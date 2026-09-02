export const MASTER_DATA_COLUMNS = [
  ["sku","SKU"],
  ["name","TÊN SẢN PHẨM"],
  ["sales","Sale"],
  ["stock","Stock"],
  ["price","GIÁ BÁN RETAIL"],
  ["promoPrice","GIÁ KHUYẾN MÃI"],
  ["division","Division"],
  ["divisionName","DIVISION NAME"],
  ["department","Department"],
  ["departmentName","DEPARTMENT NAME"],
  ["supplierBarcode","BARCODE NCC"],
  ["barcode","BARCODE AEON"],
  ["imageUrl","IMAGE URL"],
  ["line","Line"],
  ["lineName","LINE NAME"],
];

// Line is assigned by POG. It remains supported for legacy files, but is not
// required in the new Master Data format (which is intentionally unassigned).
const requiredKeys=["sku","name","division","divisionName","department","departmentName","supplierBarcode"];
const optionalKeys=["sales","stock","price","promoPrice","barcode","line","lineName"];
const labelsByKey=Object.fromEntries(MASTER_DATA_COLUMNS);

const imageHeaders=["IMAGE URL","IMAGE LINK","LINK HINH ANH","LINK ANH","URL HINH ANH","PRODUCT IMAGE","IMAGE"];
const salesHeaders=["SALE","SALES","SALE QTY","DOANH SO","SO LUONG BAN","SL BAN"];
const stockHeaders=["STOCK","STOCK QTY","CLOSING STOCK","CLOSING INVENTORY","TON KHO","TON","SO LUONG TON","ON HAND","INVENTORY","QTY","QUANTITY"];
const retailPriceHeaders=["RETAIL PRICE","GI BAN RETAIL","GIA BAN RETAIL","PRICE","UNIT PRICE","RETAIL"];
const promoPriceHeaders=["PROMO PRICE","PROMOTION PRICE","GI KHUYEN MAI","GIA KHUYEN MAI","SALE PRICE","PROMO"];
const supplierBarcodeHeaders=["SUPPLIER BARCODE","SUPPLIER EAN","BARCODE NCC","BARCODE NHA CUNG CAP","BARCODE NHA CUNG CAP"];
const aeonBarcodeHeaders=["BARCODE AEON","AEON BARCODE","AEON EAN","BARCODE"];

export function masterCellText(value) {
  if(value===null||value===undefined)return "";
  if(value instanceof Date)return value.toISOString().slice(0,10);
  return String(value).trim();
}

function headerKey(value) {
  return masterCellText(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
}

function headerMatches(key,aliases) {
  const compact=key.replace(/\s+/g,"");
  return aliases.some((alias)=>alias===key||alias.replace(/\s+/g,"")===compact);
}

function mapHeaderRow(row) {
  const indexes={};
  row.forEach((value,index)=>{
    const key=headerKey(value);
    if(headerMatches(key,["SKU","ITEM CODE","MA SAN PHAM","PRODUCT CODE"]))indexes.sku??=index;
    if(headerMatches(key,["TEN SAN PHAM","PRODUCT NAME","ITEM NAME"]))indexes.name??=index;
    if(headerMatches(key,["DIVISION","DIVISION CODE"]))indexes.division??=index;
    if(headerMatches(key,["DIVISION NAME"]))indexes.divisionName??=index;
    if(headerMatches(key,["DEPARTMENT CODE","DEPT CODE"]))indexes.department??=index;
    if(headerMatches(key,["DEPARTMENT NAME","DEPT NAME"]))indexes.departmentName??=index;
    if(key==="DEPARTMENT"){
      if(indexes.department===undefined)indexes.department=index;
      else if(indexes.departmentName===undefined)indexes.departmentName=index;
    }
    if(headerMatches(key,supplierBarcodeHeaders))indexes.supplierBarcode??=index;
    if(headerMatches(key,aeonBarcodeHeaders))indexes.barcode??=index;
    if(headerMatches(key,["LINE","LINE CODE"]))indexes.line??=index;
    if(headerMatches(key,["LINE NAME"]))indexes.lineName??=index;
    if(headerMatches(key,salesHeaders))indexes.sales??=index;
    if(headerMatches(key,stockHeaders))indexes.stock??=index;
    if(headerMatches(key,retailPriceHeaders))indexes.price??=index;
    if(headerMatches(key,promoPriceHeaders))indexes.promoPrice??=index;
    if(headerMatches(key,imageHeaders))indexes.imageUrl??=index;
  });
  return indexes;
}

function normalizeSingleImageUrl(value) {
  const text=masterCellText(value);
  if(!text)return "";
  if(/^https?:\/\/[^\s]+$/i.test(text)&&text.length<=2048)return text;
  if(/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=\r\n]+$/i.test(text)&&text.length<=1_500_000)return text;
  if(/^\/(?!\/)[^\s]+$/.test(text)&&text.length<=2048)return text;
  return "";
}

// IMAGE URL may contain several product photos separated by a pipe. Keep the
// validated URLs in their original order so the first one remains the default
// image in the UI and the rest can be browsed with the carousel.
export function splitImageUrls(value) {
  const text=masterCellText(value);
  if(!text)return [];
  return [...new Set(text.split("|").map(normalizeSingleImageUrl).filter(Boolean))].slice(0,32);
}

export function normalizeImageUrl(value) {
  return splitImageUrls(value).join("|");
}

export function normalizeMasterLine(value) {
  const compact=masterCellText(value).replace(/^LINE\s*/i,"").trim();
  if(!/^\d{1,2}$/.test(compact))return "";
  const line=Number(compact);
  return line>=1&&line<=28?String(line).padStart(2,"0"):"";
}

export function parseMasterDataRows(sheetRows,{maxRows=500000,onProgress}={}) {
  if(!Array.isArray(sheetRows)||!sheetRows.length)throw new Error("File Excel không có dữ liệu.");
  let best={rowIndex:0,indexes:{},score:0};
  for(let rowIndex=0;rowIndex<Math.min(100,sheetRows.length);rowIndex++){
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
    if(typeof onProgress==="function"&&(offset===0||offset%5000===0))onProgress(offset,dataRows.length);
    const row=Array.isArray(source)?source:[];
    if(!row.some((cell)=>masterCellText(cell)))return;
    const record=Object.fromEntries(requiredKeys.map((key)=>[key,masterCellText(row[best.indexes[key]])]));
    for(const key of optionalKeys){if(best.indexes[key]!==undefined)record[key]=masterCellText(row[best.indexes[key]]);}
    if(best.indexes.imageUrl!==undefined)record.imageUrl=normalizeImageUrl(row[best.indexes.imageUrl]);
    const rowNumber=best.rowIndex+offset+2;
    if(headerKey(record.sku)==="SKU"&&headerKey(record.name)==="TEN SAN PHAM"){skipped++;return;}
    const normalizedLine=normalizeMasterLine(record.line);
    if(!record.sku||!record.name||(best.indexes.line!==undefined&&!normalizedLine)){
      skipped++;
      if(issues.length<20)issues.push({row:rowNumber,reason:!record.sku?"Thiếu SKU":!record.name?"Thiếu tên sản phẩm":"Line phải từ 01 đến 28"});
      return;
    }
    if(best.indexes.line!==undefined)record.line=normalizedLine;
    const skuKey=record.sku.toUpperCase();
    if(conflictingSkus.has(skuKey)){
      duplicates++;skipped++;
      if(issues.length<20)issues.push({row:rowNumber,reason:"SKU trùng khác nội dung; bỏ qua"});
      return;
    }
    const previous=bySku.get(skuKey);
    if(previous){
      duplicates++;
      const same=[...requiredKeys,...optionalKeys].every((key)=>previous.record[key]===record[key]);
      if(same){
        if(!previous.record.imageUrl&&record.imageUrl)previous.record.imageUrl=record.imageUrl;
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
  if(typeof onProgress==="function")onProgress(dataRows.length,dataRows.length);
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
    promoPrice:product?.promoPrice===undefined?undefined:Math.max(0,Number(product.promoPrice)||0),
    lineName:masterCellText(product?.lineName)||masterCellText(lineNameFallback),
    imageUrl:normalizeImageUrl(product?.imageUrl),
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
      supplierBarcode:masterCellText(source?.supplierBarcode)||masterCellText(source?.barcode),
      barcode:masterCellText(source?.barcode)||masterCellText(source?.supplierBarcode),
    };
    if(source?.line!==undefined)master.line=normalizeMasterLine(source.line)||masterCellText(source.line);
    if(source?.lineName!==undefined)master.lineName=masterCellText(source.lineName);
    for(const [key] of [["price"],["promoPrice"],["sales"]]){
      if(source?.[key]!==undefined&&masterCellText(source[key])!=="")master[key]=Math.max(0,Number(String(source[key]).replace(/,/g,""))||0);
    }
    const rawImage=masterCellText(source?.imageUrl),incomingImage=source?.imageUrl===undefined||!rawImage?undefined:normalizeImageUrl(rawImage);
    if(incomingImage!==undefined)master.imageUrl=incomingImage;
    const index=indexBySku.get(key);
    if(index===undefined){
      const id=typeof createId==="function"?createId():"master-"+key;
      indexBySku.set(key,result.length);
      result.push({...master,id,line:master.line??"",lineName:master.lineName??"",price:master.price??0,promoPrice:master.promoPrice??0,sales:master.sales??0,stock:0,loss:0,expDate:"",side:"A",bay:1,updatedAt:now});created++;
      continue;
    }
    const current=result[index];
    const imageChanged=incomingImage!==undefined&&masterCellText(current?.imageUrl)!==incomingImage;
    const changed=Object.keys(master).some((field)=>masterCellText(current?.[field])!==master[field])||imageChanged;
    if(!changed){unchanged++;continue;}
    result[index]={...current,...master,imageUrl:incomingImage===undefined?normalizeImageUrl(current?.imageUrl):incomingImage,updatedAt:now};updated++;
  }
  return {products:result,created,updated,unchanged};
}
