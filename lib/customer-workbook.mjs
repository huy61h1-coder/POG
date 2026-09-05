import { promises as fs } from "node:fs";
import { strFromU8, unzipSync } from "fflate";

const xmlEntities={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};
function decodeXml(value) {
  return String(value??"").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_match,entity)=>{
    if(entity[0]==="#")return String.fromCodePoint(entity[1].toLowerCase()==="x"?Number.parseInt(entity.slice(2),16):Number.parseInt(entity.slice(1),10));
    return xmlEntities[entity.toLowerCase()]??_match;
  });
}
function attribute(source,name) {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),match=String(source).match(new RegExp(`(?:^|\\s)${escaped}=(["'])([\\s\\S]*?)\\1`,"i"));
  return match?decodeXml(match[2]):"";
}
function columnNumber(reference) {
  const letters=String(reference).match(/^([A-Z]+)/i)?.[1]?.toUpperCase()||"";let number=0;
  for(const letter of letters)number=number*26+letter.charCodeAt(0)-64;
  return number;
}
function textNodes(source) {
  const values=[];for(const match of String(source).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))values.push(decodeXml(match[1]));
  return values.join("");
}
function sharedStrings(xml) {
  const values=[];for(const match of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi))values.push(textNodes(match[1]));
  return values;
}
function worksheetRows(xml,strings,maxColumns,maxRows) {
  const rows=[];
  for(const rowMatch of String(xml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)){
    if(rows.length>=maxRows)throw new Error(`Sheet khách hàng vượt quá ${maxRows.toLocaleString("vi-VN")} dòng.`);
    const row=[];
    for(const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)){
      const column=columnNumber(attribute(cellMatch[1],"r"));if(!column||column>maxColumns)continue;
      const body=cellMatch[2]||"",type=attribute(cellMatch[1],"t"),valueMatch=body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);let value="";
      if(type==="inlineStr")value=textNodes(body);
      else if(valueMatch){const raw=decodeXml(valueMatch[1]);value=type==="s"?(strings[Number(raw)]??""):raw;}
      if(value!=="")row[column-1]=value;
    }
    rows.push(row);
  }
  return rows;
}
function archiveText(archive,name) {
  const entry=archive[name];return entry?strFromU8(entry):"";
}

// Excel files can contain a phantom used range up to XFD (16,384 columns)
// because of formatting. This reader extracts only the first business-data
// columns directly from XML, so empty formatted cells never consume server RAM.
export async function readCustomerWorkbookSheets(source,{maxColumns=64,maxRows=200000,sheetFilter}={}) {
  const bytes=typeof source==="string"?new Uint8Array(await fs.readFile(source)):source instanceof Uint8Array?source:new Uint8Array(source);
  if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error("File .xlsx không hợp lệ hoặc đã bị hỏng.");
  const archive=unzipSync(bytes),workbookXml=archiveText(archive,"xl/workbook.xml"),relationshipsXml=archiveText(archive,"xl/_rels/workbook.xml.rels");
  if(!workbookXml||!relationshipsXml)throw new Error("File Excel không có cấu trúc workbook hợp lệ.");
  const relationships=new Map();
  for(const match of relationshipsXml.matchAll(/<Relationship\b([^>]*?)\/?\s*>/gi)){
    const id=attribute(match[1],"Id"),rawTarget=attribute(match[1],"Target").replace(/\\/g,"/");if(!id||!rawTarget)continue;
    const target=rawTarget.startsWith("/")?rawTarget.slice(1):rawTarget.startsWith("xl/")?rawTarget:`xl/${rawTarget.replace(/^\.\//,"")}`;relationships.set(id,target);
  }
  const strings=sharedStrings(archiveText(archive,"xl/sharedStrings.xml")),sheets=[];
  for(const match of workbookXml.matchAll(/<sheet\b([^>]*?)\/?\s*>/gi)){
    const sheet=attribute(match[1],"name");if(typeof sheetFilter==="function"&&!sheetFilter(sheet))continue;
    const relationshipId=attribute(match[1],"r:id"),target=relationships.get(relationshipId),xml=target?archiveText(archive,target):"";
    if(sheet&&xml)sheets.push({sheet,data:worksheetRows(xml,strings,maxColumns,maxRows)});
  }
  if(!sheets.length)throw new Error("File Excel không có sheet dữ liệu đọc được.");
  return sheets;
}
