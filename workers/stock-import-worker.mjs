import { promises as fs } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { readSheet } from "read-excel-file/node";
import { parseStockRows } from "../lib/stock-data.mjs";

const progress=(phase,percent,processedRows=0,totalRows=0)=>parentPort?.postMessage({type:"progress",phase,percent,processedRows,totalRows});
try{
  progress("Đang đọc file Stock",12);const rows=await readSheet(workerData.filePath),totalRows=Math.max(0,rows.length-1);progress("Đang kiểm tra dữ liệu Stock",28,0,totalRows);
  const parsed=parseStockRows(rows,{maxRows:workerData.maxRows,onProgress:(processed,total)=>progress("Đang kiểm tra dữ liệu Stock",30+Math.round(processed/Math.max(1,total)*28),processed,total)}),partPath=workerData.resultPath+".part",handle=await fs.open(partPath,"w",0o600),{records,...metadata}=parsed;
  try{await handle.write(JSON.stringify(metadata)+"\n");for(let index=0;index<records.length;index+=2000){await handle.write(records.slice(index,index+2000).map((record)=>JSON.stringify(record)).join("\n")+"\n");progress("Đang chuẩn bị cập nhật tồn kho",60+Math.round(Math.min(records.length,index+2000)/Math.max(1,records.length)*8),Math.min(records.length,index+2000),records.length);}await handle.sync();}finally{await handle.close();}
  await fs.rename(partPath,workerData.resultPath);parentPort?.postMessage({type:"done",resultPath:workerData.resultPath});
}catch(error){if(workerData?.resultPath)await fs.unlink(workerData.resultPath+".part").catch(()=>undefined);parentPort?.postMessage({type:"error",error:error instanceof Error?error.message:"Không thể xử lý file Stock"});}
