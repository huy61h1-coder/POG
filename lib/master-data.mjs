export const MASTER_DATA_COLUMNS = [
  ["sku","SKU"],
  ["name","TÊN SẢN PHẨM"],
  ["division","Division"],
  ["divisionName","DIVISION NAME"],
  ["department","Department"],
  ["departmentName","DEPARTMENT"],
  ["supplierBarcode","SUPPLIER BARCODE"],
  ["line","Line"],
  ["lineName","LINE NAME"],
];

const requiredKeys=MASTER_DATA_COLUMNS.map(([key])=>key);
const labelsByKey=Object.fromEntries(MASTER_DATA_COLUMNS);

export function masterCellText(value) {
  if(value===null||value===undefined)return "";
  if(value instanceof Date)return value.toISOString().slice(0,10);
  return String(value).trim();
}

function headerKey(value) {
  return masterCellText(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
}

function mapHeaderRow(row) {
  const indexes={};
  row.forEach((value,index)=>{
    const key=headerKey(value);
    if(key==="SKU"||key==="ITEM CODE")indexes.sku??=index;
    if(key==="TEN SAN PHAM"||key==="PRODUCT NAME"||key==="ITEM NAME")indexes.name??=index;
    if(key==="DIVISION"||key==="DIVISION CODE")indexes.division??=index;
    if(key==="DIVISION NAME")indexes.divisionName??=index;
    if(key==="DEPARTMENT CODE"||key==="DEPT CODE")indexes.department??=index;
    if(key==="DEPARTMENT NAME"||key==="DEPT NAME")indexes.departmentName??=index;
    if(key==="DEPARTMENT"){
      if(indexes.department===undefined)indexes.department=index;
      else if(indexes.departmentName===undefined)indexes.departmentName=index;
    }
    if(key==="SUPPLIER BARCODE"||key==="SUPPLIER EAN")indexes.supplierBarcode??=index;
    if(key==="LINE"||key==="LINE CODE")indexes.line??=index;
    if(key==="LINE NAME")indexes.lineName??=index;
  });
  return indexes;
}

export function normalizeMasterLine(value) {
  const compact=masterCellText(value).replace(/^LINE\s*/i,"").trim();
  if(!/^\d{1,2}$/.test(compact))return "";
  const line=Number(compact);
  return line>=1&&line<=28?String(line).padStart(2,"0"):"";
}

export function parseMasterDataRows(sheetRows,{maxRows=500000}={}) {
  if(!Array.isArray(sheetRows)||!sheetRows.length)throw new Error("File Excel không có dữ liệu.");
  let best={rowIndex:0,indexes:{},score:0};
  for(let rowIndex=0;rowIndex<Math.min(20,sheetRows.length);rowIndex++){
    const indexes=mapHeaderRow(Array.isArray(sheetRows[rowIndex])?sheetRows[rowIndex]:[]);
    const score=requiredKeys.filter((key)=>indexes[key]!==undefined).length;
    if(score>best.score)best={rowIndex,indexes,score};
    if(score===requiredKeys.length)break;
  }
  const missing=requiredKeys.filter((key)=>best.indexes[key]===undefined).map((key)=>labelsByKey[key]);
  if(missing.length)throw new Error("Thiếu cột bắt buộc: "+missing.join(", ")+".");

  const dataRows=sheetRows.slice(best.rowIndex+1);
  if(dataRows.length>maxRows)throw new Error("File vượt quá "+maxRows.toLocaleString("vi-VN")+" dòng dữ liệu.");

  const bySku=new Map(),conflictingSkus=new Set(),issues=[];let skipped=0,duplicates=0;
  dataRows.forEach((source,offset)=>{
    const row=Array.isArray(source)?source:[];
    if(!row.some((cell)=>masterCellText(cell)))return;
    const record=Object.fromEntries(requiredKeys.map((key)=>[key,masterCellText(row[best.indexes[key]])]));
    const rowNumber=best.rowIndex+offset+2;
    if(headerKey(record.sku)==="SKU"&&headerKey(record.name)==="TEN SAN PHAM"){skipped++;return;}
    const normalizedLine=normalizeMasterLine(record.line);
    if(!record.sku||!record.name||!normalizedLine){
      skipped++;
      if(issues.length<20)issues.push({row:rowNumber,reason:!record.sku?"Thiếu SKU":!record.name?"Thiếu tên sản phẩm":"Line phải từ 01 đến 28"});
      return;
    }
    record.line=normalizedLine;
    const skuKey=record.sku.toUpperCase();
    if(conflictingSkus.has(skuKey)){
      duplicates++;skipped++;
      if(issues.length<20)issues.push({row:rowNumber,reason:"SKU trùng khác nội dung; bỏ qua"});
      return;
    }
    const previous=bySku.get(skuKey);
    if(previous){
      duplicates++;
      const same=requiredKeys.every((key)=>previous.record[key]===record[key]);
      if(same){
        skipped++;
        if(issues.length<20)issues.push({row:rowNumber,reason:"SKU trùng hoàn toàn; bỏ dòng lặp"});
      }else{
        skipped+=2;bySku.delete(skuKey);conflictingSkus.add(skuKey);
        if(issues.length<20)issues.push({row:rowNumber,reason:"SKU trùng khác nội dung; bỏ toàn bộ SKU này"});
      }
      return;
    }
    bySku.set(skuKey,{record,row:rowNumber});
  });
  const records=[...bySku.values()].map((entry)=>entry.record);
  if(!records.length)throw new Error("Không tìm thấy dòng Master Data hợp lệ.");
  return {records,headerRow:best.rowIndex+1,skipped,duplicates,issues};
}

export function normalizeMasterProduct(product,lineNameFallback="") {
  const supplierBarcode=masterCellText(product?.supplierBarcode)||masterCellText(product?.barcode);
  return {
    ...product,
    division:masterCellText(product?.division),
    divisionName:masterCellText(product?.divisionName),
    department:masterCellText(product?.department),
    departmentName:masterCellText(product?.departmentName),
    supplierBarcode,
    barcode:masterCellText(product?.barcode)||supplierBarcode,
    lineName:masterCellText(product?.lineName)||masterCellText(lineNameFallback),
  };
}

export function mergeMasterRecords(products,records,{createId,now=Date.now()}={}) {
  const result=Array.isArray(products)?products.map((product)=>({...product})):[];
  const indexBySku=new Map();
  result.forEach((product,index)=>{
    const key=masterCellText(product?.sku).toUpperCase();
    if(key&&!indexBySku.has(key))indexBySku.set(key,index);
  });
  let created=0,updated=0,unchanged=0;

  for(const source of Array.isArray(records)?records:[]){
    const sku=masterCellText(source?.sku),key=sku.toUpperCase();
    if(!key)continue;
    const master={
      sku,
      name:masterCellText(source?.name),
      division:masterCellText(source?.division),
      divisionName:masterCellText(source?.divisionName),
      department:masterCellText(source?.department),
      departmentName:masterCellText(source?.departmentName),
      supplierBarcode:masterCellText(source?.supplierBarcode),
      line:normalizeMasterLine(source?.line)||masterCellText(source?.line),
      lineName:masterCellText(source?.lineName),
    };
    const index=indexBySku.get(key);
    if(index===undefined){
      const id=typeof createId==="function"?createId():"master-"+key;
      indexBySku.set(key,result.length);
      result.push({...master,id,barcode:master.supplierBarcode,side:"A",bay:1,price:0,stock:0,loss:0,expDate:"",updatedAt:now});created++;
      continue;
    }
    const current=result[index];
    const changed=requiredKeys.some((field)=>masterCellText(current?.[field])!==master[field])||masterCellText(current?.barcode)!==master.supplierBarcode;
    if(!changed){unchanged++;continue;}
    result[index]={...current,...master,barcode:master.supplierBarcode,updatedAt:now};updated++;
  }
  return {products:result,created,updated,unchanged};
}
