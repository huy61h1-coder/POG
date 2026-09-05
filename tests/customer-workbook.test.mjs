import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseCustomerRows } from "../lib/customer-data.mjs";
import { readCustomerWorkbookSheets } from "../lib/customer-workbook.mjs";

test("đọc file khách có vùng định dạng 16.384 cột mà không tạo các cột rỗng",async()=>{
  const workbook=`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data KH" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const relationships=`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
  const strings=["STT","SĐT","TÊN KHÁCH HÀNG","1","0901234567","Khách A","2","0987654321","Khách B"].map((value)=>`<si><t>${value}</t></si>`).join("");
  const sheet=`<?xml version="1.0"?><worksheet><dimension ref="A1:XFD3"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="XFD1" s="1"/></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c><c r="XFD2" s="1"/></row><row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c><c r="XFD3" s="1"/></row></sheetData></worksheet>`;
  const file=zipSync({"xl/workbook.xml":strToU8(workbook),"xl/_rels/workbook.xml.rels":strToU8(relationships),"xl/sharedStrings.xml":strToU8(`<sst>${strings}</sst>`),"xl/worksheets/sheet1.xml":strToU8(sheet)});
  const sheets=await readCustomerWorkbookSheets(file),rows=sheets[0].data,parsed=parseCustomerRows(rows);
  assert.equal(Math.max(...rows.map((row)=>row.length)),3);
  assert.equal(parsed.records.length,2);
  assert.deepEqual(parsed.records.map((record)=>record.phone),["0901234567","0987654321"]);
});
