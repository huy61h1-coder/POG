import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parsePurchaseRows } from "../lib/purchase-history.mjs";
import { readCustomerWorkbookSheets } from "../lib/customer-workbook.mjs";

test("đọc lịch sử mua hàng theo tháng và chuẩn hóa giá trị hóa đơn",()=>{
  const rows=[
    ["SĐT","TÊN KHÁCH HÀNG","NGÀY","SỐ HÓA ĐƠN","GIÁ TRỊ HÓA ĐƠN","ĐỊA CHỈ GIAO HÀNG"],
    ["0901234567","Khách A","2026-09-03","HD001","1.250.000","Quận 1"],
    ["0987654321","Khách B","45903","HD002","250000","Quận 3"],
    ["","Dòng bỏ qua","2026-09-04","HD003","1000",""],
  ];
  const parsed=parsePurchaseRows(rows,{period:"2026-09"});
  assert.equal(parsed.records.length,2);
  assert.equal(parsed.skipped,1);
  assert.equal(parsed.records[0].invoiceValue,1250000);
  assert.equal(parsed.records[1].date,"2025-09-03");
});

test("nhận file XML sheet có header lịch sử mua hàng",async()=>{
  const workbook=`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Mua hang" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const relationships=`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
  const strings=["SĐT","TÊN KHÁCH HÀNG","GIÁ TRỊ HÓA ĐƠN","0901234567","Khách A","50000"].map((value)=>`<si><t>${value}</t></si>`).join("");
  const sheet=`<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row></sheetData></worksheet>`;
  const file=zipSync({"xl/workbook.xml":strToU8(workbook),"xl/_rels/workbook.xml.rels":strToU8(relationships),"xl/sharedStrings.xml":strToU8(`<sst>${strings}</sst>`),"xl/worksheets/sheet1.xml":strToU8(sheet)});
  const sheets=await readCustomerWorkbookSheets(file),parsed=parsePurchaseRows(sheets[0].data,{period:"2026-09"});
  assert.equal(parsed.records[0].customerName,"Khách A");
  assert.equal(parsed.records[0].invoiceValue,50000);
});
