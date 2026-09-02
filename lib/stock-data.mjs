import { masterCellText } from "./master-data.mjs";

export const STOCK_DATA_COLUMNS = [
  ["sku","SKU"],
  ["name","TÊN SẢN PHẨM"],
  ["sales","Sale"],
  ["stock","Stock"],
  ["division","Division"],
  ["divisionName","DIVISION NAME"],
  ["department","Department"],
  ["departmentName","DEPARTMENT NAME"],
];

function headerKey(value){return masterCellText(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();}
function stockNumber(value){const text=masterCellText(value).replace(/\s/g,"").replace(/,/g,"");const number=Number(text);return Number.isFinite(number)&&number>=0?Math.trunc(number):null;}

export function parseStockRows(sheetRows,{maxRows=500000,onProgress}={}){
  if(!Array.isArray(sheetRows)||!sheetRows.length)throw new Error("File Stock không có dữ liệu.");
  let header={row:0,sku:-1,name:-1,sales:-1,stock:-1,division:-1,divisionName:-1,department:-1,departmentName:-1};
  for(let rowIndex=0;rowIndex<Math.min(20,sheetRows.length);rowIndex++){
    const row=Array.isArray(sheetRows[rowIndex])?sheetRows[rowIndex]:[];let sku=-1,name=-1,stock=-1,sales=-1,division=-1,divisionName=-1,department=-1,departmentName=-1;
    row.forEach((value,index)=>{
      const key=headerKey(value);
      if(sku<0&&["SKU","ITEM CODE","MA SAN PHAM","PRODUCT CODE"].includes(key))sku=index;
      if(name<0&&["TEN SAN PHAM","PRODUCT NAME","ITEM NAME"].includes(key))name=index;
      if(stock<0&&["CLOSING STOCK","CLOSING INVENTORY","STOCK","STOCK QTY","TON KHO","TON","SO LUONG TON","ON HAND","INVENTORY","QTY","QUANTITY"].includes(key))stock=index;
      if(sales<0&&["SALE","SALES","SALE QTY","DOANH SO","SO LUONG BAN","SL BAN"].includes(key))sales=index;
      if(division<0&&["DIVISION","DIVISION CODE"].includes(key))division=index;
      if(divisionName<0&&key==="DIVISION NAME")divisionName=index;
      if(department<0&&["DEPARTMENT","DEPARTMENT CODE","DEPT CODE"].includes(key))department=index;
      if(departmentName<0&&["DEPARTMENT NAME","DEPT NAME"].includes(key))departmentName=index;
    });
    if(sku>=0&&stock>=0){header={row:rowIndex,sku,name,stock,sales,division,divisionName,department,departmentName};break;}
  }
  if(header.sku<0||header.stock<0)throw new Error("File Stock cần có SKU và Closing Stock (hoặc STOCK / TỒN KHO).");
  const rows=sheetRows.slice(header.row+1);if(rows.length>maxRows)throw new Error("File vượt quá "+maxRows.toLocaleString("vi-VN")+" dòng dữ liệu.");
  const bySku=new Map(),stockMetadataBySku=new Map(),issues=[];let skipped=0,duplicates=0;
  rows.forEach((source,offset)=>{
    if(typeof onProgress==="function"&&(offset===0||offset%5000===0))onProgress(offset,rows.length);
    const row=Array.isArray(source)?source:[];if(!row.some((cell)=>masterCellText(cell)))return;
    const sku=masterCellText(row[header.sku]),stock=stockNumber(row[header.stock]),sales=header.sales>=0?stockNumber(row[header.sales]):0,rowNumber=header.row+offset+2;
    if(!sku||stock===null){skipped++;if(issues.length<20)issues.push({row:rowNumber,reason:!sku?"Thiếu SKU":"Tồn kho phải là số không âm"});return;}
    const key=sku.toUpperCase();if(bySku.has(key))duplicates++;bySku.set(key,{sku,stock,sales:sales??0});
    const metadata={sku};
    for(const [field,index] of [["name",header.name],["division",header.division],["divisionName",header.divisionName],["department",header.department],["departmentName",header.departmentName]]){
      if(index>=0){const value=masterCellText(row[index]);if(value)metadata[field]=value;}
    }
    if(Object.keys(metadata).length>1)stockMetadataBySku.set(key,{...(stockMetadataBySku.get(key)||{}),...metadata});
  });
  const records=[...bySku.values()];if(typeof onProgress==="function")onProgress(rows.length,rows.length);if(!records.length)throw new Error("Không tìm thấy dòng Stock hợp lệ.");
  // Keep the historical records shape for callers that only need quantities,
  // while exposing the descriptive Stock columns for the import worker/API.
  return {records,stockMetadata:[...stockMetadataBySku.values()],headerRow:header.row+1,skipped,duplicates,issues};
}
