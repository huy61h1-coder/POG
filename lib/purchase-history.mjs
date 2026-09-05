const aliases={
  phone:["SDT","SO DIEN THOAI","PHONE","MOBILE"],
  customerName:["TEN KHACH HANG","KHACH HANG","CUSTOMER NAME"],
  date:["NGAY","DATE","NGAY MUA","NGAY TAO"],
  invoiceNumber:["SO HOA DON","HOA DON","INVOICE NUMBER","MA DON HANG"],
  invoiceValue:["GIA TRI HOA DON","GIA TRI DON HANG","TONG TIEN","TOTAL","INVOICE VALUE"],
  deliveryAddress:["DIA CHI GIAO HANG","DIA CHI","ADDRESS","DELIVERY ADDRESS"],
  vatAddress:["DIA CHI XUAT VAT","VAT ADDRESS"],
  products:["DANH SACH HANG","SAN PHAM","PRODUCTS","MAT HANG","SKU"],
};
const headerKey=(value)=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"D").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
const text=(value)=>value===null||value===undefined?"":String(value).trim();
const normalizePhone=(value)=>text(value).replace(/\D/g,"").slice(0,24);
function number(value){
  const raw=text(value).replace(/\s/g,"");if(!raw)return 0;
  const normalized=raw.includes(",")&&raw.includes(".")?raw.replace(/\./g,"").replace(",","."):raw.includes(",")?raw.replace(/,/g,""):((raw.match(/\./g)||[]).length>1?raw.replace(/\./g,""):raw);
  const parsed=Number(normalized.replace(/[^\d.-]/g,""));return Number.isFinite(parsed)?Math.max(0,parsed):0;
}
function isoDate(value,period){
  const raw=text(value);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const serial=Number(raw);if(Number.isFinite(serial)&&serial>20000&&serial<100000){const date=new Date(Date.UTC(1899,11,30)+Math.floor(serial)*86400000);return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;}
  const parsed=new Date(raw);if(Number.isFinite(parsed.getTime()))return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}-${String(parsed.getDate()).padStart(2,"0")}`;
  return `${period}-01`;
}
function findHeader(sheetRows){
  let best={row:-1,indexes:{},score:0};
  for(let row=0;row<Math.min(40,sheetRows.length);row++){
    const indexes={};for(const [key,names] of Object.entries(aliases)){for(let index=0;index<(sheetRows[row]||[]).length;index++){const value=headerKey(sheetRows[row][index]);if(names.some((name)=>headerKey(name)===value)){indexes[key]??=index;break;}}}
    const score=["phone","customerName","invoiceValue","date","deliveryAddress"].filter((key)=>indexes[key]!==undefined).length;if(score>best.score)best={row,indexes,score};
  }
  return best;
}
export function parsePurchaseRows(sheetRows,{period,maxRows=200000}={}){
  if(!/^\d{4}-\d{2}$/.test(text(period)))throw new Error("Hãy chọn tháng và năm trước khi nhập lịch sử mua hàng.");
  if(!Array.isArray(sheetRows)||!sheetRows.length)throw new Error("File Excel lịch sử mua hàng không có dữ liệu.");
  const best=findHeader(sheetRows);if(best.row<0||best.indexes.phone===undefined)throw new Error("File cần có cột SĐT để tổng hợp lịch sử mua hàng.");
  const rows=sheetRows.slice(best.row+1);if(rows.length>maxRows)throw new Error("File lịch sử mua hàng vượt quá "+maxRows.toLocaleString("vi-VN")+" dòng.");
  const records=[];let skipped=0;
  for(const [offset,row] of rows.entries()){
    if(!Array.isArray(row)||!row.some((value)=>text(value)))continue;
    const read=(key)=>best.indexes[key]===undefined?"":text(row[best.indexes[key]]);
    const phone=normalizePhone(read("phone"));if(phone.length<8){skipped++;continue;}
    records.push({rowNumber:best.row+offset+2,phone,customerName:read("customerName"),date:isoDate(read("date"),period),invoiceNumber:read("invoiceNumber"),invoiceValue:number(read("invoiceValue")),address:read("deliveryAddress")||read("vatAddress"),products:read("products")});
  }
  if(!records.length)throw new Error("Không tìm thấy dòng mua hàng có SĐT hợp lệ.");
  return {records,headerRow:best.row+1,skipped};
}
