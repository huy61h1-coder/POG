import assert from "node:assert/strict";
import test from "node:test";
import { mergeMasterRecords, normalizeImageUrl, normalizeMasterProduct, parseMasterDataRows } from "../lib/master-data.mjs";
import { parseStockRows } from "../lib/stock-data.mjs";

const headers=["SKU","TÊN SẢN PHẨM","Division","DIVISION NAME","Department","DEPARTMENT","SUPPLIER BARCODE","Line","LINE NAME"];

test("đọc định dạng chuẩn mới không cần gán Line trước khi có POG",()=>{
  const parsed=parseMasterDataRows([
    ["SKU","Tên sản phẩm","Sale","Stock","Giá bán retail","Giá khuyến mãi","Division","Division Name","Department","Department Name","Barcode NCC","Barcode AEON"],
    ["A1","Sữa tươi",12,5,10000,8000,"10","FOOD","1001","DAIRY","NCC-1","AEON-1"],
  ]);
  assert.deepEqual(parsed.records[0],{sku:"A1",name:"Sữa tươi",division:"10",divisionName:"FOOD",department:"1001",departmentName:"DAIRY",supplierBarcode:"NCC-1",sales:"12",stock:"5",price:"10000",promoPrice:"8000",barcode:"AEON-1"});
});

test("nhận tiêu đề Master Data có ký tự ẩn hoặc viết liền",()=>{
  const parsed=parseMasterDataRows([
    ["\uFEFFSKU","TÊN\u200B SẢN PHẨM","Sale","Stock","GIÁ BÁN RETAIL","GIÁ KHUYẾN MÃI","Division","DIVISIONNAME","Department","DEPARTMENTNAME","BARCODENCC","BARCODEAEON","IMAGEURL"],
    ["A1","Sữa tươi",12,5,10000,8000,"10","FOOD","1001","DAIRY","NCC-1","AEON-1","https://cdn.example.com/a.jpg"],
  ]);
  assert.equal(parsed.records[0].divisionName,"FOOD");
  assert.equal(parsed.records[0].departmentName,"DAIRY");
  assert.equal(parsed.records[0].supplierBarcode,"NCC-1");
  assert.equal(parsed.records[0].imageUrl,"https://cdn.example.com/a.jpg");
});

test("đọc Stock theo tên cột mới dù Sale và Stock đứng giữa bảng",()=>{
  const parsed=parseStockRows([
    ["SKU","Tên sản phẩm","Sale","Stock","Giá bán retail","Giá khuyến mãi","Division","Division Name","Department","Department Name","Barcode NCC","Barcode AEON"],
    ["A1","Sữa tươi",12,5,10000,8000,"10","FOOD","1001","DAIRY","NCC-1","AEON-1"],
  ]);
  assert.deepEqual(parsed.records,[{sku:"A1",stock:5,sales:12}]);
  assert.deepEqual(parsed.stockMetadata,[{sku:"A1",name:"Sữa tươi",division:"10",divisionName:"FOOD",department:"1001",departmentName:"DAIRY"}]);
});

test("đọc đúng cấu trúc Stock 8 cột chuẩn",()=>{
  const parsed=parseStockRows([
    ["SKU","TÊN SẢN PHẨM","Sale","Stock","Division","DIVISION NAME","Department","DEPARTMENT NAME"],
    ["A1","Sữa tươi",12,5,"10","FOOD","1001","DAIRY"],
  ]);
  assert.deepEqual(parsed.records,[{sku:"A1",stock:5,sales:12}]);
  assert.deepEqual(parsed.stockMetadata,[{sku:"A1",name:"Sữa tươi",division:"10",divisionName:"FOOD",department:"1001",departmentName:"DAIRY"}]);
});

test("đọc đúng 9 cột Master Data và chuẩn hóa Line",()=>{
  const parsed=parseMasterDataRows([
    ["BÁO CÁO MASTER DATA"],
    headers,
    ["000123","Sữa tươi","10","FOOD","1001","DAIRY","8930000123",1,"MILK"],
    headers,
  ]);
  assert.equal(parsed.headerRow,2);
  assert.equal(parsed.skipped,1);
  assert.deepEqual(parsed.records,[{
    sku:"000123",name:"Sữa tươi",division:"10",divisionName:"FOOD",department:"1001",departmentName:"DAIRY",supplierBarcode:"8930000123",line:"01",lineName:"MILK",
  }]);
});

test("chấp nhận bí danh tên cột và loại Line ngoài 01–28",()=>{
  const parsed=parseMasterDataRows([
    ["ITEM CODE","PRODUCT NAME","DIVISION CODE","DIVISION NAME","DEPARTMENT CODE","DEPARTMENT NAME","SUPPLIER EAN","LINE CODE","LINE NAME"],
    ["A1","Hàng hợp lệ","12","HOME","1201","HOUSEHOLD","123","Line 12","HOUSEHOLD"],
    ["A2","Sai Line","12","HOME","1201","HOUSEHOLD","456","29","HOUSEHOLD"],
  ]);
  assert.equal(parsed.records.length,1);
  assert.equal(parsed.records[0].line,"12");
  assert.equal(parsed.skipped,1);
  assert.match(parsed.issues[0].reason,/01 đến 28/);
});

test("đọc cột link hình ảnh tùy chọn và lọc URL không hợp lệ",()=>{
  const parsed=parseMasterDataRows([
    [...headers,"LINK ẢNH"],
    ["A1","Hàng có ảnh","12","HOME","1201","HOUSEHOLD","123","Line 12","HOUSEHOLD","https://cdn.example.com/a.jpg"],
    ["A2","Hàng không ảnh hợp lệ","12","HOME","1201","HOUSEHOLD","456","12","HOUSEHOLD","javascript:alert(1)"],
  ]);
  assert.equal(parsed.records[0].imageUrl,"https://cdn.example.com/a.jpg");
  assert.equal(parsed.records[1].imageUrl,"");
  assert.equal(normalizeImageUrl("data:image/png;base64,AAAA"),"data:image/png;base64,AAAA");
  assert.equal(normalizeImageUrl("javascript:alert(1)"),"");
});

test("không nhập SKU trùng có nội dung mâu thuẫn",()=>{
  const parsed=parseMasterDataRows([
    headers,
    ["A1","Tên thứ nhất","10","FOOD","1001","DAIRY","111","01","MILK"],
    ["a1","Tên thứ hai","10","FOOD","1001","DAIRY","222","02","CHOCOLATE"],
    ["B1","Tên hợp lệ","10","FOOD","1001","DAIRY","333","03","FRUIT"],
  ]);
  assert.deepEqual(parsed.records.map((record)=>record.sku),["B1"]);
  assert.equal(parsed.duplicates,1);
  assert.equal(parsed.skipped,2);
});

test("báo thiếu cột bắt buộc",()=>{
  assert.throws(()=>parseMasterDataRows([["SKU","TÊN SẢN PHẨM","Line"]]),/Thiếu cột bắt buộc/);
});

test("mặc định chấp nhận nhiều hơn 10.000 dòng",()=>{
  const rows=[headers,...Array.from({length:10001},(_,index)=>["SKU"+index,"Sản phẩm "+index,"10","FOOD","1001","DAIRY","BC"+index,"01","MILK"])];
  assert.equal(parseMasterDataRows(rows).records.length,10001);
  assert.throws(()=>parseMasterDataRows(rows,{maxRows:10000}),/10\.000 dòng/);
  const tooMany=[headers];tooMany.length=500002;
  assert.throws(()=>parseMasterDataRows(tooMany),/500\.000 dòng/);
});

test("merge theo SKU chỉ thay Master Data và giữ dữ liệu vận hành",()=>{
  const existing={id:"p1",sku:"A1",name:"Tên cũ",division:"",divisionName:"",department:"",departmentName:"",supplierBarcode:"111",barcode:"111",line:"01",lineName:"OLD",side:"B",bay:7,price:99000,stock:18,loss:3,expDate:"2027-02-01",imageUrl:"https://cdn.example.com/old.jpg",custom:"keep"};
  const records=[{sku:"A1",name:"Tên mới",division:"10",divisionName:"FOOD",department:"1001",departmentName:"DAIRY",supplierBarcode:"999",line:"02",lineName:"CHOCO",imageUrl:"https://cdn.example.com/new.jpg"},{sku:"B1",name:"Hàng mới",division:"20",divisionName:"NONFOOD",department:"2001",departmentName:"HOME",supplierBarcode:"888",line:"12",lineName:"HOUSEHOLD"}];
  const merged=mergeMasterRecords([existing],records,{createId:()=>"new-id",now:123});
  assert.equal(merged.created,1);
  assert.equal(merged.updated,1);
  assert.equal(merged.unchanged,0);
  const updated=merged.products.find((product)=>product.id==="p1");
  assert.equal(updated.name,"Tên mới");
  assert.equal(updated.barcode,"999");
  assert.equal(updated.imageUrl,"https://cdn.example.com/new.jpg");
  assert.equal(updated.side,"B");
  assert.equal(updated.bay,7);
  assert.equal(updated.price,99000);
  assert.equal(updated.stock,18);
  assert.equal(updated.loss,3);
  assert.equal(updated.expDate,"2027-02-01");
  assert.equal(updated.custom,"keep");
  const created=merged.products.find((product)=>product.id==="new-id");
  assert.deepEqual({side:created.side,bay:created.bay,price:created.price,stock:created.stock,loss:created.loss,expDate:created.expDate},{side:"A",bay:1,price:0,stock:0,loss:0,expDate:""});
});

test("chuẩn hóa dữ liệu cũ sang schema Master Data",()=>{
  const product=normalizeMasterProduct({sku:"A1",barcode:"123",line:"12"},"HOUSEHOLD");
  assert.equal(product.supplierBarcode,"123");
  assert.equal(product.lineName,"HOUSEHOLD");
  assert.equal(product.divisionName,"");
});
