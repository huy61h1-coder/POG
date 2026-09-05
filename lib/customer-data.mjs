const aliases={
  employeeName:["TEN NV","TEN NHAN VIEN","NHAN VIEN"],
  date:["NGAY","DATE"],
  phone:["SDT","SO DIEN THOAI","PHONE","MOBILE"],
  customerName:["TEN KHACH HANG","KHACH HANG","CUSTOMER NAME"],
  customerStatus:["TINH TRANG KH","TINH TRANG KHACH HANG","CUSTOMER STATUS"],
  vatExport:["XUAT VAT","VAT"],
  orderType:["LOAI DON","ORDER TYPE"],
  invoiceNumber:["SO HOA DON","HOA DON","INVOICE NUMBER"],
  invoiceValue:["GIA TRI HOA DON","INVOICE VALUE"],
  paymentMethod:["PHUONG THUC THANH TOAN","PTTT","PAYMENT METHOD"],
  cdoNumber:["SO CDO","CDO"],
  codNumber:["SO COD","COD"],
  carrier:["NHA VAN CHUYEN","CARRIER","DON VI VAN CHUYEN"],
  returnStatus:["HUY DOI TRA HANG","HUY DOI TRA","RETURN STATUS"],
  remainingInvoiceValue:["GIA TRI HOA DON CON LAI","GIA TRI CON LAI"],
  memberCard:["THE THANH VIEN","MEMBER CARD"],
  customerGroup:["NHOM KH","NHOM KHACH HANG","CUSTOMER GROUP"],
  email:["EMAIL","E MAIL"],
  taxId:["MST","MA SO THUE","TAX ID"],
  vatAddress:["DIA CHI XUAT VAT","DIA CHI VAT","VAT ADDRESS"],
  deliveryAddress:["DIA CHI GIAO HANG","DELIVERY ADDRESS"],
  note:["NOTE","GHI CHU"]
};
const headerKey=(value)=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[đĐ]/g,"D").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
const text=(value)=>value===null||value===undefined?"":String(value).trim();
export const DAILY_REPORT_COLUMNS=[
  ["employeeName","TÊN NV"],["date","NGÀY"],["phone","SĐT"],["customerName","TÊN KHÁCH HÀNG"],["customerStatus","TÌNH TRẠNG KH"],["vatExport","XUẤT VAT"],["orderType","LOẠI ĐƠN"],["invoiceNumber","SỐ HÓA ĐƠN"],["invoiceValue","GIÁ TRỊ HÓA ĐƠN"],["paymentMethod","Phương thức thanh toán"],["cdoNumber","SỐ CDO"],["codNumber","SỐ COD"],["carrier","NHÀ VẬN CHUYỂN"],["returnStatus","HỦY/ĐỔI /TRẢ HÀNG"],["remainingInvoiceValue","GIÁ TRỊ HÓA ĐƠN CÒN LẠI"],["memberCard","THẺ THÀNH VIÊN"],["customerGroup","NHÓM KH"],["email","Email"],["taxId","MST"],["vatAddress","ĐỊA CHỈ XUẤT VAT"],["deliveryAddress","ĐỊA CHỈ GIAO HÀNG"],["note","NOTE"]
];
export function parseCustomerRows(sheetRows,{maxRows=200000}={}){
  if(!Array.isArray(sheetRows)||!sheetRows.length)throw new Error("File Excel khách hàng không có dữ liệu.");
  let best={row:-1,indexes:{},score:0};
  for(let row=0;row<Math.min(30,sheetRows.length);row++){
    const indexes={};for(const [key,names] of Object.entries(aliases)){for(let index=0;index<(sheetRows[row]||[]).length;index++){const normalized=headerKey(sheetRows[row][index]);if(names.some((name)=>headerKey(name)===normalized)){indexes[key]??=index;break;}}}
    const score=["phone","customerName","date"].filter((key)=>indexes[key]!==undefined).length;if(score>best.score)best={row,indexes,score};
    if(score===3)break;
  }
  if(best.row<0||best.indexes.phone===undefined)throw new Error("File Excel khách hàng cần có cột SĐT.");
  const rows=sheetRows.slice(best.row+1);if(rows.length>maxRows)throw new Error("File khách hàng vượt quá "+maxRows.toLocaleString("vi-VN")+" dòng.");
  const records=[];let skipped=0;
  for(const row of rows){if(!Array.isArray(row)||!row.some((value)=>text(value)))continue;const record={};for(const [key,index] of Object.entries(best.indexes))record[key]=text(row[index]);if(!record.phone){skipped++;continue;}records.push(record);}
  if(!records.length)throw new Error("Không tìm thấy dòng khách hàng hợp lệ.");
  return {records,headerRow:best.row+1,skipped};
}
export function customerFieldsFromReport(report){return {phone:text(report.phone),name:text(report.customerName),status:text(report.customerStatus),vatExport:text(report.vatExport),memberCard:text(report.memberCard),group:text(report.customerGroup),email:text(report.email),taxId:text(report.taxId),vatAddress:text(report.vatAddress),deliveryAddress:text(report.deliveryAddress)};}
