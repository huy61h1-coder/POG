import express from "express";
import multer from "multer";
import { Pool } from "pg";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { strToU8, zipSync } from "fflate";
import { normalizeImageUrl, normalizeMasterProduct } from "./lib/master-data.mjs";
import { DAILY_REPORT_COLUMNS, parseCustomerRows, customerFieldsFromReport } from "./lib/customer-data.mjs";
import { readCustomerWorkbookSheets } from "./lib/customer-workbook.mjs";
import { parsePurchaseRows } from "./lib/purchase-history.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const configuredDataDir = String(process.env.DATA_DIR || "").trim();
const dataDir = path.resolve(root, configuredDataDir || "data");
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || path.join(dataDir,"uploads"));
const importDir = path.join(dataDir,"master-imports");
const statePath = path.join(dataDir, "store.json");
const stateBackupPath = path.join(dataDir, "store.backup.json");
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const dataDirRelativeToRoot = path.relative(root,dataDir);
const dataDirInsideProject = !dataDirRelativeToRoot || (!dataDirRelativeToRoot.startsWith(".."+path.sep) && dataDirRelativeToRoot!=="..");
const uploadDirRelativeToRoot = path.relative(root,uploadDir);
const uploadDirInsideProject = !uploadDirRelativeToRoot || (!uploadDirRelativeToRoot.startsWith(".."+path.sep) && uploadDirRelativeToRoot!=="..");
let lastLocalBackupAt=0;
const localBackupIntervalMs=5*60_000;
const scryptAsync = promisify(scryptCallback);
const sessionMaxAgeSeconds = 12 * 60 * 60;
const masterImportMaxRows = 500_000;
const masterImportMaxFileBytes = 100 * 1024 * 1024;

const lineDefaults = [
  ["01","Souvenir","#dfb100",""],["02","Choco","#c00057",""],["03","Fruit","#c8185d",""],["04","Confec","#bf0d59",""],
  ["05","Milk","#62676a",""],["06","Milk","#62676a",""],["07","Kid","#bf0d59",""],["08","Kid","#bf0d59",""],
  ["09","Nonfood","#07978d",""],["10","Home Coordy","#214ab5","TOPVALU"],["11","Home Coordy","#214ab5","TOPVALU"],["12","Household","#214ab5",""],
  ["13","Household","#214ab5",""],["14","Nonfood","#07978d",""],["15","Nonfood","#07978d",""],["16","Nonfood","#07978d",""],
  ["17","Beer Liquor","#62676a",""],["18","Tea Drinks","#dfb100",""],["19","Coffee","#dfb100",""],["20","Topvalu","#b00059","TOPVALU"],
  ["21","Topvalu","#b00059","TOPVALU"],["22","Asia","#62676a",""],["23","Asia","#62676a",""],["24","Noodles","#62676a",""],
  ["25","Rice","#62676a",""],["26","Sauces","#62676a",""],["27","Spices","#62676a",""],["28","Sea Food","#62676a",""],
];

function initialState() {
  const now = Date.now();
  return {
    products: [
      { id:"p1",sku:"10531914",barcode:"45497410531914",supplierBarcode:"45497410531914",name:"HC TẤM TRẢI LÀM MÁT ICECOLD 160X200GY",division:"12",divisionName:"HOME & LIVING",department:"1201",departmentName:"HOME COORDY",line:"12",lineName:"HOUSEHOLD",side:"A",bay:3,price:450000,stock:5,loss:0,expDate:"2026-12-31",updatedAt:now },
      { id:"p2",sku:"10763049",barcode:"45497410763049",supplierBarcode:"45497410763049",name:"HC GỐI MOCHI PILLOW BE",division:"12",divisionName:"HOME & LIVING",department:"1201",departmentName:"HOME COORDY",line:"12",lineName:"HOUSEHOLD",side:"B",bay:2,price:185000,stock:45,loss:2,expDate:"2026-06-15",updatedAt:now },
      { id:"p3",sku:"8969583",barcode:"8801260418800",supplierBarcode:"8801260418800",name:"BVS SOONSOOHANMYEON 23CM 18 MIẾNG",division:"10",divisionName:"HEALTH & BEAUTY",department:"1002",departmentName:"FEMININE CARE",line:"16",lineName:"NONFOOD",side:"A",bay:5,price:45000,stock:0,loss:0,expDate:"2027-01-10",updatedAt:now },
    ],
    accounts: [], sessions: [], roles: [], logs: [], picking: [], orderHistory: [], customers: [], dailyReports: [], purchaseHistory: [], pogFiles: [], stockRecords: [], manualChecks: [], stockImport: null,
    // Keep the legacy logoSize field as a desktop alias for older clients,
    // while storing independent desktop/mobile sizes for the responsive UI.
    appBrand: { logo:"/aeon-logo.svg", logoSize:220, logoSizeDesktop:220, logoSizeMobile:120, updatedAt:now },
    lineConfigs: lineDefaults.map(([line,name,color,logo]) => ({ line,name,color,logo,updatedAt:now })),
  };
}

async function writeLocalState(state) {
  const tempPath=path.join(path.dirname(statePath),".store-"+randomUUID()+".tmp"),handle=await fs.open(tempPath,"w",0o600);
  try {
    const entries=Object.entries(state);await handle.write("{");
    for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
      const [key,value]=entries[entryIndex];if(entryIndex)await handle.write(",");await handle.write(JSON.stringify(key)+":");
      if((key==="products"||key==="stockRecords")&&Array.isArray(value)){
        await handle.write("[");
        for(let index=0;index<value.length;index+=1000){const batch=value.slice(index,index+1000).map((item)=>JSON.stringify(item)).join(",");await handle.write((index?",":"")+batch);}
        await handle.write("]");
      }else await handle.write(JSON.stringify(value));
    }
    await handle.write("}");await handle.sync();
  } catch(error){await handle.close();await fs.unlink(tempPath).catch(()=>undefined);throw error;}
  await handle.close();
  try {
    if(existsSync(statePath)&&Date.now()-lastLocalBackupAt>=localBackupIntervalMs){
      const backupTempPath=stateBackupPath+"."+randomUUID()+".tmp";
      try { await fs.copyFile(statePath,backupTempPath);await fs.rename(backupTempPath,stateBackupPath);lastLocalBackupAt=Date.now(); }
      catch(error){await fs.unlink(backupTempPath).catch(()=>undefined);console.warn("Could not refresh local data backup:",error instanceof Error?error.message:error);}
    }
    await fs.rename(tempPath,statePath);
  }
  catch(error){await fs.unlink(tempPath).catch(()=>undefined);throw error;}
}

function asText(value, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function asInt(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }
function asDecimal(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const raw = asText(value);
  if (!raw) return fallback;
  const compact = raw.replace(/\s/g, ""), comma = compact.lastIndexOf(","), dot = compact.lastIndexOf(".");
  let normalized = compact;
  if (comma >= 0 && dot >= 0) normalized = comma > dot ? compact.replace(/\./g, "").replace(",", ".") : compact.replace(/,/g, "");
  else if (comma >= 0) {
    const parts = compact.split(",");
    normalized = parts.length > 2 || (parts.length === 2 && parts[1].length === 3) ? compact.replace(/,/g, "") : compact.replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function cleanLine(value) { const digits=asText(value, "01").replace(/\D/g, ""); return (digits||"1").padStart(2, "0").slice(0, 3); }
function canManage(role) { const normalized=String(role||"").toUpperCase(); return normalized === "ADMIN" || normalized === "MANAGER"; }
function normalizeText(value) { return asText(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLowerCase(); }
function normalizePhone(value) { return asText(value).replace(/[^\d+]/g,"").slice(0,24); }
function localDateKey(value=Date.now()) {
  const date=new Date(value),time=date.getTime();
  if(!Number.isFinite(time))return "";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function normalizeOrderDate(value,fallback=Date.now()) {
  const text=asText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:localDateKey(fallback);
}
async function readCustomerWorkbook(source) {
  const sheets=await readCustomerWorkbookSheets(source);
  const candidates=[];
  for(const sheet of Array.isArray(sheets)?sheets:[]){
    try {
      const parsed=parseCustomerRows(sheet.data);
      candidates.push({sheetName:asText(sheet.sheet),...parsed});
    } catch { /* Ignore cover, template, and unrelated sheets. */ }
  }
  if(!candidates.length)throw new Error("File Excel khách hàng không có sheet chứa cột SĐT và TÊN KHÁCH HÀNG.");
  candidates.sort((left,right)=>right.records.length-left.records.length);
  return candidates[0];
}
async function readPurchaseWorkbook(source,period){
  const sheets=await readCustomerWorkbookSheets(source),allSheets=Array.isArray(sheets)?sheets:[],monthSheets=allSheets.filter((sheet)=>normalizeText(sheet.sheet).includes("thang"));
  if(!monthSheets.length)throw new Error("File Excel lịch sử mua hàng cần có sheet có chữ “tháng” (ví dụ: Tháng 09 hoặc Tháng 09-2026).");
  const candidates=[];
  for(const sheet of monthSheets){try{const parsed=parsePurchaseRows(sheet.data,{period});candidates.push({sheetName:asText(sheet.sheet),...parsed});}catch{/* Ignore cover/template sheets inside the selected month worksheets. */}}
  if(!candidates.length)throw new Error("Sheet có chữ “tháng” không chứa cột SĐT hợp lệ.");
  candidates.sort((left,right)=>right.records.length-left.records.length);return candidates[0];
}
const customerStorageFields=["name","status","vatExport","memberCard","group","companyName","email","taxId","vatAddress","deliveryAddress"];
const customerStorageColumns=["name","status","vat_export","member_card","group_name","company_name","email","tax_id","vat_address","delivery_address"];
let customerStorageCache=null,customerStorageCacheAt=0,customerStorageReady=false,purchaseStorageReady=false,dailyReportsStorageReady=false;
function invalidateCustomerStorageCache(){customerStorageCache=null;customerStorageCacheAt=0;}
function normalizedCustomerRecord(source,now=Date.now()) {
  const fields=customerFieldsFromReport(source||{});
  if(source&&typeof source==="object"){fields.phone=asText(fields.phone)||asText(source.phone);fields.name=asText(fields.name)||asText(source.name);fields.status=asText(fields.status)||asText(source.status);fields.vatExport=asText(fields.vatExport)||asText(source.vatExport);fields.memberCard=asText(fields.memberCard)||asText(source.memberCard);fields.group=asText(fields.group)||asText(source.group);fields.companyName=asText(fields.companyName)||asText(source.companyName);fields.email=asText(fields.email)||asText(source.email);fields.taxId=asText(fields.taxId)||asText(source.taxId);fields.vatAddress=asText(fields.vatAddress)||asText(source.vatAddress);fields.deliveryAddress=asText(fields.deliveryAddress)||asText(source.deliveryAddress);}
  const phone=normalizePhone(fields.phone);
  if(phone.replace(/\D/g,"").length<8)return null;
  const record={id:asText(source?.id)||randomUUID(),phone,createdAt:asInt(source?.createdAt,now),updatedAt:now};
  for(const field of customerStorageFields)record[field]=asText(fields[field]).slice(0,4000);
  return record;
}
function customerFromStorageRow(row) {
  return {id:asText(row.id)||randomUUID(),phone:normalizePhone(row.phone),name:asText(row.name),status:asText(row.status),vatExport:asText(row.vat_export),memberCard:asText(row.member_card),group:asText(row.group_name),companyName:asText(row.company_name),email:asText(row.email),taxId:asText(row.tax_id),vatAddress:asText(row.vat_address),deliveryAddress:asText(row.delivery_address),createdAt:asInt(row.created_at,Date.now()),updatedAt:asInt(row.updated_at,Date.now())};
}
async function readPersistentCustomers(fallback=[]) {
  if(!pool||!customerStorageReady)return fallback;
  if(customerStorageCache&&Date.now()-customerStorageCacheAt<30_000)return customerStorageCache.map((item)=>({...item}));
  const result=await pool.query("SELECT id,phone,name,status,vat_export,member_card,group_name,company_name,email,tax_id,vat_address,delivery_address,created_at,updated_at FROM fulfillment_customers ORDER BY updated_at DESC, phone ASC");
  customerStorageCache=result.rows.map(customerFromStorageRow);customerStorageCacheAt=Date.now();
  return customerStorageCache.map((item)=>({...item}));
}
async function upsertPersistentCustomers(sources) {
  if(!pool||!customerStorageReady)throw new Error("Kho lưu trữ khách hàng PostgreSQL chưa sẵn sàng.");
  const byPhone=new Map(),now=Date.now();
  for(const source of Array.isArray(sources)?sources:[]){
    const record=normalizedCustomerRecord(source,now);if(!record)continue;
    const previous=byPhone.get(record.phone);
    if(previous){for(const field of customerStorageFields)if(record[field])previous[field]=record[field];}
    else byPhone.set(record.phone,record);
  }
  const records=[...byPhone.values()];let created=0,updated=0;
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    for(let start=0;start<records.length;start+=250){
      const batch=records.slice(start,start+250),phones=batch.map((item)=>item.phone),existingResult=await client.query("SELECT phone FROM fulfillment_customers WHERE phone=ANY($1::text[])",[phones]),existing=new Set(existingResult.rows.map((row)=>normalizePhone(row.phone)));
      for(const record of batch){if(existing.has(record.phone))updated++;else created++;}
      const values=[],rows=batch.map((record,rowIndex)=>{
        const offset=rowIndex*14+1;values.push(record.id,record.phone,...customerStorageFields.map((field)=>record[field]),record.createdAt,record.updatedAt);
        return "("+Array.from({length:14},(_,index)=>"$"+(offset+index)).join(",")+")";
      });
      const updates=customerStorageColumns.map((column)=>`${column}=CASE WHEN EXCLUDED.${column}<>'' THEN EXCLUDED.${column} ELSE fulfillment_customers.${column} END`).join(",");
      await client.query(`INSERT INTO fulfillment_customers (id,phone,${customerStorageColumns.join(",")},created_at,updated_at) VALUES ${rows.join(",")} ON CONFLICT (phone) DO UPDATE SET ${updates},updated_at=EXCLUDED.updated_at`,values);
    }
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined);throw error; }
  finally { client.release(); }
  invalidateCustomerStorageCache();const customers=await readPersistentCustomers(),total=customers.length;
  return {created,updated,total,customers};
}

const dailyReportDbColumns=DAILY_REPORT_COLUMNS.map(([key])=>key.replace(/[A-Z]/g,(letter)=>"_"+letter.toLowerCase()));
const dailyReportNumericKeys=new Set(["invoiceValue","remainingInvoiceValue"]);
function dailyReportFromStorageRow(row){
  const report={id:asText(row.id)||randomUUID()};
  DAILY_REPORT_COLUMNS.forEach(([key],index)=>{const value=row[dailyReportDbColumns[index]];report[key]=dailyReportNumericKeys.has(key)?Number(value)||0:asText(value);});
  report.createdAt=asInt(row.created_at,Date.now());report.updatedAt=asInt(row.updated_at,report.createdAt);report.createdBy=asText(row.created_by);return report;
}
function normalizedDailyReportInput(source){
  const input=source&&typeof source==="object"?source:{};
  const report=Object.fromEntries(DAILY_REPORT_COLUMNS.map(([key])=>[key,asText(input[key]).slice(0,2000)]));
  report.id=asText(input.id);
  report.phone=normalizePhone(input.phone);report.date=normalizeOrderDate(input.date,Date.now());report.invoiceValue=Math.max(0,asDecimal(input.invoiceValue));report.remainingInvoiceValue=Math.max(0,asDecimal(input.remainingInvoiceValue));
  if(report.phone.replace(/\D/g,"").length<8)return {error:"Số điện thoại khách hàng cần ít nhất 8 chữ số"};
  if(!report.customerName)return {error:"Tên khách hàng là bắt buộc"};
  if(!report.employeeName)return {error:"Tên nhân viên là bắt buộc"};
  return {report,customerFields:customerFieldsFromReport(report)};
}
async function upsertPersistentCustomerWithClient(client,source){
  const record=normalizedCustomerRecord(source);if(!record)return null;
  const values=[record.id,record.phone,...customerStorageFields.map((field)=>record[field]),record.createdAt,record.updatedAt];
  const updates=customerStorageColumns.map((column)=>`${column}=CASE WHEN EXCLUDED.${column}<>'' THEN EXCLUDED.${column} ELSE fulfillment_customers.${column} END`).join(",");
  const result=await client.query(`INSERT INTO fulfillment_customers (id,phone,${customerStorageColumns.join(",")},created_at,updated_at) VALUES (${Array.from({length:14},(_,index)=>"$"+(index+1)).join(",")}) ON CONFLICT (phone) DO UPDATE SET ${updates},updated_at=EXCLUDED.updated_at RETURNING id,phone,name,status,vat_export,member_card,group_name,company_name,email,tax_id,vat_address,delivery_address,created_at,updated_at`,values);
  invalidateCustomerStorageCache();return result.rows[0]?customerFromStorageRow(result.rows[0]):null;
}
async function upsertDailyReportWithClient(client,report,actorName){
  const id=asText(report.id)||randomUUID(),now=Date.now(),createdAt=asInt(report.createdAt,now),createdBy=asText(report.createdBy,actorName);
  const values=[id,...DAILY_REPORT_COLUMNS.map(([key])=>dailyReportNumericKeys.has(key)?Number(report[key])||0:asText(report[key]).slice(0,2000)),createdAt,now,createdBy];
  const columns=["id",...dailyReportDbColumns,"created_at","updated_at","created_by"];
  const updates=dailyReportDbColumns.map((column)=>`${column}=EXCLUDED.${column}`).concat(["updated_at=EXCLUDED.updated_at","created_by=fulfillment_daily_reports.created_by"]).join(",");
  const result=await client.query(`INSERT INTO fulfillment_daily_reports (${columns.join(",")}) VALUES (${values.map((_,index)=>"$"+(index+1)).join(",")}) ON CONFLICT (id) DO UPDATE SET ${updates} RETURNING ${columns.join(",")}`,values);
  return result.rows[0]?dailyReportFromStorageRow(result.rows[0]):null;
}
async function persistDailyReportFast(report,actorName){
  const client=await pool.connect();
  try { await client.query("BEGIN");const customer=customerStorageReady?await upsertPersistentCustomerWithClient(client,customerFieldsFromReport(report)):null;const savedReport=await upsertDailyReportWithClient(client,report,actorName);await client.query("COMMIT");return {report:savedReport,customer}; }
  catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}
  finally {client.release();}
}
async function readPersistentDailyReports(month){
  const result=await pool.query(`SELECT id,${dailyReportDbColumns.join(",")},created_at,updated_at,created_by FROM fulfillment_daily_reports WHERE date LIKE $1 ORDER BY date DESC,created_at DESC`,[asText(month)+"%"]);return result.rows.map(dailyReportFromStorageRow);
}
function purchaseFromStorageRow(row){return {id:asText(row.source_key),period:asText(row.period),phone:normalizePhone(row.phone),customerName:asText(row.customer_name),address:asText(row.address),date:asText(row.purchase_date),invoiceNumber:asText(row.invoice_number),invoiceValue:Number(row.invoice_value)||0,products:asText(row.products),sourceName:asText(row.source_name),sourceRow:asInt(row.source_row),updatedAt:asInt(row.updated_at,Date.now())};}
function purchaseRecordKey(record){return [asText(record.period),normalizePhone(record.phone),asText(record.date),asText(record.invoiceNumber),asInt(record.rowNumber,record.sourceRow)].join("|").slice(0,500);}
async function readPersistentPurchaseHistory(fallback=[],year=""){
  if(!pool||!purchaseStorageReady)return fallback;
  const scope=/^\d{4}$/.test(asText(year));
  const result=scope
    ?await pool.query("SELECT source_key,period,phone,customer_name,address,purchase_date,invoice_number,invoice_value,products,source_name,source_row,updated_at FROM fulfillment_purchase_history WHERE period LIKE $1 ORDER BY purchase_date DESC, source_row ASC",[asText(year)+"-%"])
    :await pool.query("SELECT source_key,period,phone,customer_name,address,purchase_date,invoice_number,invoice_value,products,source_name,source_row,updated_at FROM fulfillment_purchase_history ORDER BY purchase_date DESC, source_row ASC");
  return result.rows.map(purchaseFromStorageRow);
}
async function upsertPersistentPurchaseHistory(records,sourceName){
  if(!pool||!purchaseStorageReady)throw new Error("Kho lịch sử mua hàng PostgreSQL chưa sẵn sàng.");
  const rows=(Array.isArray(records)?records:[]).map((record)=>{const period=asText(record.period),phone=normalizePhone(record.phone),date=asText(record.date),invoice=asText(record.invoiceNumber),sourceRow=asInt(record.rowNumber,record.sourceRow);return {sourceKey:purchaseRecordKey({...record,period,phone,date,invoiceNumber:invoice,sourceRow}),period,phone,customerName:asText(record.customerName).slice(0,4000),address:asText(record.address).slice(0,4000),date,invoiceNumber:invoice.slice(0,200),invoiceValue:Number(record.invoiceValue)||0,products:asText(record.products).slice(0,4000),sourceName:asText(sourceName).slice(0,300),sourceRow};}).filter((record)=>record.period&&record.phone.length>=8);
  const byKey=new Map(rows.map((record)=>[record.sourceKey,record]));const unique=[...byKey.values()],client=await pool.connect();let created=0,updated=0;
  try { await client.query("BEGIN"); for(let start=0;start<unique.length;start+=250){const batch=unique.slice(start,start+250),values=[],tuples=batch.map((record,index)=>{const offset=index*12+1;values.push(record.sourceKey,record.period,record.phone,record.customerName,record.address,record.date,record.invoiceNumber,record.invoiceValue,record.products,record.sourceName,record.sourceRow,Date.now());return "("+Array.from({length:12},(_,item)=>"$"+(offset+item)).join(",")+")";});const existing=await client.query("SELECT source_key FROM fulfillment_purchase_history WHERE source_key=ANY($1::text[])",[batch.map((record)=>record.sourceKey)]);const existingKeys=new Set(existing.rows.map((row)=>row.source_key));for(const record of batch){if(existingKeys.has(record.sourceKey))updated++;else created++;}await client.query(`INSERT INTO fulfillment_purchase_history (source_key,period,phone,customer_name,address,purchase_date,invoice_number,invoice_value,products,source_name,source_row,updated_at) VALUES ${tuples.join(",")} ON CONFLICT (source_key) DO UPDATE SET period=EXCLUDED.period,phone=EXCLUDED.phone,customer_name=EXCLUDED.customer_name,address=EXCLUDED.address,purchase_date=EXCLUDED.purchase_date,invoice_number=EXCLUDED.invoice_number,invoice_value=EXCLUDED.invoice_value,products=EXCLUDED.products,source_name=EXCLUDED.source_name,source_row=EXCLUDED.source_row,updated_at=EXCLUDED.updated_at`,values); } await client.query("COMMIT"); } catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;} finally {client.release();}
  return {created,updated,imported:unique.length};
}
function purchaseSummary(records,month){
  const selectedMonth=/^\d{4}-\d{2}$/.test(asText(month))?asText(month):localDateKey().slice(0,7),year=selectedMonth.slice(0,4),yearRows=records.filter((record)=>record.period.startsWith(year)),monthRows=yearRows.filter((record)=>record.period===selectedMonth),groups=new Map();
  for(const record of yearRows){const key=normalizePhone(record.phone)||`${normalizeText(record.customerName)}|${normalizeText(record.address)}`;const current=groups.get(key)||{phone:record.phone,customerName:record.customerName,address:record.address,yearTotal:0,monthTotal:0,monthlyTotals:{},orders:0};current.phone=current.phone||record.phone;current.customerName=current.customerName||record.customerName;current.address=current.address||record.address;current.yearTotal+=Number(record.invoiceValue)||0;current.monthlyTotals[record.period]=(current.monthlyTotals[record.period]||0)+(Number(record.invoiceValue)||0);if(record.period===selectedMonth)current.monthTotal+=Number(record.invoiceValue)||0;current.orders++;groups.set(key,current);}
  const customers=[...groups.values()].sort((left,right)=>right.monthTotal-left.monthTotal||right.yearTotal-left.yearTotal||left.customerName.localeCompare(right.customerName,"vi"));
  return {month:selectedMonth,year,records:monthRows,customers,totals:{monthValue:monthRows.reduce((sum,row)=>sum+(Number(row.invoiceValue)||0),0),yearValue:yearRows.reduce((sum,row)=>sum+(Number(row.invoiceValue)||0),0),monthOrders:monthRows.length,yearOrders:yearRows.length,customerCount:customers.length}};
}
function normalizedPurchaseRecord(record,period,sourceName){const normalized={period,phone:normalizePhone(record.phone),customerName:asText(record.customerName),address:asText(record.address),date:asText(record.date)||`${period}-01`,invoiceNumber:asText(record.invoiceNumber),invoiceValue:Number(record.invoiceValue)||0,products:asText(record.products),sourceName:asText(sourceName),sourceRow:asInt(record.rowNumber)};return {...normalized,id:purchaseRecordKey(normalized),updatedAt:Date.now()};}
const defaultLineNames = new Map(lineDefaults.map(([line,name]) => [line,name.toUpperCase()]));
function ensureStateShape(source) {
  const state=source&&typeof source==="object"?source:initialState();
  state.products=(Array.isArray(state.products)?state.products:[]).map((product)=>normalizeMasterProduct(product,defaultLineNames.get(cleanLine(product?.line))||""));
  state.accounts=Array.isArray(state.accounts)?state.accounts:[];
  state.sessions=(Array.isArray(state.sessions)?state.sessions:[]).filter((session)=>Number(session.expiresAt)>Date.now());
  state.roles=Array.isArray(state.roles)?state.roles:[];
  state.logs=Array.isArray(state.logs)?state.logs:[];
  state.picking=Array.isArray(state.picking)?state.picking:[];
  state.orderHistory=Array.isArray(state.orderHistory)?state.orderHistory:[];
  state.customers=Array.isArray(state.customers)?state.customers.filter((item)=>asText(item?.phone)).map((item)=>({id:asText(item.id)||randomUUID(),phone:normalizePhone(item.phone),name:asText(item.name),status:asText(item.status),vatExport:asText(item.vatExport),memberCard:asText(item.memberCard),group:asText(item.group),companyName:asText(item.companyName),email:asText(item.email),taxId:asText(item.taxId),vatAddress:asText(item.vatAddress),deliveryAddress:asText(item.deliveryAddress),createdAt:asInt(item.createdAt,Date.now()),updatedAt:asInt(item.updatedAt,Date.now())})):[];
  state.dailyReports=Array.isArray(state.dailyReports)?state.dailyReports.filter((item)=>asText(item?.id)).map((item)=>({id:asText(item.id),...Object.fromEntries(DAILY_REPORT_COLUMNS.map(([key])=>[key,asText(item[key])])),invoiceValue:Number(item.invoiceValue)||0,remainingInvoiceValue:Number(item.remainingInvoiceValue)||0,createdAt:asInt(item.createdAt,Date.now()),updatedAt:asInt(item.updatedAt,Date.now()),createdBy:asText(item.createdBy)})):[];
  state.purchaseHistory=Array.isArray(state.purchaseHistory)?state.purchaseHistory.filter((item)=>asText(item?.period)&&asText(item?.phone)).map((item)=>({id:asText(item.id)||randomUUID(),period:asText(item.period),phone:normalizePhone(item.phone),customerName:asText(item.customerName),address:asText(item.address),date:asText(item.date),invoiceNumber:asText(item.invoiceNumber),invoiceValue:Number(item.invoiceValue)||0,products:asText(item.products),sourceName:asText(item.sourceName),sourceRow:asInt(item.sourceRow),updatedAt:asInt(item.updatedAt,Date.now())})):[];
  state.pogFiles=Array.isArray(state.pogFiles)?state.pogFiles:[];
  state.stockRecords=Array.isArray(state.stockRecords)?state.stockRecords.filter((item)=>asText(item?.sku)).map((item)=>({sku:asText(item.sku),name:asText(item.name),division:asText(item.division),divisionName:asText(item.divisionName),department:asText(item.department),departmentName:asText(item.departmentName),stock:Math.max(0,asInt(item.stock)),sales:Math.max(0,asInt(item.sales)),updatedAt:asInt(item.updatedAt,Date.now())})):[];
  const validCheckDate=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(asText(value))?asText(value):"";
  state.manualChecks=Array.isArray(state.manualChecks)?state.manualChecks.filter((item)=>asText(item?.productId)).map((item)=>{const withdrawDate=validCheckDate(item.withdrawDate)||validCheckDate(item.expDate);return {productId:asText(item.productId),stock:item.stock===undefined?undefined:Math.max(0,asInt(item.stock)),loss:item.loss===undefined?undefined:Math.max(0,asInt(item.loss)),inboundDate:validCheckDate(item.inboundDate),withdrawDate,expDate:withdrawDate,updatedAt:asInt(item.updatedAt,Date.now())};}):[];
  state.stockImport=state.stockImport&&typeof state.stockImport==="object"?state.stockImport:null;
  const savedBrand=state.appBrand&&typeof state.appBrand==="object"&&typeof state.appBrand.logo==="string"?state.appBrand:null;
  const legacyLogoSize=Math.max(50,Math.min(320,asInt(savedBrand?.logoSize,220)));
  const logoSizeDesktop=Math.max(50,Math.min(320,asInt(savedBrand?.logoSizeDesktop,legacyLogoSize)));
  const logoSizeMobile=Math.max(72,Math.min(220,asInt(savedBrand?.logoSizeMobile,Math.round(legacyLogoSize*.55))));
  state.appBrand=savedBrand?{logo:savedBrand.logo,logoSize:logoSizeDesktop,logoSizeDesktop,logoSizeMobile,updatedAt:asInt(savedBrand.updatedAt,Date.now())}:{logo:"/aeon-logo.svg",logoSize:220,logoSizeDesktop:220,logoSizeMobile:120,updatedAt:Date.now()};
  state.lineConfigs=Array.isArray(state.lineConfigs)&&state.lineConfigs.length?state.lineConfigs:lineDefaults.map(([line,name,color,logo])=>({line,name,color,logo,updatedAt:Date.now()}));
  return state;
}
function normalizeUsername(value) { return asText(value).toLowerCase(); }
function validateAccountInput({username,name,password},requirePassword=true) {
  if(!/^[a-z0-9._-]{3,32}$/.test(normalizeUsername(username)))return "Tên đăng nhập cần 3–32 ký tự: chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới";
  if(asText(name).length<2||asText(name).length>64)return "Tên hiển thị cần từ 2 đến 64 ký tự";
  if(requirePassword&&(typeof password!=="string"||password.length<8||password.length>128))return "Mật khẩu cần từ 8 đến 128 ký tự";
  return "";
}
async function hashPassword(password) {
  const salt=randomBytes(16).toString("hex");
  const derived=Buffer.from(await scryptAsync(password,salt,64));
  return "scrypt:"+salt+":"+derived.toString("hex");
}
async function verifyPassword(password,stored) {
  const [scheme,salt,encoded]=asText(stored).split(":");
  if(scheme!=="scrypt"||!salt||!/^[a-f0-9]{128}$/i.test(encoded||""))return false;
  const expected=Buffer.from(encoded,"hex"),actual=Buffer.from(await scryptAsync(password,salt,expected.length));
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
function publicAccount(account) {
  return {userId:account.id,username:account.username,email:account.username,name:account.name,role:account.role,workType:["PICKING","DELIVERY","BOTH"].includes(account.workType)?account.workType:"BOTH",active:account.active!==false,createdAt:account.createdAt,updatedAt:account.updatedAt};
}
function sessionCookie(sessionId,maxAge=sessionMaxAgeSeconds) {
  return "fulfillment_session="+encodeURIComponent(sessionId||"")+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+maxAge+(production?"; Secure":"");
}
function createSession(state,accountId) {
  const now=Date.now(),token=randomBytes(32).toString("base64url"),session={tokenHash:createHash("sha256").update(token).digest("hex"),accountId,createdAt:now,expiresAt:now+sessionMaxAgeSeconds*1000};
  state.sessions=state.sessions.filter((item)=>item.accountId!==accountId||item.expiresAt>now).slice(-199);
  state.sessions.push(session);
  return {session,token};
}
function audit(state, actor, action) {
  state.logs.unshift({ id: randomUUID(), action, userId: actor.userId, userName: actor.name, createdAt: Date.now() });
  state.logs = state.logs.slice(0, 500);
}
function xmlEscape(value) {
  return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function excelColumnName(index) {
  let value="",number=index+1;
  while(number>0){const remainder=(number-1)%26;value=String.fromCharCode(65+remainder)+value;number=Math.floor((number-1)/26);}
  return value;
}
function createXlsx(rows) {
  const sheetRows=rows.map((row,rowIndex)=>`<row r="${rowIndex+1}">${row.map((value,columnIndex)=>{
    const ref=excelColumnName(columnIndex)+(rowIndex+1),numeric=typeof value==="number"&&Number.isFinite(value);
    if(numeric)return `<c r="${ref}" t="n"><v>${value}</v></c>`;
    const text=String(value??""),safe=/^[=+\-@]/.test(text)?"'"+text:text;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(safe)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const files={
    "[Content_Types].xml":`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels":`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml":`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Don soan" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml":`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name,content])=>[name,strToU8(content)])),{level:6});
}

const aiRateWindows = new Map();
const aiIntentGroups = [
  { triggers:["canh chua","canh chua ca","canh chua tom"], keywords:["ca","tom","thit","dau bam","ca chua","dua","bac ha","rau","gia vi","nuoc mam","me","chanh","ot","hanh","ngo"] },
  { triggers:["pho bo","pho","noodle soup"], keywords:["banh pho","bo","thit bo","hanh","rau thom","gia do","chanh","ot","nuoc mam","tieu","que","hoi"] },
  { triggers:["pho ga","chicken pho"], keywords:["banh pho","ga","thit ga","hanh","rau thom","gia do","chanh","ot","nuoc mam","tieu"] },
  { triggers:["bun bo","bun thit nuong"], keywords:["bun","bo","thit bo","thit heo","rau song","gia do","sa","hanh","nuoc mam","ot","dau phong"] },
  { triggers:["bun cha","bun nem"], keywords:["bun","thit heo","cha","rau song","du du","ca rot","nuoc mam","hanh","toi","ot"] },
  { triggers:["goi cuon","cuon","spring roll"], keywords:["banh trang","bun","tom","thit heo","rau song","xa lach","dua leo","hanh","nuoc cham"] },
  { triggers:["com chien","com rang","fried rice"], keywords:["gao","com","trung","thit","tom","ca rot","dau ha lan","hanh","dau an","nuoc tuong"] },
  { triggers:["mi xao","mi tron","stir fry"], keywords:["mi","thit","tom","hai san","rau","cai","ca rot","dau an","nuoc tuong","dau hao"] },
  { triggers:["lau","hotpot"], keywords:["rau","nam","thit","hai san","tom","ca","dau phu","mi","bun","sot","nuoc dung","sa","ot","do uong"] },
  { triggers:["nuong","bbq","grill"], keywords:["thit","bo","heo","ga","hai san","tom","muc","rau","nam","sot","nuoc tuong","dau an","do uong"] },
  { triggers:["salad","sa lat","rau tron"], keywords:["xa lach","rau","ca chua","dua leo","bap","ca rot","trung","uc ga","ca ngu","sot","dau oliu","chanh"] },
  { triggers:["ga ran","ga chien","fried chicken"], keywords:["ga","thit ga","bot chien","bot mi","dau an","tuong ot","tuong ca","chanh","salad"] },
  { triggers:["cari","ca ri","curry"], keywords:["thit bo","thit ga","tom","khoai tay","ca rot","hanh","nuoc cot dua","bot ca ri","sa","ot","gao"] },
  { triggers:["sushi","sashimi"], keywords:["gao","rong bien","ca hoi","ca ngu","tom","trung","dua leo","bo","giam","nuoc tuong","wasabi"] },
  { triggers:["banh mi","sandwich"], keywords:["banh mi","thit","cha","trung","pho mai","bo","xa lach","ca chua","dua leo","sot"] },
  { triggers:["bua sang","an sang"], keywords:["sua","banh","ngu coc","ca phe","tra","trung","yogurt","pho mai","trai cay"] },
  { triggers:["sinh nhat","tiec"], keywords:["banh","keo","chocolate","nuoc","tra","ca phe","trang tri","dia","ly"] },
  { triggers:["du lich","da ngoai","picnic"], keywords:["nuoc","banh","mi","do hop","khan","tui","thit","xuc xich","trai cay","nonfood"] },
];
const aiStopWords = new Set(["cho","voi","va","cua","mot","nhieu","nguoi","phan","mon","can","mua","nau","lam","tai","theo","uu","tien","dang","co","san","pham"]);
const aiDishWords = new Set(["pho","bun","com","lau","salad","sushi","sashimi","curry","cari","mi","goi","banh","nuong","bbq","sandwich","spring","roll"]);
const aiEssentialTerms = new Set(["banh pho","thit bo","bo","thit ga","ga","bun","thit heo","heo","tom","ca","hai san","nam","rau","xa lach","gao","com","trung","dau phu","khoai tay","ca rot","banh trang","mi","banh mi","pho mai","ca hoi","ca ngu","xuc xich","thit","muc"]);

function availableProducts(products) {
  const today = new Date().toISOString().slice(0,10);
  return products.filter((product) => product.stock > 0 && (!product.expDate || product.expDate >= today));
}

const stockIndexCache=new WeakMap(),productSkuIndexCache=new WeakMap(),stockRowsCache=new WeakMap(),pogRowsCache=new WeakMap();
function stockIndex(records) {
  let index=stockIndexCache.get(records);if(index)return index;
  index=new Map(records.map((record)=>[normalizeText(record.sku),record]));stockIndexCache.set(records,index);return index;
}
function productSkuIndex(products) {
  let index=productSkuIndexCache.get(products);if(index)return index;
  index=new Map();for(const product of products){const key=normalizeText(product.sku);if(key&&!index.has(key))index.set(key,product);}productSkuIndexCache.set(products,index);return index;
}
function withUploadedStock(product,index) {
  const record=index.get(normalizeText(product.sku));
  return {...product,stock:record?.stock??0,sales:record?.sales??product.sales??0,stockKnown:Boolean(record),loss:0,expDate:""};
}
function stockRows(state) {
  let rows=stockRowsCache.get(state);if(rows)return rows;
  const productsBySku=productSkuIndex(state.products),rowsBySku=[];
  for(const record of state.stockRecords){
    const product=productsBySku.get(normalizeText(record.sku));
    rowsBySku.push({... (product||{id:"stock-"+record.sku,sku:record.sku,name:"SKU chưa có trong Master Data",line:"--",lineName:"",side:"",bay:0}),name:asText(record.name)||product?.name||"SKU chưa có trong Master Data",division:asText(record.division)||product?.division||"",divisionName:asText(record.divisionName)||product?.divisionName||"",department:asText(record.department)||product?.department||"",departmentName:asText(record.departmentName)||product?.departmentName||"",sales:record.sales??0,stock:record.stock,stockKnown:true,updatedAt:record.updatedAt});
  }
  rowsBySku.sort((a,b)=>a.sku.localeCompare(b.sku));rows=rowsBySku;stockRowsCache.set(state,rows);return rows;
}
function pogRows(state,pogFile) {
  if(!pogFile)return [];
  let byFile=pogRowsCache.get(state);if(!byFile){byFile=new Map();pogRowsCache.set(state,byFile);}
  const cached=byFile.get(pogFile.id);if(cached)return cached;
  const uploaded=stockIndex(state.stockRecords),lookup=productLookup(state.products),byPosition=new Map();
  for(const position of pogFile.positions||[]){
    const keys=[position.sku,position.barcode].map(normalizeText).filter(Boolean),master=keys.map((key)=>lookup.get(key)).find(Boolean),record=uploaded.get(keys[0])||uploaded.get(keys[1]);
    const base=master?withUploadedStock(master,uploaded):{id:"pog-"+pogFile.id+"-"+position.number,sku:position.sku,name:position.name||"Sản phẩm đọc từ POG",division:"",divisionName:"",department:"",departmentName:"",supplierBarcode:position.barcode||position.sku,barcode:position.barcode||position.sku,line:pogFile.line||"",lineName:"",side:pogFile.side||"A",bay:1,price:0,stock:record?.stock||0,stockKnown:Boolean(record),loss:0,expDate:"",updatedAt:pogFile.updatedAt||Date.now()};
    const product={...base,sku:position.sku||base.sku,barcode:position.barcode||base.barcode||position.sku,supplierBarcode:base.supplierBarcode||position.barcode||position.sku,name:position.name||base.name};
    const key=normalizeText(product.sku||product.barcode);if(key&&!byPosition.has(key))byPosition.set(key,product);
  }
  const rows=[...byPosition.values()];byFile.set(pogFile.id,rows);return rows;
}
function manualCheckGroups(state) {
  const productsById=new Map(state.products.map((product)=>[product.id,product])),uploaded=stockIndex(state.stockRecords);
  const groups={checkLoss:[],stock:[],loss:[],expiry:[]};
  for(const check of state.manualChecks){
    const product=productsById.get(check.productId);if(!product)continue;
    const systemProduct=withUploadedStock(product,uploaded),systemStock=systemProduct.stock;
    const enriched={...systemProduct,stock:check.stock??systemStock,systemStock,stockKnown:check.stock!==undefined||systemProduct.stockKnown,loss:check.loss??product.loss,manualStock:check.stock,manualLoss:check.loss,inboundDate:check.inboundDate||"",withdrawDate:check.withdrawDate||check.expDate||"",expDate:check.withdrawDate||check.expDate||"",updatedAt:check.updatedAt};
    if(check.stock!==undefined||check.loss!==undefined)groups.checkLoss.push(enriched);
    if(check.stock!==undefined)groups.stock.push(enriched);
    if(check.loss!==undefined)groups.loss.push(enriched);
    if(check.inboundDate||check.withdrawDate||check.expDate)groups.expiry.push(enriched);
  }
  return groups;
}
function productSummary(products,stockRecords=[],manualChecks=[]) {
  const today=new Date();today.setHours(0,0,0,0);const soon=today.getTime()+30*86400000;
  const stats={total:0,outCount:0,lowCount:0,totalLoss:0,expiring:0},alerts=[],lines=new Set();
  const uploaded=stockIndex(stockRecords),manualById=new Map(manualChecks.map((item)=>[item.productId,item]));
  for(const source of products){
    const product=withUploadedStock(source,uploaded),manual=manualById.get(product.id),loss=Number(manual?.loss)||0,expiryText=asText(manual?.withdrawDate)||asText(manual?.expDate),expiry=expiryText?new Date(expiryText+"T00:00:00").getTime():Infinity;
    stats.total++;if(product.stockKnown&&product.stock===0)stats.outCount++;if(product.stockKnown&&product.stock>0&&product.stock<10)stats.lowCount++;stats.totalLoss+=loss;lines.add(product.line);
    if(expiry<=soon)stats.expiring++;
    if(alerts.length<6&&((product.stockKnown&&product.stock<10)||loss>0||expiry<=soon))alerts.push({...product,loss,expDate:expiryText});
  }
  return {stats,alerts,lines:[...lines].sort((a,b)=>Number(a)-Number(b))};
}
const productSearchCache=new WeakMap(),productLookupCache=new WeakMap(),productSearchIndexCache=new WeakMap(),productSummaryCache=new WeakMap(),productApiCache=new WeakMap(),stockApiCache=new WeakMap();
function getProductSummary(state){let summary=productSummaryCache.get(state);if(!summary){summary=productSummary(state.products,state.stockRecords,state.manualChecks);productSummaryCache.set(state,summary);}return summary;}
function productSearchText(product){let value=productSearchCache.get(product);if(!value){value=normalizeText([product.name,product.sku,product.barcode,product.supplierBarcode,product.division,product.divisionName,product.department,product.departmentName,product.line,product.lineName,product.side].join(" "));productSearchCache.set(product,value);}return value;}
function productLookup(products){let lookup=productLookupCache.get(products);if(!lookup){lookup=new Map();for(const product of products){for(const value of [product.sku,product.barcode,product.supplierBarcode]){const key=normalizeText(value);if(key&&!lookup.has(key))lookup.set(key,product);}}productLookupCache.set(products,lookup);}return lookup;}
function productSearchIndex(products){
  let index=productSearchIndexCache.get(products);if(index)return index;
  const records=[],bigrams=new Map();
  for(let productIndex=0;productIndex<products.length;productIndex++){
    const product=products[productIndex],text=productSearchText(product);records.push({product,text});
    const seen=new Set();
    for(let charIndex=0;charIndex<text.length-1;charIndex++){
      const first=text.charCodeAt(charIndex),second=text.charCodeAt(charIndex+1),firstIsAlphaNumeric=(first>=48&&first<=57)||(first>=97&&first<=122),secondIsAlphaNumeric=(second>=48&&second<=57)||(second>=97&&second<=122);
      if(!firstIsAlphaNumeric||!secondIsAlphaNumeric)continue;
      const gram=text.slice(charIndex,charIndex+2);if(seen.has(gram))continue;seen.add(gram);
      const bucket=bigrams.get(gram);if(bucket)bucket.push(productIndex);else bigrams.set(gram,[productIndex]);
    }
  }
  index={records,bigrams};productSearchIndexCache.set(products,index);return index;
}
function productSearchCandidates(query,products){
  const index=productSearchIndex(products),firstToken=query.split(/[^a-z0-9]+/).find((token)=>token.length>=2),bucket=firstToken?index.bigrams.get(firstToken.slice(0,2)):undefined;
  if(!bucket)return index.records;
  return bucket.map((productIndex)=>index.records[productIndex]).filter((entry)=>entry.text.includes(query));
}
function getProductApiCache(products){let cache=productApiCache.get(products);if(!cache){cache=new Map();productApiCache.set(products,cache);}return cache;}
function getStockApiCache(records){let cache=stockApiCache.get(records);if(!cache){cache=new Map();stockApiCache.set(records,cache);}return cache;}
function expiryRank(product){if(!product.expDate)return 0;const value=Date.parse(product.expDate+"T00:00:00");return Number.isFinite(value)?value:Number.MAX_SAFE_INTEGER;}
function pushExpiryTop(heap,product,limit){
  if(limit<=0)return;const entry={product,rank:expiryRank(product)},later=(a,b)=>a.rank>b.rank||(a.rank===b.rank&&String(a.product.sku)>String(b.product.sku));
  if(heap.length<limit){heap.push(entry);let index=heap.length-1;while(index>0){const parent=Math.floor((index-1)/2);if(!later(heap[index],heap[parent]))break;[heap[index],heap[parent]]=[heap[parent],heap[index]];index=parent;}return;}
  if(!later(heap[0],entry))return;heap[0]=entry;let index=0;for(;;){const left=index*2+1,right=left+1;let largest=index;if(left<heap.length&&later(heap[left],heap[largest]))largest=left;if(right<heap.length&&later(heap[right],heap[largest]))largest=right;if(largest===index)break;[heap[index],heap[largest]]=[heap[largest],heap[index]];index=largest;}
}

function intentTerms(query) {
  const normalized = normalizeText(query);
  const terms = new Set(normalized.split(/[^a-z0-9]+/).filter((term) => term.length > 1&&!aiStopWords.has(term)&&!aiDishWords.has(term)&&!/^[0-9]+$/.test(term)));
  for (const group of aiIntentGroups) if (group.triggers.some((trigger) => normalized.includes(trigger))) group.keywords.forEach((term) => terms.add(term));
  return [...terms];
}

function rankedProducts(query, products) {
  const terms = intentTerms(query);
  return availableProducts(products).map((product) => {
    const haystack = productSearchText(product);
    const tokenList=haystack.split(/[^a-z0-9]+/).filter(Boolean),tokens = new Set(tokenList);
    const matchesTerm=(term)=>{const parts=term.split(/\s+/).filter(Boolean);if(parts.length===1)return tokens.has(term);for(let index=0;index<=tokenList.length-parts.length;index++){if(parts.every((part,offset)=>tokenList[index+offset]===part))return true;}return false;};
    const matchedTerms=terms.filter(matchesTerm);
    const score = matchedTerms.reduce((total,term) => total + (term.includes(" ") ? (aiEssentialTerms.has(term)?20:8) : aiEssentialTerms.has(term) ? (term.length>3?7:3) : term.length > 3 ? 4 : 1),0) + Math.min(1,product.stock/50);
    return { product, score, matchedTerms };
  }).sort((a,b) => b.score-a.score || b.product.stock-a.product.stock);
}

const suggestionCache=new Map();

function localProductSuggestions(query, products, notice = "") {
  const ranked = rankedProducts(query, products);
  const matching = ranked.filter((entry) => entry.score > 2.1);
  const selected = (matching.length ? matching : ranked).slice(0,12);
  const coverage=`Đã rà soát ${products.length.toLocaleString("vi-VN")} SKU còn tồn từ Master Data và Stock.`;
  return {
    mode:"local",
    model:null,
    summary:selected.length
      ? "Đã chọn "+selected.length+" sản phẩm có sẵn phù hợp nhất với nhu cầu của bạn."
      : "Hiện chưa có sản phẩm còn hàng phù hợp trong danh sách.",
    notice:[notice,coverage].filter(Boolean).join(" "),
    items:selected.map(({product,matchedTerms}) => ({
      productId:product.id,sku:product.sku,name:product.name,line:product.line,side:product.side,bay:product.bay,
      price:product.price,stock:product.stock,quantity:1,
      reason:matchedTerms.length?"Khớp nguyên liệu "+matchedTerms.slice(0,3).join(", ")+" · còn "+product.stock:"Được chọn theo lượng tồn hiện có và danh mục Master Data."
    }))
  };
}

function takeAiQuota(userId) {
  const now=Date.now(),windowMs=60_000,limit=Math.max(1,Math.min(30,asInt(process.env.AI_RATE_LIMIT,8)));
  const recent=(aiRateWindows.get(userId)||[]).filter((time) => now-time<windowMs);
  if(recent.length>=limit)return Math.max(1,Math.ceil((windowMs-(now-recent[0]))/1000));
  recent.push(now);aiRateWindows.set(userId,recent);return 0;
}

async function openAiProductSuggestions(query, products) {
  const apiKey=asText(process.env.OPENAI_API_KEY);
  if(!apiKey)return localProductSuggestions(query,products,"Chưa cấu hình khóa AI; ứng dụng đang dùng bộ phân tích nội bộ.");
  // Keep the default on a public OpenAI API model. `gpt-5.4-mini` is a
  // Codex-host model name and is not necessarily available to API keys.
  const model=asText(process.env.OPENAI_MODEL,"gpt-5-mini");
  const baseUrl=asText(process.env.OPENAI_BASE_URL,"https://api.openai.com/v1").replace(/\/+$/,"");
  const catalogLimit=Math.max(50,Math.min(2000,asInt(process.env.AI_PRODUCT_LIMIT,1200)));
  const catalog=rankedProducts(query,products).slice(0,catalogLimit).map(({product}) => ({
    productId:product.id,sku:product.sku,name:product.name,division:product.division,divisionName:product.divisionName,
    department:product.department,departmentName:product.departmentName,supplierBarcode:product.supplierBarcode,
    line:product.line,lineName:product.lineName,side:product.side,bay:product.bay,
    price:product.price,stock:product.stock,expDate:product.expDate
  }));
  if(!catalog.length)return localProductSuggestions(query,products);

  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20_000);
  try {
    const response=await fetch(baseUrl+"/responses",{
      method:"POST",signal:controller.signal,
      headers:{"content-type":"application/json","authorization":"Bearer "+apiKey},
      body:JSON.stringify({
        model,store:false,max_output_tokens:1800,
        instructions:[
          "Bạn là trợ lý chọn sản phẩm cho nhân viên Fulfillment.",
          "Chỉ được chọn productId có trong DANH_SACH_SAN_PHAM; tuyệt đối không tự tạo sản phẩm.",
          "Danh sách đã được lọc còn tồn và chưa hết hạn. Với yêu cầu là một món ăn, hãy suy luận công thức phổ biến và chọn ĐẦY ĐỦ các nguyên liệu thiết yếu có trong danh sách (ví dụ canh chua cần đạm như cá/tôm, rau, quả tạo vị chua và gia vị). Không chỉ chọn một sản phẩm đại diện; có thể chọn nhiều sản phẩm thuộc các nhóm khác nhau.",
          "Trả lời bằng tiếng Việt. Lý do ngắn gọn, cụ thể và không quá 120 ký tự.",
          "Số lượng là số nguyên từ 1 đến 20. Trả tối đa 12 sản phẩm; nếu có nhiều nguyên liệu phù hợp thì trả tất cả nguyên liệu thiết yếu đang có tồn."
        ].join("\n"),
        input:"NHU_CAU: "+query+"\nDANH_SACH_SAN_PHAM:\n"+JSON.stringify(catalog),
        text:{format:{
          type:"json_schema",name:"fulfillment_product_recommendations",strict:true,
          schema:{
            type:"object",additionalProperties:false,
            properties:{
              summary:{type:"string"},
              items:{type:"array",maxItems:12,items:{
                type:"object",additionalProperties:false,
                properties:{productId:{type:"string"},quantity:{type:"integer",minimum:1,maximum:20},reason:{type:"string"}},
                required:["productId","quantity","reason"]
              }}
            },
            required:["summary","items"]
          }
        }}
      })
    });
    if(!response.ok){const error=new Error("OpenAI status "+response.status);error.status=response.status;throw error;}
    const payload=await response.json();
    const outputText=asText(payload.output_text)||asText(payload.output?.flatMap((item)=>item.content||[]).find((item)=>item.type==="output_text")?.text);
    if(!outputText)throw new Error("OpenAI returned no output text");
    const parsed=JSON.parse(outputText),byId=new Map(catalog.map((product)=>[product.productId,product])),seen=new Set();
    const items=(Array.isArray(parsed.items)?parsed.items:[]).flatMap((item)=>{
      const product=byId.get(asText(item.productId));
      if(!product||seen.has(product.productId))return [];
      seen.add(product.productId);
      return [{...product,quantity:Math.max(1,Math.min(20,asInt(item.quantity,1))),reason:asText(item.reason,"Phù hợp với nhu cầu đã nhập.").slice(0,160)}];
    });
    if(!items.length)return localProductSuggestions(query,products,"AI chưa tìm được kết quả hợp lệ; đã chuyển sang phân tích nội bộ.");
    return {mode:"ai",model,summary:asText(parsed.summary,"Đã tìm thấy "+items.length+" sản phẩm phù hợp.").slice(0,300),notice:`Đã rà soát ${products.length.toLocaleString("vi-VN")} SKU còn tồn từ Master Data và Stock.`,items};
  } catch(error) {
    const status=Number(error?.status)||0;
    const reason=status===401||status===403
      ? "API key không hợp lệ hoặc chưa có quyền truy cập model"
      : status===404
        ? "model không tồn tại hoặc không khả dụng cho API key"
        : status===429
          ? "tài khoản đã hết hạn mức hoặc đang vượt giới hạn gọi"
          : status>=500
            ? "OpenAI đang tạm thời gặp lỗi máy chủ"
            : error?.name==="AbortError"
              ? "quá thời gian chờ kết nối"
              : "không kết nối được tới OpenAI";
    console.error("AI suggestion fallback:",status||"network",error instanceof Error?error.message:"unknown error");
    return localProductSuggestions(query,products,`AI chưa phản hồi: ${reason}; kết quả dưới đây được phân tích nội bộ.`);
  } finally { clearTimeout(timeout); }
}

class StateStore {
  queue = Promise.resolve();
  localState = null;
  remoteState = null;
  remoteStateAt = 0;
  async init() {
    if(production&&!pool&&(dataDirInsideProject||uploadDirInsideProject)){
      throw new Error("Không thể chạy production khi chưa cấu hình DATABASE_URL hoặc DATA_DIR/UPLOAD_DIR là thư mục lưu trữ bền vững nằm ngoài thư mục mã nguồn.");
    }
    mkdirSync(uploadDir, { recursive: true });
    mkdirSync(importDir, { recursive: true });
    const staleBefore=Date.now()-6*60*60_000;
    for(const entry of await fs.readdir(importDir,{withFileTypes:true})){
      if(!entry.isFile()||!/^[0-9a-f-]+\.(?:xlsx|result\.json(?:\.part)?)$/i.test(entry.name))continue;
      const candidate=path.join(importDir,entry.name),stat=await fs.stat(candidate).catch(()=>null);if(stat&&stat.mtimeMs<staleBefore)await fs.unlink(candidate).catch(()=>undefined);
    }
    if (pool) {
      await pool.query("CREATE TABLE IF NOT EXISTS fulfillment_state (id BOOLEAN PRIMARY KEY DEFAULT TRUE, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("INSERT INTO fulfillment_state (id,state) VALUES (TRUE,$1::jsonb) ON CONFLICT (id) DO NOTHING", [JSON.stringify(initialState())]);
      try {
        await pool.query("CREATE TABLE IF NOT EXISTS fulfillment_customers (phone TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', vat_export TEXT NOT NULL DEFAULT '', member_card TEXT NOT NULL DEFAULT '', group_name TEXT NOT NULL DEFAULT '', company_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '', vat_address TEXT NOT NULL DEFAULT '', delivery_address TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)");
        customerStorageReady=true;
        const stored=await pool.query("SELECT COUNT(*)::int AS count FROM fulfillment_customers"),existingCount=Number(stored.rows[0]?.count)||0;
        if(existingCount===0){const legacy=ensureStateShape((await pool.query("SELECT state FROM fulfillment_state WHERE id=TRUE")).rows[0].state);if(legacy.customers.length)await upsertPersistentCustomers(legacy.customers);}
      } catch(error) {
        customerStorageReady=false;
        console.warn("Customer master table is unavailable; using durable fulfillment_state fallback:",error instanceof Error?error.message:error);
      }
      try {
        await pool.query("CREATE TABLE IF NOT EXISTS fulfillment_purchase_history (source_key TEXT PRIMARY KEY, period TEXT NOT NULL, phone TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', purchase_date TEXT NOT NULL, invoice_number TEXT NOT NULL DEFAULT '', invoice_value NUMERIC NOT NULL DEFAULT 0, products TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL DEFAULT '', source_row INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL)");
        purchaseStorageReady=true;
      } catch(error) {
        purchaseStorageReady=false;
        console.warn("Purchase history table is unavailable; using durable fulfillment_state fallback:",error instanceof Error?error.message:error);
      }
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS fulfillment_daily_reports (
          id TEXT PRIMARY KEY,
          employee_name TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, phone TEXT NOT NULL,
          customer_name TEXT NOT NULL DEFAULT '', customer_status TEXT NOT NULL DEFAULT '', vat_export TEXT NOT NULL DEFAULT '',
          order_type TEXT NOT NULL DEFAULT '', invoice_number TEXT NOT NULL DEFAULT '', invoice_value NUMERIC NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL DEFAULT '', cdo_number TEXT NOT NULL DEFAULT '', cod_number TEXT NOT NULL DEFAULT '',
          carrier TEXT NOT NULL DEFAULT '', return_status TEXT NOT NULL DEFAULT '', remaining_invoice_value NUMERIC NOT NULL DEFAULT 0,
          member_card TEXT NOT NULL DEFAULT '', customer_group TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', tax_id TEXT NOT NULL DEFAULT '',
          vat_address TEXT NOT NULL DEFAULT '', delivery_address TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
          created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, created_by TEXT NOT NULL DEFAULT ''
        )`);
        const count=Number((await pool.query("SELECT COUNT(*)::int AS count FROM fulfillment_daily_reports")).rows[0]?.count)||0;
        if(count===0){
          const legacy=ensureStateShape((await pool.query("SELECT state FROM fulfillment_state WHERE id=TRUE")).rows[0].state);
          if(legacy.dailyReports.length){const client=await pool.connect();try{await client.query("BEGIN");for(const report of legacy.dailyReports)await upsertDailyReportWithClient(client,report,report.createdBy);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}}
        }
        dailyReportsStorageReady=true;
      } catch(error) {
        dailyReportsStorageReady=false;
        console.warn("Daily report table is unavailable; using durable fulfillment_state fallback:",error instanceof Error?error.message:error);
      }
    } else {
      mkdirSync(path.dirname(statePath), { recursive: true });
      if (!existsSync(statePath)){
        if(existsSync(stateBackupPath)){
          await fs.copyFile(stateBackupPath,statePath);
          console.warn("Restored local data from store.backup.json.");
        } else await fs.writeFile(statePath, JSON.stringify(initialState(), null, 2));
      }
      console.warn("DATABASE_URL is not set: using persistent JSON data at "+statePath+".");
    }
    const bootstrapUsername=normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME),bootstrapName=asText(process.env.BOOTSTRAP_ADMIN_NAME,"Quản trị hệ thống"),bootstrapPassword=asText(process.env.BOOTSTRAP_ADMIN_PASSWORD);
    if(bootstrapUsername&&bootstrapPassword){
      const validation=validateAccountInput({username:bootstrapUsername,name:bootstrapName,password:bootstrapPassword});
      if(validation)throw new Error("Bootstrap Admin không hợp lệ: "+validation);
      if(!(await this.read()).accounts.length){
        const passwordHash=await hashPassword(bootstrapPassword);
        await this.mutate((state)=>{
          if(state.accounts.length)return false;
          const now=Date.now(),account={id:randomUUID(),username:bootstrapUsername,name:bootstrapName,role:"ADMIN",active:true,passwordHash,createdAt:now,updatedAt:now};
          state.accounts.push(account);audit(state,publicAccount(account),"Khởi tạo Admin từ cấu hình máy chủ");return true;
        });
      }
    }
  }
  async read(options={}) {
    const includeSidecars=options.includeSidecars!==false;
    // Keep one normalized in-memory snapshot for short read bursts (typing in
    // search, opening POG, switching filters). Mutations refresh it immediately,
    // so a longer TTL avoids reparsing the full Master Data JSON on every key.
    if (pool) { if(this.remoteState&&Date.now()-this.remoteStateAt<30_000)return this.remoteState;const fresh=ensureStateShape((await pool.query("SELECT state FROM fulfillment_state WHERE id=TRUE")).rows[0].state);if(includeSidecars&&customerStorageReady)fresh.customers=await readPersistentCustomers(fresh.customers);if(includeSidecars){this.remoteState=fresh;this.remoteStateAt=Date.now();}return fresh; }
    if(!this.localState){
      try { this.localState=ensureStateShape(JSON.parse(await fs.readFile(statePath, "utf8"))); }
      catch(error){
        if(!existsSync(stateBackupPath))throw error;
        console.warn("Local data file is unreadable; restoring store.backup.json.");
        this.localState=ensureStateShape(JSON.parse(await fs.readFile(stateBackupPath, "utf8")));
        await fs.copyFile(stateBackupPath,statePath);
      }
    }
    return this.localState;
  }
  async save(state) {
    if (pool) { await pool.query("UPDATE fulfillment_state SET state=$1::jsonb, updated_at=NOW() WHERE id=TRUE", [JSON.stringify(state)]);this.remoteState=state;this.remoteStateAt=Date.now();productSummaryCache.delete(state);productApiCache.delete(state.products);productLookupCache.delete(state.products);productSearchIndexCache.delete(state.products);stockApiCache.delete(state.stockRecords);stockIndexCache.delete(state.stockRecords);productSkuIndexCache.delete(state.products);stockRowsCache.delete(state);pogRowsCache.delete(state); }
    else { try{await writeLocalState(state);this.localState=state;productSummaryCache.delete(state);productApiCache.delete(state.products);productLookupCache.delete(state.products);productSearchIndexCache.delete(state.products);stockApiCache.delete(state.stockRecords);stockIndexCache.delete(state.stockRecords);productSkuIndexCache.delete(state.products);stockRowsCache.delete(state);pogRowsCache.delete(state);}catch(error){this.localState=null;throw error;} }
  }
  async mutate(callback) {
    const run = async () => {
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await client.query("SELECT state FROM fulfillment_state WHERE id=TRUE FOR UPDATE");
          const state = ensureStateShape(result.rows[0].state);
          const value = await callback(state);
          await client.query("UPDATE fulfillment_state SET state=$1::jsonb, updated_at=NOW() WHERE id=TRUE", [JSON.stringify(state)]);
          await client.query("COMMIT");this.remoteState=state;this.remoteStateAt=Date.now();productSummaryCache.delete(state);productApiCache.delete(state.products);productLookupCache.delete(state.products);productSearchIndexCache.delete(state.products);stockApiCache.delete(state.stockRecords);stockIndexCache.delete(state.stockRecords);productSkuIndexCache.delete(state.products);stockRowsCache.delete(state);pogRowsCache.delete(state);
          return value;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally { client.release(); }
      }
      const state = await this.read();
      try { const value = await callback(state);await this.save(state);return value; }
      catch(error){this.localState=null;throw error;}
    };
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => undefined);
    return task;
  }
  replaceCustomers(customers) {
    if(this.remoteState)this.remoteState.customers=(Array.isArray(customers)?customers:[]).map((customer)=>({...customer}));
  }
  replacePurchaseHistory(records) {
    if(this.remoteState)this.remoteState.purchaseHistory=(Array.isArray(records)?records:[]).map((record)=>({...record}));
  }
  removePurchasePeriod(period) {
    if(this.remoteState)this.remoteState.purchaseHistory=this.remoteState.purchaseHistory.filter((record)=>record.period!==period);
    if(this.localState)this.localState.purchaseHistory=this.localState.purchaseHistory.filter((record)=>record.period!==period);
  }
}

const store = new StateStore();
const app = express();
app.disable("x-powered-by");
if(production)app.set("trust proxy",1);
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const masterUpload = multer({ storage: multer.diskStorage({destination:(_req,_file,done)=>{mkdirSync(importDir,{recursive:true});done(null,importDir);},filename:(_req,_file,done)=>done(null,randomUUID()+".xlsx")}), limits: { fileSize: masterImportMaxFileBytes, files:1 } });
app.use((req,res,next)=>{
  const cookies=Object.fromEntries((req.headers.cookie||"").split(";").map((part)=>part.trim().split(/=(.*)/s).slice(0,2)).filter(([key])=>key));
  req.fulfillmentSessionId=decodeURIComponent(asText(cookies.fulfillment_session));
  next();
});
app.use("/api",(req,res,next)=>{
  if(["GET","HEAD","OPTIONS"].includes(req.method))return next();
  const origin=asText(req.headers.origin);
  if(origin){try{if(new URL(origin).host!==req.get("host"))return res.status(403).json({error:"Yêu cầu không cùng nguồn"});}catch{return res.status(403).json({error:"Nguồn yêu cầu không hợp lệ"});}}
  next();
});
app.get("/healthz", (_req,res) => res.json({
  ok:true,
  storage:pool?"postgres":"local-json",
  customerStorage:pool?(customerStorageReady?"postgres":"state-fallback"):"local-json",
  purchaseHistoryStorage:pool?(purchaseStorageReady?"postgres":"state-fallback"):"local-json",
  customerImportReader:"bounded-xlsx-v1",
}));

const guestActor={userId:"guest",username:"guest",email:"guest",name:"Khách xem",role:"STAFF",active:true};
function actorFrom(req, state) {
  const tokenHash=req.fulfillmentSessionId?createHash("sha256").update(req.fulfillmentSessionId).digest("hex"):"";
  const session=state.sessions.find((item)=>item.tokenHash===tokenHash&&item.expiresAt>Date.now());
  // Cho phép truy cập giao diện và các API đọc dữ liệu ở chế độ khách.
  // Các request ghi dữ liệu vẫn không có actor và tiếp tục bị bảo vệ.
  if(!session)return ["GET","HEAD"].includes(req.method)?guestActor:null;
  const account=state.accounts.find((item)=>item.id===session.accountId&&item.active!==false);
  return account?publicAccount(account):null;
}

async function requireManager(req,res,next) {
  try {
    const state=await store.read({includeSidecars:false}),actor=actorFrom(req,state);
    if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    if(!canManage(actor.role))return res.status(403).json({error:"Cần quyền Manager hoặc Admin"});
    req.fulfillmentActor=actor;
    next();
  } catch(error){next(error);}
}

const importIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireImportCapacity(req,res,next) {
  const requestedId=asText(req.headers["x-import-id"]),existing=importIdPattern.test(requestedId)?masterJobs.get(requestedId):null;
  if(existing&&existing.ownerId===req.fulfillmentActor.userId)return next();
  const active=[...masterJobs.values()].filter((job)=>["queued","processing"].includes(job.status));
  if(active.some((job)=>job.ownerId===req.fulfillmentActor.userId))return res.status(409).json({error:"Tài khoản đang có một file Master Data được xử lý"});
  if(active.length>=3)return res.status(503).json({error:"Hệ thống đang xử lý nhiều file Excel. Vui lòng thử lại sau."});
  next();
}

const masterJobs=new Map(),masterJobQueue=[];
let masterJobRunning=false;
const stockJobs=new Map();

function publicMasterJob(job) {
  return {
    jobId:job.id,status:job.status,phase:job.phase,percent:job.percent,
    processedRows:job.processedRows||0,totalRows:job.totalRows||0,fileName:job.fileName,
    createdAt:job.createdAt,updatedAt:job.updatedAt,result:job.result||null,error:job.error||"",
  };
}

function updateMasterJob(job,patch) {
  Object.assign(job,patch,{updatedAt:Date.now()});
}

function pruneMasterJobs() {
  const finished=[...masterJobs.values()].filter((job)=>["completed","failed"].includes(job.status)).sort((a,b)=>b.updatedAt-a.updatedAt);
  for(const job of finished.slice(50))masterJobs.delete(job.id);
}

function runMasterWorker(job,resultPath) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./workers/master-import-worker.mjs",import.meta.url),{
      workerData:{filePath:job.filePath,resultPath,maxRows:masterImportMaxRows},
      resourceLimits:{maxOldGenerationSizeMb:1024},
    });
    let settled=false;
    const timeout=setTimeout(()=>void fail(new Error("Xử lý file vượt quá 30 phút và đã được dừng"),true),30*60_000);
    const succeed=(value)=>{if(settled)return;settled=true;clearTimeout(timeout);resolve(value);};
    const fail=async(error,terminate=false)=>{if(settled)return;settled=true;clearTimeout(timeout);if(terminate)await worker.terminate().catch(()=>undefined);reject(error);};
    worker.on("message",(message)=>{
      if(message?.type==="progress")updateMasterJob(job,{status:"processing",phase:message.phase,percent:Math.max(job.percent||0,Number(message.percent)||0),processedRows:Number(message.processedRows)||0,totalRows:Number(message.totalRows)||0});
      if(message?.type==="done")succeed(message.resultPath);
      if(message?.type==="error")void fail(new Error(asText(message.error,"Không thể xử lý file Excel")),true);
    });
    worker.on("error",(error)=>void fail(error));
    worker.on("exit",(code)=>{if(!settled)void fail(new Error("Tiến trình đọc Excel đã dừng mà chưa tạo kết quả (mã "+code+")"));});
  });
}

function runStockWorker(job,resultPath) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./workers/stock-import-worker.mjs",import.meta.url),{workerData:{filePath:job.filePath,resultPath,maxRows:masterImportMaxRows},resourceLimits:{maxOldGenerationSizeMb:1024}});
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else resolve(value);};
    const timeout=setTimeout(()=>{void worker.terminate();finish(new Error("Xử lý file Stock vượt quá 30 phút và đã được dừng"));},30*60_000);
    worker.on("message",(message)=>{if(message?.type==="progress")updateMasterJob(job,{status:"processing",phase:message.phase,percent:Math.max(job.percent||0,Number(message.percent)||0),processedRows:Number(message.processedRows)||0,totalRows:Number(message.totalRows)||0});if(message?.type==="done")finish(null,message.resultPath);if(message?.type==="error")finish(new Error(asText(message.error,"Không thể xử lý file Stock")));});
    worker.on("error",(error)=>finish(error));worker.on("exit",(code)=>{if(!settled&&code!==0)finish(new Error("Tiến trình đọc Stock đã dừng (mã "+code+")"));});
  });
}
async function runStockJob(job) {
  const resultPath=path.join(importDir,job.id+".stock.result.json");
  try {
    updateMasterJob(job,{status:"processing",phase:"Đang khởi động bộ xử lý tồn kho",percent:8});await runStockWorker(job,resultPath);
    const result=await store.mutate(async(state)=>{
      const account=state.accounts.find((item)=>item.id===job.ownerId&&item.active!==false);if(!account||!canManage(account.role))throw new Error("Tài khoản không còn quyền cập nhật Stock");
      const reader=createInterface({input:createReadStream(resultPath,{encoding:"utf8"}),crlfDelay:Infinity});let metadata=null,records=[],processed=0;
      for await(const line of reader){if(!line)continue;if(!metadata){metadata=JSON.parse(line);continue;}records.push({...JSON.parse(line),updatedAt:Date.now()});processed++;if(processed%5000===0){updateMasterJob(job,{phase:"Đang lưu danh sách tồn kho",percent:82,processedRows:processed,totalRows:job.totalRows||processed});await yieldToServer();}}
      if(!metadata)throw new Error("Không tìm thấy kết quả file Stock");state.stockRecords=records;state.stockImport={fileName:job.fileName,updatedAt:Date.now(),recordCount:records.length,skipped:metadata.skipped};audit(state,publicAccount(account),"Nhập file Stock: "+records.length+" SKU");
      return {fileName:job.fileName,imported:records.length,headerRow:metadata.headerRow,skipped:metadata.skipped,duplicates:metadata.duplicates,issues:metadata.issues};
    });
    updateMasterJob(job,{status:"completed",phase:"Hoàn tất",percent:100,processedRows:result.imported,totalRows:result.imported,result});
  } catch(error) { updateMasterJob(job,{status:"failed",phase:"Nhập Stock thất bại",error:error instanceof Error?error.message:"Không thể đọc file Stock"}); }
  finally { await Promise.allSettled([fs.unlink(job.filePath),fs.unlink(resultPath),fs.unlink(resultPath+".part")]); }
}

const yieldToServer=()=>new Promise((resolve)=>setImmediate(resolve));
async function mergeMasterResultFile(products,resultPath,job) {
  const nextProducts=products.slice(),indexBySku=new Map();
  for(let index=0;index<nextProducts.length;index++){
    const key=asText(nextProducts[index]?.sku).toUpperCase();if(key&&!indexBySku.has(key))indexBySku.set(key,index);
    if(index>0&&index%5000===0)await yieldToServer();
  }
  const reader=createInterface({input:createReadStream(resultPath,{encoding:"utf8"}),crlfDelay:Infinity});
  let metadata=null,created=0,updated=0,unchanged=0,processed=0;
  for await(const line of reader){
    if(!line)continue;
    if(!metadata){metadata=JSON.parse(line);continue;}
    const source=JSON.parse(line),sku=asText(source.sku),key=sku.toUpperCase();if(!key)continue;
    const rawImage=asText(source.imageUrl),incomingImage=source.imageUrl===undefined||!rawImage?undefined:normalizeImageUrl(rawImage),master={sku,name:asText(source.name),division:asText(source.division),divisionName:asText(source.divisionName),department:asText(source.department),departmentName:asText(source.departmentName),supplierBarcode:asText(source.supplierBarcode)||asText(source.barcode),barcode:asText(source.barcode)||asText(source.supplierBarcode)};
    if(source.line!==undefined)master.line=asText(source.line)?cleanLine(source.line):"";
    if(source.lineName!==undefined)master.lineName=asText(source.lineName);
    for(const field of ["price","promoPrice","sales"]){if(source[field]!==undefined&&asText(source[field])!=="")master[field]=Math.max(0,asInt(String(source[field]).replace(/,/g,"")));}
    if(incomingImage!==undefined)master.imageUrl=incomingImage;
    const index=indexBySku.get(key);
    if(index===undefined){indexBySku.set(key,nextProducts.length);nextProducts.push({...master,id:randomUUID(),line:master.line??"",lineName:master.lineName??"",price:master.price??0,promoPrice:master.promoPrice??0,sales:master.sales??0,stock:0,loss:0,expDate:"",side:"A",bay:1,imageUrl:incomingImage||"",updatedAt:Date.now()});created++;}
    else {const current=nextProducts[index],imageChanged=incomingImage!==undefined&&asText(current?.imageUrl)!==incomingImage,changed=Object.keys(master).some((field)=>asText(current?.[field])!==master[field])||imageChanged;if(changed){nextProducts[index]={...current,...master,imageUrl:incomingImage===undefined?normalizeImageUrl(current?.imageUrl):incomingImage,updatedAt:Date.now()};updated++;}else unchanged++;}
    processed++;
    if(processed%2000===0){const percent=70+Math.round(processed/Math.max(1,job.totalRows||processed)*16);updateMasterJob(job,{phase:"Đang hợp nhất Master Data",percent:Math.min(86,percent),processedRows:processed,totalRows:job.totalRows||processed});await yieldToServer();}
  }
  if(!metadata)throw new Error("Không tìm thấy kết quả đọc Master Data");
  return {products:nextProducts,metadata,created,updated,unchanged,imported:processed};
}

async function runMasterJob(job) {
  const resultPath=path.join(importDir,job.id+".result.json");
  try {
    updateMasterJob(job,{status:"processing",phase:"Đang khởi động bộ xử lý nền",percent:8});
    await runMasterWorker(job,resultPath);
    updateMasterJob(job,{status:"processing",phase:"Đang hợp nhất Master Data",percent:70});
    const result=await store.mutate(async(state)=>{
      const account=state.accounts.find((item)=>item.id===job.ownerId&&item.active!==false);
      if(!account||!canManage(account.role))throw new Error("Tài khoản không còn quyền cập nhật Master Data");
      const actor=publicAccount(account),merged=await mergeMasterResultFile(state.products,resultPath,job),parsed=merged.metadata;
      updateMasterJob(job,{phase:"Đang lưu dữ liệu sản phẩm",percent:88});state.products=merged.products;
      audit(state,actor,"Nhập Excel Master Data: "+merged.created+" mới, "+merged.updated+" cập nhật, "+parsed.skipped+" bỏ qua");
      return {fileName:job.fileName,created:merged.created,updated:merged.updated,unchanged:merged.unchanged,imported:merged.imported,totalProducts:state.products.length,headerRow:parsed.headerRow,skipped:parsed.skipped,duplicates:parsed.duplicates,issues:parsed.issues};
    });
    updateMasterJob(job,{status:"completed",phase:"Hoàn tất",percent:100,processedRows:result.imported,totalRows:result.imported,result});
  } catch(error) {
    const raw=error instanceof Error?error.message:"Không thể xử lý file Excel";
    const friendly=/^(File Excel|Thiếu cột|File vượt|Không tìm|Tài khoản|Xử lý file)/.test(raw)?raw:"Không thể đọc file Excel. Hãy kiểm tra lại định dạng .xlsx.";
    updateMasterJob(job,{status:"failed",phase:"Nhập dữ liệu thất bại",error:friendly});
  } finally {
    await Promise.allSettled([fs.unlink(job.filePath),fs.unlink(resultPath),fs.unlink(resultPath+".part")]);
    pruneMasterJobs();
  }
}

async function runNextMasterJob() {
  if(masterJobRunning)return;
  const job=masterJobQueue.shift();if(!job)return;
  masterJobRunning=true;
  try { await runMasterJob(job); }
  finally { masterJobRunning=false;void runNextMasterJob(); }
}

function enqueueMasterJob(job) {
  masterJobQueue.push(job);
  void runNextMasterJob();
}

const loginRateWindows=new Map();
function takeLoginQuota(key) {
  const now=Date.now(),windowMs=5*60_000,limit=10,recent=(loginRateWindows.get(key)||[]).filter((time)=>now-time<windowMs);
  if(recent.length>=limit)return Math.max(1,Math.ceil((windowMs-(now-recent[0]))/1000));
  recent.push(now);loginRateWindows.set(key,recent);return 0;
}

app.get("/api/auth/status", async(req,res,next)=>{
  try { const state=await store.read(),actor=actorFrom(req,state);res.set("Cache-Control","no-store").json({authenticated:Boolean(actor),setupRequired:state.accounts.length===0,actor}); }
  catch(error){next(error);}
});

app.post("/api/auth/setup", async(req,res,next)=>{
  try {
    const source=req.body||{},username=normalizeUsername(source.username),name=asText(source.name),password=typeof source.password==="string"?source.password:"",validation=validateAccountInput({username,name,password});
    if(validation)return res.status(400).json({error:validation});
    const passwordHash=await hashPassword(password);
    const result=await store.mutate((state)=>{
      if(state.accounts.length)return {error:"Tài khoản quản trị đã được thiết lập",status:409};
      const now=Date.now(),account={id:randomUUID(),username,name,role:"ADMIN",active:true,passwordHash,createdAt:now,updatedAt:now};
      state.accounts.push(account);const {token}=createSession(state,account.id),actor=publicAccount(account);
      audit(state,actor,"Thiết lập tài khoản quản trị đầu tiên");return {ok:true,actor,sessionToken:token};
    });
    if(result.sessionToken)res.append("Set-Cookie",sessionCookie(result.sessionToken));
    res.status(result.status||200).json(result.error?{error:result.error}:{ok:true,actor:result.actor});
  } catch(error){next(error);}
});

app.post("/api/auth/login", async(req,res,next)=>{
  try {
    const username=normalizeUsername(req.body?.username),password=typeof req.body?.password==="string"?req.body.password:"",quotaKey=req.ip+":"+username,retryAfter=takeLoginQuota(quotaKey);
    if(retryAfter){res.set("Retry-After",String(retryAfter));return res.status(429).json({error:"Đăng nhập quá nhiều lần. Vui lòng thử lại sau "+retryAfter+" giây."});}
    const result=await store.mutate(async(state)=>{
      const account=state.accounts.find((item)=>item.username===username);
      if(!account||account.active===false||!await verifyPassword(password,account.passwordHash))return {error:"Tên đăng nhập hoặc mật khẩu không đúng",status:401};
      const {token}=createSession(state,account.id),actor=publicAccount(account);audit(state,actor,"Đăng nhập hệ thống");
      return {ok:true,actor,sessionToken:token};
    });
    if(result.sessionToken){loginRateWindows.delete(quotaKey);res.append("Set-Cookie",sessionCookie(result.sessionToken));}
    res.status(result.status||200).json(result.error?{error:result.error}:{ok:true,actor:result.actor});
  } catch(error){next(error);}
});

app.post("/api/auth/logout", async(req,res,next)=>{
  try {
    await store.mutate((state)=>{const actor=actorFrom(req,state),tokenHash=req.fulfillmentSessionId?createHash("sha256").update(req.fulfillmentSessionId).digest("hex"):"";state.sessions=state.sessions.filter((item)=>item.tokenHash!==tokenHash);if(actor)audit(state,actor,"Đăng xuất hệ thống");return {ok:true};});
    res.append("Set-Cookie",sessionCookie("",0)).json({ok:true});
  } catch(error){next(error);}
});

app.get("/api/store", async (req, res, next) => {
  try {
    const state=await store.read(),actor=actorFrom(req,state);
    if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập",setupRequired:state.accounts.length===0});
    const uploaded=stockIndex(state.stockRecords),accountsById=new Map(state.accounts.map((account)=>[account.id,account]));
    const pickItem=(item)=>{const product=state.products.find((p)=>p.id===item.productId),assignee=accountsById.get(item.userId),deliveryAssignee=accountsById.get(item.deliveryAssigneeId),quantity=Math.max(1,asInt(item.quantity,1)),pickedQuantity=Math.max(0,Math.min(quantity,asInt(item.pickedQuantity,item.picked?quantity:0))),workflowStatus=["unassigned","picking","ready_delivery","delivered"].includes(item.workflowStatus)?item.workflowStatus:(item.userId?item.picked?"ready_delivery":"picking":"unassigned");return product?{...withUploadedStock(product,uploaded),pickId:asText(item.id,item.productId),quantity,picked:item.picked,pickedQuantity,workflowStatus,available:item.available!==false,customerName:asText(item.customerName),customerPhone:normalizePhone(item.customerPhone),invoiceNumber:asText(item.invoiceNumber),note:asText(item.note),assignedBy:asText(item.assignedBy),assigneeId:asText(item.userId),assigneeName:asText(assignee?.name,"Chưa phân công"),deliveryAssigneeId:asText(item.deliveryAssigneeId),deliveryAssigneeName:asText(deliveryAssignee?.name,"Chưa phân công"),deliveryTimeSlot:asText(item.deliveryTimeSlot),orderDate:normalizeOrderDate(item.orderDate,item.createdAt||Date.now()),createdAt:asInt(item.createdAt,Date.now())}:null;};
    const historyItem=(item)=>{const current=pickItem(item);return current?{...current,completedAt:asInt(item.completedAt,item.createdAt||Date.now()),completedBy:asText(item.completedBy,item.assignedBy)}:null;};
    const picking=state.picking.filter((item)=>item.userId===actor.userId).map(pickItem).filter(Boolean),assignedPicking=(canManage(actor.role)?state.picking:state.picking.filter((item)=>item.userId===actor.userId||item.deliveryAssigneeId===actor.userId)).map(pickItem).filter(Boolean),orderHistory=state.orderHistory.filter((item)=>canManage(actor.role)||item.userId===actor.userId||item.deliveryAssigneeId===actor.userId).map(historyItem).filter(Boolean).slice(0,500);
    const users=(canManage(actor.role)?state.accounts:state.accounts.filter((account)=>account.id===actor.userId)).map(publicAccount),summary=getProductSummary(state),manual=manualCheckGroups(state);
    const data={actor,products:req.query.includeProducts==="1"?state.products.map((product)=>withUploadedStock(product,uploaded)):[],productTotal:summary.stats.total,productStats:summary.stats,alertProducts:summary.alerts,availableLines:summary.lines,logs:state.logs.slice(0,80),picking,assignedPicking,orderHistory,users,customers:state.customers,pogFiles:state.pogFiles,lineConfigs:state.lineConfigs,appBrand:state.appBrand,manualChecks:manual,stockImport:state.stockImport};
    res.status(data.status||200).json(data);
  } catch (error) { next(error); }
});

app.get("/api/products", async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const id=asText(req.query.id);
    const uploaded=stockIndex(state.stockRecords);
    if(id){const product=state.products.find((item)=>item.id===id);return product?res.json({products:[withUploadedStock(product,uploaded)],total:1,page:1,pageSize:1}):res.status(404).json({error:"Không tìm thấy sản phẩm"});}
    const query=normalizeText(asText(req.query.q).slice(0,200)),line=asText(req.query.line),side=asText(req.query.side),stock=asText(req.query.stock,"all"),sort=asText(req.query.sort),pogId=asText(req.query.pogId),pogFile=pogId?state.pogFiles.find((file)=>file.id===pogId):null,skuValues=asText(req.query.skus).slice(0,20000).split(",").map(normalizeText).filter(Boolean),skuSet=new Set(skuValues),pogPositionSet=new Set((pogFile?.positions||[]).flatMap((position)=>[position.sku,position.barcode]).map(normalizeText).filter(Boolean)),page=Math.max(1,asInt(req.query.page,1)),pageSize=Math.max(1,Math.min(200,asInt(req.query.pageSize,100))),start=(page-1)*pageSize;
    const cacheKey=[query,line,side,stock,sort,pogId,pogFile?.updatedAt||0,skuValues.join(","),page,pageSize,asInt(state.stockImport?.updatedAt,0)].join("|");
    const apiCache=getProductApiCache(state.products),cached=apiCache.get(cacheKey);if(cached)return res.set("Cache-Control","no-store").json(cached);
    // Khi mở POG, danh sách bên trái phải bắt đầu từ các dòng đã đọc trong
    // chính file POG. Master Data/Stock chỉ bổ sung thông tin nếu mã khớp.
    if(pogId){
      const ordered=pogRows(state,pogFile).filter((product)=>!query||productSearchText(product).includes(query)),payload={products:ordered.slice(start,start+pageSize),total:ordered.length,page,pageSize,matchedLines:[pogFile?.line||""]};
      if(apiCache.size>100)apiCache.delete(apiCache.keys().next().value);apiCache.set(cacheKey,payload);return res.set("Cache-Control","no-store").json(payload);
    }
    if(query&&!line&&!side&&!skuSet.size&&!pogId&&stock==="all"&&!sort){const exact=productLookup(state.products).get(query);if(exact){const product=withUploadedStock(exact,uploaded);return res.set("Cache-Control","no-store").json({products:[product],total:1,page:1,pageSize:1,matchedLines:[product.line]});}}
    if(!query&&(!line||line==="all")&&!side&&!skuSet.size&&!pogId&&stock==="all"&&!sort)return res.set("Cache-Control","no-store").json({products:state.products.slice(start,start+pageSize).map((product)=>withUploadedStock(product,uploaded)),total:state.products.length,page,pageSize,matchedLines:[]});
    const passesFilters=(product)=>{
      const productKeys=[product.sku,product.barcode,product.supplierBarcode].map(normalizeText);
      if(skuSet.size&&!productKeys.some((key)=>skuSet.has(key)))return false;
      if(pogId&&(!pogFile||!pogPositionSet.size||!productKeys.some((key)=>pogPositionSet.has(key))))return false;
      if(line&&line!=="all"&&product.line!==line)return false;if(side&&product.side!==side)return false;
      const current=uploaded.get(normalizeText(product.sku));
      if(stock==="available"&&!(current?.stock>0))return false;if(stock==="low"&&!(current?.stock>0&&current.stock<10))return false;if(stock==="out"&&current?.stock!==0)return false;
      return !query||productSearchText(product).includes(query);
    };
    // Narrow text searches through a cached bigram index before applying the
    // remaining filters. This keeps Excel-like contains searches responsive
    // even when Master Data grows beyond tens of thousands of SKU.
    const searchProducts=query?productSearchCandidates(query,state.products).map(({product})=>product):state.products;
    if(sort==="expiry"){
      let total=0,scanned=0;const heap=[],matchedLines=new Set(),limit=start+pageSize;
      for(const product of searchProducts){if(++scanned%5000===0){await yieldToServer();if(req.destroyed)return;}if(!passesFilters(product))continue;total++;matchedLines.add(product.line);pushExpiryTop(heap,product,limit);}
      const ordered=heap.sort((a,b)=>a.rank-b.rank||String(a.product.sku).localeCompare(String(b.product.sku))).map((entry)=>entry.product);
      const payload={products:ordered.slice(start,start+pageSize).map((product)=>withUploadedStock(product,uploaded)),total,page,pageSize,matchedLines:[...matchedLines]};if(apiCache.size>100)apiCache.delete(apiCache.keys().next().value);apiCache.set(cacheKey,payload);return res.set("Cache-Control","no-store").json(payload);
    }
    let total=0,ordinarySeen=0,scanned=0;const matches=[],exact=[],matchedLines=new Set();
    for(const product of searchProducts){
      if(++scanned%5000===0){await yieldToServer();if(req.destroyed)return;}if(!passesFilters(product))continue;
      total++;matchedLines.add(product.line);
      const isExact=query&&(normalizeText(product.sku)===query||normalizeText(product.barcode)===query||normalizeText(product.supplierBarcode)===query);
      if(isExact){exact.push(product);continue;}
      if(ordinarySeen>=start&&matches.length<pageSize)matches.push(product);ordinarySeen++;
    }
    if(exact.length){
      matches.length=0;let orderedIndex=0;
      for(const product of exact){if(orderedIndex>=start&&matches.length<pageSize)matches.push(product);orderedIndex++;}
      if(matches.length<pageSize){let rescanned=0;for(const product of searchProducts){
        if(++rescanned%5000===0){await yieldToServer();if(req.destroyed)return;}
        if(!passesFilters(product))continue;
        if(normalizeText(product.sku)===query||normalizeText(product.barcode)===query||normalizeText(product.supplierBarcode)===query)continue;
        if(orderedIndex>=start&&matches.length<pageSize)matches.push(product);orderedIndex++;if(matches.length>=pageSize)break;
      }}
    }
    const payload={products:matches.map((product)=>withUploadedStock(product,uploaded)),total,page,pageSize,matchedLines:[...matchedLines]};if(apiCache.size>100)apiCache.delete(apiCache.keys().next().value);apiCache.set(cacheKey,payload);res.set("Cache-Control","no-store").json(payload);
  } catch(error){next(error);}
});

app.get("/api/stock", async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const query=normalizeText(asText(req.query.q).slice(0,200)),page=Math.max(1,asInt(req.query.page,1)),pageSize=Math.max(1,Math.min(200,asInt(req.query.pageSize,100))),start=(page-1)*pageSize,cacheKey=[query,page,pageSize,asInt(state.stockImport?.updatedAt,0)].join("|"),apiCache=getStockApiCache(state.stockRecords),cached=apiCache.get(cacheKey);if(cached)return res.set("Cache-Control","no-store").json(cached);
    const rows=stockRows(state),bySku=productSkuIndex(state.products),matched=query?productSearchCandidates(query,rows).map(({product})=>product):rows;
    const payload={products:matched.slice(start,start+pageSize),total:matched.length,page,pageSize,stockImport:state.stockImport,unmatched:state.stockRecords.length-bySku.size+rows.filter((row)=>!bySku.has(normalizeText(row.sku))).length};if(apiCache.size>100)apiCache.delete(apiCache.keys().next().value);apiCache.set(cacheKey,payload);res.set("Cache-Control","no-store").json(payload);
  } catch(error){next(error);}
});

app.get(["/api/stock/export.xlsx","/api/stock/export.csv"],async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const productsBySku=new Map(state.products.map((product)=>[normalizeText(product.sku),product])),rows=[["SKU","TÊN SẢN PHẨM","Sale","Stock","Division","DIVISION NAME","Department","DEPARTMENT NAME"]];
    for(const record of state.stockRecords){const product=productsBySku.get(normalizeText(record.sku))||{};rows.push([record.sku,asText(record.name)||product.name||"",record.sales,record.stock,asText(record.division)||product.division||"",asText(record.divisionName)||product.divisionName||"",asText(record.department)||product.department||"",asText(record.departmentName)||product.departmentName||""]);}
    const workbook=createXlsx(rows);
    res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":"attachment; filename=Stock_Fulfillment.xlsx","Cache-Control":"no-store"}).send(Buffer.from(workbook));
  } catch(error){next(error);}
});

app.get("/api/orders/export.xlsx",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const requestedMonth=asText(req.query.month),month=/^\d{4}-\d{2}$/.test(requestedMonth)?requestedMonth:localDateKey().slice(0,7),accountsById=new Map(state.accounts.map((account)=>[account.id,account])),productsById=new Map(state.products.map((product)=>[product.id,product])),groups=new Map();
    const addUnique=(values,value)=>{const text=asText(value);if(text&&!values.includes(text))values.push(text);};
    const append=(item,completed)=>{
      if(!canManage(actor.role)&&item.userId!==actor.userId&&item.deliveryAssigneeId!==actor.userId)return;
      const date=normalizeOrderDate(item.orderDate,item.createdAt||Date.now());if(!date.startsWith(month))return;
      const product=productsById.get(item.productId);if(!product)return;
      const customerName=asText(item.customerName,"Chưa đặt tên khách"),phone=normalizePhone(item.customerPhone),identity=phone?"phone:"+phone:"name:"+normalizeText(customerName),key=date+"|"+identity;
      let group=groups.get(key);if(!group){group={date,customerName,phone,invoices:[],products:[],totalQuantity:0,statuses:[],slots:[],pickers:[],drivers:[],assignedBy:[],completedDates:[]};groups.set(key,group);}
      addUnique(group.invoices,item.invoiceNumber);addUnique(group.slots,item.deliveryTimeSlot);addUnique(group.pickers,accountsById.get(item.userId)?.name||"Chưa phân công");addUnique(group.drivers,accountsById.get(item.deliveryAssigneeId)?.name||"Chưa phân công");addUnique(group.assignedBy,item.assignedBy);group.totalQuantity+=Math.max(1,asInt(item.quantity,1));addUnique(group.statuses,completed?"Đã giao":item.picked?"Đã soạn xong":"Đang soạn");if(completed)addUnique(group.completedDates,localDateKey(item.completedAt||Date.now()));
      const sku=asText(product.sku),name=asText(product.name,"Chưa có tên sản phẩm"),line=product.line?` · POG ${product.line}${product.side||""}${product.bay?" · "+product.bay:""}`:"";
      group.products.push(`${sku} - ${name} (SL ${Math.max(1,asInt(item.quantity,1))})${line}`);
    };
    for(const item of state.picking)append(item,false);for(const item of state.orderHistory)append(item,true);
    const headers=["Ngày đơn","Số hóa đơn","Tên khách hàng","Số điện thoại","Danh sách hàng đã mua (SKU - Tên sản phẩm)","Tổng số lượng","Trạng thái","Khung giờ giao","Nhân viên soạn","Nhân viên giao hàng","Người gán","Ngày hoàn tất"];
    const rows=[headers,...[...groups.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.customerName.localeCompare(b.customerName,"vi")).map((group)=>[group.date,group.invoices.join(", ")||"—",group.customerName,group.phone||"—",group.products.join("\n"),group.totalQuantity,group.statuses.length===1?group.statuses[0]:"Đang xử lý",group.slots.join(", ")||"Chưa chọn",group.pickers.join(", "),group.drivers.join(", "),group.assignedBy.join(", "),group.completedDates.join(", ")])];
    const workbook=createXlsx(rows),filename=`Don_soan_khach_hang_${month}.xlsx`;
    res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${filename}"`,"Cache-Control":"no-store"}).send(Buffer.from(workbook));
  } catch(error){next(error);}
});

app.get("/api/daily-reports",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const month=/^\d{4}-\d{2}$/.test(asText(req.query.month))?asText(req.query.month):localDateKey().slice(0,7);
    const reports=dailyReportsStorageReady?await readPersistentDailyReports(month):state.dailyReports.filter((report)=>asText(report.date).startsWith(month)).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.createdAt).localeCompare(String(a.createdAt)));
    res.set("Cache-Control","no-store").json({reports,customers:state.customers,month,storage:dailyReportsStorageReady?"postgres":"state"});
  } catch(error){next(error);}
});

// Daily reports have their own compact table in PostgreSQL. This avoids
// locking and rewriting the large fulfillment_state JSON document on every
// keystroke/save while keeping the JSON store as a local fallback.
app.post("/api/daily-reports",async(req,res,next)=>{
  try {
    const state=await store.read({includeSidecars:false}),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const normalized=normalizedDailyReportInput(req.body?.report);if(normalized.error)return res.status(400).json({error:normalized.error});
    if(dailyReportsStorageReady){
      const persisted=await persistDailyReportFast(normalized.report,actor.name);
      return res.json({ok:true,report:persisted.report,customer:persisted.customer,storage:"postgres"});
    }
    const result=await store.mutate(async(current)=>{
      const now=Date.now(),existingCustomer=current.customers.find((customer)=>normalizePhone(customer.phone)===normalized.report.phone),savedCustomer=existingCustomer?Object.assign(existingCustomer,normalized.customerFields,{updatedAt:now}):{id:randomUUID(),...normalized.customerFields,createdAt:now,updatedAt:now};
      if(!existingCustomer)current.customers.push(savedCustomer);
      if(pool&&customerStorageReady)await upsertPersistentCustomers([normalized.customerFields]);
      const source=req.body?.report||{},id=asText(source.id),existingReport=id?current.dailyReports.find((item)=>item.id===id):null,savedReport=existingReport?Object.assign(existingReport,normalized.report,{id:existingReport.id,updatedAt:now}):{id:randomUUID(),...normalized.report,createdAt:now,updatedAt:now,createdBy:actor.name};
      if(!existingReport)current.dailyReports.unshift(savedReport);
      audit(current,actor,(existingReport?"Cập nhật":"Tạo")+" báo cáo ngày cho khách "+normalized.report.customerName);return {ok:true,report:savedReport,customer:savedCustomer,storage:"state"};
    });
    return res.status(result.status||200).json(result);
  } catch(error){next(error);}
});

app.get("/api/purchase-history",async(req,res,next)=>{
  try {
    const state=await store.read({includeSidecars:false}),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const month=/^\d{4}-\d{2}$/.test(asText(req.query.month))?asText(req.query.month):localDateKey().slice(0,7),records=purchaseStorageReady?await readPersistentPurchaseHistory(state.purchaseHistory,month.slice(0,4)):state.purchaseHistory;
    res.set("Cache-Control","no-store").json({...purchaseSummary(records,month),storage:purchaseStorageReady?"postgres":"state"});
  } catch(error){next(error);}
});

app.get("/api/purchase-history/export.xlsx",async(req,res,next)=>{
  try {
    const state=await store.read({includeSidecars:false}),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const month=/^\d{4}-\d{2}$/.test(asText(req.query.month))?asText(req.query.month):localDateKey().slice(0,7),records=purchaseStorageReady?await readPersistentPurchaseHistory(state.purchaseHistory,month.slice(0,4)):state.purchaseHistory,summary=purchaseSummary(records,month),rows=[["SĐT","TÊN KHÁCH HÀNG","ĐỊA CHỈ","TỔNG THÁNG "+month,"TỔNG NĂM "+summary.year,"SỐ ĐƠN TRONG NĂM",...Array.from({length:12},(_,index)=>`${summary.year}-${String(index+1).padStart(2,"0")}`)],...summary.customers.map((customer)=>[customer.phone,customer.customerName,customer.address,customer.monthTotal,customer.yearTotal,customer.orders,...Array.from({length:12},(_,index)=>customer.monthlyTotals[`${summary.year}-${String(index+1).padStart(2,"0")}`]||0)])];
    const workbook=createXlsx(rows),filename=`Lich_su_mua_hang_${month}.xlsx`;res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${filename}"`,"Cache-Control":"no-store"}).send(Buffer.from(workbook));
  } catch(error){next(error);}
});

app.delete("/api/purchase-history",requireManager,async(req,res,next)=>{
  const period=/^\d{4}-\d{2}$/.test(asText(req.query.month))?asText(req.query.month):"";
    if(!period)return res.status(400).json({error:"Tháng cần xóa không hợp lệ."});
  try {
    if(purchaseStorageReady){
      const deleted=await pool.query("DELETE FROM fulfillment_purchase_history WHERE period=$1",[period]),total=Number((await pool.query("SELECT COUNT(*)::int AS count FROM fulfillment_purchase_history")).rows[0]?.count)||0;
      store.removePurchasePeriod(period);
      return res.json({ok:true,period,deleted:deleted.rowCount||0,total,storage:"postgres"});
    }
    const result=await store.mutate((state)=>{const before=state.purchaseHistory.length;state.purchaseHistory=state.purchaseHistory.filter((record)=>record.period!==period);audit(state,req.fulfillmentActor,"Xóa lịch sử mua hàng tháng "+period);return {ok:true,period,deleted:before-state.purchaseHistory.length,total:state.purchaseHistory.length,storage:"state"};});
    return res.status(result.status||200).json(result);
  } catch(error){next(error);}
});

app.post("/api/purchase-history/import",requireManager,upload.single("file"),async(req,res,next)=>{
  if(!req.file)return res.status(400).json({error:"Hãy chọn file Excel lịch sử mua hàng .xlsx"});
  if(!req.file.originalname.toLowerCase().endsWith(".xlsx"))return res.status(400).json({error:"Chỉ hỗ trợ file Excel định dạng .xlsx"});
  const period=/^\d{4}-\d{2}$/.test(asText(req.body?.period))?asText(req.body.period):"";
  try {
    const parsed=await readPurchaseWorkbook(req.file.buffer,period),records=parsed.records.map((record)=>normalizedPurchaseRecord(record,period,req.file.originalname));
    if(purchaseStorageReady){const persisted=await upsertPersistentPurchaseHistory(records,req.file.originalname),total=Number((await pool.query("SELECT COUNT(*)::int AS count FROM fulfillment_purchase_history")).rows[0]?.count)||0;return res.json({ok:true,fileName:req.file.originalname,sheetName:parsed.sheetName,period,created:persisted.created,updated:persisted.updated,imported:persisted.imported,skipped:parsed.skipped,total,storage:"postgres"});}
    const result=await store.mutate((state)=>{const actor=actorFrom(req,state),current=new Map(state.purchaseHistory.map((item)=>[item.id,item]));let created=0,updated=0;for(const record of records){if(current.has(record.id))updated++;else created++;current.set(record.id,record);}state.purchaseHistory=[...current.values()].sort((left,right)=>String(right.date).localeCompare(String(left.date)));audit(state,actor,"Nhập lịch sử mua hàng "+period+": "+created+" mới, "+updated+" cập nhật");return {ok:true,fileName:req.file.originalname,sheetName:parsed.sheetName,period,created,updated,imported:records.length,skipped:parsed.skipped,total:state.purchaseHistory.length,storage:"state"};});res.status(result.status||200).json(result);
  } catch(error){next(error);}
});

app.get("/api/customers",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const query=normalizeText(req.query.q),customers=query?state.customers.filter((customer)=>normalizeText([customer.phone,customer.name,customer.email].join(" ")).includes(query)):state.customers;
    res.set("Cache-Control","no-store").json({customers:customers.slice(0,5000)});
  } catch(error){next(error);}
});

app.get("/api/daily-reports/export.xlsx",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const month=/^\d{4}-\d{2}$/.test(asText(req.query.month))?asText(req.query.month):localDateKey().slice(0,7),reports=dailyReportsStorageReady?await readPersistentDailyReports(month):state.dailyReports.filter((report)=>asText(report.date).startsWith(month)).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const headers=["STT",...DAILY_REPORT_COLUMNS.map(([,label])=>label)],rows=[headers,...reports.map((report,index)=>[index+1,...DAILY_REPORT_COLUMNS.map(([key])=>report[key]??"")])];
    const workbook=createXlsx(rows),filename=`Bao_cao_ngay_${month}.xlsx`;
    res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${filename}"`,"Cache-Control":"no-store"}).send(Buffer.from(workbook));
  } catch(error){next(error);}
});

app.get("/api/customers/export.xlsx",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const headers=["STT","SĐT","TÊN KHÁCH HÀNG","TÌNH TRẠNG KH","MÃ APP TV","NHÓM KH","TÊN CÔNG TY","EMAIL","MST","ĐỊA CHỈ XUẤT VAT","ĐỊA CHỈ GIAO HÀNG"],rows=[headers,...state.customers.map((customer,index)=>[index+1,customer.phone,customer.name,customer.status,customer.memberCard,customer.group,customer.companyName,customer.email,customer.taxId,customer.vatAddress,customer.deliveryAddress])];
    const workbook=createXlsx(rows);res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":"attachment; filename=Master_Khach_Hang.xlsx","Cache-Control":"no-store"}).send(Buffer.from(workbook));
  } catch(error){next(error);}
});

app.get(["/api/master-data/export.xlsx","/api/master-data/export.csv"],async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const uploaded=stockIndex(state.stockRecords);
    const rows=[["SKU","TÊN SẢN PHẨM","Sale","Stock","GIÁ BÁN RETAIL","GIÁ KHUYẾN MÃI","Division","DIVISION NAME","Department","DEPARTMENT NAME","BARCODE NCC","BARCODE AEON","IMAGE URL"]];
    for(const product of state.products){const record=uploaded.get(normalizeText(product.sku));rows.push([product.sku,product.name,record?.sales??product.sales??0,record?.stock??product.stock??0,product.price??0,product.promoPrice??0,product.division,product.divisionName,product.department,product.departmentName,product.supplierBarcode,product.barcode||product.supplierBarcode,product.imageUrl]);}
    const workbook=createXlsx(rows);
    res.set({"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":"attachment; filename=MasterData_Fulfillment.xlsx","Cache-Control":"no-store"}).send(Buffer.from(workbook));
  } catch(error){next(error);}
});

app.post("/api/store", async (req, res, next) => {
  try {
    // Keep the legacy action compatible with older clients, but route it to
    // the compact report table so it is just as fast as /api/daily-reports.
    if(asText(req.body?.action)==="upsertDailyReport"&&dailyReportsStorageReady){
      const state=await store.read({includeSidecars:false}),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
      const normalized=normalizedDailyReportInput(req.body?.report);if(normalized.error)return res.status(400).json({error:normalized.error});
      const persisted=await persistDailyReportFast(normalized.report,actor.name);
      return res.json({ok:true,report:persisted.report,customer:persisted.customer,storage:"postgres"});
    }
    const result = await store.mutate(async(state) => {
      const actor = actorFrom(req, state), body = req.body || {}, action = asText(body.action);
      const fail = (error, status = 400) => ({ error, status });
      if(!actor)return fail("Vui lòng đăng nhập",401);
      if(action==="createAccount"){
        if(actor.role!=="ADMIN")return fail("Chỉ Admin được tạo tài khoản",403);
        const source=body.account||{},username=normalizeUsername(source.username),name=asText(source.name),password=typeof source.password==="string"?source.password:"",role=asText(source.role,"STAFF"),workType=asText(source.workType,"BOTH"),validation=validateAccountInput({username,name,password});
        if(validation)return fail(validation);
        if(!["ADMIN","MANAGER","STAFF"].includes(role))return fail("Quyền tài khoản không hợp lệ");
        if(!["PICKING","DELIVERY","BOTH"].includes(workType))return fail("Loại nghiệp vụ không hợp lệ");
        if(state.accounts.some((account)=>account.username===username))return fail("Tên đăng nhập đã tồn tại");
        const now=Date.now(),account={id:randomUUID(),username,name,role,workType,active:true,passwordHash:await hashPassword(password),createdAt:now,updatedAt:now};
        state.accounts.push(account);audit(state,actor,"Tạo tài khoản "+username+" với quyền "+role);return {ok:true,account:publicAccount(account)};
      }
      if(action==="updateAccount"){
        if(actor.role!=="ADMIN")return fail("Chỉ Admin được phân quyền tài khoản",403);
        const source=body.account||{},account=state.accounts.find((item)=>item.id===asText(source.userId));
        if(!account)return fail("Không tìm thấy tài khoản",404);
        const name=asText(source.name,account.name),role=asText(source.role,account.role),workType=asText(source.workType,account.workType||"BOTH"),active=typeof source.active==="boolean"?source.active:account.active!==false,password=typeof source.password==="string"?source.password:"";
        const validation=validateAccountInput({username:account.username,name,password:""},false);
        if(validation)return fail(validation);
        if(!["ADMIN","MANAGER","STAFF"].includes(role))return fail("Quyền tài khoản không hợp lệ");
        if(!["PICKING","DELIVERY","BOTH"].includes(workType))return fail("Loại nghiệp vụ không hợp lệ");
        if(account.id===actor.userId&&(role!==account.role||!active))return fail("Bạn không thể tự hạ quyền hoặc khóa tài khoản đang dùng");
        const activeAdmins=state.accounts.filter((item)=>item.active!==false&&item.role==="ADMIN").length;
        if(account.role==="ADMIN"&&account.active!==false&&(role!=="ADMIN"||!active)&&activeAdmins<=1)return fail("Hệ thống phải còn ít nhất một Admin");
        if(password&&(password.length<8||password.length>128))return fail("Mật khẩu mới cần từ 8 đến 128 ký tự");
        account.name=name;account.role=role;account.workType=workType;account.active=active;account.updatedAt=Date.now();
        if(password){account.passwordHash=await hashPassword(password);state.sessions=state.sessions.filter((session)=>session.accountId!==account.id);}
        if(!active)state.sessions=state.sessions.filter((session)=>session.accountId!==account.id);
        audit(state,actor,"Cập nhật tài khoản "+account.username+": "+role+(active?"":" · đã khóa"));return {ok:true,account:publicAccount(account)};
      }
      if(action==="changeOwnPassword"){
        const account=state.accounts.find((item)=>item.id===actor.userId),currentPassword=typeof body.currentPassword==="string"?body.currentPassword:"",newPassword=typeof body.newPassword==="string"?body.newPassword:"";
        if(!account||!await verifyPassword(currentPassword,account.passwordHash))return fail("Mật khẩu hiện tại không đúng");
        if(newPassword.length<8||newPassword.length>128)return fail("Mật khẩu mới cần từ 8 đến 128 ký tự");
        account.passwordHash=await hashPassword(newPassword);account.updatedAt=Date.now();
        const currentHash=createHash("sha256").update(req.fulfillmentSessionId).digest("hex");state.sessions=state.sessions.filter((session)=>session.accountId!==account.id||session.tokenHash===currentHash);
        audit(state,actor,"Đổi mật khẩu tài khoản");return {ok:true};
      }
      if (action === "upsertProduct") {
        if (!canManage(actor.role)) return fail("Cần quyền Manager hoặc Admin",403);
        const source=body.product||{}, sku=asText(source.sku), name=asText(source.name),requestedId=asText(source.id);
        if (!sku || !name) return fail("SKU và tên sản phẩm là bắt buộc");
        const idIndex=requestedId?state.products.findIndex((item)=>item.id===requestedId):-1;
        const skuIndex=state.products.findIndex((item)=>normalizeText(item.sku)===normalizeText(sku));
        if(skuIndex>=0&&skuIndex!==idIndex)return fail("SKU đã tồn tại trong Master Data");
        const index=idIndex,existing=index>=0?state.products[index]:null,line=cleanLine(source.line);
        if(!defaultLineNames.has(line))return fail("Line phải từ 01 đến 28");
        const supplierBarcode=asText(source.supplierBarcode)||asText(existing?.supplierBarcode)||asText(source.barcode),aeonBarcode=asText(source.barcode)||asText(existing?.barcode)||supplierBarcode,promoPrice=Math.max(0,asInt(source.promoPrice,existing?.promoPrice||0)),hasImageField=Object.prototype.hasOwnProperty.call(source,"imageUrl"),rawImageUrl=asText(source.imageUrl),imageUrl=hasImageField?normalizeImageUrl(rawImageUrl):normalizeImageUrl(existing?.imageUrl);
        if(hasImageField&&rawImageUrl.length>1_500_000)return fail("Ảnh sản phẩm tối đa 1 MB");
        if(hasImageField&&rawImageUrl&&!imageUrl)return fail("Ảnh sản phẩm cần là URL http(s), đường dẫn nội bộ hoặc ảnh đã chọn hợp lệ");
        const product={...existing,id:requestedId||existing?.id||randomUUID(),sku,name,division:asText(source.division),divisionName:asText(source.divisionName),department:asText(source.department),departmentName:asText(source.departmentName),supplierBarcode,barcode:aeonBarcode,line,lineName:asText(source.lineName)||defaultLineNames.get(line)||"",side:asText(source.side,"A")==="B"?"B":"A",bay:Math.max(1,asInt(source.bay,1)),price:Math.max(0,asInt(source.price,existing?.price||0)),promoPrice,stock:existing?.stock??0,loss:existing?.loss??0,expDate:asText(existing?.expDate),imageUrl:hasImageField?imageUrl:normalizeImageUrl(existing?.imageUrl),updatedAt:Date.now()};
        if(index>=0) state.products[index]=product; else state.products.unshift(product);
        audit(state,actor,"Lưu Master Data SKU "+sku); return {ok:true,id:product.id};
      }
      if (action === "deleteProduct") {
        if (!canManage(actor.role)) return fail("Cần quyền Manager hoặc Admin",403);
        const index=state.products.findIndex((p)=>p.id===asText(body.id));
        if(index>=0){const [item]=state.products.splice(index,1);state.picking=state.picking.filter((p)=>p.productId!==item.id);state.manualChecks=state.manualChecks.filter((check)=>check.productId!==item.id);audit(state,actor,"Xóa sản phẩm SKU "+item.sku);} return {ok:true};
      }
      if (action === "setManualCheck") {
        if(actor.userId==="guest")return fail("Vui lòng đăng nhập để chỉnh sửa dữ liệu",401);
        const kind=asText(body.kind),sku=asText(body.sku),product=state.products.find((p)=>normalizeText(p.sku)===normalizeText(sku));if(!product)return fail("SKU không có trong Master Data",404);
        const value=body.value,now=Date.now(),index=state.manualChecks.findIndex((item)=>item.productId===product.id),current=index>=0?state.manualChecks[index]:{productId:product.id};
        const isNonNegativeInteger=(input)=>{if(input===null||input===undefined||String(input).trim()==="")return false;const number=Number(input);return Number.isInteger(number)&&number>=0;};
        const isValidDate=(date)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const timestamp=Date.parse(date+"T00:00:00Z");return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===date;};
        if(kind==="checkLoss"){
          if(!isNonNegativeInteger(body.systemStock))return fail("Tồn hệ thống phải là số nguyên không âm");
          if(!isNonNegativeInteger(body.stock))return fail("Tồn thực tế phải là số nguyên không âm");
          if(body.loss!==undefined&&!isNonNegativeInteger(body.loss))return fail("Thất thoát phải là số nguyên không âm");
          const systemStock=asInt(body.systemStock),recordIndex=state.stockRecords.findIndex((record)=>normalizeText(record.sku)===normalizeText(product.sku));
          if(recordIndex>=0)state.stockRecords[recordIndex]={...state.stockRecords[recordIndex],stock:systemStock,updatedAt:now};
          else state.stockRecords.push({sku:product.sku,stock:systemStock,sales:0,updatedAt:now});
          current.stock=asInt(body.stock);current.loss=body.loss===undefined?Math.max(0,asInt(current.loss)):asInt(body.loss);
        } else if(kind==="stock"){
          if(!isNonNegativeInteger(value))return fail("Tồn kiểm đếm phải là số nguyên không âm");
          current.stock=asInt(value);
        } else if(kind==="loss"){
          if(!isNonNegativeInteger(value))return fail("Thất thoát phải là số nguyên không âm");
          current.loss=asInt(value);
        } else if(kind==="checkDate"){
          const inboundDate=asText(body.inboundDate),withdrawDate=asText(body.withdrawDate);
          if(!isValidDate(inboundDate)||!isValidDate(withdrawDate))return fail("Vui lòng chọn ngày nhập hàng và hạn rút hàng");
          if(withdrawDate<inboundDate)return fail("Hạn rút hàng không thể trước ngày nhập hàng");
          current.inboundDate=inboundDate;current.withdrawDate=withdrawDate;current.expDate=withdrawDate;
        } else if(kind==="expiry"){
          const date=asText(value);if(!isValidDate(date))return fail("Hạn dùng cần theo định dạng ngày hợp lệ");current.withdrawDate=date;current.expDate=date;
        } else return fail("Loại kiểm tra không hợp lệ");
        current.updatedAt=now;if(index>=0)state.manualChecks[index]=current;else state.manualChecks.push(current);
        const auditLabel=kind==="checkLoss"?"Check Loss":kind==="checkDate"?"Check Date":kind==="stock"?"kiểm tồn":kind==="loss"?"thất thoát":"hạn dùng";
        audit(state,actor,"Nhập "+auditLabel+" SKU "+product.sku);return {ok:true};
      }
      if(action==="upsertDailyReport"){
        const source=body.report||{},report=Object.fromEntries(DAILY_REPORT_COLUMNS.map(([key])=>[key,asText(source[key]).slice(0,2000)]));
        report.phone=normalizePhone(source.phone);report.date=normalizeOrderDate(source.date,Date.now());report.invoiceValue=Math.max(0,asDecimal(source.invoiceValue));report.remainingInvoiceValue=Math.max(0,asDecimal(source.remainingInvoiceValue));
        if(report.phone.replace(/\D/g,"").length<8)return fail("Số điện thoại khách hàng cần ít nhất 8 chữ số");if(!report.customerName)return fail("Tên khách hàng là bắt buộc");if(!report.employeeName)return fail("Tên nhân viên là bắt buộc");
        const customerFields=customerFieldsFromReport(report),now=Date.now(),existingCustomer=state.customers.find((customer)=>normalizePhone(customer.phone)===report.phone);
        if(pool&&customerStorageReady)await upsertPersistentCustomers([customerFields]);
        const savedCustomer=existingCustomer?Object.assign(existingCustomer,customerFields,{updatedAt:now}):{id:randomUUID(),...customerFields,createdAt:now,updatedAt:now};if(!existingCustomer)state.customers.push(savedCustomer);
        const id=asText(source.id),existingReport=id?state.dailyReports.find((item)=>item.id===id):null,savedReport=existingReport?Object.assign(existingReport,report,{id:existingReport.id,updatedAt:now}):{id:randomUUID(),...report,createdAt:now,updatedAt:now,createdBy:actor.name};if(!existingReport)state.dailyReports.unshift(savedReport);
        audit(state,actor,(existingReport?"Cập nhật":"Tạo")+" báo cáo ngày cho khách "+report.customerName);return {ok:true,report:savedReport,customer:savedCustomer};
      }
      if(action==="addPick"){const productId=asText(body.productId),quantity=Math.max(1,Math.min(99,asInt(body.quantity,1))),product=state.products.find((p)=>p.id===productId),record=product&&stockIndex(state.stockRecords).get(normalizeText(product.sku));if(!product)return fail("Không tìm thấy sản phẩm",404);if(!record)return fail("Chưa có dữ liệu tồn kho từ file Stock cho sản phẩm này",409);if(record.stock<=0)return fail("Sản phẩm đang hết hàng",409);const found=state.picking.find((item)=>item.userId===actor.userId&&item.productId===productId);if(found){found.quantity=Math.min(99,found.quantity+quantity);found.picked=false;found.pickedQuantity=0;}else {const now=Date.now();state.picking.push({id:randomUUID(),userId:actor.userId,productId,quantity,picked:false,pickedQuantity:0,orderDate:localDateKey(now),createdAt:now});}audit(state,actor,"Thêm sản phẩm vào đơn soạn");return {ok:true};}
      if(action==="assignPick"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const productId=asText(body.productId),requestedAssigneeId=asText(body.assigneeId),assigneeId=requestedAssigneeId,deliveryAssigneeId=asText(body.deliveryAssigneeId),quantity=Math.max(1,Math.min(999,asInt(body.quantity,1))),customerName=asText(body.customerName).slice(0,100),customerPhone=normalizePhone(body.customerPhone),invoiceNumber=asText(body.invoiceNumber).slice(0,80),note=asText(body.note).slice(0,500),orderDate=normalizeOrderDate(body.orderDate,Date.now()),deliveryTimeSlot=asText(body.deliveryTimeSlot),validSlots=["08:00 - 10:00","10:00 - 12:00","12:00 - 14:00","14:00 - 16:00","16:00 - 18:00","18:00 - 20:00"],product=state.products.find((p)=>p.id===productId),assignee=assigneeId?state.accounts.find((account)=>account.id===assigneeId&&account.active!==false):null,deliveryAssignee=deliveryAssigneeId?state.accounts.find((account)=>account.id===deliveryAssigneeId&&account.active!==false):null,record=product&&stockIndex(state.stockRecords).get(normalizeText(product.sku));if(!product)return fail("Không tìm thấy sản phẩm",404);if(assigneeId&&!assignee)return fail("Không tìm thấy nhân viên soạn hàng",404);if(deliveryAssigneeId&&(!deliveryAssignee||!["DELIVERY","BOTH"].includes(deliveryAssignee.workType||"BOTH")))return fail("Nhân viên giao hàng không hợp lệ",404);if(deliveryTimeSlot&&!validSlots.includes(deliveryTimeSlot))return fail("Khung giờ giao hàng không hợp lệ");if(!record||record.stock<=0)return fail("Sản phẩm không có tồn kho từ file Stock",409);if(quantity>record.stock)return fail("Số lượng giao vượt tồn kho hiện có ("+record.stock+")",400);if(!customerName)return fail("Tên khách hàng là bắt buộc");if(customerPhone.replace(/\D/g,"").length<8)return fail("Số điện thoại khách hàng cần ít nhất 8 chữ số");const now=Date.now();state.picking.push({id:randomUUID(),userId:assigneeId||"",productId,quantity,picked:false,workflowStatus:assigneeId?"picking":"unassigned",customerName,customerPhone,invoiceNumber,orderDate,note,assignedBy:actor.name,deliveryAssigneeId,deliveryTimeSlot,createdAt:now});audit(state,actor,(assigneeId?"Gán":"Tạo")+" SKU "+product.sku+(assignee?.name?" cho "+assignee.name:"")+" · khách "+customerName);return {ok:true};}
      if(action==="reassignOrder"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const assigneeId=asText(body.assigneeId),pickIds=Array.isArray(body.pickIds)?body.pickIds.map((id)=>asText(id)).filter(Boolean).slice(0,200):[],assignee=state.accounts.find((account)=>account.id===assigneeId&&account.active!==false);if(!assignee)return fail("Không tìm thấy nhân viên nhận đơn",404);if(!pickIds.length)return fail("Đơn hàng chưa có sản phẩm",400);const selected=new Set(pickIds),matches=state.picking.filter((item)=>selected.has(asText(item.id)));if(!matches.length)return fail("Không tìm thấy đơn hàng",404);for(const item of matches){item.userId=assigneeId;item.picked=false;item.pickedQuantity=0;item.workflowStatus="picking";item.assignedBy=actor.name;item.updatedAt=Date.now();}audit(state,actor,"Gán "+matches.length+" sản phẩm trong đơn cho "+assignee.name);return {ok:true,updated:matches.length};}
      if(action==="completePickingOrder"){const pickIds=Array.isArray(body.pickIds)?body.pickIds.map((id)=>asText(id)).filter(Boolean).slice(0,200):[],selected=new Set(pickIds),matches=state.picking.filter((item)=>selected.has(asText(item.id)));if(!pickIds.length||!matches.length)return fail("Không tìm thấy đơn hàng",404);if(!canManage(actor.role)&&matches.some((item)=>item.userId!==actor.userId))return fail("Bạn không được hoàn tất đơn của nhân viên khác",403);if(matches.some((item)=>asInt(item.pickedQuantity,item.picked?item.quantity:0)<Math.max(1,asInt(item.quantity,1))))return fail("Cần đánh dấu đã lấy đủ số lượng trước khi hoàn tất",400);for(const item of matches){item.picked=true;item.pickedQuantity=Math.max(1,asInt(item.quantity,1));item.workflowStatus="ready_delivery";item.updatedAt=Date.now();}audit(state,actor,"Hoàn tất soạn "+matches.length+" sản phẩm");return {ok:true,updated:matches.length};}
      if(action==="assignDeliveryOrder"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const deliveryAssigneeId=asText(body.deliveryAssigneeId),pickIds=Array.isArray(body.pickIds)?body.pickIds.map((id)=>asText(id)).filter(Boolean).slice(0,200):[],deliveryAssignee=state.accounts.find((account)=>account.id===deliveryAssigneeId&&account.active!==false);if(!deliveryAssignee||!["DELIVERY","BOTH"].includes(deliveryAssignee.workType||"BOTH"))return fail("Tài khoản chưa được cấp quyền Giao hàng",400);const selected=new Set(pickIds),matches=state.picking.filter((item)=>selected.has(asText(item.id)));if(!matches.length)return fail("Không tìm thấy đơn hàng",404);if(matches.some((item)=>item.workflowStatus!=="ready_delivery"&&!item.picked))return fail("Đơn chưa hoàn tất khâu soạn hàng",400);for(const item of matches){item.deliveryAssigneeId=deliveryAssigneeId;item.workflowStatus="ready_delivery";item.updatedAt=Date.now();}audit(state,actor,"Gán tài xế "+deliveryAssignee.name+" cho "+matches.length+" sản phẩm");return {ok:true,updated:matches.length};}
      if(action==="completeDeliveryOrder"){const pickIds=Array.isArray(body.pickIds)?body.pickIds.map((id)=>asText(id)).filter(Boolean).slice(0,200):[],selected=new Set(pickIds),matches=state.picking.filter((item)=>selected.has(asText(item.id)));if(!pickIds.length||!matches.length)return fail("Không tìm thấy đơn hàng",404);if(!canManage(actor.role)&&matches.some((item)=>item.deliveryAssigneeId!==actor.userId))return fail("Bạn không được hoàn tất đơn giao của tài xế khác",403);const now=Date.now();state.orderHistory=[...matches.map((item)=>({...item,workflowStatus:"delivered",completedAt:now,completedBy:actor.name,orderDate:normalizeOrderDate(item.orderDate,item.createdAt||now),customerPhone:normalizePhone(item.customerPhone)})),...state.orderHistory].slice(0,5000);state.picking=state.picking.filter((item)=>!selected.has(asText(item.id)));audit(state,actor,"Hoàn tất giao "+matches.length+" sản phẩm");return {ok:true,updated:matches.length};}
      if(action==="reopenDeliveredOrder"){if(actor.role!=="ADMIN")return fail("Chỉ Admin được chỉnh sửa đơn đã giao",403);const pickIds=Array.isArray(body.pickIds)?body.pickIds.map((id)=>asText(id)).filter(Boolean).slice(0,200):[],selected=new Set(pickIds),matches=state.orderHistory.filter((item)=>selected.has(asText(item.id)));if(!matches.length)return fail("Không tìm thấy đơn đã giao",404);state.picking=[...matches.map((item)=>{const copy={...item};delete copy.completedAt;delete copy.completedBy;copy.workflowStatus="ready_delivery";return copy;}),...state.picking];state.orderHistory=state.orderHistory.filter((item)=>!selected.has(asText(item.id)));audit(state,actor,"Mở lại "+matches.length+" sản phẩm đã giao để chỉnh sửa");return {ok:true,updated:matches.length};}
      if(action==="updatePickQuantity"){const key=asText(body.pickId)||asText(body.productId),item=state.picking.find((p)=>(p.id===key||p.productId===key)&&p.userId===actor.userId);if(!item)return fail("Sản phẩm không còn trong đơn",404);item.quantity=Math.max(1,Math.min(99,asInt(body.quantity,1)));item.picked=false;item.pickedQuantity=0;audit(state,actor,"Cập nhật số lượng cần lấy");return {ok:true};}
      if(action==="togglePick"){const key=asText(body.pickId)||asText(body.productId),item=state.picking.find((p)=>(p.id===key||p.productId===key)&&p.userId===actor.userId);if(item){const quantity=Math.max(1,asInt(item.quantity,1)),next=asInt(item.pickedQuantity,item.picked?quantity:0)>=quantity?0:quantity;item.pickedQuantity=next;item.picked=next>0;}audit(state,actor,"Cập nhật trạng thái lấy hàng");return {ok:true};}
      if(action==="updatePickedQuantity"){const key=asText(body.pickId)||asText(body.productId),item=state.picking.find((p)=>(p.id===key||p.productId===key)&&p.userId===actor.userId);if(!item)return fail("Sản phẩm không còn trong đơn",404);const quantity=Math.max(1,asInt(item.quantity,1)),pickedQuantity=Math.max(0,Math.min(quantity,asInt(body.quantity,0)));item.pickedQuantity=pickedQuantity;item.picked=pickedQuantity>0;audit(state,actor,"Cập nhật số lượng đã lấy");return {ok:true};}
      if(action==="markPickAvailability"){const key=asText(body.pickId)||asText(body.productId),item=state.picking.find((p)=>(p.id===key||p.productId===key)&&p.userId===actor.userId);if(!item)return fail("Sản phẩm không còn trong đơn",404);item.available=Boolean(body.available);audit(state,actor,"Đánh dấu sản phẩm "+(item.available?"có hàng":"không có hàng"));return {ok:true};}
      if(action==="removePick"){const key=asText(body.pickId)||asText(body.productId);state.picking=state.picking.filter((p)=>!((p.id===key||p.productId===key)&&p.userId===actor.userId));audit(state,actor,"Bỏ sản phẩm khỏi đơn soạn");return {ok:true};}
      if(action==="clearPick"){const now=Date.now(),completed=state.picking.filter((p)=>p.userId===actor.userId);state.orderHistory=[...completed.map((item)=>({...item,id:asText(item.id)||randomUUID(),workflowStatus:"delivered",completedAt:now,completedBy:actor.name,orderDate:normalizeOrderDate(item.orderDate,item.createdAt||now),customerPhone:normalizePhone(item.customerPhone)})),...state.orderHistory].slice(0,5000);state.picking=state.picking.filter((p)=>p.userId!==actor.userId);audit(state,actor,"Hoàn tất và lưu lịch sử đơn soạn");return {ok:true};}
      if(action==="updateLineConfig"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const source=body.lineConfig||{},line=cleanLine(source.line),name=asText(source.name).slice(0,48),color=asText(source.color).toUpperCase(),logo=asText(source.logo).slice(0,36);if(!name)return fail("Tên Line là bắt buộc");if(!/^#[0-9A-F]{6}$/.test(color))return fail("Màu cần theo định dạng #RRGGBB");const config={line,name,color,logo,updatedAt:Date.now()},index=state.lineConfigs.findIndex((item)=>item.line===line);if(index>=0)state.lineConfigs[index]=config;else state.lineConfigs.push(config);audit(state,actor,"Cập nhật layout Line "+line+": "+name);return {ok:true};}
      if(action==="updatePogPage"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const line=cleanLine(body.line),side=asText(body.side,"A")==="B"?"B":"A",record=state.pogFiles.find((item)=>item.id===line+"_"+side);if(!record)return fail("Chưa có file POG cho mặt kệ này",404);record.page=Math.max(1,Math.min(99,asInt(body.page,1)));record.updatedAt=Date.now();audit(state,actor,"Đổi trang POG Line "+line+" mặt "+side);return {ok:true};}
      if(action==="updateAppBrand"){
        if(actor.role!=="ADMIN")return fail("Chỉ Admin được thay đổi logo ứng dụng",403);
        const current=state.appBrand||{logo:"/aeon-logo.svg",logoSize:220,logoSizeDesktop:220,logoSizeMobile:120};
        const logo=asText(body.logo)||current.logo||"/aeon-logo.svg";
        const desktopInput=body.logoSizeDesktop===undefined?body.logoSize:body.logoSizeDesktop;
        const desktopFallback=current.logoSizeDesktop||current.logoSize||220;
        const mobileFallback=current.logoSizeMobile||Math.round(desktopFallback*.55);
        const logoSizeDesktop=Math.max(50,Math.min(320,asInt(desktopInput,desktopFallback)));
        const logoSizeMobile=Math.max(72,Math.min(220,asInt(body.logoSizeMobile,mobileFallback)));
        if(logo!=="/aeon-logo.svg"&&(!/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/i.test(logo)||logo.length>1_500_000))return fail("Logo cần là PNG, JPG, WEBP hoặc SVG, dung lượng tối đa 1 MB");
        state.appBrand={logo,logoSize:logoSizeDesktop,logoSizeDesktop,logoSizeMobile,updatedAt:Date.now()};
        audit(state,actor,"Cập nhật logo ứng dụng");
        return {ok:true};
      }
      return fail("Thao tác không hợp lệ");
    });
    res.status(result.status||200).json(result);
  } catch (error) { next(error); }
});

app.post("/api/customers/import", requireManager, upload.single("file"), async (req,res)=>{
  if(!req.file)return res.status(400).json({error:"Hãy chọn file Excel khách hàng .xlsx"});
  if(!req.file.originalname.toLowerCase().endsWith(".xlsx"))return res.status(400).json({error:"Chỉ hỗ trợ file Excel định dạng .xlsx"});
  try {
    const parsed=await readCustomerWorkbook(req.file.buffer);
    if(pool&&customerStorageReady){
      const persisted=await upsertPersistentCustomers(parsed.records);
      store.replaceCustomers(persisted.customers);
      console.info("Imported customer master directly to PostgreSQL:",parsed.sheetName,persisted.created,"new",persisted.updated,"updated");
      const imported=persisted.created+persisted.updated,skipped=parsed.skipped+Math.max(0,parsed.records.length-imported);
      return res.json({ok:true,fileName:req.file.originalname,sheetName:parsed.sheetName,created:persisted.created,updated:persisted.updated,imported,skipped,total:persisted.total,storage:"postgres"});
    }
    const result=await store.mutate((state)=>{const actor=actorFrom(req,state);if(!actor||!canManage(actor.role))return {error:"Cần quyền Manager hoặc Admin",status:403};let created=0,updated=0;for(const source of parsed.records){const report={...source},fields=customerFieldsFromReport(report),phone=normalizePhone(fields.phone);if(phone.replace(/\D/g,"").length<8)continue;const existing=state.customers.find((customer)=>normalizePhone(customer.phone)===phone);if(existing){for(const [key,value] of Object.entries(fields))if(value)existing[key]=value;existing.updatedAt=Date.now();updated++;}else {state.customers.push({id:randomUUID(),...fields,createdAt:Date.now(),updatedAt:Date.now()});created++;}}const imported=created+updated,skipped=parsed.skipped+Math.max(0,parsed.records.length-imported);audit(state,actor,"Nhập Master Data khách hàng ("+(parsed.sheetName||"sheet")+"): "+created+" mới, "+updated+" cập nhật");return {ok:true,fileName:req.file.originalname,sheetName:parsed.sheetName,created,updated,imported,skipped,total:state.customers.length};});
    res.status(result.status||200).json(result);
  }catch(error){res.status(400).json({error:error instanceof Error?error.message:"Không thể đọc file khách hàng"});}
});

app.post("/api/master-data/import", requireManager, requireImportCapacity, masterUpload.single("file"), async (req, res, next) => {
  try {
    if(!req.file)return res.status(400).json({error:"Hãy chọn file Excel .xlsx"});
    const removeUpload=()=>fs.unlink(req.file.path).catch(()=>undefined);
    if(!req.file.originalname.toLowerCase().endsWith(".xlsx")){await removeUpload();return res.status(400).json({error:"Chỉ hỗ trợ file Excel định dạng .xlsx"});}
    const handle=await fs.open(req.file.path,"r");let signature;
    try { signature=Buffer.alloc(4);await handle.read(signature,0,4,0); } finally { await handle.close(); }
    if(req.file.size<4||signature[0]!==0x50||signature[1]!==0x4b){await removeUpload();return res.status(400).json({error:"File .xlsx không hợp lệ hoặc đã bị hỏng"});}
    const requestedId=asText(req.headers["x-import-id"]),jobId=importIdPattern.test(requestedId)?requestedId:randomUUID(),existing=masterJobs.get(jobId);
    if(existing){await removeUpload();if(existing.ownerId!==req.fulfillmentActor.userId)return res.status(409).json({error:"Mã lần nhập đã được sử dụng"});return res.status(202).json(publicMasterJob(existing));}
    const now=Date.now(),job={id:jobId,ownerId:req.fulfillmentActor.userId,fileName:req.file.originalname,filePath:req.file.path,status:"queued",phase:"Đã nhận file, đang chờ xử lý",percent:5,processedRows:0,totalRows:0,createdAt:now,updatedAt:now,result:null,error:""};
    masterJobs.set(job.id,job);
    res.status(202).set("Location","/api/master-data/import/"+job.id).json(publicMasterJob(job));
    enqueueMasterJob(job);
  } catch(error) { next(error); }
});

app.get("/api/master-data/import/:jobId",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const job=masterJobs.get(asText(req.params.jobId));if(!job)return res.status(404).json({error:"Không tìm thấy lần nhập dữ liệu này"});
    if(job.ownerId!==actor.userId&&actor.role!=="ADMIN")return res.status(403).json({error:"Bạn không có quyền xem lần nhập này"});
    res.set("Cache-Control","no-store").json(publicMasterJob(job));
  } catch(error){next(error);}
});

app.post("/api/stock/import", requireManager, masterUpload.single("file"), async(req,res,next)=>{
  try {
    if(!req.file)return res.status(400).json({error:"Hãy chọn file Excel .xlsx"});
    const removeUpload=()=>fs.unlink(req.file.path).catch(()=>undefined);
    if(!req.file.originalname.toLowerCase().endsWith(".xlsx")){await removeUpload();return res.status(400).json({error:"Chỉ hỗ trợ file Excel định dạng .xlsx"});}
    const handle=await fs.open(req.file.path,"r");let signature;try{signature=Buffer.alloc(4);await handle.read(signature,0,4,0);}finally{await handle.close();}
    if(req.file.size<4||signature[0]!==0x50||signature[1]!==0x4b){await removeUpload();return res.status(400).json({error:"File .xlsx không hợp lệ hoặc đã bị hỏng"});}
    const active=[...stockJobs.values()].find((job)=>["queued","processing"].includes(job.status));if(active){await removeUpload();return res.status(409).json({error:"Hệ thống đang xử lý một file Stock khác"});}
    const now=Date.now(),job={id:randomUUID(),ownerId:req.fulfillmentActor.userId,fileName:req.file.originalname,filePath:req.file.path,status:"queued",phase:"Đã nhận file Stock",percent:5,processedRows:0,totalRows:0,createdAt:now,updatedAt:now,result:null,error:""};stockJobs.set(job.id,job);res.status(202).set("Location","/api/stock/import/"+job.id).json(publicMasterJob(job));void runStockJob(job);
  }catch(error){next(error);}
});
app.get("/api/stock/import/:jobId",async(req,res,next)=>{
  try{const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});const job=stockJobs.get(asText(req.params.jobId));if(!job)return res.status(404).json({error:"Không tìm thấy lần nhập Stock"});if(job.ownerId!==actor.userId&&actor.role!=="ADMIN")return res.status(403).json({error:"Bạn không có quyền xem lần nhập này"});res.set("Cache-Control","no-store").json(publicMasterJob(job));}catch(error){next(error);}
});

app.post("/api/cloudinary/upload", requireManager, upload.single("file"), async(req,res,next)=>{
  try {
    const cloudName=asText(process.env.CLOUDINARY_CLOUD_NAME),apiKey=asText(process.env.CLOUDINARY_API_KEY),apiSecret=asText(process.env.CLOUDINARY_API_SECRET);
    if(!cloudName||!apiKey||!apiSecret)return res.status(503).json({error:"Cloudinary chưa được cấu hình trên máy chủ"});
    if(!req.file)return res.status(400).json({error:"Chưa nhận được ảnh sản phẩm"});
    if(!req.file.mimetype||!req.file.mimetype.startsWith("image/"))return res.status(400).json({error:"Chỉ hỗ trợ tệp hình ảnh"});
    if(req.file.size>8*1024*1024)return res.status(413).json({error:"Ảnh sản phẩm tối đa 8 MB"});
    if(!/^[a-z0-9_-]+$/i.test(cloudName))return res.status(500).json({error:"CLOUDINARY_CLOUD_NAME không hợp lệ"});
    const folder=asText(process.env.CLOUDINARY_FOLDER||"products").replace(/[^a-zA-Z0-9/_-]/g,"").replace(/^\/+|\/+$/g,"");
    const sku=asText(req.body?.sku).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80),publicId=(sku||"product")+"-"+randomUUID().replace(/-/g,"").slice(0,16),timestamp=Math.floor(Date.now()/1000);
    const signedParams={timestamp,public_id:publicId,...(folder?{folder}: {})};
    const signatureBase=Object.entries(signedParams).sort(([left],[right])=>left.localeCompare(right)).map(([key,value])=>key+"="+value).join("&");
    const signature=createHash("sha1").update(signatureBase+apiSecret).digest("hex");
    const form=new FormData();form.append("file",new Blob([req.file.buffer],{type:req.file.mimetype}),req.file.originalname||"product.jpg");
    for(const [key,value] of Object.entries(signedParams))form.append(key,String(value));
    form.append("api_key",apiKey);form.append("signature",signature);
    const response=await fetch("https://api.cloudinary.com/v1_1/"+encodeURIComponent(cloudName)+"/image/upload",{method:"POST",body:form});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||!payload.secure_url){const detail=asText(payload?.error?.message);return res.status(502).json({error:detail?"Cloudinary: "+detail:"Không thể tải ảnh lên Cloudinary"});}
    res.json({ok:true,url:payload.secure_url,publicId:payload.public_id||publicId,assetId:payload.asset_id||""});
  } catch(error) { next(error); }
});

app.post("/api/ai/suggest", async (req, res, next) => {
  try {
    const state=await store.read(),actor=actorFrom(req,state)||guestActor;
    const query=asText(req.body?.query).slice(0,500);
    if(query.length<2)return res.status(400).json({error:"Hãy mô tả nhu cầu bằng ít nhất 2 ký tự."});
    const cacheKey=normalizeText(query)+"|"+asInt(state.stockImport?.updatedAt,0),cached=suggestionCache.get(cacheKey);
    if(cached&&cached.expiresAt>Date.now())return res.set("Cache-Control","no-store").json(cached.result);
    if(asText(process.env.OPENAI_API_KEY)){
      const retryAfter=takeAiQuota(actor.userId);
      if(retryAfter){res.set("Retry-After",String(retryAfter));return res.status(429).json({error:"Bạn đang phân tích quá nhanh. Vui lòng thử lại sau "+retryAfter+" giây."});}
    }
    const productsBySku=new Map(state.products.map((product)=>[normalizeText(product.sku),product]));
    const stockProducts=state.stockRecords.map((record)=>{const product=productsBySku.get(normalizeText(record.sku));return product?{...product,stock:record.stock,stockKnown:true,loss:0,expDate:"",sales:record.sales||0}:null;}).filter((product)=>product&&product.stock>0).sort((a,b)=>b.stock-a.stock);
    const suggestions=await openAiProductSuggestions(query,stockProducts);
    const result={...suggestions,productCount:stockProducts.length};
    suggestionCache.set(cacheKey,{result,expiresAt:Date.now()+60_000});if(suggestionCache.size>100){const oldest=suggestionCache.keys().next().value;if(oldest)suggestionCache.delete(oldest);}
    res.set("Cache-Control","no-store").json(result);
  } catch (error) { next(error); }
});

app.get("/api/pog", async (req, res, next) => {
  try {
    const state=await store.read();
    if(!actorFrom(req,state))return res.status(401).send("Unauthorized");
    const record=state.pogFiles.find((file)=>file.id===asText(req.query.id));
    if(!record)return res.status(404).send("Not found");
    const shelf=asText(req.query.asset)==="shelf"&&record.shelfFileKey,sourceIndex=Math.max(0,asInt(req.query.source)),sources=Array.isArray(record.sources)&&record.sources.length?record.sources:[{fileKey:record.fileKey,fileName:record.fileName,mimeType:record.mimeType}],source=sources[Math.min(sourceIndex,sources.length-1)],fileKey=shelf?record.shelfFileKey:source.fileKey,mimeType=shelf?(record.shelfMimeType||"image/webp"):source.mimeType,fileName=shelf?(record.shelfFileName||"pog-shelf.webp"):source.fileName;
    const filePath=path.join(uploadDir,fileKey);if(!existsSync(filePath))return res.status(404).send("Not found");
    // Shelf images are immutable because the URL includes the POG updatedAt
    // version. Let browsers and the background preloader reuse them instantly.
    const cacheControl=shelf?"public, max-age=31536000, immutable":"private, max-age=300";
    res.type(mimeType).set({"Content-Disposition":"inline; filename="+fileName.replace(/"/g,""),"Cache-Control":cacheControl}).sendFile(filePath);
  } catch (error) { next(error); }
});

app.post("/api/pog", requireManager, upload.fields([{name:"file",maxCount:1},{name:"shelfImage",maxCount:1}]), async (req, res, next) => {
  try {
    const files=req.files||{},sourceFile=files.file?.[0],shelfFile=files.shelfImage?.[0];
    if(!sourceFile)return res.status(400).json({error:"Thiếu tệp"});
    const isPdf=sourceFile.mimetype==="application/pdf"||/\.pdf$/i.test(sourceFile.originalname),isImage=sourceFile.mimetype.startsWith("image/");
    if(!isImage&&!isPdf)return res.status(400).json({error:"Chỉ nhận ảnh hoặc PDF"});
    const result=await store.mutate(async(state)=>{
      const actor=actorFrom(req,state);if(!actor)return {error:"Vui lòng đăng nhập",status:401};if(!canManage(actor.role))return {error:"Cần quyền Manager hoặc Admin",status:403};
      const line=cleanLine(req.body.line),side=asText(req.body.side,"A")==="B"?"B":"A",id=line+"_"+side,index=state.pogFiles.findIndex((item)=>item.id===id),existing=index>=0?state.pogFiles[index]:null,mode=["append","reanalyze"].includes(asText(req.body.mode))?asText(req.body.mode):"replace",safeName=sourceFile.originalname.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100),fileKey=Date.now()+"-"+createHash("sha1").update(sourceFile.buffer).digest("hex").slice(0,10)+"-"+safeName,oldSources=existing?(Array.isArray(existing.sources)&&existing.sources.length?existing.sources:[{fileKey:existing.fileKey,fileName:existing.fileName,mimeType:existing.mimeType}]):[];
      let sources;if(mode==="reanalyze"&&oldSources.length)sources=oldSources;else{await fs.writeFile(path.join(uploadDir,fileKey),sourceFile.buffer);const uploadedSource={fileKey,fileName:sourceFile.originalname,mimeType:isPdf?"application/pdf":sourceFile.mimetype};sources=mode==="append"?[...oldSources,uploadedSource]:[uploadedSource];}const primary=sources[0];
      let positions=[];try{positions=JSON.parse(asText(req.body.positions,"[]"));}catch{positions=[];}positions=Array.isArray(positions)?positions.slice(0,10000).map((position)=>({number:Math.max(0,asInt(position.number)),sku:asText(position.sku).slice(0,40),barcode:asText(position.barcode).slice(0,40),name:asText(position.name).slice(0,300),x:Math.max(0,Math.min(1,Number(position.x)||0)),y:Math.max(0,Math.min(1,Number(position.y)||0)),linked:position.linked!==false})).filter((position)=>position.number&&position.sku):[];
      let shelfFileKey="",shelfFileName="",shelfMimeType="";if(shelfFile&&shelfFile.mimetype.startsWith("image/")){shelfFileName=shelfFile.originalname.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100);shelfFileKey=Date.now()+"-shelf-"+createHash("sha1").update(shelfFile.buffer).digest("hex").slice(0,10)+"-"+shelfFileName;shelfMimeType=shelfFile.mimetype;await fs.writeFile(path.join(uploadDir,shelfFileKey),shelfFile.buffer);}
      const item={id,line,side,fileKey:primary.fileKey,fileName:primary.fileName,mimeType:primary.mimeType,sources,page:Math.max(1,Math.min(99,asInt(req.body.page,existing?.page||1))),shelfFileKey,shelfFileName,shelfMimeType,shelfImage:Boolean(shelfFileKey),shelfWidth:Math.max(0,asInt(req.body.shelfWidth)),shelfHeight:Math.max(0,asInt(req.body.shelfHeight)),positions,sourcePages:asText(req.body.sourcePages).split(",").map((value)=>asInt(value)).filter(Boolean),analysisVersion:Math.max(0,asInt(req.body.analysisVersion)),updatedAt:Date.now()};
      if(index>=0)state.pogFiles[index]=item;else state.pogFiles.push(item);
      audit(state,actor,(mode==="append"?"Thêm file vào":"Cập nhật")+" POG Line "+line+" mặt "+side+": "+sourceFile.originalname+" · "+sources.length+" file · "+positions.length+" SKU đã liên kết");return {ok:true,id,fileName:item.fileName,mimeType:item.mimeType,fileCount:sources.length,mappedCount:positions.length,analyzedPages:item.sourcePages.length};
    });
    res.status(result.status||200).json(result);
  } catch (error) { next(error); }
});

await store.init();
// Warm the read-only indexes before accepting browser traffic. Without this,
// the first search/Stock/POG request pays the cost of scanning tens of
// thousands of Master Data rows and appears as a long spinner to users.
const warmState=await store.read();
stockIndex(warmState.stockRecords);productSkuIndex(warmState.products);productLookup(warmState.products);productSearchIndex(warmState.products);const warmStockRows=stockRows(warmState);productSearchIndex(warmStockRows);getProductSummary(warmState);for(const file of warmState.pogFiles)if(file.positions?.length)pogRows(warmState,file);
app.use("/api",(_req,res)=>res.status(404).json({error:"API không tồn tại"}));
if(production)app.use(express.static(path.join(root,"dist")));
else { const {createServer:createViteServer}=await import("vite");const vite=await createViteServer({root,server:{middlewareMode:true},appType:"spa"});app.use(vite.middlewares); }
app.use((req,res,next)=>{if(req.method!=="GET"||!req.accepts("html"))return next();res.sendFile(path.join(root,"dist/index.html"));});
app.use((_req,res)=>res.status(404).json({error:"Không tìm thấy"}));
app.use((error,_req,res,next)=>{void next;console.error(error);res.status(error.code==="LIMIT_FILE_SIZE"?413:500).json({error:error.code==="LIMIT_FILE_SIZE"?"Tệp vượt quá dung lượng cho phép (Excel 100 MB, POG 20 MB).":"Máy chủ gặp lỗi. Vui lòng thử lại."});});
app.listen(port,"0.0.0.0",()=>console.log("Fulfillment SmartOps listening on http://0.0.0.0:"+port));
