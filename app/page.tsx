"use client";
/* eslint-disable @next/next/no-img-element -- POG uploads are served dynamically by the Node API. */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Role = "ADMIN" | "MANAGER" | "STAFF";
type Tab = "DASHBOARD" | "MAP" | "PRODUCTS" | "CHECK_STOCK" | "CHECK_LOSS" | "DATE" | "ORDER" | "DAILY_REPORT" | "SUGGEST";
type UiPreferences = { density:"comfortable"|"compact"; fontSize:"normal"|"large"; reduceMotion:boolean };
type Product = { id:string; sku:string; name:string; division:string; divisionName:string; department:string; departmentName:string; supplierBarcode:string; barcode:string; imageUrl?:string; line:string; lineName:string; side:"A"|"B"; bay:number; shelfLine?:string; shelfSide?:string; shelfPosition?:number; price:number; promoPrice?:number; stock:number; systemStock?:number; sales?:number; stockKnown?:boolean; loss:number; expDate:string; manualStock?:number; manualLoss?:number; inboundDate?:string; withdrawDate?:string; updatedAt?:number };
type ManualCheckKind = "checkLoss" | "checkDate";
type WorkflowStatus = "unassigned"|"picking"|"ready_delivery"|"delivered";
type PickItem = Product & { pickId:string; quantity:number; picked:boolean|number; pickedQuantity?:number; workflowStatus?:WorkflowStatus; available?:boolean; customerName:string; customerPhone?:string; invoiceNumber?:string; note:string; assignedBy:string; assigneeId?:string; assigneeName?:string; deliveryAssigneeId?:string; deliveryAssigneeName?:string; deliveryTimeSlot?:string; orderDate?:string; createdAt?:number };
type AssignedPickItem = PickItem & { assigneeId:string; assigneeName:string };
type OrderHistoryItem = PickItem & { completedAt:number; completedBy?:string };
type Actor = { userId:string; username:string; email:string; name:string; role:Role; workType?:WorkType; active:boolean };
type Audit = { id:string; action:string; userId:string; userName:string; createdAt:number };
type WorkType = "PICKING"|"DELIVERY"|"BOTH";
type UserRole = { userId:string; username:string; email:string; name:string; role:Role; workType?:WorkType; active:boolean; createdAt:number; updatedAt?:number };
type PogPosition = { number:number; sku:string; barcode:string; name:string; x:number; y:number; linked?:boolean };
type PogSource = { fileName:string; mimeType:string };
type PogFile = { id:string; line:string; side:"A"|"B"; fileName:string; mimeType:string; sources?:PogSource[]; page?:number; shelfImage?:boolean; shelfWidth?:number; shelfHeight?:number; positions?:PogPosition[]; analysisVersion?:number; updatedAt:number };
type LineConfig = { line:string; name:string; color:string; logo:string; updatedAt?:number };
type AiSuggestion = { productId:string; sku:string; name:string; line:string; side:"A"|"B"; bay:number; price:number; stock:number; quantity:number; reason:string };
type AiSuggestionResult = { mode:"ai"|"local"; model:string|null; summary:string; notice:string; items:AiSuggestion[]; productCount:number };
type MasterImportResult = { fileName:string; created:number; updated:number; unchanged:number; imported:number; totalProducts:number; skipped:number; duplicates:number; issues:Array<{row:number;reason:string}> };
type MasterImportJob = { jobId:string; status:"uploading"|"queued"|"processing"|"completed"|"failed"; phase:string; percent:number; processedRows:number; totalRows:number; fileName:string; result:MasterImportResult|null; error:string; updatedAt?:number };
type StockImportJob = Omit<MasterImportJob,"result"> & {result:{fileName:string;imported:number;skipped:number;duplicates:number;issues:Array<{row:number;reason:string}>}|null};
type ProductStats = { total:number; outCount:number; lowCount:number; totalLoss:number; expiring:number };
type CustomerMaster = {id:string;phone:string;name:string;status?:string;vatExport?:string;memberCard?:string;group?:string;companyName?:string;email?:string;taxId?:string;vatAddress?:string;deliveryAddress?:string;createdAt?:number;updatedAt?:number};
type DailyReport = {id:string;employeeName:string;date:string;phone:string;customerName:string;customerStatus:string;vatExport:string;orderType:string;invoiceNumber:string;invoiceValue:number|string;paymentMethod:string;cdoNumber:string;codNumber:string;carrier:string;returnStatus:string;remainingInvoiceValue:number|string;memberCard:string;customerGroup:string;email:string;taxId:string;vatAddress:string;deliveryAddress:string;createdAt?:number;updatedAt?:number;createdBy?:string};
type PurchaseHistoryRecord = {id:string;period:string;phone:string;customerName:string;address:string;date:string;invoiceNumber:string;invoiceValue:number;products?:string;sourceName?:string;sourceRow?:number;updatedAt?:number};
type PurchaseHistoryCustomer = {phone:string;customerName:string;address:string;monthTotal:number;yearTotal:number;orders:number;monthlyTotals:Record<string,number>};
type PurchaseHistorySummary = {month:string;year:string;records:PurchaseHistoryRecord[];customers:PurchaseHistoryCustomer[];totals:{monthValue:number;yearValue:number;monthOrders:number;yearOrders:number;customerCount:number};storage?:string};
type StoreData = { actor:Actor; products:Product[]; productTotal:number; productStats:ProductStats; alertProducts:Product[]; availableLines:string[]; logs:Audit[]; picking:PickItem[]; assignedPicking:AssignedPickItem[]; orderHistory?:OrderHistoryItem[]; users:UserRole[]; customers?:CustomerMaster[]; pogFiles:PogFile[]; lineConfigs?:LineConfig[]; appBrand?:{logo:string;logoSize:number;logoSizeDesktop?:number;logoSizeMobile?:number;updatedAt:number}; manualChecks:{checkLoss?:Product[];stock?:Product[];loss?:Product[];expiry:Product[]}; stockImport?:{fileName:string;updatedAt:number;recordCount:number;skipped:number}|null };
type ProductPage = { products:Product[]; total:number; page:number; pageSize:number; matchedLines?:string[] };

const aisleNames: Record<string,string> = {
  "01":"Souvenir","02":"Chocolate","03":"Fruit","04":"Confectionery","05":"Milk","06":"Milk","07":"Kids","08":"Kids",
  "09":"Nonfood","10":"Home Coordy","11":"Home Coordy","12":"Household","13":"Household","14":"Nonfood","15":"Nonfood",
  "16":"Nonfood","17":"Beer & Liquor","18":"Tea & Drinks","19":"Coffee","20":"Topvalu","21":"Topvalu","22":"Asia",
  "23":"Asia","24":"Noodles","25":"Rice","26":"Sauces","27":"Spices","28":"Seafood"
};
const menu: Array<{id:Tab;label:string}> = [
  {id:"DASHBOARD",label:"Tổng quan"},{id:"MAP",label:"Sơ đồ POG"},{id:"PRODUCTS",label:"Sản phẩm"},
  {id:"CHECK_STOCK",label:"Check Stock"},{id:"CHECK_LOSS",label:"Check Loss"},{id:"DATE",label:"Check Date"},
  {id:"ORDER",label:"Đơn soạn"},{id:"DAILY_REPORT",label:"Báo cáo ngày"},{id:"SUGGEST",label:"Gợi ý"}
];
function AppIcon({name}:{name:Tab}) {
  const paths:Record<Tab,React.ReactNode>={
    DASHBOARD:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    MAP:<><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15M15 6v15"/></>,
    PRODUCTS:<><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
    CHECK_STOCK:<><path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h5M8 15h3"/><path d="m14 16 1.5 1.5L19 14"/></>,
    CHECK_LOSS:<><path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v5M12 17h.01"/><path d="M7 6.5h10"/></>,
    DATE:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="m9 15 2 2 4-4"/></>,
    ORDER:<><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h3"/><path d="m15 16 1.5 1.5L20 13"/></>,
    DAILY_REPORT:<><path d="M4 4h16v16H4z"/><path d="M8 2v4M16 2v4M4 9h16M8 13h3M8 17h6"/></>,
    SUGGEST:<><path d="M9 18h6M10 22h4"/><path d="M8.2 15.2A7 7 0 1 1 15.8 15.2c-1.1.8-1.8 1.6-1.8 2.8h-4c0-1.2-.7-2-1.8-2.8Z"/><path d="M12 2V0M4 5 2.5 3.5M20 5l1.5-1.5"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
const emptyProduct: Product = { id:"",sku:"",name:"",division:"",divisionName:"",department:"",departmentName:"",supplierBarcode:"",barcode:"",line:"01",lineName:"SOUVENIR",side:"A",bay:1,price:0,promoPrice:0,stock:0,loss:0,expDate:"" };
const money = new Intl.NumberFormat("vi-VN");
const decimalMoney = new Intl.NumberFormat("en-US",{minimumFractionDigits:0,maximumFractionDigits:2});
function formatInvoiceInput(value:unknown) {
  const raw=String(value??"").replace(/[^\d.,]/g,"");
  if(!raw)return "";
  const lastDot=raw.lastIndexOf("."),lastComma=raw.lastIndexOf(",");
  let decimalSeparator="";
  if(lastDot>=0&&lastComma>=0)decimalSeparator=lastDot>lastComma?".":",";
  else if(lastDot>=0)decimalSeparator=".";
  else if(lastComma>=0&&raw.length-lastComma-1<3)decimalSeparator=",";
  const separatorIndex=decimalSeparator?raw.lastIndexOf(decimalSeparator):-1;
  const integerSource=(separatorIndex>=0?raw.slice(0,separatorIndex):raw).replace(/\D/g,"");
  const decimalSource=separatorIndex>=0?raw.slice(separatorIndex+1).replace(/\D/g,""):"";
  const integer=(integerSource||"0").replace(/^0+(?=\d)/,"");
  const grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,",");
  return grouped+(decimalSeparator?(raw.endsWith(decimalSeparator)||decimalSource?"."+decimalSource:""):"");
}
const normalize = (value:unknown) => String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"d").toLowerCase().trim();
const orderDateKey = (value:unknown) => {
  const text=String(value??"").trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  const date=new Date(typeof value === "number" ? value : text);
  if(!Number.isFinite(date.getTime()))return "";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};
const orderDateLabel = (value:unknown) => {
  const key=orderDateKey(value);
  if(!key)return "Chưa có ngày";
  return new Intl.DateTimeFormat("vi-VN",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric"}).format(new Date(`${key}T00:00:00`));
};
const defaultOrderMonth = orderDateKey(new Date().getTime()).slice(0,7);
const todayOrderDate = orderDateKey(new Date().getTime());
const orderGroupKey = (item:PickItem) => {const phone=(item.customerPhone||"").replace(/\D/g,""),name=normalize((item.customerName||"").trim())||"chua dat ten khach";return `${orderDateKey(item.orderDate||item.createdAt)}|${phone?`phone:${phone}`:`name:${name}`}`;};
const groupOrderItems = <T extends PickItem>(items:T[]) => {const groups=new Map<string,T[]>();for(const item of items){const key=orderGroupKey(item);groups.set(key,[...(groups.get(key)||[]),item]);}return [...groups.values()];};
const pickWorkflowStatus = (item:PickItem):WorkflowStatus => item.workflowStatus || (item.assigneeId ? (item.picked ? "ready_delivery" : "picking") : "unassigned");
const pickedQuantityFor = (item:PickItem) => Math.max(0,Math.min(item.quantity,Number(item.pickedQuantity??(item.picked===true?item.quantity:item.picked||0))||0));
// Máy quét/camera đôi khi trả về tiền tố định dạng (ví dụ ]C1) hoặc chữ
// mô tả. Giữ nguyên số 0 ở đầu nhưng chỉ lấy chuỗi số dài nhất để truy vấn
// đúng barcode trong Master Data/Stock.
const normalizeScannedBarcode = (rawValue:string) => {
  const raw=String(rawValue||"").trim().replace(/^\](?:[A-Za-z]\d?)/,"");
  const compact=raw.replace(/\D/g,"");
  if(compact.length>=6&&!/[A-Za-z]/.test(raw))return compact;
  const runs=raw.match(/\d+/g)||[];
  return runs.sort((a,b)=>b.length-a.length)[0]||"";
};
const productImageUrls = (value?:string) => [...new Set(String(value||"").split("|").map((item)=>item.trim()).filter(Boolean))].slice(0,32);
const productImageUrl = (value?:string) => productImageUrls(value)[0]||"";
const isLinkedPogPosition = (position:PogPosition) => position.linked !== false && (position.x !== 0 || position.y !== 0);
const canManage = (role?:Role) => { const normalized=String(role||"").toUpperCase(); return normalized === "ADMIN" || normalized === "MANAGER"; };
const POG_ANALYSIS_VERSION=14;
const STORE_SNAPSHOT_KEY="fulfillment-store-snapshot-v1";
// A proxy can briefly return plain text or HTML (for example 502) while the
// server is restarting. Convert that into an operator-friendly error instead
// of leaking a JSON parser exception into the interface.
async function readApiJson<T>(response:Response):Promise<T> {
  const body=await response.text();
  try { return JSON.parse(body||"{}") as T; }
  catch {
    if(response.status>=500)throw new Error(`Máy chủ tạm thời không phản hồi (${response.status} ${response.statusText||"Server Error"}). Vui lòng thử lại sau vài giây.`);
    throw new Error(`Máy chủ trả về dữ liệu không hợp lệ${response.status?` (${response.status})`:""}.`);
  }
}
async function fetchApi(input:RequestInfo|URL,init?:RequestInit):Promise<Response> {
  const retryable=!init?.method||["GET","HEAD"].includes(init.method.toUpperCase());
  let response=await fetch(input,init);
  if(!retryable||![502,503,504].includes(response.status))return response;
  for(const delay of [500,1200]){
    await new Promise<void>((resolve)=>window.setTimeout(resolve,delay));
    response=await fetch(input,init);
    if(![502,503,504].includes(response.status))break;
  }
  return response;
}
function readStoreSnapshot():{data:StoreData;cachedAt:number}|null {
  if(typeof window==="undefined")return null;
  try {
    const parsed=JSON.parse(window.sessionStorage.getItem(STORE_SNAPSHOT_KEY)||"null") as {data?:StoreData;cachedAt?:number}|null;
    if(!parsed?.data?.actor||!Array.isArray(parsed.data.pogFiles)||!Number.isFinite(parsed.cachedAt)||Date.now()-(parsed.cachedAt||0)>5*60_000)return null;
    return {data:parsed.data,cachedAt:parsed.cachedAt||0};
  } catch { return null; }
}

type PogAnalysis = { image:Blob; width:number; height:number; positions:PogPosition[]; sourcePages:number[] };
type PogAnalysisMode = "auto" | "page1" | "page2";
type PdfTextToken = { text:string; x:number; y:number; fontSize:number };
type PogRow = { number:number; sku:string; barcode:string; name:string; y:number; page:number; location?:string };
type PogMarker = { number:number; x:number; y:number; location?:string };
type CropBox = { x:number; y:number; width:number; height:number };

function parsePogRows(groups:PdfTextToken[][],page:number):PogRow[] {
  let location="";
  const rows:PogRow[]=[];
  for(const group of groups){
    const sorted=[...group].sort((a,b)=>a.x-b.x),joined=sorted.map((token)=>token.text).join(" ").replace(/\s+/g," ").trim();
    const locationHeader=joined.match(/(?:fixel\s*[_-]?\s*id|location\s*[_-]?\s*id)\s+([a-z0-9]+(?:\/[a-z0-9]+)?)/i)||joined.match(/^([0-9]{1,2}\/[0-9]{1,2})$/);
    if(locationHeader)location=locationHeader[1];
    // Mẫu chuẩn: STT | SKU | barcode | tên sản phẩm.
    const skuAndBarcode=joined.match(/^(\d{1,4})[.)]?\s+([A-Z0-9-]{4,20})\s+(\d{6,20})\s+(.{2,})$/i);
    if(skuAndBarcode){rows.push({number:Number(skuAndBarcode[1]),sku:skuAndBarcode[2],barcode:skuAndBarcode[3],name:skuAndBarcode[4].replace(/\s+(?:\d+|\*)\s+(?:\d+|\*)$/,"").trim(),y:group[0].y,page,location:location||undefined});continue;}
    // Microsoft Print to PDF đôi khi ghép SKU 8 số và barcode 13 số thành một chuỗi 21 số.
    const gluedSkuAndBarcode=joined.match(/^(\d{1,4})[.)]?\s+(\d{18,33})(?=\D)\s*(.{2,})$/i);
    if(gluedSkuAndBarcode){
      const ids=gluedSkuAndBarcode[2],barcode=ids.slice(-13),sku=ids.slice(0,-13);
      if(sku.length>=4){rows.push({number:Number(gluedSkuAndBarcode[1]),sku,barcode,name:gluedSkuAndBarcode[3].replace(/\s+(?:\d+|\*)\s+(?:\d+|\*)$/,"").trim(),y:group[0].y,page,location:location||undefined});continue;}
    }
    // Một số POG dùng Location_ID | UPC | Name. UPC là barcode liên kết Master Data.
    const upcAndName=joined.match(/^(\d{1,4})[.)]?\s+(\d{8,20})\s+(.{2,}?)(?:\s+(?:\d+|\*)\s+(?:\d+|\*))?$/);
    if(upcAndName)rows.push({number:Number(upcAndName[1]),sku:upcAndName[2],barcode:upcAndName[2],name:upcAndName[3].trim(),y:group[0].y,page,location:location||undefined});
  }
  return rows;
}

function cropShelfToProductBorder(canvas:HTMLCanvasElement,initial:CropBox,tokens:PdfTextToken[]):CropBox|null {
  const numeric=tokens.filter((token)=>token.x>=initial.x&&token.x<=initial.x+initial.width&&token.y>=initial.y&&token.y<=initial.y+initial.height*.84&&token.fontSize>=5&&/^\d{1,3}[.)]?$/.test(token.text));
  const shelfLabels=tokens.filter((token)=>token.x>=initial.x&&token.x<=initial.x+initial.width&&token.y>=initial.y&&token.y<=initial.y+initial.height&&/^(?:notch\b|mam\b|gondola\b|bay\b)/i.test(token.text));
  const measurements=tokens.filter((token)=>token.x>=initial.x&&token.x<=initial.x+initial.width&&token.y>=initial.y&&token.y<=initial.y+initial.height&&/^\d+(?:[.,]\d+)?(?:m|cm)$/i.test(token.text));
  // POG của các Line có thể không in Notch/MAM/độ dài kệ. STT trên ảnh là
  // dữ liệu chung bắt buộc, đủ để xác định vùng sản phẩm và đặt marker.
  if(numeric.length<2)return null;
  const anchors=[...numeric,...shelfLabels,...measurements],anchorLeft=Math.min(...anchors.map((token)=>token.x)),anchorRight=Math.max(...anchors.map((token)=>token.x)),anchorTop=Math.min(...anchors.map((token)=>token.y)),anchorBottom=Math.max(...anchors.map((token)=>token.y));
  const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)return null;
  const sx=Math.max(0,Math.floor(initial.x)),sy=Math.max(0,Math.floor(initial.y)),sw=Math.min(canvas.width-sx,Math.ceil(initial.width)),sh=Math.min(canvas.height-sy,Math.ceil(initial.height)),pixels=context.getImageData(sx,sy,sw,sh).data;
  const dark=(x:number,y:number)=>{const index=(y*sw+x)*4;return pixels[index]<125&&pixels[index+1]<125&&pixels[index+2]<125;};
  const horizontal:number[]=[];for(let y=0;y<sh;y++){let ink=0;for(let x=0;x<sw;x+=2)if(dark(x,y))ink++;if(ink>=sw*.24)horizontal.push(sy+y);}
  const vertical:number[]=[];for(let x=0;x<sw;x++){let ink=0;for(let y=0;y<sh;y+=2)if(dark(x,y))ink++;if(ink>=sh*.08)vertical.push(sx+x);}
  const rawLeft=[...vertical].filter((value)=>value<=anchorLeft+4).pop(),rawRight=vertical.find((value)=>value>=anchorRight-4),bandStart=(value:number)=>{let edge=value;while(vertical.includes(edge-1))edge--;return edge;},bandEnd=(value:number)=>{let edge=value;while(vertical.includes(edge+1))edge++;return edge;};
  const top=[...horizontal].filter((value)=>value<=anchorTop+4).pop(),bottom=horizontal.find((value)=>value>=anchorBottom-4),left=rawLeft===undefined?undefined:bandStart(rawLeft),right=rawRight===undefined?undefined:bandEnd(rawRight);
  const fallback={x:Math.max(initial.x,anchorLeft-24),y:Math.max(initial.y,anchorTop-24),width:Math.min(initial.x+initial.width,anchorRight+24)-Math.max(initial.x,anchorLeft-24),height:Math.min(initial.y+initial.height,anchorBottom+24)-Math.max(initial.y,anchorTop-24)};
  if(top===undefined||bottom===undefined||left===undefined||right===undefined||right-left<initial.width*.35||bottom-top<initial.height*.35)return fallback;
  return {x:Math.max(initial.x,left-1),y:Math.max(initial.y,top-1),width:Math.min(initial.x+initial.width,right+1)-Math.max(initial.x,left-1),height:Math.min(initial.y+initial.height,bottom+1)-Math.max(initial.y,top-1)};
}

// Some supplier POGs (such as Line 18) place the shelf diagram in a narrow
// column beside the product table, while other pages contain only the image.
// Detect the densest visual band below the page heading so the table is never
// concatenated into the shelf image; parsed rows are linked afterward.
function cropVisualShelf(canvas:HTMLCanvasElement):CropBox|null {
  const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)return null;
  const {width,height}=canvas,data=context.getImageData(0,0,canvas.width,canvas.height).data,step=3,scanTop=Math.floor(height*.15),scanBottom=Math.floor(height*.96),scanSpan=scanBottom-scanTop;
  const ink=(x:number,y:number)=>{const index=(y*width+x)*4,red=data[index],green=data[index+1],blue=data[index+2];return red<242||green<242||blue<242;};
  // Product-list pages often place the actual shelf diagram in a narrow
  // column beside a wide table. Find a full-height divider first so table
  // text is never mistaken for the shelf image.
  let visualRight=width;
  for(let x=Math.floor(width*.18);x<Math.floor(width*.65);x++){let score=0;for(let y=scanTop;y<scanBottom;y+=step)if(ink(x,y)&&data[(y*width+x)*4]<125&&data[(y*width+x)*4+1]<125&&data[(y*width+x)*4+2]<125)score++;if(score>=scanSpan/step*.45){visualRight=x;break;}}
  const rowScores:number[]=[];
  for(let y=Math.floor(height*.18);y<height*.94;y+=step){let score=0;for(let x=0;x<visualRight;x+=step)if(ink(x,y))score++;rowScores.push(score);}
  const threshold=Math.max(8,Math.floor(visualRight/step*.035)),runs:Array<{start:number;end:number;score:number}>=[];
  let start=-1,last=-1,total=0;
  for(let index=0;index<rowScores.length;index++){
    const active=rowScores[index]>=threshold,y=Math.floor(height*.18)+index*step;
    if(active){if(start<0){start=y;total=0;}last=y;total+=rowScores[index];continue;}
    if(start>=0&&y-last>42){runs.push({start,end:last,score:total});start=-1;}
  }
  if(start>=0)runs.push({start,end:last,score:total});
  const run=runs.filter((item)=>item.end-item.start>height*.12).sort((left,right)=>(right.end-right.start)*right.score-(left.end-left.start)*left.score)[0];
  if(!run)return null;
  const top=Math.max(0,run.start-10),bottom=Math.min(height,run.end+18),columnScores:number[]=[];
  for(let x=0;x<visualRight;x+=step){let score=0;for(let y=top;y<bottom;y+=step)if(ink(x,y))score++;columnScores.push(score);}
  const columnThreshold=Math.max(5,Math.floor((bottom-top)/step*.04));let left=-1,right=-1;
  for(let index=0;index<columnScores.length;index++)if(columnScores[index]>=columnThreshold){if(left<0)left=index*step;right=index*step;}
  if(left<0||right-left<visualRight*.35)return null;
  return {x:Math.max(0,left-12),y:top,width:Math.min(visualRight,right+15)-Math.max(0,left-12),height:bottom-top};
}

async function analyzePogPdf(file:File,mode:PogAnalysisMode="auto"):Promise<PogAnalysis|null> {
  if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name))return null;
  // PDF.js is only needed when an administrator analyzes a POG upload. Keep
  // it out of the initial page bundle so text/catalog screens open faster.
  const [pdfjs,workerModule]=await Promise.all([import("pdfjs-dist"),import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc=workerModule.default;
  const pdfDocument=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
  const pieces:Array<{canvas:HTMLCanvasElement;crop:{x:number;y:number;width:number;height:number};markers:PogMarker[];page:number;hasRows:boolean}>=[],tables:Array<{groups:PdfTextToken[][];page:number}>=[];
  for(let pageNumber=1;pageNumber<=pdfDocument.numPages;pageNumber++){
    const page=await pdfDocument.getPage(pageNumber),viewport=page.getViewport({scale:2.4}),textContent=await page.getTextContent();
    const tokens:PdfTextToken[]=[];
    for(const item of textContent.items){
      if(!("str" in item)||!item.str.trim())continue;
      const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
      tokens.push({text:item.str.trim(),x,y,fontSize:item.height});
    }
    // Các mẫu POG khác nhau đặt tên cột đầu là Location_ID, STT, No, SKU hoặc UPC.
    // Chỉ dùng token tiêu đề cột chính xác để không nhầm tiêu đề trang thành bảng sản phẩm.
    const headerKey=(value:string)=>value.normalize("NFKD").toLowerCase().replace(/[ƟƢ]/g,"t").replace(/[^a-z0-9]/g,"");
    const headerCandidates=tokens.filter((token)=>{const key=headerKey(token.text);return key.startsWith("loca")||["stt","no","number","sku","upc","barcode"].includes(key);});
    // Prefer the location/STT anchor: UPC may appear earlier in the PDF text
    // stream and would otherwise cut off the first two columns of each row.
    const tableHeader=headerCandidates.find((token)=>{const key=headerKey(token.text);return key.startsWith("loca")||["stt","no","number"].includes(key);})||headerCandidates[0];
    // Một số file chỉ có ảnh/bảng không ghi tiêu đề cột; khi đó dùng toàn trang
    // làm vùng dữ liệu và vẫn áp dụng cùng parser/crop như Line 16.
    // Không dùng riêng tọa độ cột STT/Location để đoán phía của bảng: cột này
    // nằm sát đường chia đôi và từng khiến vùng Product List bị hiểu nhầm là kệ.
    // Lấy tâm của cả hàng tiêu đề (SKU/UPC/Name/Total...) để xác định phía bảng.
    const headerTokens=tableHeader?tokens.filter((token)=>Math.abs(token.y-tableHeader.y)<=48&&/^(?:loca|product|sku|upc|barcode|name|total)/i.test(token.text)):[];
    const headerCenter=headerTokens.length>=2?(Math.min(...headerTokens.map((token)=>token.x))+Math.max(...headerTokens.map((token)=>token.x)))/2:tableHeader?.x||0;
    const tableOnRight=Boolean(tableHeader&&(headerTokens.length>=2?headerCenter>=viewport.width*.5:tableHeader.x>=viewport.width*.3));
    const tableAreaTokens=tableHeader?tokens.filter((token)=>tableOnRight?token.x>=tableHeader.x-5:token.x<=viewport.width*.58):tokens;
    const groups:PdfTextToken[][]=[];
    for(const token of [...tableAreaTokens].sort((a,b)=>a.y-b.y||a.x-b.x)){
      const group=groups.find((candidate)=>Math.abs(candidate[0].y-token.y)<=5);
      if(group)group.push(token);else groups.push([token]);
    }
    const rows=parsePogRows(groups,pageNumber);if(rows.length)tables.push({groups,page:pageNumber});
    // Luôn đọc bảng sản phẩm trên mọi trang của PDF. Chế độ Trang 1/Trang 2
    // chỉ giới hạn ảnh kệ được hiển thị; danh sách STT/SKU/barcode vẫn là
    // nguồn dữ liệu chung để liên kết vào marker của trang đang chọn.
    const displayPage=mode==="auto"||mode==="page1"&&pageNumber===1||mode==="page2"&&pageNumber===2;
    if(!displayPage)continue;
    const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const context=canvas.getContext("2d");if(!context)continue;
    await page.render({canvas,canvasContext:context,viewport}).promise;
    // Prefer the visual shelf detector on every page. Product-list pages in
    // supplier PDFs commonly place the shelf beside the table; using the
    // table crop first would concatenate the blue Product List instead of the
    // actual shelf image. The table rows are still retained above for STT ↔
    // SKU linking after all shelf pieces are assembled.
    let crop:CropBox|null=cropVisualShelf(canvas);
    if(!crop&&rows.length>=2){
      const rowYs=rows.map((row)=>row.y),rowGroups=groups.filter((group)=>parsePogRows([group],pageNumber).length>0),rowTokens=rowGroups.flat(),tableLeft=Math.min(...rowTokens.map((token)=>token.x)),tableRight=Math.max(...rowTokens.map((token)=>token.x)),tableTop=Math.max(0,Math.min(...rowYs)-18),tableBottom=Math.min(viewport.height,Math.max(...rowYs)+18);
      // Ảnh kệ luôn được lấy từ vùng nằm kế bên và đối diện bảng dữ liệu.
      const sideCandidates=(tableOnRight
        ?[{x:0,y:0,width:tableLeft-14,height:viewport.height}]
        :[{x:tableRight+14,y:0,width:viewport.width-tableRight-14,height:viewport.height}]
      ).filter((box)=>box.width>viewport.width*.15&&box.height>viewport.height*.25);
      const fallbackCandidates=[{x:0,y:0,width:viewport.width,height:tableTop-14},{x:0,y:tableBottom+14,width:viewport.width,height:viewport.height-tableBottom-14}].filter((box)=>box.width>viewport.width*.25&&box.height>viewport.height*.25);
      const candidate=(sideCandidates.length?sideCandidates:fallbackCandidates).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      crop=candidate?cropShelfToProductBorder(canvas,candidate,tokens):null;
    }
    if(!crop)continue;
    const shelfCanvas=document.createElement("canvas");shelfCanvas.width=Math.max(1,Math.ceil(crop.width));shelfCanvas.height=Math.max(1,Math.ceil(crop.height));const shelfContext=shelfCanvas.getContext("2d");if(!shelfContext)continue;shelfContext.drawImage(canvas,crop.x,crop.y,crop.width,crop.height,0,0,shelfCanvas.width,shelfCanvas.height);
    const locationAnchors=tokens.filter((token)=>/^\d{1,2}\/\d{1,2}$/.test(token.text));
    const markers:PogMarker[]=[];
    for(const token of tokens){
      const number=Number(token.text.replace(/[.)]/g,""));
      if(!Number.isInteger(number)||number<1||number>999||token.fontSize<5)continue;
      if(token.x>=crop.x&&token.x<=crop.x+crop.width&&token.y>=crop.y&&token.y<=crop.y+crop.height*.92){
        // The location label is often printed at the far right edge of the
        // shelf (or just outside the crop), so do not discard it based on X.
        // Vertical proximity keeps repeated STT numbers in different bays
        // distinguishable (e.g. STT 6 in 10/2 vs 10/4).
        const nearest=locationAnchors.sort((a,b)=>Math.abs(a.y-token.y)*4+Math.abs(a.x-token.x)- (Math.abs(b.y-token.y)*4+Math.abs(b.x-token.x)))[0];
        markers.push({number,x:token.x-crop.x,y:token.y-crop.y,location:nearest?.text});
      }
    }
    pieces.push({canvas:shelfCanvas,crop:{x:0,y:0,width:shelfCanvas.width,height:shelfCanvas.height},markers,page:pageNumber,hasRows:rows.length>=2});
  }
  if(!pieces.length)return null;
  // If the PDF contains Product List tables, ignore overview pages without
  // rows; they are often a duplicate full-layout drawing and would make one
  // bay appear disproportionately large when concatenated. For image-only
  // PDFs, keep every detected visual shelf page.
  // Khi chọn riêng một trang, trang đó có thể chỉ chứa ảnh kệ còn bảng STT
  // nằm ở trang khác; vẫn giữ ảnh đã chọn để liên kết với bảng đã đọc.
  const shelfPieces=mode==="auto"&&tables.length?pieces.filter((piece)=>piece.hasRows):pieces;
  if(!shelfPieces.length)return null;
  shelfPieces.sort((a,b)=>a.page-b.page);
  // Keep enough resolution for zooming while avoiding multi-megabyte POG
  // images. The source PDFs remain on the server for re-analysis if needed.
  const targetHeight=1200,rawWidths=shelfPieces.map((piece)=>piece.crop.width*targetHeight/piece.crop.height),rawTotal=rawWidths.reduce((sum,width)=>sum+width,0),fit=Math.min(1,10000/rawTotal),height=Math.max(1,Math.round(targetHeight*fit)),overlap=Math.max(0,shelfPieces.length-1),width=Math.max(1,Math.round(rawTotal*fit)-overlap);
  const output=document.createElement("canvas");output.width=width;output.height=height;const context=output.getContext("2d");if(!context)return null;
  const positions:PogPosition[]=[],rendered:Array<{piece:typeof pieces[number];offset:number;scale:number}>=[];let offset=0;
  shelfPieces.forEach((piece,index)=>{
    const pieceWidth=Math.round(rawWidths[index]*fit),scale=height/piece.crop.height;
    context.drawImage(piece.canvas,piece.crop.x,piece.crop.y,piece.crop.width,piece.crop.height,offset,0,pieceWidth,height);
    rendered.push({piece,offset,scale});
    offset+=pieceWidth-1;
  });
  // Chỉ đọc và liên kết dữ liệu sau khi toàn bộ ảnh kệ đã được ghép xong.
  // STT là cầu nối giữa marker trên ảnh; SKU/barcode là cầu nối tới Stock/Master.
  const allRows=tables.flatMap(({groups,page})=>parsePogRows(groups,page));
  const linkedRows=new Set<string>(),usedMarkers=new Set<string>();for(const row of allRows){const rowKey=`${row.page}:${row.number}:${row.sku}:${row.barcode}`;if(linkedRows.has(rowKey))continue;linkedRows.add(rowKey);const candidates=[...rendered].flatMap(({piece,offset,scale})=>piece.markers.map((marker,index)=>({piece,offset,scale,marker,index,exact:Boolean(row.location&&marker.location===row.location)}))).filter(({marker})=>marker.number===row.number);const target=candidates.sort((a,b)=>Number(b.exact)-Number(a.exact)||(Math.abs(a.piece.page-row.page)-Math.abs(b.piece.page-row.page)))[0],marker=target?.marker,markerKey=target?`${target.piece.page}:${target.index}`:"";if(target&&marker&&!usedMarkers.has(markerKey)){usedMarkers.add(markerKey);positions.push({number:row.number,sku:row.sku,barcode:row.barcode,name:row.name,x:(target.offset+(marker.x-target.piece.crop.x)*target.scale)/width,y:((marker.y-target.piece.crop.y)*target.scale)/height,linked:true});}else positions.push({number:row.number,sku:row.sku,barcode:row.barcode,name:row.name,x:0,y:0,linked:false});}
  const image=await new Promise<Blob>((resolve,reject)=>output.toBlob((blob)=>blob?resolve(blob):reject(new Error("Không thể tạo ảnh POG ghép")),"image/webp",.84));
  return {image,width,height,positions,sourcePages:shelfPieces.map((piece)=>piece.page)};
}

async function combinePogAnalyses(analyses:PogAnalysis[]):Promise<PogAnalysis|null> {
  if(!analyses.length)return null;if(analyses.length===1)return analyses[0];
  const bitmaps=await Promise.all(analyses.map((analysis)=>createImageBitmap(analysis.image))),targetHeight=1200,rawWidths=analyses.map((analysis)=>analysis.width*targetHeight/analysis.height),rawTotal=rawWidths.reduce((sum,value)=>sum+value,0),fit=Math.min(1,10000/rawTotal),height=Math.max(1,Math.round(targetHeight*fit)),width=Math.max(1,Math.round(rawTotal*fit)-(analyses.length-1));
  const output=document.createElement("canvas");output.width=width;output.height=height;const context=output.getContext("2d");if(!context){bitmaps.forEach((bitmap)=>bitmap.close());return null;}
  const positions:PogPosition[]=[];let offset=0;analyses.forEach((analysis,index)=>{const pieceWidth=Math.round(rawWidths[index]*fit);context.drawImage(bitmaps[index],offset,0,pieceWidth,height);for(const position of analysis.positions)positions.push({...position,x:(offset+position.x*pieceWidth)/width});offset+=pieceWidth-1;});bitmaps.forEach((bitmap)=>bitmap.close());
  const image=await new Promise<Blob>((resolve,reject)=>output.toBlob((blob)=>blob?resolve(blob):reject(new Error("Không thể ghép nhiều file POG")),"image/webp",.84));return {image,width,height,positions,sourcePages:analyses.flatMap((analysis)=>analysis.sourcePages)};
}

async function analyzePogFiles(files:File[],mode:PogAnalysisMode="auto"):Promise<PogAnalysis|null> {
  const analyses:PogAnalysis[]=[];for(const file of files){const analysis=await analyzePogPdf(file,mode);if(analysis)analyses.push(analysis);}return combinePogAnalyses(analyses);
}

function expiryStatus(value:string) {
  if (!value) return {label:"Chưa có HSD",tone:"muted"};
  const days = Math.ceil((new Date(value + "T00:00:00").getTime() - new Date().setHours(0,0,0,0)) / 86400000);
  if (days < 0) return {label:"Đã hết hạn",tone:"danger"};
  if (days <= 30) return {label:"Còn " + days + " ngày",tone:"warning"};
  return {label:"An toàn",tone:"success"};
}

function StockBadge({stock,known=true}:{stock:number;known?:boolean}) {
  if(!known)return <span className="badge muted">Chưa tải tồn</span>;
  return <span className={"badge " + (stock === 0 ? "danger" : stock < 10 ? "warning" : "success")}>{stock === 0 ? "Hết hàng · 0" : stock < 10 ? "Sắp hết · " + stock : "Còn hàng · " + stock}</span>;
}

function BarcodeIcon() {
  return <svg viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9V5h4M24 9V5h-4M4 19v4h4M24 19v4h-4"/>
    <path d="M8 9v10M10.5 7v14M13 10v8M16 7v14M18.5 10v8M21 7v14"/>
    <path d="M7 14h14" strokeWidth="1.2" opacity=".45"/>
  </svg>;
}

function BarcodeScannerModal({onClose,onDetected,onError}:{onClose:()=>void;onDetected:(value:string)=>void;onError:(message:string)=>void}) {
  const videoRef=useRef<HTMLVideoElement>(null),zxingRef=useRef<{stop:()=>void;switchTorch?:(on:boolean)=>Promise<void>}|null>(null),scanRef=useRef({value:"",hits:0,at:0});
  const detectedRef=useRef(onDetected),errorRef=useRef(onError);
  const [status,setStatus]=useState("Đang mở camera…"),[manual,setManual]=useState(""),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[deviceId,setDeviceId]=useState(""),[torchOn,setTorchOn]=useState(false),[torchAvailable,setTorchAvailable]=useState(false);
  useEffect(()=>{detectedRef.current=onDetected;errorRef.current=onError;},[onDetected,onError]);
  useEffect(()=>{
    let stopped=false;
    scanRef.current={value:"",hits:0,at:0};
    const stop=()=>{zxingRef.current?.stop();zxingRef.current=null;const source=videoRef.current?.srcObject;if(source instanceof MediaStream)source.getTracks().forEach((track)=>track.stop());if(videoRef.current)videoRef.current.srcObject=null;};
    const accept=(raw:string,controls:{stop:()=>void})=>{
      const value=normalizeScannedBarcode(raw);if(!value||stopped)return;
      // ZXing only calls the callback after a complete checksum-valid decode.
      // Accept the first valid result instead of waiting for a second frame;
      // this removes the noticeable confirmation delay on phone cameras.
      const now=Date.now(),previous=scanRef.current;
      if(previous.value===value&&now-previous.at<800)return;
      scanRef.current={value,hits:1,at:now};
      stopped=true;controls.stop();zxingRef.current=null;detectedRef.current(value);
    };
    const start=async()=>{
      try {
        if(!window.isSecureContext&&location.hostname!=="localhost")throw new Error("Quét bằng camera cần trang HTTPS. Hãy mở bằng domain https, không dùng địa chỉ IP nội bộ.");
        if(!navigator.mediaDevices?.getUserMedia)throw new Error("Trình duyệt không hỗ trợ camera. Hãy dùng HTTPS/localhost, máy quét USB hoặc nhập mã.");
        const video=videoRef.current;if(!video)return;
        // Barcode decoding is an opt-in feature; defer its bundle until the
        // scanner modal is actually opened and camera access is available.
        const [{BrowserMultiFormatReader},{BarcodeFormat}]=await Promise.all([import("@zxing/browser"),import("@zxing/library")]);
        setStatus("Đang bật camera sau…");
        const reader=new BrowserMultiFormatReader(undefined,{delayBetweenScanAttempts:35,delayBetweenScanSuccess:100});reader.possibleFormats=[BarcodeFormat.EAN_13,BarcodeFormat.EAN_8,BarcodeFormat.UPC_A,BarcodeFormat.UPC_E,BarcodeFormat.CODE_128,BarcodeFormat.CODE_39,BarcodeFormat.ITF];
        // 1280×720 is sufficient for retail EAN/UPC codes and starts much
        // faster than requesting a 1920×1080 stream on mobile devices.
        const camera={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}};
        const preferred={audio:false,video:deviceId?{deviceId:{exact:deviceId},...camera}:{facingMode:{ideal:"environment"},...camera}} as MediaStreamConstraints;
        const scan=(result:{getText:()=>string}|undefined,_error:unknown,controls:{stop:()=>void})=>{if(result)accept(result.getText(),controls);};
        let controls;try{controls=await reader.decodeFromConstraints(preferred,video,scan);}catch(cause){if(deviceId||(cause as DOMException)?.name!=="OverconstrainedError")throw cause;controls=await reader.decodeFromConstraints({audio:false,video:true},video,scan);}
        if(stopped){controls.stop();return;}zxingRef.current=controls;setTorchAvailable(Boolean(controls.switchTorch));setStatus("Đưa mã vạch vào giữa khung hình để quét.");
        const cameras=(await navigator.mediaDevices.enumerateDevices()).filter((device)=>device.kind==="videoinput");if(!stopped)setDevices(cameras);
      } catch(cause) { const error=cause as DOMException;const message=error?.name==="NotAllowedError"?"Chưa được cấp quyền camera. Hãy cho phép camera hoặc dùng HTTPS/localhost, máy quét USB hay nhập mã.":cause instanceof Error?cause.message:"Không thể mở camera";setStatus(message);errorRef.current(message); }
    };
    void start();return()=>{stopped=true;stop();};
  },[deviceId]);
  return <div className="modal-backdrop barcode-modal"><section className="scanner-card" role="dialog" aria-modal="true" aria-label="Quét barcode"><div className="modal-head"><div><p>QUÉT SẢN PHẨM</p><h2>Quét barcode</h2></div><button onClick={onClose}>×</button></div><div className="scanner-video"><video ref={videoRef} muted playsInline/><span className="scanner-frame"/></div><p>{status}</p>{devices.length>1&&<label className="scanner-device">Camera<select value={deviceId} onChange={(event)=>setDeviceId(event.target.value)}><option value="">Camera sau (tự động)</option>{devices.map((device,index)=><option key={device.deviceId} value={device.deviceId}>{device.label||"Camera "+(index+1)}</option>)}</select></label>}{torchAvailable&&<button className="ghost scanner-torch" onClick={()=>{const next=!torchOn;void zxingRef.current?.switchTorch?.(next).then(()=>setTorchOn(next)).catch(()=>setStatus("Camera này không hỗ trợ đèn flash."));}}>{torchOn?"Tắt đèn flash":"Bật đèn flash"}</button>}<form className="scanner-manual" onSubmit={(event)=>{event.preventDefault();const value=normalizeScannedBarcode(manual);if(value)onDetected(value);}}><input value={manual} onChange={(event)=>setManual(event.target.value)} inputMode="numeric" placeholder="Hoặc nhập / quét bằng máy quét USB"/><button className="primary" disabled={!normalizeScannedBarcode(manual)}>Tìm</button></form><button className="ghost scanner-close" onClick={onClose}>Đóng</button></section></div>;
}

export default function Home() {
  const [data,setData] = useState<StoreData|null>(null);
  const [authMode,setAuthMode] = useState<"login"|"setup"|null>(null);
  const [loginOpen,setLoginOpen] = useState(false);
  const [tab,setTab] = useState<Tab>("DASHBOARD");
  const [query,setQuery] = useState("");
  const [stockFilter,setStockFilter] = useState<"all"|"available"|"low"|"out">("all");
  const [lastSyncedAt,setLastSyncedAt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [toast,setToast] = useState("");
  const [productDetails,setProductDetails] = useState<Product|null>(null);
  const [productModal,setProductModal] = useState<Product|null>(null);
  const [assignmentProduct,setAssignmentProduct] = useState<Product|null>(null);
  const [orderTabSignal,setOrderTabSignal] = useState(0);
  const [manualCheckModal,setManualCheckModal] = useState<ManualCheckKind|null>(null);
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [lineModal,setLineModal] = useState<LineConfig|null>(null);
  const [pogModal,setPogModal] = useState<{line:string;side:"A"|"B";selectedId?:string}|null>(null);
  const [pogSearch,setPogSearch] = useState("");
  const [suggestInput,setSuggestInput] = useState("");
  const [suggestResult,setSuggestResult] = useState<AiSuggestionResult|null>(null);
  const [suggestBusy,setSuggestBusy] = useState(false);
  const [suggestError,setSuggestError] = useState("");
  const [scannerOpen,setScannerOpen] = useState(false);
  const [pogUploadBusy,setPogUploadBusy] = useState(false);
  const [masterImport,setMasterImport] = useState<MasterImportResult|null>(null);
  const [importJob,setImportJob] = useState<MasterImportJob|null>(null);
  const [stockImportJob,setStockImportJob] = useState<StockImportJob|null>(null);
  const [dailyReports,setDailyReports] = useState<DailyReport[]>([]);
  const [reportMonth,setReportMonth] = useState(defaultOrderMonth);
  const [reportsBusy,setReportsBusy] = useState(false);
  const [purchaseHistory,setPurchaseHistory] = useState<PurchaseHistorySummary>({month:defaultOrderMonth,year:defaultOrderMonth.slice(0,4),records:[],customers:[],totals:{monthValue:0,yearValue:0,monthOrders:0,yearOrders:0,customerCount:0}});
  const [purchaseMonth,setPurchaseMonth] = useState(defaultOrderMonth);
  const [purchaseBusy,setPurchaseBusy] = useState(false);
  const [productResult,setProductResult] = useState<ProductPage>({products:[],total:0,page:1,pageSize:100});
  const [productResultKey,setProductResultKey] = useState("");
  const [productPage,setProductPage] = useState(1);
  const [productRefresh,setProductRefresh] = useState(0);
  const [productsBusy,setProductsBusy] = useState(false);
  const [pogProducts,setPogProducts] = useState<Product[]>([]);
  const [pogTotal,setPogTotal] = useState(0);
  const [pogResultKey,setPogResultKey] = useState("");
  const [theme,setTheme] = useState(()=>{if(typeof window==="undefined")return "aeon";const saved=window.localStorage.getItem("fulfillment-theme");return ["aeon","aeon-soft","graphite"].includes(saved||"")?saved!:"aeon"});
  const [uiPreferences,setUiPreferences] = useState<UiPreferences>(()=>{
    if(typeof window==="undefined")return {density:"comfortable",fontSize:"normal",reduceMotion:false};
    try {
      const saved=JSON.parse(window.localStorage.getItem("fulfillment-ui-preferences")||"{}") as Partial<UiPreferences>;
      return {density:saved.density==="compact"?"compact":"comfortable",fontSize:saved.fontSize==="large"?"large":"normal",reduceMotion:Boolean(saved.reduceMotion)};
    } catch { return {density:"comfortable",fontSize:"normal",reduceMotion:false}; }
  });
  const excelRef = useRef<HTMLInputElement>(null);
  const stockExcelRef = useRef<HTMLInputElement>(null);
  const customerExcelRef = useRef<HTMLInputElement>(null);
  const purchaseExcelRef = useRef<HTMLInputElement>(null);
  const pogRef = useRef<HTMLInputElement>(null);
  const pogAutoAnalysisRef = useRef(new Set<string>());
  const searchCacheRef = useRef(new Map<string,ProductPage>());
  const productViewCacheRef = useRef(new Map<string,ProductPage>());
  const pogSearchCacheRef = useRef(new Map<string,{products:Product[];total:number}>());
  // Keep the last successful suggestions visible while a new query is being
  // resolved. This prevents the search popover from flashing a large blank
  // loading panel on every keystroke.
  const searchMatchesCacheRef = useRef<Product[]>([]);
  const clearProductCaches=useCallback(()=>{searchCacheRef.current.clear();productViewCacheRef.current.clear();},[]);
  const pogLocationIndex=useMemo(()=>{const index=new Map<string,{line:string;side:"A"|"B";position:PogPosition}>();for(const file of data?.pogFiles||[]){for(const position of file.positions||[]){if(!isLinkedPogPosition(position))continue;const location={line:file.line,side:file.side,position};for(const key of [position.sku,position.barcode].map(normalize).filter(Boolean))if(!index.has(key))index.set(key,location);}}return index;},[data?.pogFiles]);
  const pogLocationFor=useCallback((product:Pick<Product,"sku"|"barcode"|"supplierBarcode">)=>pogLocationIndex.get(normalize(product.sku))||pogLocationIndex.get(normalize(product.barcode))||pogLocationIndex.get(normalize(product.supplierBarcode)),[pogLocationIndex]);
  const withPogLocation=useCallback(<T extends Product,>(product:T):T=>{const location=pogLocationFor(product);return {...product,shelfLine:location?.line||"",shelfSide:location?.side||"",shelfPosition:location?.position.number||0} as T;},[pogLocationFor]);
  const actorUserId=data?.actor.userId,pogLine=pogModal?.line,pogSide=pogModal?.side,activePogFile=pogLine&&pogSide?data?.pogFiles.find((file)=>file.id===pogLine+"_"+pogSide):undefined,activePogUpdated=activePogFile?.updatedAt||0,importStorageKey=actorUserId?"fulfillment-master-job:"+actorUserId:"";
  const productSource=tab==="CHECK_STOCK"?"stock":"master",effectiveStock=tab==="MAP"?"all":stockFilter,productSort=tab==="DATE"?"expiry":"",normalizedProductQuery=normalize(query.trim());
  // Tables need a full page, but the global search suggestions only need a
  // handful of rows. Smaller hidden-tab requests make typing feel instant.
  const productPageSize=(tab==="PRODUCTS"||tab==="CHECK_STOCK")?100:(normalizedProductQuery?8:20);

  const loadData = useCallback(async (quiet=false) => {
    if (!quiet) setBusy(true);
    try {
      const response = await fetchApi("/api/store?includeProducts=0", { cache:"no-store" });
      const payload = await readApiJson<StoreData & {error?:string;setupRequired?:boolean}>(response);
      if(response.status===401){setData(null);window.sessionStorage.removeItem(STORE_SNAPSHOT_KEY);setAuthMode(payload.setupRequired?"setup":"login");setError("");return;}
      if (!response.ok) throw new Error(payload.error || "Không thể tải dữ liệu");
      const syncedAt=Date.now();setData(payload);setAuthMode(null);setError("");setLastSyncedAt(syncedAt);try{window.sessionStorage.setItem(STORE_SNAPSHOT_KEY,JSON.stringify({cachedAt:syncedAt,data:payload}));}catch{/* Storage can be disabled or full; live data still works. */}
      const saved=window.localStorage.getItem("fulfillment-master-job:"+payload.actor.userId);if(saved)setImportJob((current)=>current||{jobId:saved,status:"queued",phase:"Đang khôi phục tiến độ nhập dữ liệu",percent:5,processedRows:0,totalRows:0,fileName:"Master Data",result:null,error:""});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu"); }
    finally { if (!quiet) setBusy(false); }
  },[]);

  useEffect(()=>{
    const cached=readStoreSnapshot();
    if(cached){setData(cached.data);setLastSyncedAt(cached.cachedAt);}
  },[]);
  useEffect(() => {
    if(authMode)return;
    const initial = window.setTimeout(() => void loadData(),0);
    const timer = window.setInterval(() => void loadData(true),30000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  },[loadData,authMode]);
  useEffect(() => { document.documentElement.dataset.theme=theme; window.localStorage.setItem("fulfillment-theme",theme); },[theme]);
  useEffect(() => {
    document.documentElement.dataset.density=uiPreferences.density;
    document.documentElement.dataset.fontSize=uiPreferences.fontSize;
    document.documentElement.dataset.reduceMotion=uiPreferences.reduceMotion?"true":"false";
    window.localStorage.setItem("fulfillment-ui-preferences",JSON.stringify(uiPreferences));
  },[uiPreferences]);
  useEffect(() => { if (!toast) return; const timer=window.setTimeout(()=>setToast(""),2600); return ()=>window.clearTimeout(timer); },[toast]);
  useEffect(()=>{
    if(!actorUserId)return;
    if(query.trim().length===1)return;
    const requestKey=[productSource,normalizedProductQuery,effectiveStock,productSort,productPage,productPageSize,productRefresh].join("|");
    const cachedView=productViewCacheRef.current.get(requestKey);if(cachedView){if(normalizedProductQuery)searchMatchesCacheRef.current=cachedView.products.slice(0,8).map(withPogLocation);setProductResult({...cachedView,products:cachedView.products.map(withPogLocation)});setProductResultKey(requestKey);setProductsBusy(false);return;}
    const controller=new AbortController(),timer=window.setTimeout(async()=>{
      setProductsBusy(true);
      try {
        const params=new URLSearchParams({page:String(productPage),pageSize:String(productPageSize),stock:effectiveStock});
        if(normalizedProductQuery)params.set("q",normalizedProductQuery);if(productSort)params.set("sort",productSort);
        const endpoint=(productSource==="stock"?"/api/stock?":"/api/products?")+params,cacheKey=endpoint;
        const cached=searchCacheRef.current.get(cacheKey);if(cached){productViewCacheRef.current.set(requestKey,cached);if(normalizedProductQuery)searchMatchesCacheRef.current=cached.products.slice(0,8).map(withPogLocation);setProductResult({...cached,products:cached.products.map(withPogLocation)});setProductResultKey(requestKey);setProductsBusy(false);return;}
        const response=await fetchApi(endpoint,{cache:"no-store",signal:controller.signal}),payload=await readApiJson<ProductPage&{error?:string}>(response);
        if(!response.ok)throw new Error(payload.error||"Không thể tải danh sách sản phẩm");
        if(searchCacheRef.current.size>80)searchCacheRef.current.delete(searchCacheRef.current.keys().next().value as string);searchCacheRef.current.set(cacheKey,payload);
        if(productViewCacheRef.current.size>100)productViewCacheRef.current.delete(productViewCacheRef.current.keys().next().value as string);productViewCacheRef.current.set(requestKey,payload);
        if(normalizedProductQuery)searchMatchesCacheRef.current=payload.products.slice(0,8).map(withPogLocation);
        setProductResult({...payload,products:payload.products.map(withPogLocation)});setProductResultKey(requestKey);
        const lastPage=Math.max(1,Math.ceil(payload.total/payload.pageSize));if(productPage>lastPage)setProductPage(lastPage);
      } catch(cause){if(!controller.signal.aborted)setToast(cause instanceof Error?cause.message:"Không thể tải danh sách sản phẩm");}
      finally{if(!controller.signal.aborted)setProductsBusy(false);}
    },normalizedProductQuery?80:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[actorUserId,query,normalizedProductQuery,effectiveStock,productPage,productPageSize,productRefresh,productSource,productSort,withPogLocation]);
  useEffect(()=>{
    if(!actorUserId||!pogLine||!pogSide)return;
    const requestKey=[actorUserId,pogLine,pogSide,pogSearch.trim(),productRefresh,activePogUpdated].join("|");
    const cached=pogSearchCacheRef.current.get(requestKey);if(cached){setPogProducts(cached.products);setPogTotal(cached.total);setPogResultKey(requestKey);return;}
    const controller=new AbortController(),timer=window.setTimeout(async()=>{
      const params=new URLSearchParams({pageSize:"200",pogId:activePogFile?.id||"__no_pog_position__"});if(pogSearch.trim())params.set("q",pogSearch.trim());
      try{const response=await fetchApi("/api/products?"+params,{cache:"no-store",signal:controller.signal}),payload=await readApiJson<ProductPage>(response);if(response.ok){const products=payload.products.map(withPogLocation);if(pogSearchCacheRef.current.size>80)pogSearchCacheRef.current.delete(pogSearchCacheRef.current.keys().next().value as string);pogSearchCacheRef.current.set(requestKey,{products,total:payload.total});setPogProducts(products);setPogTotal(payload.total);setPogResultKey(requestKey);}}catch(cause){void cause}
    },pogSearch.trim()?180:0);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[actorUserId,pogLine,pogSide,pogSearch,productRefresh,activePogUpdated,activePogFile?.id,withPogLocation]);
  useEffect(()=>{
    const jobId=importJob?.jobId;if(!actorUserId||!jobId||importJob.status==="uploading"||["completed","failed"].includes(importJob.status))return;
    let stopped=false,timer=0,failures=0;
    const poll=async()=>{
      try{
        const response=await fetchApi("/api/master-data/import/"+encodeURIComponent(jobId),{cache:"no-store"}),payload=await readApiJson<MasterImportJob&{error?:string}>(response);
        if(response.status===401){setData(null);setAuthMode("login");return;}
        if(!response.ok){const cause=new Error(payload.error||"Không thể theo dõi tiến độ nhập dữ liệu") as Error&{terminal?:boolean};cause.terminal=[403,404].includes(response.status);throw cause;}
        failures=0;
        if(stopped)return;setImportJob(payload);
        if(payload.status==="completed"&&payload.result){setMasterImport(payload.result);window.localStorage.removeItem(importStorageKey);clearProductCaches();setProductPage(1);setProductRefresh((value)=>value+1);void loadData(true);setToast("Đã nhập "+payload.result.imported+" SKU · "+payload.result.created+" mới · "+payload.result.updated+" cập nhật");return;}
        if(payload.status==="failed"){window.localStorage.removeItem(importStorageKey);setToast(payload.error||"Không thể nhập Master Data");return;}
        timer=window.setTimeout(()=>void poll(),900);
      }catch(cause){if(!stopped){const error=cause as Error&{terminal?:boolean};if(error.terminal){setImportJob((current)=>current?{...current,status:"failed",phase:"Không thể tiếp tục",error:error.message}:current);window.localStorage.removeItem(importStorageKey);return;}failures++;setImportJob((current)=>current?{...current,phase:"Mất kết nối tạm thời · đang thử lại",error:error.message}:current);timer=window.setTimeout(()=>void poll(),Math.min(10000,900*2**Math.min(4,failures)));}}
    };
    void poll();return()=>{stopped=true;window.clearTimeout(timer);};
  },[actorUserId,clearProductCaches,importJob?.jobId,importJob?.status,importStorageKey,loadData]);
  useEffect(()=>{
    const jobId=stockImportJob?.jobId;if(!actorUserId||!jobId||stockImportJob.status==="uploading"||["completed","failed"].includes(stockImportJob.status))return;
    let stopped=false,timer=0;
    const poll=async()=>{try{const response=await fetchApi("/api/stock/import/"+encodeURIComponent(jobId),{cache:"no-store"}),payload=await readApiJson<StockImportJob&{error?:string}>(response);if(!response.ok)throw new Error(payload.error||"Không thể theo dõi file Stock");if(stopped)return;setStockImportJob(payload);if(payload.status==="completed"){clearProductCaches();setProductPage(1);setProductRefresh((value)=>value+1);void loadData(true);setToast("Đã cập nhật tồn kho từ "+(payload.result?.imported||0)+" SKU");return;}if(payload.status==="failed"){setToast(payload.error||"Không thể nhập file Stock");return;}timer=window.setTimeout(()=>void poll(),900);}catch(cause){if(!stopped){setStockImportJob((current)=>current?{...current,phase:"Mất kết nối tạm thời · đang thử lại",error:cause instanceof Error?cause.message:""}:current);timer=window.setTimeout(()=>void poll(),3000);}}};void poll();return()=>{stopped=true;window.clearTimeout(timer);};
  },[actorUserId,clearProductCaches,stockImportJob?.jobId,stockImportJob?.status,loadData]);

  const mutate = async (action:string, payload:Record<string,unknown>={}) => {
    setBusy(true);
    try {
      const response = await fetch("/api/store",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,...payload})});
      const result = await readApiJson<{error?:string;setupRequired?:boolean}>(response);
      if(response.status===401){setData(null);setAuthMode(result.setupRequired?"setup":"login");throw new Error("Phiên đăng nhập đã hết hạn");}
      if (!response.ok) throw new Error(result.error || "Thao tác thất bại");
      await loadData(true);clearProductCaches();setProductRefresh((value)=>value+1);setToast("Đã cập nhật thành công");
      return true;
    } catch (cause) { setToast(cause instanceof Error ? cause.message : "Thao tác thất bại"); return false; }
    finally { setBusy(false); }
  };

  const uploadCloudinaryImage = async (file:File,sku:string) => {
    const form=new FormData();form.set("file",file);form.set("sku",sku);
    const response=await fetch("/api/cloudinary/upload",{method:"POST",body:form});
    const result=await readApiJson<{url?:string;error?:string}>(response);
    if(!response.ok||!result.url)throw new Error(result.error||"Không thể tải ảnh lên Cloudinary");
    return result.url;
  };

  const authenticate = async (credentials:{username:string;password:string;name?:string}) => {
    if(!authMode)return;
    setBusy(true);setError("");
    try {
      const response=await fetch(authMode==="setup"?"/api/auth/setup":"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(credentials)});
      const result=await readApiJson<{error?:string}>(response);
      if(!response.ok)throw new Error(result.error||"Không thể đăng nhập");
      setLoginOpen(false);setAuthMode(null);
      await loadData(true);
    } catch(cause){setError(cause instanceof Error?cause.message:"Không thể đăng nhập");}
    finally{setBusy(false);}
  };

  const logout = async () => {
    setBusy(true);
    try{await fetch("/api/auth/logout",{method:"POST"});}finally{window.sessionStorage.removeItem(STORE_SNAPSHOT_KEY);setSettingsOpen(false);setImportJob(null);setLoginOpen(false);setAuthMode(null);setData(null);await loadData(true);setBusy(false);}
  };

  const productRequestKey=[productSource,normalizedProductQuery,effectiveStock,productSort,productPage,productPageSize,productRefresh].join("|"),productsCurrent=productResultKey===productRequestKey;
  const products=productsCurrent?productResult.products:[],productsLoading=productsBusy||!productsCurrent;
  const searchMatches = query.length >= 2 ? (productsCurrent?products:searchMatchesCacheRef.current).slice(0,8) : [];
  const pickedCount = (data?.picking||[]).filter((p)=>Boolean(p.picked)).length;
  const progress = data?.picking?.length ? Math.round(pickedCount/data.picking.length*100) : 0;
  const unassignedOrderCount = data ? groupOrderItems(data.assignedPicking.filter((item)=>pickWorkflowStatus(item)==="unassigned")).length : 0;
  const activePog = activePogFile;
  const pogRequestKey=[actorUserId||"",pogLine||"",pogSide||"",pogSearch.trim(),productRefresh,activePog?.updatedAt||0].join("|"),pogCurrent=pogResultKey===pogRequestKey;
  const visiblePogProducts=pogCurrent?pogProducts:[],visiblePogTotal=pogCurrent?pogTotal:0;
  const importActive=Boolean(importJob&&["uploading","queued","processing"].includes(importJob.status));
  const totalPages=Math.max(1,Math.ceil(productResult.total/productResult.pageSize));
  const manualCheckLossProducts=useMemo(()=>{
    const manualChecks=data?.manualChecks;
    if(!manualChecks)return [];
    const current=manualChecks.checkLoss||[];
    if(current.length)return current;
    const merged=new Map<string,Product>();
    for(const product of manualChecks.stock||[])merged.set(product.id,{...product,manualStock:product.stock});
    for(const product of manualChecks.loss||[])merged.set(product.id,{...(merged.get(product.id)||product),manualLoss:product.loss});
    return [...merged.values()];
  },[data?.manualChecks]);

  const exportMasterXlsx = () => {
    const link=document.createElement("a");link.href="/api/master-data/export.xlsx";link.download="MasterData_Fulfillment.xlsx";document.body.appendChild(link);link.click();link.remove();
  };
  const exportOrderHistory = (month:string) => {
    const selected=/^\d{4}-\d{2}$/.test(month)?month:orderDateKey(Date.now()).slice(0,7),link=document.createElement("a");
    link.href="/api/orders/export.xlsx?month="+encodeURIComponent(selected);link.download="Don_soan_khach_hang_"+selected+".xlsx";document.body.appendChild(link);link.click();link.remove();
  };
  const loadDailyReports=useCallback(async(month:string)=>{setReportsBusy(true);try{const response=await fetchApi("/api/daily-reports?month="+encodeURIComponent(month),{cache:"no-store"}),payload=await readApiJson<{reports?:DailyReport[];error?:string}>(response);if(!response.ok)throw new Error(payload.error||"Không thể tải báo cáo ngày");setDailyReports(payload.reports||[]);}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể tải báo cáo ngày");}finally{setReportsBusy(false);}},[]);
  useEffect(()=>{if(tab==="DAILY_REPORT"&&data)void loadDailyReports(reportMonth);},[tab,data,reportMonth,loadDailyReports]);
  const saveDailyReport=async(report:Record<string,unknown>)=>{
    setReportsBusy(true);
    try {
      const response=await fetch("/api/daily-reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({report})});
      const result=await readApiJson<{error?:string;report?:DailyReport;customer?:CustomerMaster}>(response);
      if(response.status===401){setData(null);setAuthMode(result.error?"login":"login");throw new Error("Phiên đăng nhập đã hết hạn");}
      if(!response.ok||!result.report)throw new Error(result.error||"Không thể lưu báo cáo ngày");
      const savedReport=result.report;
      setDailyReports((current)=>[...current.filter((item)=>item.id!==savedReport.id),savedReport].filter((item)=>String(item.date||"").startsWith(reportMonth)).sort((left,right)=>String(right.date).localeCompare(String(left.date))||String(right.createdAt||"").localeCompare(String(left.createdAt||""))));
      if(result.customer)setData((current)=>current?{...current,customers:[result.customer!,...(current.customers||[]).filter((item)=>item.id!==result.customer!.id&&item.phone!==result.customer!.phone)]}:current);
      setToast("Đã lưu báo cáo tức thời");
      return true;
    } catch(cause) { setToast(cause instanceof Error?cause.message:"Không thể lưu báo cáo ngày");return false; }
    finally { setReportsBusy(false); }
  };
  const exportDailyReports=(month:string)=>{const selected=/^\d{4}-\d{2}$/.test(month)?month:reportMonth,link=document.createElement("a");link.href="/api/daily-reports/export.xlsx?month="+encodeURIComponent(selected);link.download="Bao_cao_ngay_"+selected+".xlsx";document.body.appendChild(link);link.click();link.remove();};
  const exportCustomerMaster=()=>{const link=document.createElement("a");link.href="/api/customers/export.xlsx";link.download="Master_Khach_Hang.xlsx";document.body.appendChild(link);link.click();link.remove();};
  const loadPurchaseHistory=useCallback(async(month:string)=>{setPurchaseBusy(true);try{const response=await fetchApi("/api/purchase-history?month="+encodeURIComponent(month),{cache:"no-store"}),payload=await readApiJson<PurchaseHistorySummary&{error?:string}>(response);if(!response.ok)throw new Error(payload.error||"Không thể tải lịch sử mua hàng");setPurchaseHistory(payload);}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể tải lịch sử mua hàng");}finally{setPurchaseBusy(false);}},[]);
  useEffect(()=>{if(tab==="DAILY_REPORT"&&data)void loadPurchaseHistory(purchaseMonth);},[tab,data,purchaseMonth,loadPurchaseHistory]);
  const exportPurchaseHistory=(month:string)=>{const selected=/^\d{4}-\d{2}$/.test(month)?month:purchaseMonth,link=document.createElement("a");link.href="/api/purchase-history/export.xlsx?month="+encodeURIComponent(selected);link.download="Lich_su_mua_hang_"+selected+".xlsx";document.body.appendChild(link);link.click();link.remove();};
  const importPurchaseHistory=async(file?:File)=>{if(!file)return;setPurchaseBusy(true);try{const form=new FormData();form.set("file",file);form.set("period",purchaseMonth);const response=await fetch("/api/purchase-history/import",{method:"POST",body:form}),payload=await readApiJson<{error?:string;imported?:number;created?:number;updated?:number;skipped?:number;sheetName?:string}>(response);if(!response.ok)throw new Error(payload.error||"Không thể nhập lịch sử mua hàng");await loadPurchaseHistory(purchaseMonth);setToast(`Đã nhập lịch sử ${purchaseMonth}${payload.sheetName?` · sheet ${payload.sheetName}`:""} · ${payload.imported||0} dòng · ${payload.created||0} mới · ${payload.updated||0} cập nhật${payload.skipped?` · ${payload.skipped} bỏ qua`:""}`);}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể nhập lịch sử mua hàng");}finally{setPurchaseBusy(false);if(purchaseExcelRef.current)purchaseExcelRef.current.value="";}};
  const deletePurchaseHistory=async(month:string)=>{
    if(!/^\d{4}-\d{2}$/.test(month)||!window.confirm("Xóa toàn bộ dữ liệu lịch sử mua hàng tháng "+month+"? Dữ liệu sau khi xóa không thể khôi phục."))return;
    setPurchaseBusy(true);
    try {
      const response=await fetch("/api/purchase-history?month="+encodeURIComponent(month),{method:"DELETE"}),payload=await readApiJson<{error?:string;deleted?:number}>(response);
      if(!response.ok)throw new Error(payload.error||"Không thể xóa dữ liệu lịch sử mua hàng");
      await loadPurchaseHistory(month);
      setToast("Đã xóa "+(payload.deleted||0)+" dòng lịch sử tháng "+month);
    } catch(cause){setToast(cause instanceof Error?cause.message:"Không thể xóa dữ liệu lịch sử mua hàng");}
    finally{setPurchaseBusy(false);}
  };
  const importCustomerMaster=async(file?:File)=>{if(!file)return;setBusy(true);try{const form=new FormData();form.set("file",file);const response=await fetch("/api/customers/import",{method:"POST",body:form}),payload=await readApiJson<{error?:string;created?:number;updated?:number;imported?:number;skipped?:number;sheetName?:string}>(response);if(!response.ok)throw new Error(payload.error||"Không thể nhập Master Data khách hàng");await loadData(true);setToast(`Đã nhập Master khách hàng${payload.sheetName?` · sheet ${payload.sheetName}`:""} · ${payload.imported||0} dòng · ${payload.created||0} mới · ${payload.updated||0} cập nhật${payload.skipped?` · ${payload.skipped} bỏ qua`:""}`);}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể nhập Master Data khách hàng");}finally{setBusy(false);if(customerExcelRef.current)customerExcelRef.current.value="";}};
  const importExcel = async (file?:File) => {
    if(!file||importActive)return;
    const jobId=crypto.randomUUID(),form=new FormData();form.set("file",file);
    setMasterImport(null);setTab("PRODUCTS");setProductPage(1);setImportJob({jobId,status:"uploading",phase:"Đang tải file Excel lên máy chủ",percent:0,processedRows:0,totalRows:0,fileName:file.name,result:null,error:""});
    if(importStorageKey)window.localStorage.setItem(importStorageKey,jobId);
    try {
      const result=await new Promise<MasterImportJob>((resolve,reject)=>{
        const xhr=new XMLHttpRequest();xhr.open("POST","/api/master-data/import");xhr.timeout=10*60_000;xhr.setRequestHeader("x-import-id",jobId);
        xhr.upload.onprogress=(event)=>{if(event.lengthComputable)setImportJob((current)=>current?{...current,percent:Math.min(10,Math.round(event.loaded/event.total*10))}:current);};
        xhr.onerror=()=>reject(new Error("Mất kết nối khi tải file Excel"));
        xhr.ontimeout=()=>reject(new Error("Tải file quá lâu · hệ thống sẽ tự kiểm tra lại trạng thái"));xhr.onabort=()=>reject(new Error("Đã dừng tải file Excel"));
        xhr.onload=()=>{let payload:MasterImportJob&{error?:string};try{payload=JSON.parse(xhr.responseText||"{}");}catch{reject(new Error(xhr.status>=500?`Máy chủ tạm thời không phản hồi (${xhr.status} ${xhr.statusText||"Server Error"}). Vui lòng thử lại sau vài giây.`:"Máy chủ trả về dữ liệu không hợp lệ"));return;}if(xhr.status!==202){const cause=new Error(payload.error||"Không thể nhập Master Data") as Error&{terminal?:boolean};cause.terminal=xhr.status>=400&&xhr.status<500;reject(cause);return;}resolve(payload);};
        xhr.send(form);
      });
      setImportJob(result);
    } catch(cause){const error=cause as Error&{terminal?:boolean};if(error.terminal){if(importStorageKey)window.localStorage.removeItem(importStorageKey);setImportJob((current)=>current?{...current,status:"failed",phase:"Tải file thất bại",error:error.message}:current);}else setImportJob((current)=>current?{...current,status:"queued",phase:"Đang kiểm tra file đã nhận trên máy chủ",error:error.message}:current);setToast(error.message||"Không thể nhập Master Data");}
    finally{if(excelRef.current)excelRef.current.value="";}
  };
  const importStockExcel=async(file?:File)=>{
    if(!file||stockImportJob&&["uploading","queued","processing"].includes(stockImportJob.status))return;
    setStockImportJob({jobId:"",status:"uploading",phase:"Đang tải file Stock",percent:5,processedRows:0,totalRows:0,fileName:file.name,result:null,error:""});
    try{const form=new FormData();form.set("file",file);const response=await fetch("/api/stock/import",{method:"POST",body:form}),payload=await readApiJson<StockImportJob&{error?:string}>(response);if(!response.ok)throw new Error(payload.error||"Không thể nhập file Stock");setStockImportJob(payload);}catch(cause){setStockImportJob(null);setToast(cause instanceof Error?cause.message:"Không thể nhập file Stock");}finally{if(stockExcelRef.current)stockExcelRef.current.value="";}
  };
  const addManualCheck=(kind:ManualCheckKind)=>setManualCheckModal(kind);
  const searchManualProducts=async(search:string):Promise<Product[]>=>{
    const params=new URLSearchParams({page:"1",pageSize:"50"});if(search.trim())params.set("q",search.trim());
    const response=await fetchApi("/api/products?"+params,{cache:"no-store"}),payload=await readApiJson<ProductPage&{error?:string}>(response);
    if(!response.ok)throw new Error(payload.error||"Không thể tìm sản phẩm");
    const lossById=new Map((manualCheckLossProducts||[]).map((item)=>[item.id,item])),dateById=new Map((data.manualChecks.expiry||[]).map((item)=>[item.id,item]));
    return payload.products.map((product)=>{const lossCheck=lossById.get(product.id),dateCheck=dateById.get(product.id);return withPogLocation({...product,manualStock:lossCheck?.manualStock??(lossCheck?.stockKnown?lossCheck.stock:undefined),manualLoss:lossCheck?.manualLoss??(lossCheck?.loss||undefined),inboundDate:dateCheck?.inboundDate,withdrawDate:dateCheck?.withdrawDate||dateCheck?.expDate,expDate:dateCheck?.withdrawDate||dateCheck?.expDate||product.expDate});});
  };
  const saveManualCheck=async(payload:Record<string,unknown>)=>{
    if(await mutate("setManualCheck",payload))setManualCheckModal(null);
  };

  const openProductOnMap = (product:Product,keepQuery=false) => { const location=pogLocationFor(product);if(!location){setToast("SKU này chưa được gán vị trí kệ từ POG.");return;}setPogModal({line:location.line,side:location.side,selectedId:product.id});setPogSearch(product.sku);if(!keepQuery)setQuery("");setProductPage(1); };
  const quickAdd = async (product:Product,keepQuery=false) => { if(product.stock===0){setToast("Sản phẩm đang hết hàng");return;}if(await mutate("addPick",{productId:product.id,quantity:1})){if(!keepQuery)setQuery("");setProductPage(1);} };
  const handleBarcode = async (rawValue:string,keepQuery=false) => { const value=rawValue.trim(),needle=normalize(value);if(!value)return;try{const response=await fetchApi("/api/products?"+new URLSearchParams({q:value,page:"1",pageSize:"8"}),{cache:"no-store"}),payload=await readApiJson<ProductPage&{error?:string}>(response);if(!response.ok)throw new Error(payload.error||"Không thể tìm sản phẩm");const exact=payload.products.find((p)=>normalize(p.sku)===needle||normalize(p.barcode)===needle||normalize(p.supplierBarcode)===needle);if(exact)await quickAdd(exact,keepQuery);else if(payload.products[0])openProductOnMap(payload.products[0],keepQuery);else setToast("Không tìm thấy SKU hoặc barcode");}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể tìm sản phẩm");} };
  const handleSearchEnter = async () => { await handleBarcode(query); };
  const loadPogSourceFiles=async(record:PogFile)=>{const sources=record.sources?.length?record.sources:[{fileName:record.fileName,mimeType:record.mimeType}],files:File[]=[];for(let index=0;index<sources.length;index++){const response=await fetchApi(`/api/pog?id=${encodeURIComponent(record.id)}&source=${index}`,{cache:"no-store"});if(!response.ok)throw new Error("Không thể đọc file POG "+(index+1));const blob=await response.blob(),source=sources[index];files.push(new File([blob],source.fileName,{type:source.mimeType}));}return files;};
  const savePogAnalysis=async(file:File,line:string,side:"A"|"B",analysis:PogAnalysis|null,mode:"replace"|"append"|"reanalyze"="replace")=>{const form=new FormData();form.set("file",file);form.set("line",line);form.set("side",side);form.set("mode",mode);if(analysis){form.set("shelfImage",analysis.image,`pog-${line}${side}-shelf.webp`);form.set("positions",JSON.stringify(analysis.positions));form.set("shelfWidth",String(analysis.width));form.set("shelfHeight",String(analysis.height));form.set("sourcePages",analysis.sourcePages.join(","));form.set("analysisVersion",String(POG_ANALYSIS_VERSION));}const response=await fetch("/api/pog",{method:"POST",body:form}),result=await readApiJson<{error?:string;mappedCount?:number;analyzedPages?:number;fileCount?:number}>(response);if(!response.ok)throw new Error(result.error||"Không thể tải POG");return result;};
  const uploadPogFor = async (file:File|undefined,line:string,side:"A"|"B",silent=false,append=false,analysisMode:PogAnalysisMode="auto") => {
    if(!file)return false;if(!silent){setBusy(true);setPogUploadBusy(true);}
    try {const existing=data?.pogFiles.find((record)=>record.id===line+"_"+side),sourceFiles=append&&existing?[...await loadPogSourceFiles(existing),file]:[file],analysis=await analyzePogFiles(sourceFiles,analysisMode),result=await savePogAnalysis(file,line,side,analysis,append?"append":"replace");if(!silent){await loadData(true);const modeLabel=analysisMode==="page1"?"chỉ hiển thị Trang 1":analysisMode==="page2"?"chỉ hiển thị Trang 2":"tự động ghép tất cả trang";setToast(analysis?`Đã ${analysisMode==="auto"?"ghép ảnh":"cập nhật ảnh"} ${result.fileCount||sourceFiles.length} file (${modeLabel}) · đã đọc ${result.mappedCount||0} vị trí từ danh sách sản phẩm`:`POG ${line}${side} chưa nhận diện được vùng kệ; hãy kiểm tra trang đã chọn và bảng STT/SKU.`);}return Boolean(analysis);
    } catch(cause){if(!silent)setToast(cause instanceof Error?cause.message:"Không thể tải POG");return false;} finally{if(!silent){setBusy(false);setPogUploadBusy(false);if(pogRef.current)pogRef.current.value="";}}
  };
  const uploadPog = async (file?:File,append=false,analysisMode:PogAnalysisMode="auto") => { if(pogModal)await uploadPogFor(file,pogModal.line,pogModal.side,false,append,analysisMode); };
  const reanalyzePog = async (analysisMode:PogAnalysisMode="auto") => { if(!pogModal||!activePog)return;setBusy(true);setPogUploadBusy(true);try{const files=await loadPogSourceFiles(activePog),analysis=await analyzePogFiles(files,analysisMode);if(!analysis)throw new Error("Không tìm thấy vùng kệ trong các PDF POG");await savePogAnalysis(files[0],pogModal.line,pogModal.side,analysis,"reanalyze");await loadData(true);const modeLabel=analysisMode==="page1"?"chỉ hiển thị Trang 1":analysisMode==="page2"?"chỉ hiển thị Trang 2":"tự động ghép tất cả trang";setToast(`Đã ${analysisMode==="auto"?"ghép lại ảnh":"cập nhật ảnh"} ${files.length} file (${modeLabel}) · đã đọc ${analysis.positions.length} vị trí từ danh sách sản phẩm`);}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể ghép lại POG");}finally{setBusy(false);setPogUploadBusy(false);} };
  // Mỗi phiên bản pipeline chỉ tự xử lý một lần cho từng bản PDF đã lưu.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{const sources=(data?.pogFiles||[]).filter((source)=>source.mimeType==="application/pdf"&&(!source.shelfImage||(source.analysisVersion||0)<POG_ANALYSIS_VERSION)&&!pogAutoAnalysisRef.current.has(`${source.id}:${source.updatedAt}:${POG_ANALYSIS_VERSION}`));if(!canManage(data?.actor.role)||!sources.length)return;for(const source of sources)pogAutoAnalysisRef.current.add(`${source.id}:${source.updatedAt}:${POG_ANALYSIS_VERSION}`);const timer=window.setTimeout(async()=>{let completed=0;try{for(const source of sources){const files=await loadPogSourceFiles(source),analysis=await analyzePogFiles(files);if(!analysis)continue;await savePogAnalysis(files[0],source.line,source.side,analysis,"reanalyze");completed++;}await loadData(true);if(completed)setToast(`Đã tự động chuẩn hóa ${completed}/${sources.length} Line/mặt theo quy trình POG chung.`);}catch(cause){setToast(cause instanceof Error?cause.message:"Không thể tự động chuẩn hóa toàn bộ POG");}},350);return()=>window.clearTimeout(timer);},[data?.pogFiles,data?.actor.role]);
  // Warm shelf images in the browser after the text/UI is ready. Requests are
  // sequential and idle-scheduled so they never block the first paint or
  // compete with an active search; slow/data-saving connections are skipped.
  useEffect(()=>{
    const sources=(data?.pogFiles||[]).filter((source)=>source.shelfImage&&source.shelfWidth&&source.shelfHeight);
    const connection=(navigator as Navigator&{connection?:{saveData?:boolean;effectiveType?:string}}).connection;
    if(!sources.length||connection?.saveData||/2g/i.test(connection?.effectiveType||""))return;
    let stopped=false,index=0,timer=0;
    const loadNext=()=>{
      if(stopped||index>=sources.length)return;
      const source=sources[index++],image=new Image();image.decoding="async";image.onload=()=>schedule();image.onerror=()=>schedule();image.src=`/api/pog?id=${encodeURIComponent(source.id)}&asset=shelf&v=${source.updatedAt}`;
    };
    const schedule=()=>{if(stopped||index>=sources.length)return;timer=window.setTimeout(loadNext,900);};
    schedule();return()=>{stopped=true;window.clearTimeout(timer);};
  },[data?.pogFiles]);
  const savePogPage = async (page:number) => { if(!pogModal)return; await mutate("updatePogPage",{line:pogModal.line,side:pogModal.side,page}); };
  const generateSuggestions = async () => {
    const value=suggestInput.trim();
    if(value.length<2){setSuggestError("Hãy mô tả nhu cầu để AI có thể phân tích.");return;}
    setSuggestBusy(true);setSuggestError("");
    try {
      const response=await fetch("/api/ai/suggest",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:value})});
      const payload=await readApiJson<AiSuggestionResult&{error?:string}>(response);
      if(!response.ok)throw new Error(payload.error||"Không thể phân tích lúc này.");
      setSuggestResult(payload);
    } catch(cause){setSuggestError(cause instanceof Error?cause.message:"Không thể phân tích lúc này.");}
    finally{setSuggestBusy(false);}
  };
  const openSuggested=async(item:AiSuggestion)=>{try{const response=await fetchApi("/api/products?id="+encodeURIComponent(item.productId),{cache:"no-store"}),payload=await readApiJson<ProductPage&{error?:string}>(response);if(!response.ok||!payload.products[0])throw new Error(payload.error||"Sản phẩm không còn trong danh sách");openProductOnMap(payload.products[0]);}catch(cause){setToast(cause instanceof Error?cause.message:"Sản phẩm không còn trong danh sách");}};
  const addSuggested=async(item:AiSuggestion)=>{if(item.stock===0){setToast("Sản phẩm đang hết hàng");return;}await mutate("addPick",{productId:item.productId,quantity:item.quantity});};

  if (!data && authMode) return <AuthScreen mode={authMode} busy={busy} error={error} onSubmit={authenticate}/>;
  if (!data && busy) return <main className="loading-screen"><div className="spinner"/><b>Đang đồng bộ dữ liệu cửa hàng…</b></main>;
  if (!data && error) return <main className="loading-screen"><b>Không thể mở dữ liệu</b><p>{error}</p><button onClick={()=>void loadData()}>Thử lại</button></main>;
  if (!data) return null;

  // Logo sizes are stored independently so the header can stay readable on
  // small screens without changing the desktop presentation (and vice versa).
  const desktopLogoSize=data.appBrand?.logoSizeDesktop||data.appBrand?.logoSize||220;
  const mobileLogoSize=data.appBrand?.logoSizeMobile||Math.max(72,Math.round(desktopLogoSize*.55));

  return (
    <main className="ops-shell">
      {toast&&<div className="toast">{toast}</div>}
      {busy&&<div className="busy-line"/>}
      <header className="ops-topbar">
        <button className="ops-brand" style={{"--brand-logo-width":`${desktopLogoSize}px`,"--brand-logo-width-mobile":`${mobileLogoSize}px`} as React.CSSProperties} aria-label="AEON Fulfillment SmartOps" onClick={()=>{setTab("DASHBOARD");setProductPage(1);}}><img src={data.appBrand?.logo||"/aeon-logo.svg"} alt="AEON Fulfillment SmartOps"/></button>
        <div className="global-search">
          <span>⌕</span><input value={query} onChange={(e)=>{setQuery(e.target.value);setProductPage(1);}} onKeyDown={(e)=>{if(e.key==="Enter")void handleSearchEnter()}} placeholder="Tìm hoặc quét SKU, barcode…" />
          <button className="barcode-trigger" title="Quét barcode bằng camera" aria-label="Quét barcode bằng camera" onClick={()=>setScannerOpen(true)}><BarcodeIcon/></button>
          {query&&<button onClick={()=>{setQuery("");setProductPage(1);}}>×</button>}
          {query.length>=2&&<div className={"search-popover"+(productsLoading?" is-loading":"")}>
            {productsLoading&&<div className="search-loading-indicator"><i className="mini-spinner"/><span>Đang lọc…</span></div>}
            {searchMatches.map((p)=>{const location=pogLocationFor(p);return <article key={p.id}><button className="search-result-main" onClick={()=>setProductDetails(p)}><span><b>{p.name}</b><small>SKU {p.sku} · {location?`POG Line ${location.line}${location.side} · Vị trí ${location.position.number}`:"Chưa gán vị trí kệ POG"}</small></span><StockBadge stock={p.stock}/></button><button className="search-quick-add" disabled={p.stock===0} onClick={()=>void quickAdd(p)}>+ Đơn</button></article>;})}
            {!productsLoading&&!searchMatches.length&&<div className="search-empty"><b>Không tìm thấy sản phẩm</b><span>Kiểm tra lại SKU, barcode hoặc tên hàng.</span></div>}
          </div>}
        </div>
        <button className="top-order" onClick={()=>{setTab("ORDER");setProductPage(1);}}><span>ĐƠN SOẠN</span><b>{pickedCount}/{data.picking.length}</b><i><em style={{width:progress+"%"}}/></i></button>
        {importActive&&<button className="import-job-chip" onClick={()=>{setTab("PRODUCTS");setProductPage(1);}} title={importJob?.phase}><i/><span>Đang nhập Excel<b>{Math.round(importJob?.percent||0)}%</b></span></button>}
        <div className={"sync-chip "+(error?"offline":"online")} title={error||"Dữ liệu được tự động cập nhật mỗi 30 giây"}><i/>{error?"Mất kết nối":lastSyncedAt?"Đã đồng bộ":"Đang nối"}</div>
        {data.actor.userId==="guest"?<button className="top-login-button" onClick={()=>{setAuthMode("login");setLoginOpen(true);setError("");}}>Đăng nhập</button>:<button className="user-chip" onClick={()=>setSettingsOpen(true)}><span>{data.actor.name.slice(0,2).toUpperCase()}</span><b>{data.actor.name}<small>{data.actor.role}</small></b></button>}
      </header>

      <div className="ops-body">
        <nav className="side-nav">{menu.map((item)=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>{setTab(item.id);setProductPage(1);}}><span><AppIcon name={item.id}/></span>{item.label}{item.id==="ORDER"&&unassignedOrderCount>0?<b>{unassignedOrderCount}</b>:null}</button>)}</nav>
        <section className="ops-content">
          {(["PRODUCTS","CHECK_STOCK"] as Tab[]).includes(tab)&&<OpsFilters stock={stockFilter} visible={products.length} total={productResult.total} onStock={(value)=>{setStockFilter(value);setProductPage(1);}} onClear={()=>{setQuery("");setStockFilter("all");setProductPage(1);}}/>}
          {tab==="DASHBOARD"&&<Dashboard products={data.alertProducts.map(withPogLocation)} totalProducts={data.productTotal} logs={data.logs} totals={data.productStats} assignedItems={data.assignedPicking.map(withPogLocation)} history={(data.orderHistory||[]).map(withPogLocation)} onGo={(next,stock)=>{setTab(next);setStockFilter(stock||"all");setQuery("");setProductPage(1);}}/>}
          {tab==="MAP"&&
            <MapView pogFiles={data.pogFiles} lineConfigs={data.lineConfigs||[]} query={query} canManage={canManage(data.actor.role)} onOpen={(line,side)=>setPogModal({line,side})} onEdit={(lineConfig)=>setLineModal(lineConfig)}/>
          }
          {tab==="PRODUCTS"&&<ProductsView products={products} total={productResult.total} role={data.actor.role} importResult={masterImport} importJob={importJob} onAdd={()=>setProductModal({...emptyProduct})} onEdit={(p)=>setProductModal({...p})} onDelete={(p)=>void mutate("deleteProduct",{id:p.id})} onView={(p)=>setProductDetails(p)} onMap={openProductOnMap} onPick={(p)=>void mutate("addPick",{productId:p.id})} onExport={exportMasterXlsx} onImport={()=>excelRef.current?.click()}/>}
          {tab==="CHECK_STOCK"&&<StockCheckView products={products} total={productResult.total} role={data.actor.role} metadata={data.stockImport} job={stockImportJob} onImport={()=>stockExcelRef.current?.click()} onExport={()=>{const link=document.createElement("a");link.href="/api/stock/export.xlsx";link.download="Stock_Fulfillment.xlsx";document.body.appendChild(link);link.click();link.remove();}} onView={(p)=>setProductDetails(p)} onAssign={(product)=>setAssignmentProduct(product)}/>}
          {tab==="CHECK_LOSS"&&<ManualCheckGrid kind="checkLoss" products={manualCheckLossProducts.filter((product)=>Number(product.manualLoss??product.loss??0)>0).map(withPogLocation)} canEdit={data.actor.userId!=="guest"} onAdd={()=>addManualCheck("checkLoss")}/>}
          {tab==="DATE"&&<ManualCheckGrid kind="checkDate" products={(data.manualChecks.expiry||[]).map(withPogLocation)} canEdit={data.actor.userId!=="guest"} onAdd={()=>addManualCheck("checkDate")}/>}
          {(["PRODUCTS","CHECK_STOCK"] as Tab[]).includes(tab)&&<ProductPager page={productPage} pages={totalPages} total={productResult.total} busy={productsLoading} onPage={setProductPage}/>}
           {tab==="ORDER"&&<OrderView key={orderTabSignal} items={data.picking.map(withPogLocation)} assignedItems={data.assignedPicking.map(withPogLocation)} history={(data.orderHistory||[]).map(withPogLocation)} actor={data.actor} users={data.users.filter((user)=>user.active)} canReassign={canManage(data.actor.role)} onReassignOrder={(pickIds,assigneeId)=>mutate("reassignOrder",{pickIds,assigneeId})} onCompletePicking={(pickIds)=>mutate("completePickingOrder",{pickIds})} onAssignDelivery={(pickIds,deliveryAssigneeId)=>mutate("assignDeliveryOrder",{pickIds,deliveryAssigneeId})} onCompleteDelivery={(pickIds)=>mutate("completeDeliveryOrder",{pickIds})} onReopenDelivered={(pickIds)=>mutate("reopenDeliveredOrder",{pickIds})} onExportHistory={exportOrderHistory} onToggle={(p)=>void mutate("togglePick",{pickId:p.pickId})} onPickedQuantity={(p,quantity)=>void mutate("updatePickedQuantity",{pickId:p.pickId,quantity})} onViewProduct={setProductDetails}/>}
          {tab==="DAILY_REPORT"&&<DailyReportView reports={dailyReports} customers={data.customers||[]} users={data.users||[]} month={reportMonth} onMonth={setReportMonth} onSave={saveDailyReport} onImport={()=>customerExcelRef.current?.click()} onExport={exportDailyReports} onExportCustomers={exportCustomerMaster} canManage={canManage(data.actor.role)} busy={reportsBusy} purchaseHistory={purchaseHistory} purchaseMonth={purchaseMonth} onPurchaseMonth={setPurchaseMonth} onPurchaseImport={()=>purchaseExcelRef.current?.click()} onPurchaseExport={exportPurchaseHistory} onPurchaseDelete={deletePurchaseHistory} purchaseBusy={purchaseBusy}/>}
          {tab==="SUGGEST"&&<SuggestView value={suggestInput} onValue={setSuggestInput} onGenerate={()=>void generateSuggestions()} result={suggestResult} busy={suggestBusy} error={suggestError} totalProducts={data.productTotal} onMap={(item)=>void openSuggested(item)} onPick={(item)=>void addSuggested(item)}/>}
        </section>
      </div>

      <nav className="mobile-nav">{menu.filter((item)=>(["DASHBOARD","MAP","PRODUCTS","CHECK_STOCK","CHECK_LOSS","DATE","ORDER","DAILY_REPORT","SUGGEST"] as Tab[]).includes(item.id)).map((item)=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>{setTab(item.id);setProductPage(1);}}><span><AppIcon name={item.id}/></span>{item.label}</button>)}</nav>
      <input ref={excelRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e)=>void importExcel(e.target.files?.[0])}/>
      <input ref={stockExcelRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e)=>void importStockExcel(e.target.files?.[0])}/>
      <input ref={customerExcelRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e)=>void importCustomerMaster(e.target.files?.[0])}/>
      <input ref={purchaseExcelRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e)=>void importPurchaseHistory(e.target.files?.[0])}/>

      {productDetails&&<ProductInfoModal product={productDetails} onClose={()=>setProductDetails(null)} onMap={()=>{const location=pogLocationFor(productDetails);if(!location){setToast("SKU này chưa được gán vị trí kệ từ POG.");return;}setProductDetails(null);openProductOnMap(productDetails,true);}} onPick={async()=>{await quickAdd(productDetails);}}/>}
      {productModal&&<ProductModal value={productModal} onChange={setProductModal} onClose={()=>setProductModal(null)} onUploadCloudinary={uploadCloudinaryImage} onSave={async()=>{if(await mutate("upsertProduct",{product:productModal}))setProductModal(null);}}/>}
      {assignmentProduct&&<AssignPickModal product={assignmentProduct} customerNames={[...new Set([...data.assignedPicking,...(data.orderHistory||[])].map((item)=>item.customerName?.trim()).filter(Boolean) as string[])]} onClose={()=>setAssignmentProduct(null)} onAssign={async(assignment)=>{if(await mutate("assignPick",{productId:assignmentProduct.id,...assignment})){setAssignmentProduct(null);setTab("ORDER");setOrderTabSignal((value)=>value+1);}}}/>}
      {manualCheckModal&&<ManualCheckModal kind={manualCheckModal} onSearch={searchManualProducts} onSave={saveManualCheck} onClose={()=>setManualCheckModal(null)}/>}
      {settingsOpen&&<SettingsModal
        actor={data.actor}
        users={data.users}
        theme={theme}
        appLogo={data.appBrand?.logo||"/aeon-logo.svg"}
        logoSizeDesktop={desktopLogoSize}
        logoSizeMobile={mobileLogoSize}
        uiPreferences={uiPreferences}
        onSaveAppearance={async(changes)=>{
          if(data.actor.role==="ADMIN"){
            const saved=await mutate("updateAppBrand",{logo:changes.logo,logoSize:changes.logoSizeDesktop,logoSizeDesktop:changes.logoSizeDesktop,logoSizeMobile:changes.logoSizeMobile});
            if(!saved)return false;
            // Apply the saved values immediately as well. This keeps the
            // header responsive even when an older running API only echoes
            // the legacy `logoSize` field in its next response.
            setData((current)=>current?{...current,appBrand:{logo:changes.logo,logoSize:changes.logoSizeDesktop,logoSizeDesktop:changes.logoSizeDesktop,logoSizeMobile:changes.logoSizeMobile,updatedAt:Date.now()}}:current);
          }
          setTheme(changes.theme);
          setUiPreferences(changes.uiPreferences);
          return true;
        }}
        onCreate={(account)=>mutate("createAccount",{account})}
        onUpdate={(account)=>mutate("updateAccount",{account})}
        onPassword={(currentPassword,newPassword)=>mutate("changeOwnPassword",{currentPassword,newPassword})}
        onLogout={logout}
        onClose={()=>setSettingsOpen(false)}
      />}
      {lineModal&&<LineConfigModal value={lineModal} onChange={setLineModal} onClose={()=>setLineModal(null)} onUploadPog={(file,line,side)=>void uploadPogFor(file,line,side)} onSave={async()=>{if(await mutate("updateLineConfig",{lineConfig:lineModal}))setLineModal(null);}}/>}
      {pogModal&&
        <PogModal modal={pogModal} setModal={setPogModal} products={visiblePogProducts} total={visiblePogTotal} file={activePog} search={pogSearch} setSearch={setPogSearch} canUpload={canManage(data.actor.role)} uploading={pogUploadBusy} uploadRef={pogRef} onUpload={(file,mode)=>void uploadPog(file,false,mode)} onAppend={(file,mode)=>void uploadPog(file,true,mode)} onReanalyze={(mode)=>void reanalyzePog(mode)} onPageChange={(page)=>void savePogPage(page)} onPick={(product)=>void quickAdd(product)} onClose={()=>setPogModal(null)}/>
      }
      {scannerOpen&&<BarcodeScannerModal onClose={()=>setScannerOpen(false)} onDetected={(rawValue)=>{const value=normalizeScannedBarcode(rawValue);if(!value){setToast("Không đọc được barcode dạng số");return;}setScannerOpen(false);setQuery(value);setProductPage(1);setToast("Đã quét barcode "+value);}} onError={setToast}/>}
      {loginOpen&&<LoginModal busy={busy} error={error} onSubmit={authenticate} onClose={()=>{setLoginOpen(false);setAuthMode(null);setError("");}}/>}
    </main>
  );
}

function LoginModal({busy,error,onSubmit,onClose}:{busy:boolean;error:string;onSubmit:(credentials:{username:string;password:string})=>Promise<void>;onClose:()=>void}) {
  const [username,setUsername]=useState("");const [password,setPassword]=useState("");
  const valid=username.trim().length>=3&&password.length>=8;
  return <div className="modal-backdrop login-backdrop"><section className="auth-card login-modal" role="dialog" aria-modal="true" aria-label="Đăng nhập"><div className="modal-head"><div><p>TÀI KHOẢN NHÂN VIÊN</p><h2>Đăng nhập</h2></div><button onClick={onClose} aria-label="Đóng">×</button></div><div className="login-modal-body"><span>Đăng nhập để sử dụng quyền chỉnh sửa, upload và quản trị. Bạn vẫn có thể tra cứu dữ liệu ở chế độ khách.</span><form onSubmit={(event)=>{event.preventDefault();if(valid&&!busy)void onSubmit({username:username.trim().toLowerCase(),password});}}><label>Tên đăng nhập<input value={username} autoCapitalize="none" autoComplete="username" onChange={(event)=>setUsername(event.target.value)} placeholder="Ví dụ: an.nguyen"/></label><label>Mật khẩu<input type="password" value={password} autoComplete="current-password" onChange={(event)=>setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự"/></label>{error&&<div className="auth-error" aria-live="polite">{error}</div>}<button disabled={!valid||busy}>{busy?<><i className="mini-spinner"/>Đang xử lý…</>:"Đăng nhập"}</button></form></div></section></div>;
}

function AuthScreen({mode,busy,error,onSubmit}:{mode:"login"|"setup";busy:boolean;error:string;onSubmit:(credentials:{username:string;password:string;name?:string})=>Promise<void>}) {
  const [username,setUsername]=useState("");const [password,setPassword]=useState("");const [name,setName]=useState("");
  const setup=mode==="setup",valid=username.trim().length>=3&&password.length>=8&&(!setup||name.trim().length>=2);
  return <main className="auth-screen"><section className="auth-card"><header><b>AEON</b><div><span>FULFILLMENT</span><strong>SMARTOPS</strong></div></header><div className="auth-intro"><p>{setup?"THIẾT LẬP LẦN ĐẦU":"TÀI KHOẢN NHÂN VIÊN"}</p><h1>{setup?"Tạo tài khoản Admin":"Đăng nhập"}</h1><span>{setup?"Tài khoản đầu tiên quản lý sản phẩm, Excel và phân quyền cho nhân viên.":"Đăng nhập để truy cập dữ liệu hàng hóa và đơn soạn của bạn."}</span></div><form onSubmit={(event)=>{event.preventDefault();if(valid&&!busy)void onSubmit({username:username.trim().toLowerCase(),password,name:name.trim()});}}>
    {setup&&<label>Tên hiển thị<input value={name} autoComplete="name" onChange={(event)=>setName(event.target.value)} placeholder="Ví dụ: Nguyễn Văn An"/></label>}
    <label>Tên đăng nhập<input value={username} autoCapitalize="none" autoComplete="username" onChange={(event)=>setUsername(event.target.value)} placeholder="Ví dụ: an.nguyen"/></label>
    <label>Mật khẩu<input type="password" value={password} autoComplete={setup?"new-password":"current-password"} onChange={(event)=>setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự"/></label>
    {error&&<div className="auth-error" aria-live="polite">{error}</div>}
    <button disabled={!valid||busy}>{busy?<><i className="mini-spinner"/>Đang xử lý…</>:setup?"Tạo Admin và bắt đầu":"Đăng nhập"}</button>
  </form>{setup&&<small>Chỉ hiển thị khi hệ thống chưa có tài khoản. Sau khi tạo, Admin có thể thêm Manager và Staff.</small>}</section><aside><span>01</span><b>Master Data rõ ràng</b><p>Tìm kiếm, kiểm tồn và cập nhật sản phẩm từ Excel theo đúng quyền được giao.</p></aside></main>;
}

function PageHead({eyebrow,title,subtitle,actions}:{eyebrow:string;title:string;subtitle:string;actions?:React.ReactNode}) {
  return <div className="page-head"><div><p>{eyebrow}</p><h1>{title}</h1><span>{subtitle}</span></div>{actions&&<div className="head-actions">{actions}</div>}</div>;
}
function OpsFilters({stock,visible,total,onStock,onClear}:{stock:"all"|"available"|"low"|"out";visible:number;total:number;onStock:(value:"all"|"available"|"low"|"out")=>void;onClear:()=>void}) {
  return <div className="ops-filters"><div className="filter-chips">{([['all','Tất cả'],['available','Còn hàng'],['low','Tồn thấp'],['out','Hết hàng']] as const).map(([value,label])=><button key={value} className={stock===value?"active":""} onClick={()=>onStock(value)}>{label}</button>)}</div><span>{visible}/{total} sản phẩm</span>{stock!=="all"&&<button className="clear-filters" onClick={onClear}>Xóa lọc</button>}</div>;
}
function ProductPager({page,pages,total,busy,onPage}:{page:number;pages:number;total:number;busy:boolean;onPage:(page:number)=>void}) {
  if(total<=100)return busy?<div className="product-loading"><i className="mini-spinner"/>Đang tải sản phẩm…</div>:null;
  return <nav className="product-pager" aria-label="Phân trang sản phẩm"><span>{busy?<><i className="mini-spinner"/>Đang tải…</>:<>{money.format(total)} sản phẩm</>}</span><div><button disabled={busy||page<=1} onClick={()=>onPage(page-1)}>← Trước</button><b>Trang {page}/{pages}</b><button disabled={busy||page>=pages} onClick={()=>onPage(page+1)}>Sau →</button></div></nav>;
}
function Dashboard({products,totalProducts,logs,totals,assignedItems,history,onGo}:{products:Product[];totalProducts:number;logs:Audit[];totals:ProductStats;assignedItems:AssignedPickItem[];history:OrderHistoryItem[];onGo:(tab:Tab,stock?:"all"|"low"|"out")=>void}) {
  const cards=[["Cạn kho",totals.outCount,"CHECK_STOCK","out","!"],["Tồn thấp",totals.lowCount,"CHECK_STOCK","low","↓"],["Thất thoát",totals.totalLoss,"CHECK_LOSS",undefined,"△"],["HSD cảnh báo",totals.expiring,"DATE",undefined,"◷"]] as const;
  const alerts=products.filter((p)=>p.stock<10||p.loss>0||["warning","danger"].includes(expiryStatus(p.expDate).tone)).slice(0,6);
  const activeOrders=groupOrderItems(assignedItems),orderCards=[["Chưa soạn",activeOrders.filter((group)=>group.every((item)=>!item.picked)).length,"○"],["Đang soạn",activeOrders.filter((group)=>group.some((item)=>item.picked)&&group.some((item)=>!item.picked)).length,"◐"],["Đã soạn xong",activeOrders.filter((group)=>group.every((item)=>Boolean(item.picked))).length,"✓"],["Đã giao",groupOrderItems(history).length,"→"]] as const;
  return <div><PageHead eyebrow="TRUNG TÂM VẬN HÀNH" title="Tổng quan" subtitle={money.format(totalProducts)+" SKU · Tồn kho, thất thoát và hạn dùng được cập nhật đồng bộ."}/>
    <div className="metric-grid">{cards.map((card)=><button key={card[0]} onClick={()=>onGo(card[2],card[3])}><i>{card[4]}</i><span>{card[0]}</span><strong>{card[1]}</strong></button>)}</div>
    <section className="panel order-overview"><div className="panel-title"><h2>Thông tin chung đơn hàng</h2><span>{activeOrders.length+groupOrderItems(history).length} đơn</span></div><div className="order-overview-grid">{orderCards.map((card)=><article key={card[0]}><i>{card[2]}</i><span>{card[0]}</span><b>{card[1]}</b><small>đơn hàng</small></article>)}</div></section>
    <div className="dash-grid"><section className="panel"><div className="panel-title"><h2>Cảnh báo cần xử lý</h2><span>{alerts.length} mục</span></div><div className="alert-list">{alerts.map((p)=><article key={p.id}><div className={"line-token "+(p.shelfLine?"line-"+p.shelfLine:"unassigned")}>{p.shelfLine?p.shelfLine+p.shelfSide:"—"}</div><div><b>{p.name}</b><span>SKU {p.sku} · {p.shelfLine?`POG Line ${p.shelfLine}${p.shelfSide} · vị trí ${p.shelfPosition}`:"Chưa gán kệ POG"} · Tồn {p.stock} · Loss {p.loss}</span></div><StockBadge stock={p.stock}/></article>)}</div></section>
    <section className="panel"><div className="panel-title"><h2>Lịch sử thao tác</h2><span>Real-time</span></div><div className="audit-list">{logs.slice(0,10).map((log)=><article key={log.id}><i/><div><b>{log.action}</b><span>{log.userName} · {new Date(log.createdAt).toLocaleString("vi-VN")}</span></div></article>)}{!logs.length&&<div className="empty">Chưa có thao tác</div>}</div></section></div></div>;
}
function MapView({pogFiles,lineConfigs,query,canManage,onOpen,onEdit}:{pogFiles:PogFile[];lineConfigs:LineConfig[];query:string;canManage:boolean;onOpen:(line:string,side:"A"|"B")=>void;onEdit:(lineConfig:LineConfig)=>void}) {
  const topLines=["17","18","19","20","21","22","23","24","25","26","27","28"];
  const bottomLines=["16","15","14","13","12","11","10","09","08","07","06","05","04","03","02","01"];
  const knownLines=new Set([...topLines,...bottomLines]),extraLines=[...new Set([...lineConfigs.map((config)=>config.line),...pogFiles.map((file)=>file.line)].filter((line)=>!knownLines.has(line)))].sort((a,b)=>Number(a)-Number(b));
  const configByLine=new Map(lineConfigs.map((config)=>[config.line,config]));
  const needle=normalize(query),pogMatchedLines=query?[...new Set(pogFiles.flatMap((file)=>(file.positions||[]).filter((position)=>normalize([position.sku,position.barcode,position.name].join(" ")).includes(needle)).map(()=>file.line)))]:[];
  const matched=new Set(pogMatchedLines);
  const LineCard=({line}:{line:string})=>{const config=configByLine.get(line)||{line,name:aisleNames[line],color:"#62676A",logo:""};const hit=matched.has(line)&&Boolean(query);return <section className={`layout-line line-${line}${hit?" match":""}`} style={{"--line":config.color,"--body":`color-mix(in srgb, ${config.color} 14%, white)`} as React.CSSProperties}><header>LINE {line}{canManage&&<button type="button" className="line-edit" aria-label={`Chỉnh sửa logo Line ${line}`} title="Chỉnh sửa tên, màu hoặc logo" onClick={(event)=>{event.stopPropagation();onEdit(config);}}>✎</button>}</header><div className="layout-body">{config.logo?<em>{config.logo}</em>:<b>{config.name}</b>}<button type="button" className="layout-side-overlay layout-side-overlay-a" aria-label={`Mở Line ${line}, mặt A`} onClick={()=>onOpen(line,"A")}/><button type="button" className="layout-side-overlay layout-side-overlay-b" aria-label={`Mở Line ${line}, mặt B`} onClick={()=>onOpen(line,"B")}/></div><div className="layout-sides"><button aria-label={`Mở Line ${line}, mặt A`} onClick={()=>onOpen(line,"A")}>A</button><button aria-label={`Mở Line ${line}, mặt B`} onClick={()=>onOpen(line,"B")}>B</button></div></section>};
  return <div><PageHead eyebrow="BẢN ĐỒ CỬA HÀNG" title="Sơ đồ POG" subtitle="Chọn dãy và mặt kệ để xem vị trí sản phẩm chi tiết." />
     <div className="full-map" aria-label="Sơ đồ layout cửa hàng"><div className="store-layout"><div className="dd-zone dd-left">D&amp;D</div>{topLines.slice(0,5).map((line)=><LineCard key={line} line={line}/>)}<div className="promo-spine">PROMOTION</div>{topLines.slice(5).map((line)=><LineCard key={line} line={line}/>)}<div className="dd-zone dd-right">D&amp;D</div>{bottomLines.slice(0,8).map((line)=><LineCard key={line} line={line}/>)}{bottomLines.slice(8).map((line)=><LineCard key={line} line={line}/>)}{extraLines.map((line)=><LineCard key={line} line={line}/>)}</div></div><div className="you-are">● BẠN Ở ĐÂY · Chọn Mặt A hoặc B để xem sơ đồ kệ{extraLines.length?` · Có thêm ${extraLines.length} Line ngoài sơ đồ chuẩn`:""}{canManage?" · Chọn ⚙ để chỉnh tên, màu và logo Line":""}</div></div>;
}
function ProductDetailGrid({product,full=false}:{product:Product;full?:boolean}) {
  const pog=product.shelfLine?`Line ${product.shelfLine}${product.shelfSide||""} · Vị trí ${product.shelfPosition??"—"}`:"Chưa gán POG";
  const fields:[string,string][]=[
    ["SKU",product.sku||"—"],["Tên sản phẩm",product.name||"—"],["Sale",money.format(product.sales??0)],
    ["Stock",money.format(product.stock??0)],["Giá bán retail",`${money.format(product.price??0)} đ`],["Giá khuyến mãi",product.promoPrice?`${money.format(product.promoPrice)} đ`:"—"],
    ["Division",product.division||"—"],["Division Name",product.divisionName||"—"],["Department",product.department||"—"],["Department Name",product.departmentName||"—"],
    ["Barcode NCC",product.supplierBarcode||"—"],["Barcode AEON",product.barcode||"—"],["Vị trí kệ POG",pog],
    ["Thất thoát",money.format(product.loss??0)],["Hạn dùng",product.expDate||"—"],["Ngày nhập hàng",product.inboundDate||"—"],["Hạn rút hàng",product.withdrawDate||"—"]
  ];
  if(full){
    fields.push(["Line sản phẩm",product.line||"—"],["Tên Line",product.lineName||"—"],["Mặt kệ",product.side||"—"],["Bay",product.bay?String(product.bay):"—"],["Tồn hệ thống",product.systemStock===undefined?"—":money.format(product.systemStock)],["Tồn thực tế",product.manualStock===undefined?"—":money.format(product.manualStock)],["IMAGE URL",product.imageUrl||"—"],["Cập nhật",product.updatedAt?new Date(product.updatedAt).toLocaleString("vi-VN"):"—"]);
  }
  return <div className="product-detail-grid" aria-label={`Thông tin đầy đủ của ${product.name||product.sku}`}>{fields.map(([label,value])=><div key={label}><span>{label}</span><b title={value}>{value}</b></div>)}</div>;
}
function ProductImageCarousel({value,alt,className}:{value?:string;alt:string;className:string}) {
  const urls=useMemo(()=>productImageUrls(value),[value]);
  const [index,setIndex]=useState(0),[failedUrls,setFailedUrls]=useState<Set<string>>(()=>new Set()),dragStart=useRef<number|null>(null);
  const currentIndex=Math.min(index,Math.max(0,urls.length-1));
  const move=(direction:number)=>{
    if(urls.length<2)return;
    for(let step=1;step<=urls.length;step++){
      const next=(currentIndex+direction*step+urls.length*2)%urls.length;
      if(!failedUrls.has(urls[next])){setIndex(next);return;}
    }
  };
  const onPointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{if(urls.length>1)dragStart.current=event.clientX;};
  const onPointerUp=(event:React.PointerEvent<HTMLDivElement>)=>{const start=dragStart.current;dragStart.current=null;if(start===null||urls.length<2)return;const delta=event.clientX-start;if(Math.abs(delta)>=35)move(delta<0?1:-1);};
  const onKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{if(event.key==="ArrowRight"){event.preventDefault();move(1);}else if(event.key==="ArrowLeft"){event.preventDefault();move(-1);}};
  const currentUrl=urls[currentIndex];
  const imageUnavailable=!currentUrl||failedUrls.has(currentUrl);
  const onImageError=()=>{
    if(!currentUrl)return;
    const nextFailed=new Set(failedUrls);nextFailed.add(currentUrl);setFailedUrls(nextFailed);
    for(let step=1;step<=urls.length;step++){
      const next=(currentIndex+step)%urls.length;
      if(!nextFailed.has(urls[next])){setIndex(next);return;}
    }
  };
  return <div className={`product-image-carousel ${className}${urls.length>1?" has-multiple-images":""}`} role={urls.length>1?"group":undefined} aria-label={urls.length>1?`Ảnh sản phẩm ${currentIndex+1} trên ${urls.length}`:undefined} tabIndex={urls.length>1?0:undefined} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={()=>{dragStart.current=null}} onKeyDown={onKeyDown}>
    {!imageUnavailable?<img src={currentUrl} alt={alt} draggable={false} loading="lazy" decoding="async" onError={onImageError}/>:<span className="product-image-empty">{urls.length?"Không tải được ảnh":"Chưa có ảnh sản phẩm"}</span>}
    {urls.length>1&&<><button type="button" className="product-image-nav product-image-prev" onClick={()=>move(-1)} aria-label="Ảnh trước">‹</button><button type="button" className="product-image-nav product-image-next" onClick={()=>move(1)} aria-label="Ảnh tiếp theo">›</button><div className="product-image-indicator" aria-live="polite"><span>{currentIndex+1}/{urls.length}</span><div>{urls.map((url,dotIndex)=><i key={`${url}-${dotIndex}`} className={dotIndex===currentIndex?"active":""}/>)}</div></div></>}
  </div>;
}
function ProductInfoModal({product,onClose,onMap,onPick}:{product:Product;onClose:()=>void;onMap?:()=>void;onPick?:()=>Promise<void>}) {
  const [adding,setAdding]=useState(false);
  const add=async()=>{if(!onPick||product.stock<=0||adding)return;setAdding(true);try{await onPick();}finally{setAdding(false);}};
  return <div className="modal-backdrop product-info-backdrop"><section className="form-modal product-info-modal" role="dialog" aria-modal="true" aria-label={`Thông tin sản phẩm ${product.name||product.sku}`}>
    <div className="modal-head"><div><p>THÔNG TIN SẢN PHẨM</p><h2>Chi tiết sản phẩm</h2></div><button onClick={onClose} aria-label="Đóng">×</button></div>
    <div className="product-info-body"><div className="product-info-hero"><ProductImageCarousel key={`${product.id}:${product.imageUrl||""}`} value={product.imageUrl} alt={product.name||"Ảnh sản phẩm"} className="product-info-image"/><div className="product-info-title"><span>SKU {product.sku||"—"}</span><h3>{product.name||"Chưa có tên sản phẩm"}</h3><p>{product.supplierBarcode||product.barcode?`Barcode ${product.supplierBarcode||product.barcode}`:"Chưa có barcode"}</p><StockBadge stock={product.stock}/></div></div><ProductDetailGrid product={product} full/></div>
    <div className="modal-actions"><button className="ghost" onClick={onClose}>Đóng</button>{onMap&&<button className="ghost" onClick={onMap}>Xem vị trí sản phẩm</button>}{onPick&&<button className="primary" disabled={product.stock<=0||adding} onClick={()=>void add()}>{adding?"Đang thêm…":product.stock<=0?"Hết hàng":"+ Thêm vào đơn"}</button>}</div>
  </section></div>;
}
function ProductsView({products,total,role,importResult,importJob,onAdd,onEdit,onDelete,onView,onMap,onPick,onExport,onImport}:{products:Product[];total:number;role:Role;importResult:MasterImportResult|null;importJob:MasterImportJob|null;onAdd:()=>void;onEdit:(p:Product)=>void;onDelete:(p:Product)=>void;onView:(p:Product)=>void;onMap:(p:Product)=>void;onPick:(p:Product)=>void;onExport:()=>void;onImport:()=>void}) {
  const importing=Boolean(importJob&&["uploading","queued","processing"].includes(importJob.status));
  const [expandedRows,setExpandedRows]=useState<Set<string>>(new Set());
  const toggleRow=(id:string)=>setExpandedRows((current)=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  return <div><PageHead eyebrow="MASTER DATA" title="Master Data sản phẩm" subtitle={money.format(total)+" SKU phù hợp"} actions={<><button className="ghost" onClick={onExport}>↓ Xuất Master (.xlsx)</button>{canManage(role)&&<button className="ghost" disabled={importing} onClick={onImport}>{importing?"Đang nhập Excel…":"↑ Nhập Excel (.xlsx)"}</button>}{canManage(role)&&<button className="primary" onClick={onAdd}>+ Thêm sản phẩm</button>}</>}/>
    <div className="master-help"><b>Định dạng nhập Excel</b><span>Thứ tự chuẩn: SKU · Tên sản phẩm · Sale · Stock · Giá bán retail · Giá khuyến mãi · Division · Division Name · Department · Department Name · Barcode NCC · Barcode AEON · IMAGE URL (tùy chọn). Dùng dấu | trong IMAGE URL để thêm nhiều ảnh; ảnh đầu tiên là ảnh mặc định. Hệ thống cũng nhận file cũ theo tên cột, đọc sheet đầu tiên · tối đa 500.000 dòng / 100 MB · cập nhật theo SKU. Line được gán sau khi liên kết POG.</span></div>
    {importJob&&<section className={"master-import-progress "+importJob.status} aria-live="polite"><div><span>{importJob.status==="completed"?"✓":importJob.status==="failed"?"!":"↑"}</span><div><b>{importJob.phase}</b><small>{importJob.fileName}{importJob.totalRows>0?" · "+money.format(importJob.processedRows)+"/"+money.format(importJob.totalRows)+" dòng":" · bạn có thể tiếp tục sử dụng ứng dụng"}</small></div><strong>{Math.round(importJob.percent)}%</strong></div><i role="progressbar" aria-label="Tiến độ nhập Master Data" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(importJob.percent)}><span style={{width:Math.max(2,importJob.percent)+"%"}}/></i>{importJob.error&&<p>{importJob.error}</p>}</section>}
    {importResult&&<section className="master-import-summary"><div><b>Đã nhập {importResult.fileName}</b><span>{importResult.created} SKU mới · {importResult.updated} cập nhật · {importResult.unchanged} không thay đổi</span></div><strong>{importResult.totalProducts} SKU</strong>{importResult.skipped>0&&<small>{importResult.skipped} dòng được bỏ qua{importResult.duplicates>0?" · "+importResult.duplicates+" dòng SKU trùng":""}{importResult.issues[0]?" · Dòng "+importResult.issues[0].row+": "+importResult.issues[0].reason:""}</small>}</section>}
    <div className="table-wrap"><table className="master-table compact-table master-data-table"><thead><tr><th>ẢNH</th><th>SKU</th><th>TÊN SẢN PHẨM</th><th>Sale</th><th>Stock</th><th>Division</th><th>Department</th><th>VỊ TRÍ KỆ POG</th><th>THAO TÁC</th></tr></thead><tbody>{products.map((p)=>{const expanded=expandedRows.has(p.id),imageUrl=productImageUrl(p.imageUrl);return <Fragment key={p.id}><tr className="product-row-clickable" tabIndex={0} onClick={()=>onView(p)} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onView(p);}}}><td data-label="ẢNH"><button type="button" className="product-table-image-button" onClick={(event)=>{event.stopPropagation();onView(p)}} aria-label={`Xem thông tin ${p.name||p.sku}`}><div className="product-table-image">{imageUrl?<img src={imageUrl} loading="lazy" decoding="async" alt=""/>:<span>Chưa có ảnh</span>}</div></button></td><td data-label="SKU"><button type="button" className="product-name-button" onClick={(event)=>{event.stopPropagation();onView(p)}}>{p.sku}</button></td><td data-label="TÊN SẢN PHẨM"><button type="button" className="product-name-button product-name-button-wide" onClick={(event)=>{event.stopPropagation();onView(p)}}><strong>{p.name}</strong></button></td><td data-label="Sale">{money.format(p.sales??0)}</td><td data-label="Stock"><StockBadge stock={p.stock}/></td><td data-label="Division">{p.division||"—"}</td><td data-label="Department">{p.department||"—"}</td><td data-label="VỊ TRÍ KỆ POG"><b>{p.shelfLine?`Line ${p.shelfLine}${p.shelfSide} · Vị trí ${p.shelfPosition}`:"Chưa gán POG"}</b></td><td data-label="THAO TÁC"><div className="row-actions compact-row-actions"><button type="button" className="details-button" aria-expanded={expanded} onClick={(event)=>{event.stopPropagation();toggleRow(p.id)}}>{expanded?"Thu gọn":"Xem đầy đủ"}</button><button type="button" onClick={(event)=>{event.stopPropagation();onPick(p)}}>+ Đơn</button><button type="button" disabled={!p.shelfLine} onClick={(event)=>{event.stopPropagation();onMap(p)}}>Vị trí</button>{canManage(role)&&<button type="button" onClick={(event)=>{event.stopPropagation();onEdit(p)}}>Sửa</button>}{canManage(role)&&<button type="button" className="danger-text" onClick={(event)=>{event.stopPropagation();if(window.confirm("Xóa sản phẩm “"+p.name+"”?"))onDelete(p)}}>Xóa</button>}</div></td></tr>{expanded&&<tr className="master-detail-row"><td colSpan={9}><ProductDetailGrid product={p}/></td></tr>}</Fragment>;})}{!products.length&&<tr><td colSpan={9}><div className="empty big"><b>Chưa có sản phẩm phù hợp</b><span>Thử đổi bộ lọc hoặc nhập Master Data từ Excel.</span></div></td></tr>}</tbody></table></div></div>;
}
function StockCheckView({products,total,role,metadata,job,onImport,onExport,onView,onAssign}:{products:Product[];total:number;role:Role;metadata?:StoreData["stockImport"];job:StockImportJob|null;onImport:()=>void;onExport:()=>void;onView:(p:Product)=>void;onAssign:(product:Product)=>void}) {
  const active=Boolean(job&&["uploading","queued","processing"].includes(job.status));
  const [expandedRows,setExpandedRows]=useState<Set<string>>(new Set());
  const toggleRow=(id:string)=>setExpandedRows((current)=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  return <div><PageHead eyebrow="TỒN KHO TỪ FILE UPLOAD" title="Check Stock" subtitle="Chỉ hiển thị số tồn có trong file Stock đã upload; không lấy từ Master Data." actions={<>{products.length>0&&<button onClick={onExport}>↓ Xuất Stock (.xlsx)</button>}{canManage(role)&&<button className="primary" disabled={active} onClick={onImport}>{active?"Đang xử lý…":"↑ Upload Stock .xlsx"}</button>}</>}/>
    <div className="master-help"><b>Định dạng file Stock</b><span>Thứ tự chuẩn: SKU · Tên sản phẩm · Sale · Stock · Division · Division Name · Department · Department Name. Hệ thống nhận theo tên cột nên không phụ thuộc thứ tự; SKU, Sale và Stock dùng để cập nhật tồn, các cột còn lại dùng để đối chiếu thông tin với Master Data.</span></div>
    {metadata&&<section className="master-import-summary"><div><b>File hiện tại: {metadata.fileName}</b><span>{money.format(metadata.recordCount)} SKU tồn kho · cập nhật {new Date(metadata.updatedAt).toLocaleString("vi-VN")}</span></div></section>}
    {job&&<section className={"master-import-progress "+job.status}><div><span>{job.status==="failed"?"!":"↑"}</span><div><b>{job.phase}</b><small>{job.fileName}</small></div><strong>{Math.round(job.percent)}%</strong></div><i><span style={{width:Math.max(2,job.percent)+"%"}}/></i>{job.error&&<p>{job.error}</p>}</section>}
    <div className="table-wrap"><table className="master-table compact-table stock-table stock-data-table"><thead><tr><th>SKU</th><th>TÊN SẢN PHẨM</th><th>Sale</th><th>Stock</th><th>Department</th><th>Division</th><th>THAO TÁC</th></tr></thead><tbody>{products.map((p)=>{const expanded=expandedRows.has(p.id);return <Fragment key={p.id}><tr className="product-row-clickable" tabIndex={0} onClick={()=>onView(p)} onKeyDown={(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onView(p);}}}><td data-label="SKU"><button type="button" className="product-name-button" onClick={(event)=>{event.stopPropagation();onView(p)}}>{p.sku}</button></td><td data-label="TÊN SẢN PHẨM"><button type="button" className="product-name-button product-name-button-wide" onClick={(event)=>{event.stopPropagation();onView(p)}}><strong>{p.name}</strong></button></td><td data-label="Sale">{money.format(p.sales??0)}</td><td data-label="Stock"><StockBadge stock={p.stock}/></td><td data-label="Department">{p.department||"—"}</td><td data-label="Division">{p.division||"—"}</td><td data-label="THAO TÁC"><div className="row-actions compact-row-actions"><button type="button" className="details-button" aria-expanded={expanded} onClick={(event)=>{event.stopPropagation();toggleRow(p.id)}}>{expanded?"Thu gọn":"Xem đầy đủ"}</button>{canManage(role)&&<button type="button" className="primary assign-button" disabled={p.stock<=0} onClick={(event)=>{event.stopPropagation();onAssign(p)}}>Gán đơn</button>}</div></td></tr>{expanded&&<tr className="master-detail-row"><td colSpan={7}><ProductDetailGrid product={p}/></td></tr>}</Fragment>;})}{!products.length&&<tr><td colSpan={7}><div className="empty big"><b>Chưa có file Stock</b><span>Upload file Stock để bắt đầu xem tồn kho tách biệt.</span></div></td></tr>}</tbody></table></div><p className="stock-total">{money.format(total)} SKU có trong file Stock</p></div>;
}
function AssignPickModal({product,customerNames,onClose,onAssign}:{product:Product;customerNames:string[];onClose:()=>void;onAssign:(assignment:{deliveryTimeSlot:string;quantity:number;customerName:string;customerPhone:string;invoiceNumber:string;note:string;orderDate:string})=>Promise<void>}) {
	  const [deliveryTimeSlot,setDeliveryTimeSlot]=useState(""),[quantity,setQuantity]=useState(1),[customerName,setCustomerName]=useState(""),[customerPhone,setCustomerPhone]=useState(""),[invoiceNumber,setInvoiceNumber]=useState(""),[orderDate,setOrderDate]=useState(()=>orderDateKey(Date.now())),[note,setNote]=useState("");
	  const phoneDigits=customerPhone.replace(/\D/g,"");
	  const valid=Boolean(customerName.trim()&&phoneDigits.length>=8&&quantity<=product.stock);
	  return <div className="modal-backdrop"><section className="form-modal"><div className="modal-head"><div><p>GÁN SOẠN ĐƠN TỪ STOCK</p><h2>Giao sản phẩm cho đơn hàng</h2></div><button onClick={onClose}>×</button></div><div className="form-grid"><p className="form-note wide"><b>{product.name}</b><br/>SKU {product.sku} · Tồn hiện có: {money.format(product.stock)}</p><label>Tên khách hàng<input list="assigned-customer-names" value={customerName} onChange={(event)=>setCustomerName(event.target.value)} placeholder="Chọn hoặc nhập tên khách"/><datalist id="assigned-customer-names">{customerNames.map((name)=><option key={name} value={name}/>)}</datalist></label><label>Số điện thoại khách<input type="tel" inputMode="tel" autoComplete="tel" value={customerPhone} onChange={(event)=>setCustomerPhone(event.target.value)} placeholder="Ví dụ: 0901234567"/></label><label>Số hóa đơn<input value={invoiceNumber} onChange={(event)=>setInvoiceNumber(event.target.value)} placeholder="Nhập số hóa đơn (nếu có)" maxLength={80}/></label><label>Ngày giao hàng<input type="date" min={todayOrderDate} value={orderDate} onChange={(event)=>setOrderDate(event.target.value)}/></label><label>Khung giờ giao hàng<select value={deliveryTimeSlot} onChange={(event)=>setDeliveryTimeSlot(event.target.value)}><option value="">Chưa chọn khung giờ</option><option>08:00 - 10:00</option><option>10:00 - 12:00</option><option>12:00 - 14:00</option><option>14:00 - 16:00</option><option>16:00 - 18:00</option><option>18:00 - 20:00</option></select></label><label>Số lượng<input type="number" min="1" max={product.stock} value={quantity} onChange={(event)=>setQuantity(Math.max(1,Number(event.target.value)||1))}/></label><label className="wide">Ghi chú Stock / đơn hàng<textarea rows={3} value={note} onChange={(event)=>setNote(event.target.value)} placeholder="Ví dụ: Ưu tiên hàng hạn dùng xa, giao buổi chiều…"/></label></div><p className="form-note order-assignment-hint">Đơn sẽ chờ phân công nhân viên soạn; sau khi hoàn tất soạn mới có thể gán tài xế ở tab Đã soạn xong.</p><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" disabled={!valid||!orderDate} onClick={()=>void onAssign({deliveryTimeSlot,quantity,customerName:customerName.trim(),customerPhone:phoneDigits,invoiceNumber:invoiceNumber.trim(),orderDate,note:note.trim()})}>Tạo đơn</button></div></section></div>;
}
const dailyReportFields:[keyof DailyReport,string,boolean][]=[
  ["employeeName","Tên nhân viên",false],["date","Ngày",false],["phone","SĐT",true],["customerName","Tên khách hàng",true],["customerStatus","Tình trạng KH",true],["vatExport","Xuất VAT",true],["orderType","Loại đơn",false],["invoiceNumber","Số hóa đơn",false],["invoiceValue","Giá trị hóa đơn",false],["paymentMethod","Phương thức thanh toán",false],["cdoNumber","Số CDO",false],["codNumber","Số COD",false],["carrier","Nhà vận chuyển",false],["returnStatus","Hủy/đổi/trả hàng",false],["remainingInvoiceValue","Giá trị hóa đơn còn lại",false],["memberCard","Thẻ thành viên",true],["customerGroup","Nhóm KH",true],["email","Email",true],["taxId","MST",true],["vatAddress","Địa chỉ xuất VAT",true],["deliveryAddress","Địa chỉ giao hàng",true]
];
function DailyReportHistoryView({reports:sourceReports,month,onEdit}:{reports:DailyReport[];month:string;onEdit:(report:DailyReport)=>void}) {
  const [deletedIds,setDeletedIds]=useState<Set<string>>(new Set()),[deletingId,setDeletingId]=useState("");
  const reports=sourceReports.filter((report)=>!deletedIds.has(report.id)),canDelete=true;
  const onDelete=async(report:DailyReport)=>{
    if(deletingId||!window.confirm(`Xóa báo cáo của ${report.customerName||"khách hàng này"} ngày ${report.date}? Dữ liệu đã xóa không thể khôi phục.`))return;
    setDeletingId(report.id);
    try {
      const response=await fetch("/api/daily-reports/"+encodeURIComponent(report.id),{method:"DELETE"}),result=await readApiJson<{error?:string}>(response);
      if(!response.ok)throw new Error(result.error||"Không thể xóa báo cáo ngày");
      setDeletedIds((current)=>new Set([...current,report.id]));
    } catch(cause) { window.alert(cause instanceof Error?cause.message:"Không thể xóa báo cáo ngày"); }
    finally { setDeletingId(""); }
  };
  const displayValue=(report:DailyReport,key:keyof DailyReport)=>{
    const value=report[key];
    if ((key==="invoiceValue"||key==="remainingInvoiceValue")&&value!==""&&value!==null&&value!==undefined) return decimalMoney.format(Number(value));
    const text=String(value??"").trim();
    return text||"—";
  };
  return <section className="panel daily-report-list">
    <div className="panel-title"><div><h2>Lịch sử nhập báo cáo tháng {month}</h2><span>Chọn Sửa để mở lại biểu mẫu; chỉ Manager/Admin có thể xóa.</span></div><b>{reports.length} báo cáo</b></div>
    <div className="table-wrap"><table className="compact-table report-table daily-report-history-table">
      <thead><tr><th>Thao tác</th><th>STT</th>{dailyReportFields.map(([,label])=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{reports.map((report,index)=><tr key={report.id} onClick={()=>onEdit(report)}>
        <td><div className="report-history-actions"><button type="button" onClick={(event)=>{event.stopPropagation();onEdit(report);}}>Sửa</button>{canDelete&&<button type="button" className="danger-text" disabled={deletingId===report.id} onClick={(event)=>{event.stopPropagation();void onDelete(report);}}>{deletingId===report.id?"Đang xóa…":"Xóa"}</button>}</div></td>
        <td>{index+1}</td>{dailyReportFields.map(([key])=><td key={String(key)}>{displayValue(report,key)}</td>)}
      </tr>)}{!reports.length&&<tr><td colSpan={dailyReportFields.length+2}><div className="empty big"><b>Chưa có báo cáo trong tháng này</b><span>Các báo cáo bạn nhập sẽ được lưu và hiển thị tại đây.</span></div></td></tr>}</tbody>
    </table></div>
  </section>;
}

function PurchaseHistoryView({summary,month,onMonth,onImport,onExport,onDelete,canManage,busy}:{summary:PurchaseHistorySummary;month:string;onMonth:(value:string)=>void;onImport:()=>void;onExport:(month:string)=>void;onDelete:(month:string)=>void;canManage:boolean;busy:boolean}) {
  const [query,setQuery]=useState("");
  const year=summary.year||month.slice(0,4),needle=normalize(query),records=summary.records.filter((record)=>!needle||normalize(`${record.phone} ${record.customerName} ${record.address} ${record.invoiceNumber} ${record.products||""}`).includes(needle));
  return <div className="purchase-history-view"><div className="purchase-history-toolbar"><label>Tháng và năm<input type="month" value={month} onChange={(event)=>onMonth(event.target.value)}/></label><label className="purchase-history-search">Tìm trong tháng<input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="SĐT, tên, hóa đơn hoặc sản phẩm"/></label><button className="ghost" onClick={()=>onExport(month)}>↓ Xuất tổng hợp .xlsx</button><button className="primary" disabled={!canManage||busy} title={canManage?"Upload dữ liệu mua hàng của tháng đã chọn":"Cần quyền Manager hoặc Admin"} onClick={onImport}>{busy?<><i className="mini-spinner"/> Đang xử lý…</>:canManage?"↑ Upload dữ liệu tháng":"Cần quyền Manager/Admin"}</button><button className="ghost danger-text" disabled={!canManage||busy||!summary.records.length} title={canManage?"Xóa toàn bộ dữ liệu của tháng đang chọn":"Cần quyền Manager hoặc Admin"} onClick={()=>onDelete(month)}>× Xóa dữ liệu tháng</button></div><div className="purchase-history-note">Đang hiển thị từng dòng mua hàng của tháng {month}. Hệ thống vẫn đọc dữ liệu các tháng trong năm để tính tổng năm, nhưng không gộp các khách hàng trong danh sách này.</div><div className="purchase-history-cards"><article><small>Tổng tháng {month}</small><b>{money.format(summary.totals.monthValue)} đ</b><span>{summary.totals.monthOrders} dòng mua hàng</span></article><article><small>Tổng năm {year}</small><b>{money.format(summary.totals.yearValue)} đ</b><span>{summary.totals.yearOrders} dòng mua hàng</span></article><article><small>Khách hàng trong năm</small><b>{money.format(summary.totals.customerCount)}</b><span>Dùng cho tổng hợp năm</span></article></div><section className="panel purchase-history-table-panel"><div className="panel-title"><div><h2>Danh sách mua hàng tháng {month}</h2><span>{records.length} dòng đang hiển thị · không gộp khách hàng</span></div><b>{busy?"Đang tải…":`${summary.records.length} dòng tháng ${month}`}</b></div><div className="table-wrap"><table className="compact-table purchase-history-table"><thead><tr><th>Ngày</th><th>SĐT</th><th>Khách hàng</th><th>Địa chỉ</th><th>Số hóa đơn</th><th>Giá trị hóa đơn</th><th>Sản phẩm (SKU - tên)</th></tr></thead><tbody>{records.map((record,index)=><tr key={`${record.id}-${index}`}><td>{record.date||month}</td><td>{record.phone||"—"}</td><td><b>{record.customerName||"Chưa có tên"}</b></td><td>{record.address||"—"}</td><td>{record.invoiceNumber||"—"}</td><td>{record.invoiceValue?decimalMoney.format(Number(record.invoiceValue)):"—"}</td><td className="purchase-history-products">{record.products||"—"}</td></tr>)}{!records.length&&<tr><td colSpan={7}><div className="empty big"><b>Chưa có dữ liệu mua hàng trong tháng này</b><span>Upload file Excel theo tháng/năm để bắt đầu tổng hợp.</span></div></td></tr>}</tbody></table></div></section></div>;
}
function DailyReportFieldSections({form,onChange,carrierUsers}:{form:Record<string,string>;onChange:(key:string,value:string)=>void;carrierUsers:UserRole[]}) {
  const compactKeys=new Set(["employeeName","orderType","date","phone","customerName","customerStatus","vatExport","invoiceNumber","invoiceValue","paymentMethod","cdoNumber","codNumber","returnStatus","remainingInvoiceValue","customerGroup","taxId"]);
  const renderField=([key,label,isLinked]:typeof dailyReportFields[number])=>{
    const isInvoiceValue=key==="invoiceValue"||key==="remainingInvoiceValue",type=key==="date"?"date":isInvoiceValue?"text":"text";
    const wide=false,compact=compactKeys.has(String(key));
    const paymentOptions=["Tiền mặt","Chuyển khoản","Cà thẻ","COD"],invoiceValue=form[String(key)]||"";
    const input=key==="carrier"?<select value={form.carrier||""} onChange={(event)=>onChange("carrier",event.target.value)}><option value="">Chọn nhà vận chuyển</option><option value="Ahamove">Ahamove</option>{carrierUsers.map((user)=><option key={user.userId} value={user.name}>{user.name}</option>)}</select>:key==="paymentMethod"?<select value={form.paymentMethod||""} onChange={(event)=>onChange("paymentMethod",event.target.value)}><option value="">Chọn phương thức thanh toán</option>{paymentOptions.map((option)=><option key={option} value={option}>{option}</option>)}</select>:<input type={type} inputMode={isInvoiceValue?"decimal":type==="number"?"decimal":undefined} value={isInvoiceValue?formatInvoiceInput(invoiceValue):invoiceValue} onChange={(event)=>onChange(String(key),isInvoiceValue?formatInvoiceInput(event.target.value):event.target.value)} placeholder={key==="phone"?"Nhập SĐT để tra cứu khách hàng":label}/>;
    return <label key={String(key)} className={(compact?"compact-report-field ":"")+(isLinked?"customer-linked-field ":"")+(wide?"wide":"")}><span>{label}{isLinked&&<i>●</i>}</span>{input}</label>;
  };
  const manualFields=dailyReportFields.filter(([key,,isLinked])=>!isLinked||key==="phone");
  const linkedFields=dailyReportFields.filter(([key,,isLinked])=>isLinked&&key!=="phone");
  return <div className="daily-report-field-sections"><section className="daily-report-field-group manual"><header><div><h3>Thông tin nhập tay</h3><p>Các trường vận hành của báo cáo.</p></div><b>{manualFields.length} trường</b></header><div className="daily-report-grid">{manualFields.map(renderField)}</div></section><section className="daily-report-field-group linked"><header><div><h3>Thông tin khách hàng tự điền</h3><p>Tự liên kết theo SĐT; có thể chỉnh sửa trước khi lưu.</p></div><b>{linkedFields.length} trường</b></header><div className="daily-report-grid">{linkedFields.map(renderField)}</div></section></div>;
}

function DailyReportView({reports,customers,users,month,onMonth,onSave,onImport,onExport,onExportCustomers,canManage,busy,purchaseHistory,purchaseMonth,onPurchaseMonth,onPurchaseImport,onPurchaseExport,onPurchaseDelete,purchaseBusy}:{reports:DailyReport[];customers:CustomerMaster[];users:UserRole[];month:string;onMonth:(value:string)=>void;onSave:(report:Record<string,unknown>)=>Promise<void>;onImport:()=>void;onExport:(month:string)=>void;onExportCustomers:()=>void;canManage:boolean;busy:boolean;purchaseHistory:PurchaseHistorySummary;purchaseMonth:string;onPurchaseMonth:(value:string)=>void;onPurchaseImport:()=>void;onPurchaseExport:(month:string)=>void;onPurchaseDelete:(month:string)=>void;purchaseBusy:boolean}) {
  const blank=()=>({employeeName:"",date:todayOrderDate,phone:"",customerName:"",customerStatus:"",vatExport:"",orderType:"",invoiceNumber:"",invoiceValue:"",paymentMethod:"",cdoNumber:"",codNumber:"",carrier:"",returnStatus:"",remainingInvoiceValue:"",memberCard:"",customerGroup:"",email:"",taxId:"",vatAddress:"",deliveryAddress:"",id:""});
  const carrierUsers=users.filter((user)=>user.active!==false&&(user.workType==="DELIVERY"||user.workType==="BOTH"));
  const [form,setForm]=useState<Record<string,string>>(blank);const [view,setView]=useState<"report"|"reportHistory"|"master"|"history">("report");const [saving,setSaving]=useState(false);
  const linkedCustomerFields=["customerName","customerStatus","vatExport","memberCard","customerGroup","email","taxId","vatAddress","deliveryAddress"];
  const setField=(key:string,value:string)=>{if(key!=="phone"){setForm((current)=>({...current,[key]:value}));return;}const phone=value.replace(/\D/g,"");const customer=phone.length>=8?customers.find((item)=>item.phone.replace(/\D/g,"")===phone):undefined;setForm((current)=>{const linkedValues=customer?{customerName:customer.name||"",customerStatus:customer.status||"",vatExport:customer.vatExport||"",memberCard:customer.memberCard||"",customerGroup:customer.group||"",email:customer.email||"",taxId:customer.taxId||"",vatAddress:customer.vatAddress||"",deliveryAddress:customer.deliveryAddress||""}:Object.fromEntries(linkedCustomerFields.map((field)=>[field,""]));return {...current,phone:value,...linkedValues};});};
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setSaving(true);try{await onSave({...form,invoiceValue:form.invoiceValue,remainingInvoiceValue:form.remainingInvoiceValue});setForm(blank());}finally{setSaving(false);}};
  return <div className="daily-report-page"><PageHead eyebrow="BÁO CÁO VẬN HÀNH" title="Nhập báo cáo ngày" subtitle={`${reports.length} báo cáo trong tháng ${month}`} actions={<><label className="report-month-picker">Tháng<input type="month" value={month} onChange={(event)=>onMonth(event.target.value)}/></label><button className="ghost" onClick={()=>onExport(month)}>↓ Xuất báo cáo tháng</button><button className="ghost" onClick={onExportCustomers}>↓ Xuất Master khách</button><button className="primary" disabled={!canManage} title={canManage?"Upload file Master khách hàng .xlsx":"Đăng nhập tài khoản Manager hoặc Admin để upload Master khách"} onClick={onImport}>{canManage?"↑ Upload Master khách":"↑ Cần quyền Manager/Admin"}</button></>}/>
    <div className="daily-report-tabs"><button className={view==="report"?"active":""} onClick={()=>setView("report")}>Nhập báo cáo</button><button className={view==="reportHistory"?"active":""} onClick={()=>setView("reportHistory")}>Lịch sử nhập <b>{reports.length}</b></button><button className={view==="master"?"active":""} onClick={()=>setView("master")}>Master khách hàng <b>{customers.length}</b></button><button className={view==="history"?"active":""} onClick={()=>setView("history")}>Lịch sử mua hàng</button></div>
    {view==="reportHistory"?<DailyReportHistoryView reports={reports} month={month} onEdit={(report)=>{setForm(Object.fromEntries(Object.entries({...report,invoiceValue:String(report.invoiceValue??""),remainingInvoiceValue:String(report.remainingInvoiceValue??"")}).map(([key,value])=>[key,String(value??"")])));setView("report");}} />:view==="report"?<><form className="daily-report-form panel" onSubmit={submit}><div className="panel-title"><div><h2>Thông tin báo cáo</h2><span>Các trường có dấu liên kết sẽ tự điền theo SĐT nếu khách đã có trong Master.</span></div><button className="primary" disabled={saving||busy||!form.employeeName.trim()||!form.phone.trim()||!form.customerName.trim()}>{saving?"Đang lưu…":form.id?"Cập nhật báo cáo":"Lưu báo cáo"}</button></div><DailyReportFieldSections form={form} onChange={setField} carrierUsers={carrierUsers}/><p className="report-link-hint"><i>●</i> Tự liên kết từ SĐT · Khách mới hoặc thông tin chỉnh sửa sẽ được cập nhật vào Master khách hàng khi bấm Lưu.</p></form><section className="panel daily-report-list"><div className="panel-title"><h2>Dữ liệu báo cáo tháng {month}</h2><span>{reports.length} khách/báo cáo</span></div><div className="table-wrap"><table className="compact-table report-table"><thead><tr><th>Ngày</th><th>Tên NV</th><th>SĐT</th><th>Khách hàng</th><th>Số hóa đơn</th><th>Giá trị HĐ</th><th>PTTT</th><th>Loại đơn</th><th>Ghi chú</th></tr></thead><tbody>{reports.map((report)=><tr key={report.id} onClick={()=>setForm(Object.fromEntries(Object.entries({...report,invoiceValue:String(report.invoiceValue??""),remainingInvoiceValue:String(report.remainingInvoiceValue??"")}).map(([key,value])=>[key,String(value??"")])))}><td>{report.date}</td><td>{report.employeeName}</td><td>{report.phone}</td><td><b>{report.customerName}</b><small>{report.customerGroup||""}</small></td><td>{report.invoiceNumber||"—"}</td><td>{report.invoiceValue?decimalMoney.format(Number(report.invoiceValue)):"—"}</td><td>{report.paymentMethod||"—"}</td><td>{report.orderType||"—"}</td><td>{report.note||"—"}</td></tr>)}{!reports.length&&<tr><td colSpan={9}><div className="empty big"><b>Chưa có báo cáo trong tháng này</b><span>Nhập thông tin khách hàng và đơn hàng ở biểu mẫu phía trên.</span></div></td></tr>}</tbody></table></div></section></>:view==="master"?<section className="panel customer-master-panel"><div className="panel-title"><div><h2>Master khách hàng</h2><span>Tra cứu và quản lý thông tin được liên kết tự động theo SĐT.</span></div><b>{customers.length} khách</b></div><div className="table-wrap"><table className="compact-table report-table customer-table"><thead><tr><th>STT</th><th>SĐT</th><th>Tên khách hàng</th><th>Tình trạng KH</th><th>Mã App TV</th><th>Nhóm KH</th><th>Tên công ty</th><th>Email</th><th>MST</th><th>Địa chỉ xuất VAT</th><th>Địa chỉ giao hàng</th></tr></thead><tbody>{customers.map((customer,index)=><tr key={customer.id}><td>{index+1}</td><td>{customer.phone}</td><td><b>{customer.name}</b></td><td>{customer.status||"—"}</td><td>{customer.memberCard||"—"}</td><td>{customer.group||"—"}</td><td>{customer.companyName||"—"}</td><td>{customer.email||"—"}</td><td>{customer.taxId||"—"}</td><td>{customer.vatAddress||"—"}</td><td>{customer.deliveryAddress||"—"}</td></tr>)}{!customers.length&&<tr><td colSpan={11}><div className="empty big"><b>Chưa có Master khách hàng</b><span>Upload file .xlsx hoặc lưu báo cáo đầu tiên để tạo dữ liệu.</span></div></td></tr>}</tbody></table></div></section>:<PurchaseHistoryView summary={purchaseHistory} month={purchaseMonth} onMonth={onPurchaseMonth} onImport={onPurchaseImport} onExport={onPurchaseExport} onDelete={onPurchaseDelete} canManage={canManage} busy={purchaseBusy}/>}
  </div>;
}
function ManualCheckGrid({kind,products,canEdit,onAdd}:{kind:"checkLoss"|"checkDate";products:Product[];canEdit:boolean;onAdd:()=>void}) {
  const isLoss=kind==="checkLoss";
  const config=isLoss
    ?{eyebrow:"CHECK LOSS",title:"Check Loss",subtitle:"Gộp kiểm tồn và thất thoát trong một quy trình. Chọn sản phẩm để nhập số liệu thực tế.",empty:"Chọn “Nhập Check Loss” để tìm sản phẩm và nhập tồn thực tế, thất thoát."}
    :{eyebrow:"CHECK DATE",title:"Check Date",subtitle:"Theo dõi ngày nhập hàng và hạn rút hàng theo từng sản phẩm.",empty:"Chọn “Nhập Check Date” để tìm sản phẩm và nhập hai mốc ngày."};
  return <div><PageHead eyebrow={config.eyebrow} title={config.title} subtitle={config.subtitle} actions={canEdit?<button className="primary" onClick={onAdd}>+ Nhập {isLoss?"Check Loss":"Check Date"}</button>:undefined}/><div className="check-grid">{products.map((p)=>{
    const systemStock=p.systemStock??(p.stockKnown?p.stock:undefined),stock=p.manualStock??undefined,loss=p.manualLoss??(p.loss||undefined),withdrawDate=p.withdrawDate||p.expDate||"",status=expiryStatus(withdrawDate);
    return <article key={p.id} className={isLoss?"check-loss-card":"check-date-card"}><div className="card-top"><span className={"line-token "+(p.shelfLine?"line-"+p.shelfLine:"unassigned")}>{p.shelfLine?p.shelfLine+p.shelfSide:"—"}</span>{!isLoss&&withdrawDate&&<span className={"badge "+status.tone}>{status.label}</span>}</div><h2>{p.name}</h2><p>SKU {p.sku} · Barcode {p.barcode||p.supplierBarcode||"—"}</p><p>{p.shelfLine?`POG Line ${p.shelfLine}${p.shelfSide} · Vị trí ${p.shelfPosition}`:"Chưa gán vị trí kệ POG"}</p>{isLoss?<div className="manual-check-metrics"><span><small>Tồn hệ thống</small><b>{systemStock===undefined?"—":money.format(systemStock)}</b></span><span><small>Tồn thực tế</small><b>{stock===undefined?"—":money.format(stock)}</b></span><span><small>Thất thoát</small><b>{loss===undefined?"—":money.format(loss)}</b></span></div>:<div className="manual-check-dates"><span><small>Ngày nhập hàng</small><b>{p.inboundDate||"—"}</b></span><span><small>Hạn rút hàng</small><b>{withdrawDate||"—"}</b></span></div>}</article>;
  })}{!products.length&&<div className="empty big grid-empty"><b>Chưa có dữ liệu {isLoss?"Check Loss":"Check Date"}</b><span>{canEdit?config.empty:"Đăng nhập để nhập dữ liệu kiểm tra thủ công."}</span></div>}</div></div>;
}

function ManualCheckModal({kind,onSearch,onSave,onClose}:{kind:ManualCheckKind;onSearch:(query:string)=>Promise<Product[]>;onSave:(payload:Record<string,unknown>)=>Promise<void>;onClose:()=>void}) {
  const isLoss=kind==="checkLoss";
  const [query,setQuery]=useState(""),[results,setResults]=useState<Product[]>([]),[selected,setSelected]=useState<Product|null>(null),[systemStock,setSystemStock]=useState(""),[stock,setStock]=useState(""),[loss,setLoss]=useState("0"),[inboundDate,setInboundDate]=useState(""),[withdrawDate,setWithdrawDate]=useState(""),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;const timer=window.setTimeout(async()=>{setLoading(true);setError("");try{const products=await onSearch(query);if(!cancelled)setResults(products);}catch(cause){if(!cancelled)setError(cause instanceof Error?cause.message:"Không thể tìm sản phẩm");}finally{if(!cancelled)setLoading(false);}},query.trim()?120:0);return()=>{cancelled=true;window.clearTimeout(timer);};},[query,onSearch]);
  const selectProduct=(product:Product)=>{setSelected(product);if(isLoss){setSystemStock(String(product.systemStock??product.stock??0));setStock(product.manualStock===undefined?"":String(product.manualStock));setLoss(product.manualLoss===undefined?"0":String(product.manualLoss));}else{setInboundDate(product.inboundDate||"");setWithdrawDate(product.withdrawDate||product.expDate||"");}};
  const validNumber=(value:string)=>/^\d+$/.test(value.trim());
  const valid=isLoss?Boolean(selected&&validNumber(systemStock)&&validNumber(stock)&&validNumber(loss)):Boolean(selected&&/^\d{4}-\d{2}-\d{2}$/.test(inboundDate)&&/^\d{4}-\d{2}-\d{2}$/.test(withdrawDate)&&withdrawDate>=inboundDate);
  const save=async()=>{if(!selected||!valid||saving)return;setSaving(true);try{await onSave(isLoss?{kind:"checkLoss",sku:selected.sku,systemStock:Number(systemStock),stock:Number(stock),loss:Number(loss)}:{kind:"checkDate",sku:selected.sku,inboundDate,withdrawDate});}finally{setSaving(false);}};
  return <div className="modal-backdrop"><section className="form-modal manual-check-modal" role="dialog" aria-modal="true" aria-label={isLoss?"Nhập Check Loss":"Nhập Check Date"}><div className="modal-head"><div><p>{isLoss?"CHECK LOSS":"CHECK DATE"}</p><h2>{isLoss?"Nhập tồn & thất thoát":"Nhập ngày hàng"}</h2></div><button onClick={onClose} aria-label="Đóng">×</button></div><div className="manual-check-search"><label>Tìm sản phẩm<input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Nhập SKU, barcode hoặc tên sản phẩm…"/></label></div><div className="manual-product-results" aria-live="polite">{loading?<div className="search-empty"><i className="mini-spinner"/>Đang tìm sản phẩm…</div>:results.map((product)=><button type="button" key={product.id} className={selected?.id===product.id?"manual-product-result active":"manual-product-result"} onClick={()=>selectProduct(product)}><span>{product.departmentName||product.department||"SP"}</span><div><b>{product.name}</b><small>SKU {product.sku} · Barcode {product.barcode||product.supplierBarcode||"—"}</small></div><em>{product.shelfLine?`POG ${product.shelfLine}${product.shelfSide}`:"Chưa gán POG"}</em></button>)}{!loading&&!results.length&&<div className="search-empty"><b>Không tìm thấy sản phẩm</b><span>Thử SKU, barcode hoặc tên sản phẩm khác.</span></div>}</div>{selected&&<div className="manual-check-form"><div className="manual-check-selected"><b>{selected.name}</b><span>SKU {selected.sku} · Barcode {selected.barcode||selected.supplierBarcode||"—"}</span></div>{isLoss?<div className="manual-check-fields manual-check-loss-fields"><label>Tồn hệ thống<input type="number" min="0" step="1" inputMode="numeric" value={systemStock} onChange={(event)=>setSystemStock(event.target.value)} placeholder="0"/></label><label>Tồn thực tế<input type="number" min="0" step="1" inputMode="numeric" value={stock} onChange={(event)=>setStock(event.target.value)} placeholder="0"/></label><label>Thất thoát<input type="number" min="0" step="1" inputMode="numeric" value={loss} onChange={(event)=>setLoss(event.target.value)} placeholder="0"/></label></div>:<div className="manual-check-fields"><label>Ngày nhập hàng<input type="date" value={inboundDate} onChange={(event)=>setInboundDate(event.target.value)}/></label><label>Hạn rút hàng<input type="date" min={inboundDate||undefined} value={withdrawDate} onChange={(event)=>setWithdrawDate(event.target.value)}/></label></div>}{!isLoss&&withdrawDate&&inboundDate&&withdrawDate<inboundDate&&<p className="manual-check-error">Hạn rút hàng không thể trước ngày nhập hàng.</p>}</div>}{error&&<p className="manual-check-error">{error}</p>}<div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" disabled={!valid||saving} onClick={()=>void save()}>{saving?<><i className="mini-spinner"/>Đang lưu…</>:"Lưu kiểm tra"}</button></div></section></div>;
}
export function OrderViewLegacy({items,assignedItems,history,onExportHistory,onToggle,onAvailability,onQuantity,onRemove,onClear,onMap}:{items:PickItem[];assignedItems:AssignedPickItem[];history:OrderHistoryItem[];onExportHistory:(month:string)=>void;onToggle:(p:PickItem)=>void;onAvailability:(p:PickItem)=>void;onQuantity:(p:PickItem,quantity:number)=>void;onRemove:(p:PickItem)=>void;onClear:()=>void;onMap:(p:PickItem)=>void}) {
  const route=["16","15","14","13","12","11","10","09","08","07","06","05","04","03","02","01","17","18","19","20","21","22","23","24","25","26","27","28"];
  const locationLabel=(product:PickItem)=>product.shelfLine?`POG Line ${product.shelfLine}${product.shelfSide} · Vị trí ${product.shelfPosition}`:"Chưa gán vị trí kệ POG";
  const shelfRoute=(product:PickItem)=>{const index=route.indexOf(product.shelfLine||"");return index<0?999:index;};
  const sorted=[...items].sort((a,b)=>orderDateKey(a.orderDate||a.createdAt).localeCompare(orderDateKey(b.orderDate||b.createdAt))||Number(Boolean(a.picked))-Number(Boolean(b.picked))||shelfRoute(a)-shelfRoute(b)||(a.shelfSide||"Z").localeCompare(b.shelfSide||"Z")||(a.shelfPosition||0)-(b.shelfPosition||0));
  const pickedUnits=items.filter((p)=>Boolean(p.picked)).reduce((sum,p)=>sum+p.quantity,0),totalUnits=items.reduce((sum,p)=>sum+p.quantity,0),percent=totalUnits?Math.round(pickedUnits/totalUnits*100):0,next=sorted.find((p)=>!p.picked);
  const assignedCustomerCount=new Set(assignedItems.map((item)=>{const phone=(item.customerPhone||"").replace(/\D/g,""),fallback=normalize((item.customerName||"").trim())||"chua dat ten khach",groupKey=phone?"phone:"+phone:"name:"+fallback;return orderDateKey(item.orderDate||item.createdAt)+"|"+groupKey;})).size;
  const dateTotals=new Map<string,number>();
  for(const item of sorted){const date=orderDateKey(item.orderDate||item.createdAt);dateTotals.set(date,(dateTotals.get(date)||0)+1);}
  const finish=()=>{if(next&&!window.confirm("Đơn vẫn còn sản phẩm chưa lấy. Bạn có chắc muốn hoàn tất và xóa đơn?"))return;onClear()};
  return <div className="order-page"><PageHead eyebrow="PICKING LIST" title="Đơn đang soạn" subtitle={pickedUnits+"/"+totalUnits+" sản phẩm đã lấy · sắp theo vị trí kệ POG"} actions={items.length?<button className="primary" onClick={finish}>{next?"Kết thúc sớm":"Hoàn tất đơn"}</button>:undefined}/><div className="order-top-panels"><AssignedOrdersView items={assignedItems} history={history} onExportHistory={onExportHistory}/></div><section className="order-summary" aria-label="Tóm tắt đơn soạn"><article><span>Đang soạn</span><b>{items.length}</b><small>{totalUnits} sản phẩm</small></article><article><span>Đã lấy</span><b>{pickedUnits}</b><small>trên {totalUnits} sản phẩm</small></article><article><span>Nhóm đã giao</span><b>{assignedCustomerCount}</b><small>khách hàng</small></article><article><span>Lịch sử</span><b>{history.length}</b><small>mặt hàng đã hoàn tất</small></article></section>{next&&<section className="next-pick"><div><small>ĐIỂM LẤY TIẾP THEO</small><b>{locationLabel(next)}</b><span>{next.name} · SL {next.quantity}</span></div><button disabled={!next.shelfLine} onClick={()=>onMap(next)}>Mở vị trí →</button></section>}<div className="order-progress-large"><i><span style={{width:percent+"%"}}/></i><b>{percent}%</b></div>
    <div className="order-list" aria-label="Danh sách sản phẩm đang soạn">{sorted.map((p,index)=>{const date=orderDateKey(p.orderDate||p.createdAt),previous=index?orderDateKey(sorted[index-1].orderDate||sorted[index-1].createdAt):"",imageUrl=productImageUrl(p.imageUrl);return <Fragment key={p.pickId}>{date!==previous&&<div className="order-day-divider"><b>{orderDateLabel(date)}</b><span>{dateTotals.get(date)||0} mặt hàng</span></div>}<article className={p.picked?"picked":""}><div className="pick-product-thumb" title={p.departmentName||p.department||"Chưa có Department"}>{imageUrl?<img src={imageUrl} alt=""/>:<span>{(p.departmentName||p.department||"Chưa có Dept").slice(0,22)}</span>}</div><button className={"availability-toggle "+(p.available!==false?"available":"unavailable")} aria-pressed={p.available===false} aria-label={p.available!==false?"Chuyển sản phẩm sang hết hàng":"Chuyển sản phẩm sang còn hàng"} title={p.available!==false?"Nhấn để báo hết hàng":"Nhấn để báo còn hàng"} onClick={()=>onAvailability(p)}><i/><span><b>{p.available!==false?"Còn hàng":"Hết hàng"}</b><small>{p.available!==false?"Nhấn để báo hết":"Nhấn để hoàn tác"}</small></span></button><button className="pick-check" aria-label={p.picked?"Đánh dấu chưa lấy":"Đánh dấu đã lấy"} onClick={()=>onToggle(p)}>{p.picked?"✓":""}</button><div className="pick-product-info"><small>SKU {p.sku}{p.customerName?" · Khách: "+p.customerName:""}{p.customerPhone?" · "+p.customerPhone:""}</small><b>{p.name}</b><span>{p.barcode||p.supplierBarcode?"Barcode: "+(p.barcode||p.supplierBarcode)+" · ":""}{locationLabel(p)}{p.note?" · "+p.note:""}</span></div><div className="pick-quantity"><button disabled={p.quantity<=1} onClick={()=>onQuantity(p,p.quantity-1)}>−</button><b>{p.quantity}</b><button onClick={()=>onQuantity(p,p.quantity+1)}>+</button></div><StockBadge stock={p.stock}/><button disabled={!p.shelfLine} onClick={()=>onMap(p)}>Vị trí</button><button className="danger-text" onClick={()=>onRemove(p)}>Bỏ</button></article></Fragment>})}{!items.length&&<div className="empty big"><b>Đơn soạn đang trống</b><span>Chờ đơn được giao từ Check Stock hoặc thêm sản phẩm từ tìm kiếm.</span></div>}</div></div>;
}
function OrderView({items,assignedItems,history,actor,users,canReassign,onReassignOrder,onCompletePicking,onAssignDelivery,onCompleteDelivery,onReopenDelivered,onExportHistory,onToggle,onPickedQuantity,onViewProduct}:{items:PickItem[];assignedItems:AssignedPickItem[];history:OrderHistoryItem[];actor:Actor;users:UserRole[];canReassign:boolean;onReassignOrder:(pickIds:string[],assigneeId:string)=>Promise<boolean|undefined>;onCompletePicking:(pickIds:string[])=>Promise<boolean|undefined>;onAssignDelivery:(pickIds:string[],assigneeId:string)=>Promise<boolean|undefined>;onCompleteDelivery:(pickIds:string[])=>Promise<boolean|undefined>;onReopenDelivered:(pickIds:string[])=>Promise<boolean|undefined>;onExportHistory:(month:string)=>void;onToggle:(p:PickItem)=>void;onPickedQuantity:(p:PickItem,quantity:number)=>void;onViewProduct:(product:Product)=>void}) {
  const [tab,setTab]=useState<"unpicked"|"working"|"completed"|"delivered">("unpicked"),[orderDate,setOrderDate]=useState("");
  const dateMatches=(item:PickItem)=>!orderDate||orderDateKey(item.orderDate||item.createdAt)===orderDate;
  const orderGroups=groupOrderItems(assignedItems.filter(dateMatches)),flatten=(groups:AssignedPickItem[][])=>groups.flat();
  const unpickedGroups=orderGroups.filter((group)=>group.every((item)=>pickWorkflowStatus(item)==="unassigned")),workingGroups=orderGroups.filter((group)=>group.every((item)=>pickWorkflowStatus(item)==="picking")),completedGroups=orderGroups.filter((group)=>group.every((item)=>pickWorkflowStatus(item)==="ready_delivery"));
  const unpickedItems=flatten(unpickedGroups),workingItems=flatten(workingGroups),completedItems=flatten(completedGroups),visibleHistory=history.filter(dateMatches),deliveredOrderCount=new Set(visibleHistory.map(orderGroupKey)).size;
  const panels=tab==="delivered"?{items:[],history:visibleHistory}:{items:tab==="unpicked"?unpickedItems:tab==="completed"?completedItems:workingItems,history:[]};
  const panelTitle=tab==="unpicked"?"ĐƠN CHƯA SOẠN":tab==="working"?"ĐƠN ĐANG SOẠN":"ĐƠN ĐÃ SOẠN XONG",editablePickIds=new Set(items.filter((item)=>workingGroups.some((group)=>orderGroupKey(group[0])===orderGroupKey(item))).map((item)=>item.pickId));
  return <div className={`order-tab-shell order-tab-${tab}`}><nav className="order-tabs" aria-label="Trạng thái đơn hàng"><button type="button" className={tab==="unpicked"?"active":""} onClick={()=>setTab("unpicked")} aria-pressed={tab==="unpicked"}><span>Chưa soạn</span><b>{unpickedGroups.length}</b></button><button type="button" className={tab==="working"?"active":""} onClick={()=>setTab("working")} aria-pressed={tab==="working"}><span>Đang soạn</span><b>{workingGroups.length}</b></button><button type="button" className={tab==="completed"?"active":""} onClick={()=>setTab("completed")} aria-pressed={tab==="completed"}><span>Đã soạn xong</span><b>{completedGroups.length}</b></button><button type="button" className={tab==="delivered"?"active":""} onClick={()=>setTab("delivered")} aria-pressed={tab==="delivered"}><span>Đã giao</span><b>{deliveredOrderCount}</b></button></nav><div className="order-date-toolbar"><label>Ngày xem đơn<input type="date" value={orderDate} onChange={(event)=>setOrderDate(event.target.value)}/></label>{orderDate&&<button type="button" className="ghost" onClick={()=>setOrderDate("")}>Xem tất cả ngày</button>}<span>{orderDate?`Đang lọc: ${orderDateLabel(orderDate)}`:"Đang xem tất cả ngày"}</span></div><div className="order-tab-content"><AssignedOrdersView items={panels.items} history={panels.history} actor={actor} users={users} canReassign={canReassign} onReassignOrder={onReassignOrder} onCompletePicking={onCompletePicking} onAssignDelivery={onAssignDelivery} onCompleteDelivery={onCompleteDelivery} onReopenDelivered={onReopenDelivered} assignedTitle={panelTitle} historyTitle="ĐƠN ĐÃ GIAO" onExportHistory={onExportHistory} onToggle={tab==="working"?onToggle:undefined} onPickedQuantity={tab==="working"?onPickedQuantity:undefined} editablePickIds={editablePickIds} onViewProduct={onViewProduct} hideHistoryDate/></div></div>;
}
function AssignedOrdersView({items,history,actor,users,canReassign,onReassignOrder,onCompletePicking,onAssignDelivery,onCompleteDelivery,onReopenDelivered,assignedTitle="ĐƠN ĐÃ GIAO THEO KHÁCH HÀNG",historyTitle="LỊCH SỬ ĐƠN HÀNG",onExportHistory,onToggle,onPickedQuantity,editablePickIds,onViewProduct,hideHistoryDate}:{items:AssignedPickItem[];history:OrderHistoryItem[];actor?:Actor;users?:UserRole[];canReassign?:boolean;onReassignOrder?:(pickIds:string[],assigneeId:string)=>Promise<boolean|undefined>;onCompletePicking?:(pickIds:string[])=>Promise<boolean|undefined>;onAssignDelivery?:(pickIds:string[],assigneeId:string)=>Promise<boolean|undefined>;onCompleteDelivery?:(pickIds:string[])=>Promise<boolean|undefined>;onReopenDelivered?:(pickIds:string[])=>Promise<boolean|undefined>;assignedTitle?:string;historyTitle?:string;onExportHistory:(month:string)=>void;onToggle?:(item:PickItem)=>void;onPickedQuantity?:(item:PickItem,quantity:number)=>void;editablePickIds?:Set<string>;onViewProduct?:(product:Product)=>void;hideHistoryDate?:boolean}) {
  const [historyDate,setHistoryDate]=useState(""),[historyCustomer,setHistoryCustomer]=useState(""),[exportMonth,setExportMonth]=useState(defaultOrderMonth),[selectedGroup,setSelectedGroup]=useState<{key:string;orders:PickItem[];historyMode:boolean}|null>(null),[contextGroup,setContextGroup]=useState<{orders:PickItem[];x:number;y:number;kind:"picker"|"delivery"|"reopen"}|null>(null),[reassigning,setReassigning]=useState(false);
  useEffect(()=>{if(!contextGroup)return;const close=()=>setContextGroup(null);window.addEventListener("click",close);return()=>window.removeEventListener("click",close);},[contextGroup]);
  const groupItems=<T extends PickItem>(rows:T[])=>{const grouped=new Map<string,T[]>();for(const item of rows){const key=orderGroupKey(item),name=(item.customerName||"Chưa đặt tên khách").trim().replace(/\s+/g," ");grouped.set(key,[...(grouped.get(key)||[]),{...item,customerName:name}]);}return grouped;};
  const assignedGroups=groupItems(items),historyGroups=groupItems(history.filter((item)=>{const matchesDate=hideHistoryDate||!historyDate||orderDateKey(item.orderDate||item.completedAt)===historyDate,needle=normalize(historyCustomer),matchesCustomer=!needle||normalize(`${item.customerName||""} ${item.customerPhone||""}`).includes(needle);return matchesDate&&matchesCustomer;}));
  const renderGroup=(key:string,orders:PickItem[],historyMode=false)=>{const totalQuantity=orders.reduce((sum,item)=>sum+item.quantity,0),pickedQuantity=orders.reduce((sum,item)=>sum+pickedQuantityFor(item),0),first=orders[0],date=orderDateKey(first.orderDate||((first as OrderHistoryItem).completedAt)),groupId=(historyMode?"history|":"assigned|")+key,status=pickWorkflowStatus(first),statusLabel=historyMode?"Đã giao":status==="unassigned"?"Chờ phân công":status==="ready_delivery"?"Chờ gán tài xế":pickedQuantity+"/"+totalQuantity+" đã lấy";return <article key={groupId} className="customer-order-group" onContextMenu={(event)=>{const kind=historyMode?"reopen":status==="ready_delivery"?"delivery":"picker";if((kind==="reopen"&&actor?.role==="ADMIN")||(kind==="delivery"&&canReassign)||(kind==="picker"&&canReassign)){event.preventDefault();setContextGroup({orders,x:event.clientX,y:event.clientY,kind});}}}><button type="button" className="customer-order-header" onClick={()=>setSelectedGroup({key,orders,historyMode})} aria-label={`Xem chi tiết đơn của ${first.customerName||"khách hàng"}`}><span><b>Khách: {first.customerName||"Chưa đặt tên"}</b>{first.customerPhone&&<small>☎ {first.customerPhone}</small>}<small>{orderDateLabel(date)}</small>{first.assigneeName&&first.assigneeName!=="Chưa phân công"&&<small>🧺 Soạn: {first.assigneeName}</small>}{first.deliveryTimeSlot&&<small>🕘 {first.deliveryTimeSlot}</small>}{first.deliveryAssigneeName&&first.deliveryAssigneeName!=="Chưa phân công"&&<small>🚚 Giao: {first.deliveryAssigneeName}</small>}</span><strong>{totalQuantity} mặt hàng · {statusLabel}<i>›</i></strong></button></article>;};
  const selectedFirst=selectedGroup?.orders[0],selectedDate=selectedFirst?orderDateKey(selectedFirst.orderDate||((selectedFirst as OrderHistoryItem).completedAt)):"",selectedStatus=selectedFirst?pickWorkflowStatus(selectedFirst):"unassigned";
  const staffUsers=users||[],pickerUsers=staffUsers.filter((user)=>user.workType!=="DELIVERY"),deliveryUsers=staffUsers.filter((user)=>user.workType==="DELIVERY"||user.workType==="BOTH");
  const handlePickerReassign=async(assigneeId:string)=>{if(!contextGroup||contextGroup.kind!=="picker"||reassigning||!onReassignOrder)return;setReassigning(true);const ok=await onReassignOrder(contextGroup.orders.map((item)=>item.pickId),assigneeId);setReassigning(false);if(ok)setContextGroup(null);};
  const handleDeliveryAssign=async(assigneeId:string)=>{if(!contextGroup||contextGroup.kind!=="delivery"||reassigning||!onAssignDelivery)return;setReassigning(true);const ok=await onAssignDelivery(contextGroup.orders.map((item)=>item.pickId),assigneeId);setReassigning(false);if(ok)setContextGroup(null);};
  const handleCompletePicking=async()=>{if(!selectedGroup||selectedGroup.historyMode||!onCompletePicking||reassigning)return;setReassigning(true);const ok=await onCompletePicking(selectedGroup.orders.map((item)=>item.pickId));setReassigning(false);if(ok)setSelectedGroup(null);};
  const handleCompleteDelivery=async()=>{if(!selectedGroup||selectedGroup.historyMode||!onCompleteDelivery||reassigning)return;setReassigning(true);const ok=await onCompleteDelivery(selectedGroup.orders.map((item)=>item.pickId));setReassigning(false);if(ok)setSelectedGroup(null);};
  const handleReopen=async()=>{if(!contextGroup||contextGroup.kind!=="reopen"||reassigning||!onReopenDelivered)return;setReassigning(true);const ok=await onReopenDelivered(contextGroup.orders.map((item)=>item.pickId));setReassigning(false);if(ok)setContextGroup(null);};
  const selectedAllPicked=Boolean(selectedGroup?.orders.length&&selectedGroup.orders.every((item)=>pickedQuantityFor(item)>=item.quantity));
  const canCompletePicking=Boolean(selectedGroup&&!selectedGroup.historyMode&&selectedStatus==="picking"&&selectedAllPicked&&onCompletePicking&&(actor?.role==="ADMIN"||selectedGroup.orders.every((item)=>item.assigneeId===actor?.userId)));
  const canCompleteDelivery=Boolean(selectedGroup&&!selectedGroup.historyMode&&selectedStatus==="ready_delivery"&&onCompleteDelivery&&(actor?.role==="ADMIN"||((actor?.workType==="DELIVERY"||actor?.workType==="BOTH")&&selectedGroup.orders.every((item)=>item.deliveryAssigneeId===actor?.userId))));
  const menuLeft=contextGroup&&typeof window!=="undefined"?Math.min(contextGroup.x,Math.max(8,window.innerWidth-260)):8,menuTop=contextGroup&&typeof window!=="undefined"?Math.min(contextGroup.y,Math.max(8,window.innerHeight-340)):8;
  return <>
    <section className="assigned-orders"><div className="panel-title"><h2>{assignedTitle}</h2><span>{assignedGroups.size} khách/ngày · {items.length} mặt hàng</span></div>{[...assignedGroups.entries()].map(([key,orders])=>renderGroup(key,orders))}{!items.length&&<div className="empty"><b>Chưa có đơn phù hợp.</b><span>Các sản phẩm cùng số điện thoại sẽ được gom chung một đơn trong cùng ngày.</span></div>}</section>
    <section className="order-history-panel"><div className="panel-title"><h2>{historyTitle}</h2><span>{historyGroups.size} khách/ngày · {history.length} mặt hàng</span></div><div className="order-history-toolbar"><label>Tìm khách hàng<input type="search" value={historyCustomer} onChange={(event)=>setHistoryCustomer(event.target.value)} placeholder="Tên hoặc số điện thoại"/></label><label>Chọn ngày xem lại<input type="date" value={historyDate} onChange={(event)=>setHistoryDate(event.target.value)}/></label><label>Tháng lưu Excel<input type="month" value={exportMonth} onChange={(event)=>setExportMonth(event.target.value)}/></label><button type="button" className="primary" disabled={!exportMonth} onClick={()=>onExportHistory(exportMonth)}>↓ Xuất Excel</button><button type="button" className="ghost" disabled={!historyDate&&!historyCustomer} onClick={()=>{setHistoryDate("");setHistoryCustomer("")}}>Tất cả</button></div>{historyGroups.size?[...historyGroups.entries()].map(([key,orders])=>renderGroup(key,orders,true)):<div className="empty"><b>{historyDate||historyCustomer?"Không có đơn phù hợp":"Chưa có lịch sử đơn hàng"}</b><span>Đơn cùng số điện thoại được lưu chung theo từng ngày.</span></div>}</section>
    {selectedGroup&&selectedFirst&&<div className="modal-backdrop order-detail-backdrop"><section className="order-detail-modal" role="dialog" aria-modal="true" aria-label="Chi tiết đơn hàng"><div className="modal-head"><div><p>{selectedGroup.historyMode?"LỊCH SỬ ĐƠN HÀNG":assignedTitle}</p><h2>{selectedFirst.customerName||"Chưa đặt tên khách"}</h2></div><button type="button" onClick={()=>setSelectedGroup(null)} aria-label="Đóng">×</button></div><div className="order-detail-meta"><span><small>Số điện thoại</small><b>{selectedFirst.customerPhone||"—"}</b></span><span><small>Ngày đơn</small><b>{orderDateLabel(selectedDate)}</b></span><span><small>Tổng mặt hàng</small><b>{selectedGroup.orders.reduce((sum,item)=>sum+item.quantity,0)}</b></span><span><small>Trạng thái</small><b>{selectedGroup.historyMode?"Đã giao":selectedStatus==="unassigned"?"Chờ phân công":selectedStatus==="ready_delivery"?"Chờ gán tài xế":`${selectedGroup.orders.reduce((sum,item)=>sum+pickedQuantityFor(item),0)}/${selectedGroup.orders.reduce((sum,item)=>sum+item.quantity,0)} đã lấy`}</b></span></div><div className="order-detail-items"><div className="order-detail-items-head"><b>Danh sách hàng trong đơn</b><span>{selectedGroup.orders.length} dòng sản phẩm</span></div>{selectedGroup.orders.map((item,index)=>{const imageUrl=productImageUrl(item.imageUrl),pickedQuantity=pickedQuantityFor(item);return <article key={item.pickId}><em>{index+1}</em>{onViewProduct?<button type="button" className="order-product-image" onClick={()=>onViewProduct(item)} aria-label={`Xem chi tiết ${item.name}`}>{imageUrl?<img src={imageUrl} loading="lazy" decoding="async" alt=""/>:<span>Chưa có ảnh</span>}</button>:null}<div><button type="button" className="order-product-name" onClick={()=>onViewProduct?.(item)}><b>{item.name}</b></button><small>SKU {item.sku} · SL khách đặt {item.quantity} · Đã lấy {pickedQuantity}{item.barcode||item.supplierBarcode?` · Barcode ${item.barcode||item.supplierBarcode}`:""}</small><small>{selectedGroup.historyMode?`Hoàn tất bởi: ${(item as OrderHistoryItem).completedBy||"—"}`:`Nhân viên soạn: ${(item as AssignedPickItem).assigneeName||"Chưa phân công"}`}{item.deliveryAssigneeName?` · Giao hàng: ${item.deliveryAssigneeName}`:""}{item.deliveryTimeSlot?` · ${item.deliveryTimeSlot}`:""}{item.note?` · ${item.note}`:""}</small></div><aside><strong>{item.shelfLine?`POG ${item.shelfLine}${item.shelfSide} · ${item.shelfPosition}`:"Chưa gán POG"}</strong>{!selectedGroup.historyMode&&onToggle&&editablePickIds?.has(item.pickId)&&<><div className="picked-quantity-editor" aria-label={`Số lượng đã lấy của ${item.name}`}><button type="button" disabled={pickedQuantity<=0} onClick={()=>onPickedQuantity?.(item,pickedQuantity-1)}>−</button><b>{pickedQuantity}/{item.quantity}</b><button type="button" disabled={pickedQuantity>=item.quantity} onClick={()=>onPickedQuantity?.(item,pickedQuantity+1)}>+</button></div><button type="button" className={pickedQuantity>=item.quantity?"order-picked-toggle done":"order-picked-toggle"} onClick={()=>onToggle(item)}>{pickedQuantity>=item.quantity?"✓ Đã lấy":"Đánh dấu đã lấy"}</button></>}</aside></article>;})}</div><div className="modal-actions">{canCompletePicking&&<button type="button" className="primary" disabled={reassigning} onClick={()=>void handleCompletePicking()}>Hoàn tất soạn hàng</button>}{canCompleteDelivery&&<button type="button" className="primary" disabled={reassigning} onClick={()=>void handleCompleteDelivery()}>Hoàn tất giao hàng</button>}{selectedGroup.historyMode&&actor?.role==="ADMIN"&&onReopenDelivered&&<button type="button" className="ghost" disabled={reassigning} onClick={()=>{setContextGroup({orders:selectedGroup.orders,x:window.innerWidth/2,y:window.innerHeight/2,kind:"reopen"});setSelectedGroup(null);}}>Mở lại chỉnh sửa</button>}<button type="button" className="primary" onClick={()=>setSelectedGroup(null)}>Đóng chi tiết</button></div></section></div>}
    {contextGroup&&<div className="order-reassign-menu" style={{left:menuLeft,top:menuTop}} role="menu" tabIndex={-1} aria-label="Thao tác đơn hàng" onClick={(event)=>event.stopPropagation()} onKeyDown={(event)=>event.stopPropagation()}><b>{contextGroup.kind==="picker"?"Gán nhân viên soạn hàng":contextGroup.kind==="delivery"?"Gán tài xế giao hàng":"Chỉnh sửa đơn đã giao"}</b>{contextGroup.kind==="reopen"?<button type="button" role="menuitem" disabled={reassigning} onClick={()=>void handleReopen()}>Mở lại để chỉnh sửa</button>:((contextGroup.kind==="picker"?pickerUsers:deliveryUsers).length?(contextGroup.kind==="picker"?pickerUsers:deliveryUsers).map((user)=><button type="button" role="menuitem" key={user.userId} disabled={reassigning} onClick={()=>void (contextGroup.kind==="picker"?handlePickerReassign(user.userId):handleDeliveryAssign(user.userId))}>{user.name}<small>@{user.username}</small></button>):<span>{contextGroup.kind==="picker"?"Chưa có nhân viên soạn hàng hoạt động":"Chưa có tài xế giao hàng hoạt động"}</span>)}</div>}
  </>;
}
function SuggestView({value,onValue,onGenerate,result,busy,error,totalProducts,onMap,onPick}:{value:string;onValue:(v:string)=>void;onGenerate:()=>void;result:AiSuggestionResult|null;busy:boolean;error:string;totalProducts:number;onMap:(item:AiSuggestion)=>void;onPick:(item:AiSuggestion)=>void}) {
  const examples=["Lẩu cho 4 người","BBQ cuối tuần","Bữa sáng nhanh","Tiệc sinh nhật"];
  return <div className="ai-page"><PageHead eyebrow="TRỢ LÝ AI" title="Gợi ý sản phẩm" subtitle="Nhập món ăn để AI đối chiếu toàn bộ Master Data và chọn nguyên liệu đang còn tồn." actions={<span className="ai-catalog-status"><i/>{totalProducts.toLocaleString("vi-VN")} SKU Master Data</span>}/>
    <section className="ai-query-card">
      <div className="ai-query-title"><span>AI</span><div><b>Bạn đang chuẩn bị gì?</b><small>Mô tả món ăn, sự kiện hoặc nhu cầu; hệ thống sẽ rà soát danh mục và chỉ đề xuất sản phẩm còn tồn trong Stock.</small></div></div>
      <div className="ai-query-box">
        <textarea rows={2} value={value} disabled={busy} onChange={(event)=>onValue(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();onGenerate();}}} placeholder="Ví dụ: Chuẩn bị lẩu cho 6 người, ưu tiên sản phẩm còn nhiều tồn…"/>
        <button disabled={busy||value.trim().length<2} onClick={onGenerate}>{busy?<><i className="mini-spinner"/>Đang phân tích…</>:<>✦ Phân tích</>}</button>
      </div>
      <div className="ai-examples"><span>Gợi ý nhanh</span>{examples.map((example)=><button key={example} disabled={busy} onClick={()=>onValue(example)}>{example}</button>)}</div>
    </section>

    <div className="ai-feedback" aria-live="polite" aria-busy={busy}>
      {busy&&<div className="ai-skeletons">{[0,1,2].map((item)=><article key={item}><i/><span/><span/><b/></article>)}</div>}
      {!busy&&error&&<section className="ai-error"><div><b>Chưa thể phân tích</b><span>{error}</span></div><button onClick={onGenerate}>Thử lại</button></section>}
      {!busy&&!error&&result&&<section className="ai-summary"><span className={"ai-source "+result.mode}>{result.mode==="ai"?"AI · OpenAI":"Phân tích nội bộ"}</span><div><b>{result.summary}</b>{result.notice&&<small>{result.notice}</small>}</div></section>}
      {!busy&&!error&&result&&result.items.length>0&&<div className="ai-results">{result.items.map((item,index)=><article key={item.productId}>
        <header><span>{String(index+1).padStart(2,"0")}</span><div><small>SKU {item.sku}</small><h2>{item.name}</h2></div><StockBadge stock={item.stock}/></header>
        <p>{item.reason}</p>
        <div className="ai-product-meta"><span>{money.format(item.price)} đ</span><span>SL đề xuất: {item.quantity}</span><span>Vị trí chỉ hiển thị khi SKU đã gán POG</span></div>
        <footer><button className="ai-secondary" onClick={()=>onMap(item)}>Xem vị trí</button><button className="ai-primary" disabled={item.stock===0} onClick={()=>onPick(item)}>+ Thêm vào đơn</button></footer>
      </article>)}</div>}
      {!busy&&!error&&result&&!result.items.length&&<div className="ai-empty"><b>Chưa tìm thấy sản phẩm phù hợp đang còn tồn</b><span>Hãy thử mô tả rộng hơn hoặc chọn một gợi ý nhanh phía trên.</span></div>}
      {!busy&&!error&&!result&&<div className="ai-empty"><span className="ai-empty-mark">✦</span><b>AI chỉ đề xuất từ hàng hóa đang có</b><span>Không tạo tên sản phẩm, giá hoặc vị trí ngoài danh sách cửa hàng.</span></div>}
    </div>
  </div>;
}
function ProductModal({value,onChange,onClose,onUploadCloudinary,onSave}:{value:Product;onChange:(p:Product)=>void;onClose:()=>void;onUploadCloudinary:(file:File,sku:string)=>Promise<string>;onSave:()=>void}) {
  const imageRef=useRef<HTMLInputElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),streamRef=useRef<MediaStream|null>(null);
  const [cameraOpen,setCameraOpen]=useState(false),[cameraBusy,setCameraBusy]=useState(false),[cameraError,setCameraError]=useState("");
  const set=(key:keyof Product,next:string|number)=>onChange({...value,[key]:next});
  const setSupplierBarcode=(next:string)=>onChange({...value,supplierBarcode:next});
  const selectImage=(file?:File)=>{if(!file)return;if(file.size>1024*1024){window.alert("Ảnh sản phẩm tối đa 1 MB.");return;}if(file.type&&!file.type.startsWith("image/")){window.alert("Vui lòng chọn tệp hình ảnh.");return;}const reader=new FileReader();reader.onload=()=>{if(typeof reader.result==="string")onChange({...value,imageUrl:reader.result});};reader.onerror=()=>window.alert("Không thể đọc tệp hình ảnh.");reader.readAsDataURL(file);};
  useEffect(()=>()=>{streamRef.current?.getTracks().forEach((track)=>track.stop());},[]);
  useEffect(()=>{if(cameraOpen&&videoRef.current&&streamRef.current){videoRef.current.srcObject=streamRef.current;void videoRef.current.play().catch(()=>undefined);}},[cameraOpen]);
  const stopCamera=()=>{streamRef.current?.getTracks().forEach((track)=>track.stop());streamRef.current=null;if(videoRef.current)videoRef.current.srcObject=null;setCameraOpen(false);setCameraError("");};
  const startCamera=async()=>{setCameraError("");if(!navigator.mediaDevices?.getUserMedia){setCameraError("Trình duyệt không hỗ trợ camera. Hãy dùng HTTPS/localhost hoặc chọn ảnh từ máy.");return;}try{streamRef.current=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:1280}}});setCameraOpen(true);}catch(cause){const error=cause as DOMException;setCameraError(error?.name==="NotAllowedError"?"Bạn chưa cấp quyền camera cho trình duyệt.":"Không thể mở camera. Hãy kiểm tra quyền truy cập hoặc chọn ảnh từ máy.");}};
  const captureCamera=async()=>{const video=videoRef.current,canvas=canvasRef.current;if(!video||!canvas||!video.videoWidth||!video.videoHeight||cameraBusy)return;const scale=Math.min(1,1600/video.videoWidth,1600/video.videoHeight);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));const context=canvas.getContext("2d");if(!context){setCameraError("Không thể xử lý ảnh từ camera.");return;}context.drawImage(video,0,0,canvas.width,canvas.height);const blob=await new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,"image/jpeg",.84));if(!blob){setCameraError("Không thể tạo ảnh chụp.");return;}setCameraBusy(true);setCameraError("");try{const file=new File([blob],`${value.sku||"product"}-${Date.now()}.jpg`,{type:"image/jpeg"}),url=await onUploadCloudinary(file,value.sku),images=[...new Set([...productImageUrls(value.imageUrl),url])].slice(0,32).join("|");onChange({...value,imageUrl:images});stopCamera();}catch(cause){setCameraError(cause instanceof Error?cause.message:"Không thể tải ảnh lên Cloudinary");}finally{setCameraBusy(false);}};
  return <div className="modal-backdrop"><section className="form-modal product-modal"><div className="modal-head"><div><p>MASTER DATA</p><h2>{value.id?"Chỉnh sửa sản phẩm":"Thêm sản phẩm"}</h2></div><button onClick={onClose}>×</button></div><div className="form-grid">
    <h3 className="form-section-title">Thông tin Master Data</h3>
    <label>SKU<input value={value.sku} onChange={(e)=>set("sku",e.target.value)}/></label><label>BARCODE NCC<input value={value.supplierBarcode||""} onChange={(e)=>setSupplierBarcode(e.target.value)}/></label><label>BARCODE AEON<input value={value.barcode||""} onChange={(e)=>set("barcode",e.target.value)}/></label>
    <label className="wide">TÊN SẢN PHẨM<input value={value.name} onChange={(e)=>set("name",e.target.value)}/></label>
    <label>Division<input value={value.division||""} onChange={(e)=>set("division",e.target.value)}/></label><label>DIVISION NAME<input value={value.divisionName||""} onChange={(e)=>set("divisionName",e.target.value)}/></label>
    <label>Department<input value={value.department||""} onChange={(e)=>set("department",e.target.value)}/></label><label>DEPARTMENT NAME<input value={value.departmentName||""} onChange={(e)=>set("departmentName",e.target.value)}/></label>
    <label>Giá bán retail<input type="number" min="0" value={value.price} onChange={(e)=>set("price",Number(e.target.value))}/></label><label>Giá khuyến mãi<input type="number" min="0" value={value.promoPrice||0} onChange={(e)=>set("promoPrice",Number(e.target.value))}/></label><label>Sale<input type="number" min="0" value={value.sales||0} onChange={(e)=>set("sales",Number(e.target.value))}/></label><label className="wide">Link hình ảnh<input value={value.imageUrl||""} onChange={(e)=>set("imageUrl",e.target.value)} placeholder="https://.../mặt-trước.jpg | https://.../mặt-sau.jpg"/></label>
    <div className="product-image-tools wide"><button type="button" className="ghost" onClick={()=>imageRef.current?.click()}>↑ Chọn ảnh từ máy</button><button type="button" className="ghost" onClick={()=>void startCamera()}>▣ Chụp ảnh</button>{value.imageUrl&&<button type="button" className="ghost" onClick={()=>onChange({...value,imageUrl:""})}>Xóa ảnh</button>}<input ref={imageRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e)=>{selectImage(e.target.files?.[0]);if(imageRef.current)imageRef.current.value="";}}/><ProductImageCarousel key={`${value.id}:${value.imageUrl||""}`} value={value.imageUrl} alt={value.name||"Ảnh sản phẩm"} className="product-modal-image-preview"/>{cameraError&&<p className="camera-error" role="alert">{cameraError}</p>}{cameraOpen&&<div className="product-camera-panel"><video ref={videoRef} muted playsInline/><canvas ref={canvasRef} hidden/><div><button type="button" className="primary" disabled={cameraBusy} onClick={()=>void captureCamera()}>{cameraBusy?"Đang tải lên…":"Chụp & tải lên"}</button><button type="button" className="ghost" disabled={cameraBusy} onClick={stopCamera}>Hủy</button></div><small>Ảnh chụp sẽ tự tải lên Cloudinary và thêm vào danh sách ảnh của sản phẩm.</small></div>}</div>
    <p className="form-note wide">Cột IMAGE URL / LINK HÌNH ẢNH trong Excel được đọc tự động. Dùng dấu <b>|</b> để ngăn cách nhiều link ảnh; ảnh đầu tiên sẽ hiển thị mặc định. Bạn cũng có thể chọn tệp PNG, JPG, WEBP, GIF, SVG (tối đa 1 MB).</p>
  </div><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" onClick={onSave}>Lưu sản phẩm</button></div></section></div>;
}
function LineConfigModal({value,onChange,onClose,onSave,onUploadPog}:{value:LineConfig;onChange:(config:LineConfig)=>void;onClose:()=>void;onSave:()=>void;onUploadPog:(file:File|undefined,line:string,side:"A"|"B")=>void}) {
  const [side,setSide]=useState<"A"|"B">("A");const fileRef=useRef<HTMLInputElement>(null);
  return <div className="modal-backdrop"><section className="form-modal line-config-modal"><div className="modal-head"><div><p>THIẾT LẬP SƠ ĐỒ</p><h2>Line {value.line}</h2></div><button onClick={onClose}>×</button></div><div className="line-config-preview" style={{"--line":value.color} as React.CSSProperties}><b>{value.logo||value.name}</b><span>LINE {value.line}</span></div><div className="form-grid"><label className="wide">Tên hiển thị<input value={value.name} maxLength={48} onChange={(e)=>onChange({...value,name:e.target.value})} placeholder="Ví dụ: Tea Drinks"/></label><label>Màu Line<input type="color" value={value.color} onChange={(e)=>onChange({...value,color:e.target.value.toUpperCase()})}/></label><label>Mã màu<input value={value.color} maxLength={7} onChange={(e)=>onChange({...value,color:e.target.value.toUpperCase()})} placeholder="#DFB100"/></label><label className="wide">Logo / biểu tượng<input value={value.logo} maxLength={36} onChange={(e)=>onChange({...value,logo:e.target.value})} placeholder="Ví dụ: TOPVALU, ★, 🥛 (để trống để hiện tên Line)"/></label></div><p className="form-note">Logo hỗ trợ chữ ngắn hoặc emoji. Để trống logo nếu muốn hiển thị tên Line ở giữa kệ.</p><div className="pog-upload-inline"><b>Tải sơ đồ POG cho Line này</b><select value={side} onChange={(e)=>setSide(e.target.value as "A"|"B")}><option value="A">Mặt A</option><option value="B">Mặt B</option></select><button className="ghost" onClick={()=>fileRef.current?.click()}>Chọn PDF / ảnh</button><input ref={fileRef} hidden type="file" accept=".pdf,application/pdf,image/*" onChange={(e)=>{onUploadPog(e.target.files?.[0],value.line,side);if(fileRef.current)fileRef.current.value="";}}/></div><div className="modal-actions"><button className="ghost" onClick={onClose}>Hủy</button><button className="primary" onClick={onSave}>Lưu Line</button></div></section></div>;
}
function SettingsModal({actor,users,theme,appLogo,logoSizeDesktop,logoSizeMobile,uiPreferences,onSaveAppearance,onCreate,onUpdate,onPassword,onLogout,onClose}:{actor:Actor;users:UserRole[];theme:string;appLogo:string;logoSizeDesktop:number;logoSizeMobile:number;uiPreferences:UiPreferences;onSaveAppearance:(changes:{logo:string;logoSizeDesktop:number;logoSizeMobile:number;theme:string;uiPreferences:UiPreferences})=>Promise<boolean>;onCreate:(account:{name:string;username:string;password:string;role:Role;workType:WorkType})=>Promise<boolean>;onUpdate:(account:{userId:string;name?:string;role?:Role;workType?:WorkType;active?:boolean;password?:string})=>Promise<boolean>;onPassword:(currentPassword:string,newPassword:string)=>Promise<boolean>;onLogout:()=>Promise<void>;onClose:()=>void}) {
  const themes=[["aeon","AEON"],["aeon-soft","AEON sáng"],["graphite","Tương phản"]] as const;
  const [activeSection,setActiveSection]=useState<"appearance"|"account"|"users">("appearance");
  const [draft,setDraft]=useState<{name:string;username:string;password:string;role:Role;workType:WorkType}>({name:"",username:"",password:"",role:"STAFF",workType:"BOTH"});
  const [currentPassword,setCurrentPassword]=useState("");const [newPassword,setNewPassword]=useState("");
  const [draftLogo,setDraftLogo]=useState(appLogo),[draftLogoDesktop,setDraftLogoDesktop]=useState(logoSizeDesktop),[draftLogoMobile,setDraftLogoMobile]=useState(logoSizeMobile),[draftTheme,setDraftTheme]=useState(theme),[draftUi,setDraftUi]=useState<UiPreferences>(uiPreferences),[savingAppearance,setSavingAppearance]=useState(false);
  const create=async()=>{if(await onCreate({...draft,username:draft.username.trim().toLowerCase()}))setDraft({name:"",username:"",password:"",role:"STAFF",workType:"BOTH"});};
  const changePassword=async()=>{if(await onPassword(currentPassword,newPassword)){setCurrentPassword("");setNewPassword("");}};
  const resetPassword=(user:UserRole)=>{const password=window.prompt("Nhập mật khẩu mới cho "+user.name+" (tối thiểu 8 ký tự):");if(password!==null)void onUpdate({userId:user.userId,password});};
  const setLogoSize=(device:"desktop"|"mobile",next:number)=>{const min=device==="desktop"?50:72,max=device==="desktop"?320:220,value=Math.max(min,Math.min(max,Math.round(next/10)*10));if(device==="desktop")setDraftLogoDesktop(value);else setDraftLogoMobile(value);};
  const updateLogo=(file?:File)=>{if(!file)return;if(file.size>1024*1024){window.alert("Logo tối đa 1 MB.");return;}const reader=new FileReader();reader.onload=()=>setDraftLogo(String(reader.result));reader.readAsDataURL(file);};
  const appearanceDirty=draftLogo!==appLogo||draftLogoDesktop!==logoSizeDesktop||draftLogoMobile!==logoSizeMobile||draftTheme!==theme||JSON.stringify(draftUi)!==JSON.stringify(uiPreferences);
  const saveAppearance=async()=>{if(!appearanceDirty||savingAppearance)return;setSavingAppearance(true);try{await onSaveAppearance({logo:draftLogo,logoSizeDesktop:draftLogoDesktop,logoSizeMobile:draftLogoMobile,theme:draftTheme,uiPreferences:draftUi});}finally{setSavingAppearance(false);}};
  const resetAppearance=()=>{setDraftLogo(appLogo);setDraftLogoDesktop(logoSizeDesktop);setDraftLogoMobile(logoSizeMobile);setDraftTheme(theme);setDraftUi(uiPreferences);};
  return <div className="modal-backdrop settings-backdrop"><section className="settings-modal account-settings" role="dialog" aria-modal="true" aria-label="Cài đặt ứng dụng">
    <div className="modal-head settings-head"><div><p>CÀI ĐẶT ỨNG DỤNG</p><h2>Tùy chỉnh trải nghiệm</h2><span>Thay đổi chỉ có hiệu lực sau khi bấm Lưu.</span></div><button onClick={onClose} aria-label="Đóng cài đặt">×</button></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Nhóm cài đặt">
        <button className={activeSection==="appearance"?"active":""} onClick={()=>setActiveSection("appearance")}><span>◐</span><b>Giao diện</b><small>Màu sắc, logo, hiển thị</small></button>
        <button className={activeSection==="account"?"active":""} onClick={()=>setActiveSection("account")}><span>♙</span><b>Tài khoản</b><small>Mật khẩu và phiên đăng nhập</small></button>
        {actor.role==="ADMIN"&&<button className={activeSection==="users"?"active":""} onClick={()=>setActiveSection("users")}><span>♧</span><b>Phân quyền</b><small>Quản lý người dùng</small></button>}
      </nav>
      <div className="settings-content">
        {activeSection==="appearance"&&<>
          <section className="settings-section"><header><div><h3>Màu giao diện</h3><p>Chọn độ tương phản phù hợp với khu vực làm việc.</p></div><span className="settings-personal-tag">Cá nhân</span></header><div className="theme-row">{themes.map(([color,label])=><button key={color} className={draftTheme===color?"active":""} data-color={color} aria-pressed={draftTheme===color} onClick={()=>setDraftTheme(color)}><i/>{label}<small>{color==="aeon"?"Mặc định":color==="aeon-soft"?"Dịu mắt":"Rõ nét"}</small></button>)}</div></section>
          <section className="settings-section"><header><div><h3>Mật độ & khả năng đọc</h3><p>Tối ưu số lượng thông tin hiển thị trên màn hình.</p></div><span className="settings-personal-tag">Cá nhân</span></header><div className="settings-choice-grid"><div><b>Mật độ hiển thị</b><span>Khoảng cách giữa các nội dung</span><div className="settings-segment"><button className={draftUi.density==="comfortable"?"active":""} onClick={()=>setDraftUi({...draftUi,density:"comfortable"})}>Thoải mái</button><button className={draftUi.density==="compact"?"active":""} onClick={()=>setDraftUi({...draftUi,density:"compact"})}>Gọn</button></div></div><div><b>Cỡ chữ</b><span>Tăng độ rõ của nội dung chính</span><div className="settings-segment"><button className={draftUi.fontSize==="normal"?"active":""} onClick={()=>setDraftUi({...draftUi,fontSize:"normal"})}>Tiêu chuẩn</button><button className={draftUi.fontSize==="large"?"active":""} onClick={()=>setDraftUi({...draftUi,fontSize:"large"})}>Lớn</button></div></div></div><label className="settings-toggle" aria-label="Giảm hiệu ứng chuyển động"><div><b>Giảm hiệu ứng chuyển động</b><span>Tắt hiệu ứng rung, trượt và nhấp nháy để thao tác ổn định hơn.</span></div><input type="checkbox" checked={draftUi.reduceMotion} onChange={(event)=>setDraftUi({...draftUi,reduceMotion:event.target.checked})}/><i/></label></section>
          {actor.role==="ADMIN"&&<section className="settings-section"><header><div><h3>Nhận diện ứng dụng</h3><p>Logo dùng chung cho mọi tài khoản.</p></div><span className="settings-admin-tag">Admin</span></header><div className="app-logo-setting"><div className="app-logo-previews"><div className="app-logo-preview"><span>Desktop · {draftLogoDesktop}px</span><img style={{width:Math.min(320,draftLogoDesktop)+"px"}} src={draftLogo} alt="Logo Desktop"/></div><div className="app-logo-preview"><span>Mobile · {draftLogoMobile}px</span><img style={{width:Math.min(220,draftLogoMobile)+"px"}} src={draftLogo} alt="Logo Mobile"/></div></div><div className="logo-setting-actions"><label className="ghost">Chọn logo<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(event)=>updateLogo(event.target.files?.[0])}/></label><button className="ghost" onClick={()=>setDraftLogo("/aeon-logo.svg")}>Logo mặc định</button></div><div className="logo-size-control"><span>Desktop</span><input type="range" min="50" max="320" step="10" value={draftLogoDesktop} aria-label="Kích thước logo Desktop" onChange={(event)=>setLogoSize("desktop",Number(event.target.value))}/><b>{draftLogoDesktop}px</b></div><div className="logo-size-control"><span>Mobile</span><input type="range" min="72" max="220" step="10" value={draftLogoMobile} aria-label="Kích thước logo Mobile" onChange={(event)=>setLogoSize("mobile",Number(event.target.value))}/><b>{draftLogoMobile}px</b></div><small>Ảnh tối đa 1 MB. Nên dùng PNG/WebP nền trong suốt hoặc SVG.</small></div></section>}
        </>}
        {activeSection==="account"&&<section className="settings-section account-section"><header><div><h3>Tài khoản của tôi</h3><p>Kiểm tra quyền hiện tại và bảo vệ tài khoản.</p></div></header><div className="my-account"><span>{actor.name.slice(0,2).toUpperCase()}</span><div><b>{actor.name}</b><small>@{actor.username} · {actor.role}</small></div></div><div className="password-form"><label>Mật khẩu hiện tại<input type="password" value={currentPassword} autoComplete="current-password" onChange={(event)=>setCurrentPassword(event.target.value)}/></label><label>Mật khẩu mới<input type="password" value={newPassword} autoComplete="new-password" onChange={(event)=>setNewPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự"/></label><button disabled={!currentPassword||newPassword.length<8} onClick={()=>void changePassword()}>Đổi mật khẩu</button></div><button className="settings-logout danger-text" onClick={()=>void onLogout()}>Đăng xuất khỏi thiết bị này</button></section>}
        {activeSection==="users"&&actor.role==="ADMIN"&&<><section className="settings-section"><header><div><h3>Tạo tài khoản mới</h3><p>Cấp đúng quyền theo công việc của nhân viên.</p></div></header><div className="role-guide"><span><b>Staff</b>Quyền hệ thống + nghiệp vụ đã chọn</span><span><b>Manager</b>Sửa dữ liệu, nhập Excel</span><span><b>Admin</b>Toàn quyền hệ thống</span></div><div className="account-create"><label>Tên hiển thị<input value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})}/></label><label>Tên đăng nhập<input value={draft.username} autoCapitalize="none" onChange={(event)=>setDraft({...draft,username:event.target.value})}/></label><label>Mật khẩu tạm<input type="password" value={draft.password} onChange={(event)=>setDraft({...draft,password:event.target.value})}/></label><label>Phân quyền hệ thống<select value={draft.role} onChange={(event)=>setDraft({...draft,role:event.target.value as Role})}><option value="STAFF">Staff</option><option value="MANAGER">Manager</option><option value="ADMIN">Admin</option></select></label><label>Nghiệp vụ<select value={draft.workType} onChange={(event)=>setDraft({...draft,workType:event.target.value as WorkType})}><option value="PICKING">Soạn hàng</option><option value="DELIVERY">Giao hàng</option><option value="BOTH">Soạn hàng + giao hàng</option></select></label><button disabled={draft.name.trim().length<2||draft.username.trim().length<3||draft.password.length<8} onClick={()=>void create()}>+ Tạo tài khoản</button></div></section><section className="settings-section"><header><div><h3>Danh sách tài khoản</h3><p>{users.filter((user)=>user.active).length} đang hoạt động · {users.filter((user)=>!user.active).length} đã khóa</p></div></header><div className="user-list account-list">{users.map((user)=><article key={user.userId} className={user.active?"":"inactive"}><span>{user.name.slice(0,2).toUpperCase()}</span><div className="account-identity"><b>{user.name}</b><small>@{user.username} · {user.active?"Đang hoạt động":"Đã khóa"}</small></div><div className="account-controls">{user.userId===actor.userId?<em>{user.role} · {user.workType==="DELIVERY"?"Giao hàng":user.workType==="PICKING"?"Soạn hàng":"Cả hai"}</em>:<><select value={user.role} onChange={(event)=>void onUpdate({userId:user.userId,role:event.target.value as Role})}><option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="STAFF">Staff</option></select><select aria-label={"Nghiệp vụ "+user.name} value={user.workType||"BOTH"} onChange={(event)=>void onUpdate({userId:user.userId,workType:event.target.value as WorkType})}><option value="PICKING">Soạn hàng</option><option value="DELIVERY">Giao hàng</option><option value="BOTH">Cả hai</option></select><button onClick={()=>void onUpdate({userId:user.userId,active:!user.active})}>{user.active?"Khóa":"Mở"}</button><button onClick={()=>resetPassword(user)}>Mật khẩu</button></>}</div></article>)}</div></section></>}
      </div>
    </div>
    <div className="modal-actions settings-actions"><span className={appearanceDirty?"settings-save-note dirty":"settings-save-note"}>{appearanceDirty?"Có thay đổi chưa lưu":"Mọi thay đổi đã được lưu"}</span>{activeSection==="appearance"&&<button className="ghost" disabled={!appearanceDirty||savingAppearance} onClick={resetAppearance}>Hoàn tác</button>}<button className="ghost" onClick={onClose}>Đóng</button>{activeSection==="appearance"&&<button className="primary" disabled={!appearanceDirty||savingAppearance} onClick={()=>void saveAppearance()}>{savingAppearance?"Đang lưu…":"Lưu thay đổi"}</button>}</div>
  </section></div>;
}
function PogCanvas({file,modal,selected,positions,canUpload,onReanalyze,onUpload}:{file?:PogFile;modal:{line:string;side:"A"|"B"};selected?:Product;positions:PogPosition[];canUpload:boolean;onReanalyze:()=>void;onUpload:()=>void}) {
  const [zoom,setZoom]=useState(1);
  if(file?.shelfImage)return <><PogShelfImage file={file} selected={selected} positions={positions} zoom={zoom}/><div className="pog-zoom-controls" aria-label="Thu phóng ảnh POG"><button onClick={()=>setZoom((value)=>Math.max(.75,Number((value-.25).toFixed(2))))} aria-label="Thu nhỏ POG">−</button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom((value)=>Math.min(3,Number((value+.25).toFixed(2))))} aria-label="Phóng to POG">+</button><button className="zoom-reset" onClick={()=>setZoom(1)}>Vừa khung</button></div></>;
  if(file)return <div className="pog-empty-state pog-needs-standard"><span>POG {modal.line}{modal.side}</span><h3>POG này chưa được chuẩn hóa như Line 16A</h3><p>Hệ thống sẽ đọc bảng sản phẩm, crop sát viền, ghép ảnh và tạo vị trí khoanh theo quy trình mặc định.</p>{canUpload&&<button onClick={onReanalyze}>↻ Phân tích &amp; ghép theo chuẩn 16A</button>}</div>;
  return <div className="pog-empty-state"><span>POG {modal.line}{modal.side}</span><h3>Chưa có file POG cho mặt kệ này</h3><p>Tải PDF để tự crop, ghép nhiều file, liên kết SKU với stock và khoanh vị trí sản phẩm theo chuẩn Line 16A.</p>{canUpload&&<button onClick={onUpload}>↑ Tải POG PDF</button>}</div>;
}
function PogProductDetails({product,file,positions}:{product:Product;file?:PogFile;positions:PogPosition[]}) {
  // POG-only records can contain the identifiers only on the matched image
  // position. Keep those values visible even when Master Data is incomplete.
  const matchedPosition=positions[0];
  const sku=product.sku||matchedPosition?.sku||"—";
  const barcode=product.supplierBarcode||product.barcode||matchedPosition?.barcode||"—";
  const line=file?`${file.line}${file.side}`:product.shelfLine?`${product.shelfLine}${product.shelfSide||""}`:"—";
  const division=[product.divisionName,product.division].filter(Boolean).join(" · ")||"—";
  const department=[product.departmentName,product.department].filter(Boolean).join(" · ")||"—";
  const positionNumbers=positions.map((position)=>position.number).join(", ")||"—";
  const fields=[
    ["STT",positionNumbers],
    ["SKU",sku],
    ["Sale",money.format(product.sales??0)],
    ["Barcode NCC",product.supplierBarcode||"—"],
    ["Barcode AEON",product.barcode||barcode],
    ["Giá bán retail",money.format(product.price??0)+" đ"],
    ["Giá khuyến mãi",product.promoPrice?money.format(product.promoPrice)+" đ":"—"],
    ["Department",department],
    ["Division",division],
    ["Line",line],
    ["Thất thoát",money.format(product.loss||0)],
    ["Ngày HSD",product.expDate||"Chưa có"]
  ] as const;
  return <section className="pog-product-details" aria-live="polite"><header><div className="pog-product-summary"><ProductImageCarousel key={`${product.id}:${product.imageUrl||""}`} value={product.imageUrl} alt={product.name||"Ảnh sản phẩm"} className="pog-product-image"/><div><p>SẢN PHẨM ĐANG CHỌN</p><h3>{product.name||matchedPosition?.name||"Sản phẩm"}</h3></div></div><StockBadge stock={product.stock}/></header><dl><div className="pog-detail-stock"><dt>Tồn kho</dt><dd>{money.format(product.stock||0)}</dd></div>{fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd title={value}><span>{value}</span></dd></div>)}</dl></section>;
}
function PogModal({modal,setModal,products,total,file,search,setSearch,canUpload,uploading,uploadRef,onUpload,onAppend,onReanalyze,onPageChange,onPick,onClose}:{modal:{line:string;side:"A"|"B";selectedId?:string};setModal:(v:{line:string;side:"A"|"B";selectedId?:string})=>void;products:Product[];total:number;file?:PogFile;search:string;setSearch:(v:string)=>void;canUpload:boolean;uploading:boolean;uploadRef:React.RefObject<HTMLInputElement|null>;onUpload:(f?:File,mode?:PogAnalysisMode)=>void;onAppend:(f?:File,mode?:PogAnalysisMode)=>void;onReanalyze:(mode?:PogAnalysisMode)=>void;onPageChange:(page:number)=>void;onPick:(p:Product)=>void;onClose:()=>void}) {
  // Trên mobile, một kết quả tìm kiếm duy nhất được chọn ngay để thông tin
  // xuất hiện ở khu vực dưới POG mà không cần chạm thêm vào danh sách.
  const selected=products.find((p)=>p.id===modal.selectedId)||(search.trim()&&products.length===1?products[0]:undefined);
  const selectedKeys=new Set(selected?[selected.sku,selected.barcode,selected.supplierBarcode].map(normalize).filter(Boolean):[]);
  const linkedPositions=selected?file?.positions?.filter((position)=>isLinkedPogPosition(position)&&[position.sku,position.barcode].map(normalize).some((key)=>selectedKeys.has(key)))||[]:[];
  const positionsFor=(product:Product)=>{const keys=new Set([product.sku,product.barcode,product.supplierBarcode].map(normalize).filter(Boolean));return file?.positions?.filter((position)=>isLinkedPogPosition(position)&&[position.sku,position.barcode].map(normalize).some((key)=>keys.has(key)))||[];};
  const mobileProducts=search.trim()?products.slice(0,12):[];
  const [pdfPage,setPdfPage]=useState(file?.page||1),[searchExpanded,setSearchExpanded]=useState(false),[analysisMode,setAnalysisMode]=useState<PogAnalysisMode>("auto"),appendRef=useRef<HTMLInputElement>(null),fileCount=file?.sources?.length||1;
  const switchSide=(side:"A"|"B")=>{setSearch("");setPdfPage(1);setModal({line:modal.line,side})};
  return <div className="modal-backdrop pog-backdrop"><section className="pog-modal">{uploading&&<div className="pog-upload-overlay" role="status" aria-live="polite"><i className="mini-spinner"/><b>Đang upload POG…</b><span>Đang đọc danh sách sản phẩm và ghép ảnh kệ, vui lòng chờ.</span></div>}<div className="pog-head"><div><p>SƠ ĐỒ KỆ CHI TIẾT</p><h2>Line {modal.line} · {aisleNames[modal.line]||"Khu vực"}</h2></div><div className="side-switch"><button disabled={uploading} className={modal.side==="A"?"active":""} onClick={()=>switchSide("A")}>Mặt A</button><button disabled={uploading} className={modal.side==="B"?"active":""} onClick={()=>switchSide("B")}>Mặt B</button></div>{canUpload&&<label className="pog-analysis-picker" title="Chọn cách hiển thị ảnh POG; danh sách sản phẩm vẫn luôn được đọc từ toàn bộ PDF"><span>Hiển thị POG</span><select disabled={uploading||Boolean(file&&file.mimeType!=="application/pdf")} value={analysisMode} onChange={(event)=>setAnalysisMode(event.target.value as PogAnalysisMode)}><option value="auto">Tự động ghép tất cả trang</option><option value="page1">Chỉ hiển thị trang 1</option><option value="page2">Chỉ hiển thị trang 2</option></select></label>}{file?.mimeType==="application/pdf"&&!file.shelfImage&&<label className="pdf-page-picker">Trang sơ đồ<select disabled={uploading} value={pdfPage} onChange={(e)=>{const page=Number(e.target.value);setPdfPage(page);onPageChange(page)}}>{Array.from({length:12},(_,index)=><option key={index+1} value={index+1}>Trang {index+1}{index<2?" · thường dùng":""}</option>)}</select></label>}{file?.shelfImage&&<span className="pog-linked-count">Đã ghép {fileCount} file · {file.positions?.length||0} vị trí</span>}{canUpload&&file?.mimeType==="application/pdf"&&<button disabled={uploading} className="upload-pog reanalyze-pog" title="Tạo lại ảnh theo cách hiển thị đã chọn; danh sách sản phẩm vẫn đọc toàn bộ PDF" onClick={()=>onReanalyze(analysisMode)}>↻ {analysisMode==="auto"?"Ghép lại POG":"Đọc lại POG"}</button>}{canUpload&&file&&<button disabled={uploading} className="upload-pog add-pog" title="Giữ POG hiện có và ghép thêm một PDF" onClick={()=>appendRef.current?.click()}>＋ Thêm file POG</button>}{canUpload&&<button disabled={uploading} className="upload-pog" title="Thay toàn bộ POG bằng PDF hoặc ảnh mới" onClick={()=>uploadRef.current?.click()}>↑ {file?"Thay POG":"Tải POG PDF/ảnh"}</button>}<button disabled={uploading} className="close-pog" onClick={onClose}>×</button></div>
    <div className={`pog-body pog-canvas-layout${searchExpanded?" pog-search-expanded":""}${selected?" pog-has-product":""}`}>
      <aside className="pog-list"><label>⌕<input disabled={uploading} value={search} onChange={(e)=>setSearch(e.target.value)} onFocus={()=>setSearchExpanded(true)} onBlur={()=>window.setTimeout(()=>setSearchExpanded(false),160)} placeholder="Tìm SKU, barcode, tên…"/><b>{products.length}/{total} SP</b></label>{total>products.length&&<p className="pog-limit-note">Đang hiện 200 kết quả đầu · nhập SKU hoặc tên để tìm chính xác.</p>}<div>{products.map((p)=><button key={p.id} className={p.id===selected?.id?"active":""} onClick={()=>setModal({...modal,selectedId:p.id})}><span>{file?.shelfImage?`POG ${file.line}${file.side}`:"POG chưa chuẩn"}</span><div><small>SKU {p.sku}</small><b>{p.name}</b><em>{p.supplierBarcode||p.barcode}</em></div><StockBadge stock={p.stock}/></button>)}{!products.length&&<div className="empty big">{file?.shelfImage?(file?.positions?.length?"Chưa có sản phẩm liên kết trong Master Data.":"POG đã hiển thị ảnh kệ nhưng chưa đọc được bảng STT/SKU/barcode để liên kết sản phẩm."):"POG cần được phân tích và ghép trước khi liên kết sản phẩm."}</div>}</div>{selected&&<section className="pog-selected"><div><b>{file?.shelfImage?`POG Line ${file.line}${file.side}`:"Chưa chuẩn hóa POG"}</b><span>{selected.name}</span><small>{file?.shelfImage?(linkedPositions.length?`${linkedPositions.length} vị trí POG: ${linkedPositions.map((position)=>position.number).join(", ")}`:"Chưa tìm thấy STT trên ảnh POG")+" · ":""}Tồn {selected.stock} · Loss {selected.loss} · HSD {selected.expDate||"chưa có"}</small></div><button disabled={selected.stock===0||uploading} onClick={()=>onPick(selected)}>+ Thêm vào đơn</button></section>}</aside>
      <div className="pog-visual"><PogCanvas file={file} modal={modal} selected={selected} positions={linkedPositions} canUpload={canUpload} onReanalyze={()=>onReanalyze(analysisMode)} onUpload={()=>uploadRef.current?.click()}/>{selected&&<PogProductDetails product={selected} file={file} positions={linkedPositions}/>}<div className="pog-file-label">{file?file.fileName:`POG Line ${modal.line}${modal.side}`}</div></div>
      <section className="pog-mobile-results" aria-live="polite">
        <header><b>Thông tin sản phẩm</b><span>{search.trim()?(total?`${total} kết quả`:"Không tìm thấy"):"Chưa chọn"}</span></header>
        {selected?<PogProductDetails product={selected} file={file} positions={linkedPositions}/>:<div className="pog-mobile-empty">{search.trim()?"Không tìm thấy sản phẩm trong POG này.":"Tìm SKU, barcode hoặc tên để xem chi tiết sản phẩm tại đây."}</div>}
        {mobileProducts.length>1&&<div>{mobileProducts.map((product)=>{const matches=positionsFor(product);return <article key={product.id} className={product.id===selected?.id?"active":""}><div className="pog-mobile-product-head"><div><small>SKU {product.sku}</small><b>{product.name}</b></div><StockBadge stock={product.stock}/></div><div className="pog-mobile-product-meta"><span>Barcode {product.supplierBarcode||product.barcode||"—"}</span><span>Line {file?.line||product.shelfLine||"—"}{file?.side||product.shelfSide||""}</span><span>{matches.length?`Vị trí ${matches.map((position)=>position.number).join(", ")}`:"Chưa có STT trên POG"}</span></div><div className="pog-mobile-product-actions"><button className="ghost" onClick={()=>setModal({...modal,selectedId:product.id})}>Khoanh trên ảnh</button><button className="primary" disabled={product.stock===0} onClick={()=>onPick(product)}>+ Thêm vào đơn</button></div></article>})}</div>}
        {total>mobileProducts.length&&<small className="pog-mobile-more">Đang hiển thị {mobileProducts.length} kết quả đầu.</small>}
      </section>
    </div>
    <input ref={uploadRef} hidden type="file" accept=".pdf,application/pdf,image/*" onChange={(e)=>{onUpload(e.target.files?.[0],analysisMode);e.currentTarget.value="";}}/><input ref={appendRef} hidden type="file" accept=".pdf,application/pdf" onChange={(e)=>{onAppend(e.target.files?.[0],analysisMode);e.currentTarget.value="";}}/></section></div>;
}
function PogShelfImage({file,selected,positions,zoom=1}:{file:PogFile;selected?:Product;positions:PogPosition[];zoom?:number}) {
  const width=file.shelfWidth||1600,height=file.shelfHeight||720,markerOffset=Math.max(38,Math.min(width,height)*.035);
  return <svg className="pog-shelf-image" style={{width:`${Math.max(.75,zoom)*100}%`}} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={selected?`Vị trí ${selected.name} trên POG`:'Ảnh POG đã ghép'}><image href={`/api/pog?id=${encodeURIComponent(file.id)}&asset=shelf&v=${file.updatedAt}`} width={width} height={height}/>{positions.filter(isLinkedPogPosition).map((position,index)=><g key={`${position.number}-${index}`} className="pog-svg-marker" transform={`translate(${position.x*width+markerOffset} ${position.y*height})`}><circle className="pog-marker-pulse" r="224"/><circle className="pog-marker-ring" r="160"/></g>)}</svg>;
}
