import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, unzipSync, zipSync } from "fflate";

const root=fileURLToPath(new URL("..",import.meta.url));
const port=32000+(process.pid%1000);
const aiPort=33000+(process.pid%1000);
const origin=`http://127.0.0.1:${port}`;
const dataDir=await mkdtemp(path.join(tmpdir(),"fulfillment-test-"));
let server,aiServer;

function createXlsx(rows){
  const escape=(value)=>String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const sheetRows=rows.map((row,rowIndex)=>'<row r="'+(rowIndex+1)+'">'+row.map((value,columnIndex)=>'<c r="'+String.fromCharCode(65+columnIndex)+(rowIndex+1)+'" t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>').join("")+'</row>').join("");
  const files={
    "[Content_Types].xml":'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels":'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Master" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml":'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+sheetRows+'</sheetData></worksheet>',
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name,content])=>[name,strToU8(content)])),{level:0});
}

async function waitForServer(){
  let lastError="";
  server.stderr.on("data",(chunk)=>{lastError+=chunk.toString()});
  for(let attempt=0;attempt<150;attempt++){
    try{const response=await fetch(origin+"/healthz");if(response.ok)return;}catch(error){void error}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error("Server did not start: "+lastError);
}

async function waitForImport(cookie,jobId){
  let last;
  for(let attempt=0;attempt<300;attempt++){
    const response=await fetch(origin+"/api/master-data/import/"+encodeURIComponent(jobId),{headers:{cookie}});
    assert.equal(response.status,200);
    last=await response.json();
    if(last.status==="completed")return last;
    if(last.status==="failed")throw new Error("Import failed: "+last.error);
    await new Promise((resolve)=>setTimeout(resolve,50));
  }
  throw new Error("Import did not finish: "+JSON.stringify(last));
}
async function waitForStockImport(cookie,jobId){
  let last;
  for(let attempt=0;attempt<300;attempt++){
    const response=await fetch(origin+"/api/stock/import/"+encodeURIComponent(jobId),{headers:{cookie}});
    assert.equal(response.status,200);last=await response.json();
    if(last.status==="completed")return last;
    if(last.status==="failed")throw new Error("Stock import failed: "+last.error);
    await new Promise((resolve)=>setTimeout(resolve,50));
  }
  throw new Error("Stock import did not finish: "+JSON.stringify(last));
}

async function stopServer(){
  if(server&&!server.killed){
    const exited=new Promise((resolve)=>server.once("exit",resolve));
    server.kill();
    await Promise.race([exited,new Promise((resolve)=>setTimeout(resolve,2000))]);
  }
  if(aiServer)await new Promise((resolve)=>aiServer.close(resolve));
  await rm(dataDir,{recursive:true,force:true});
}

try{
  aiServer=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(req.url!=="/responses"||req.headers.authorization!=="Bearer test-key"){res.writeHead(401).end();return;}
    if(String(body.input).includes("force-fallback")){res.writeHead(500,{"content-type":"application/json"}).end(JSON.stringify({error:{message:"mock failure"}}));return;}
    const result={summary:"Đã chọn sản phẩm phù hợp từ kho hiện có.",items:[
      {productId:"p1",quantity:2,reason:"Còn hàng và phù hợp với nhu cầu."},
      {productId:"p3",quantity:1,reason:"Sản phẩm hết hàng phải bị loại."},
      {productId:"unknown",quantity:1,reason:"Mã không tồn tại phải bị loại."},
      {productId:"p1",quantity:3,reason:"Mã trùng phải bị loại."}
    ]};
    res.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(result)}]}]}));
  });
  await new Promise((resolve)=>aiServer.listen(aiPort,"127.0.0.1",resolve));
  server=spawn(process.execPath,["server.mjs","--production"],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataDir,UPLOAD_DIR:path.join(dataDir,"uploads"),DATABASE_URL:"",OPENAI_API_KEY:"test-key",OPENAI_BASE_URL:`http://127.0.0.1:${aiPort}`,OPENAI_MODEL:"gpt-5.4-mini",AI_RATE_LIMIT:"20"},stdio:["ignore","ignore","pipe"]});
  await waitForServer();

  const [page,health]=await Promise.all([fetch(origin+"/"),fetch(origin+"/healthz")]);
  assert.equal(page.status,200);
  assert.match(page.headers.get("content-type")||"",/^text\/html/);
  assert.deepEqual(await health.json(),{ok:true,storage:"local-json",customerStorage:"local-json",purchaseHistoryStorage:"local-json",customerImportReader:"bounded-xlsx-v1"});

  const anonymous=await fetch(origin+"/api/store");
  assert.equal(anonymous.status,200);
  assert.equal((await anonymous.json()).actor.role,"STAFF");
  const setupResponse=await fetch(origin+"/api/auth/setup",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Quản trị kiểm thử",username:"admin.test",password:"StrongPass123"})});
  assert.equal(setupResponse.status,200);
  const cookie=(setupResponse.headers.get("set-cookie")||"").split(";")[0];
  assert.match(cookie,/^fulfillment_session=/);
  const first=await fetch(origin+"/api/store?includeProducts=1",{headers:{cookie}});
  const data=await first.json();
  assert.equal(data.actor.role,"ADMIN");
  assert.equal(data.actor.username,"admin.test");
  assert.equal(data.users.length,1);
  assert.equal(data.products.length,3);
  assert.equal(data.products[0].divisionName,"HOME & LIVING");
  assert.equal(data.products[0].supplierBarcode,"45497410531914");
  const compact=await (await fetch(origin+"/api/store",{headers:{cookie}})).json();
  assert.equal(compact.products.length,0);
  assert.equal(compact.productTotal,3);
  assert.equal(compact.productStats.total,3);
  const paged=await (await fetch(origin+"/api/products?page=1&pageSize=2",{headers:{cookie}})).json();
  assert.equal(paged.products.length,2);
  assert.equal(paged.total,3);
  assert.equal(paged.pageSize,2);
  const initialStockForm=new FormData();initialStockForm.set("file",new Blob([createXlsx([["SKU","STOCK"],["10531914","5"],["10763049","45"],["8969583","0"]])],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"stock.xlsx");
  const initialStockResponse=await fetch(origin+"/api/stock/import",{method:"POST",headers:{cookie},body:initialStockForm});assert.equal(initialStockResponse.status,202);
  const initialStockJob=await initialStockResponse.json();await waitForStockImport(cookie,initialStockJob.jobId);
  const stockPage=await (await fetch(origin+"/api/stock?pageSize=10",{headers:{cookie}})).json();assert.equal(stockPage.total,3);assert.equal(stockPage.products[0].stockKnown,true);
  const expiryPage=await (await fetch(origin+"/api/products?sort=expiry&pageSize=3",{headers:{cookie}})).json();
  assert.equal(expiryPage.products.length,3);
  const product=data.products[0],headers={"content-type":"application/json",cookie};
  const addOutOfStock=await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"addPick",productId:"p3",quantity:1})});
  assert.equal(addOutOfStock.status,409);
  await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"addPick",productId:product.id,quantity:2})});
  await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"addPick",productId:product.id,quantity:1})});
  const updated=await (await fetch(origin+"/api/store?includeProducts=1",{headers:{cookie}})).json();
  assert.equal(updated.actor.userId,data.actor.userId);
  assert.equal(updated.picking[0].quantity,3);

  const dailyReport={employeeName:"Nhân viên kiểm thử",date:"2026-09-05",phone:"0901234567",customerName:"Khách báo cáo",invoiceValue:"125000"};
  const createReport=await fetch(origin+"/api/daily-reports",{method:"POST",headers,body:JSON.stringify({report:dailyReport})});assert.equal(createReport.status,200);
  const savedReport=(await createReport.json()).report;assert.ok(savedReport.id);
  const updateReport=await fetch(origin+"/api/daily-reports",{method:"POST",headers,body:JSON.stringify({report:{...dailyReport,id:savedReport.id,customerName:"Khách báo cáo đã sửa"}})});assert.equal(updateReport.status,200);
  const reportList=await (await fetch(origin+"/api/daily-reports?month=2026-09",{headers:{cookie}})).json();assert.equal(reportList.reports.length,1);assert.equal(reportList.reports[0].customerName,"Khách báo cáo đã sửa");
  const deleteReport=await fetch(origin+"/api/daily-reports/"+encodeURIComponent(savedReport.id),{method:"DELETE",headers:{cookie}});assert.equal(deleteReport.status,200);
  const emptyReportList=await (await fetch(origin+"/api/daily-reports?month=2026-09",{headers:{cookie}})).json();assert.equal(emptyReportList.reports.length,0);

  const firstPogForm=new FormData();firstPogForm.set("line","16");firstPogForm.set("side","A");firstPogForm.set("file",new Blob(["first-pog"],{type:"application/pdf"}),"pog-part-1.pdf");
  const firstPogResponse=await fetch(origin+"/api/pog",{method:"POST",headers:{cookie},body:firstPogForm});assert.equal(firstPogResponse.status,200);assert.equal((await firstPogResponse.json()).fileCount,1);
  const secondPogForm=new FormData();secondPogForm.set("line","16");secondPogForm.set("side","A");secondPogForm.set("mode","append");secondPogForm.set("file",new Blob(["second-pog"],{type:"application/pdf"}),"pog-part-2.pdf");
  const secondPogResponse=await fetch(origin+"/api/pog",{method:"POST",headers:{cookie},body:secondPogForm});assert.equal(secondPogResponse.status,200);assert.equal((await secondPogResponse.json()).fileCount,2);
  const pogState=await (await fetch(origin+"/api/store",{headers:{cookie}})).json();assert.equal(pogState.pogFiles[0].sources.length,2);
  assert.equal(await (await fetch(origin+"/api/pog?id=16_A&source=0",{headers:{cookie}})).text(),"first-pog");
  assert.equal(await (await fetch(origin+"/api/pog?id=16_A&source=1",{headers:{cookie}})).text(),"second-pog");

  const otherLinePogForm=new FormData();otherLinePogForm.set("line","07");otherLinePogForm.set("side","B");otherLinePogForm.set("file",new Blob(["line-07b-pog"],{type:"application/pdf"}),"pog-line-07b.pdf");
  const otherLinePogResponse=await fetch(origin+"/api/pog",{method:"POST",headers:{cookie},body:otherLinePogForm});assert.equal(otherLinePogResponse.status,200);
  const otherLinePogState=await (await fetch(origin+"/api/store",{headers:{cookie}})).json();
  assert.ok(otherLinePogState.pogFiles.some((item)=>item.id==="07_B"),"POG pipeline must work for every Line, not only Line 16");
  assert.equal(await (await fetch(origin+"/api/pog?id=07_B&source=0",{headers:{cookie}})).text(),"line-07b-pog");

  const wrongLogin=await fetch(origin+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"admin.test",password:"wrong-password"})});
  assert.equal(wrongLogin.status,401);
  const createStaff=await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"createAccount",account:{name:"Nhân viên kiểm thử",username:"staff.test",password:"StaffPass123",role:"STAFF"}})});
  assert.equal(createStaff.status,200);
  const staffAccount=(await createStaff.json()).account;
  const staffLogin=await fetch(origin+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"staff.test",password:"StaffPass123"})});
  assert.equal(staffLogin.status,200);
  const staffCookie=(staffLogin.headers.get("set-cookie")||"").split(";")[0];
  const forbiddenDelete=await fetch(origin+"/api/store",{method:"POST",headers:{"content-type":"application/json",cookie:staffCookie},body:JSON.stringify({action:"deleteProduct",id:product.id})});
  assert.equal(forbiddenDelete.status,403);
  const promoteStaff=await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"updateAccount",account:{userId:staffAccount.userId,role:"MANAGER"}})});
  assert.equal(promoteStaff.status,200);
  const selfDemote=await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"updateAccount",account:{userId:data.actor.userId,role:"STAFF"}})});
  assert.equal(selfDemote.status,400);
  const managerCannotCreate=await fetch(origin+"/api/store",{method:"POST",headers:{"content-type":"application/json",cookie:staffCookie},body:JSON.stringify({action:"createAccount",account:{name:"Không hợp lệ",username:"blocked.user",password:"BlockedPass123",role:"STAFF"}})});
  assert.equal(managerCannotCreate.status,403);

  const invalidMaster=new FormData();
  invalidMaster.set("file",new Blob(["not-an-xlsx"],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"master.xlsx");
  const invalidMasterResponse=await fetch(origin+"/api/master-data/import",{method:"POST",headers:{cookie},body:invalidMaster});
  assert.equal(invalidMasterResponse.status,400);

  const invalidAi=await fetch(origin+"/api/ai/suggest",{method:"POST",headers,body:JSON.stringify({query:""})});
  assert.equal(invalidAi.status,400);
  const aiResponse=await fetch(origin+"/api/ai/suggest",{method:"POST",headers,body:JSON.stringify({query:"Gợi ý cho bữa sáng"})});
  assert.equal(aiResponse.status,200);
  const aiResult=await aiResponse.json();
  assert.equal(aiResult.mode,"ai");
  assert.equal(aiResult.model,"gpt-5.4-mini");
  assert.equal(aiResult.items.length,1);
  assert.equal(aiResult.items[0].productId,"p1");
  assert.equal(aiResult.items[0].name,"HC TẤM TRẢI LÀM MÁT ICECOLD 160X200GY");
  assert.equal(aiResult.items[0].stock,5);
  assert.equal(aiResult.items[0].quantity,2);

  const fallbackResponse=await fetch(origin+"/api/ai/suggest",{method:"POST",headers,body:JSON.stringify({query:"force-fallback"})});
  const fallbackResult=await fallbackResponse.json();
  assert.equal(fallbackResponse.status,200);
  assert.equal(fallbackResult.mode,"local");
  assert.ok(fallbackResult.items.length>0);
  assert.ok(fallbackResult.items.every((item)=>item.stock>0&&item.productId!=="p3"));

  const masterHeaders=["SKU","TÊN SẢN PHẨM","Division","DIVISION NAME","Department","DEPARTMENT","SUPPLIER BARCODE","Line","LINE NAME","IMAGE URL"];
  const workbook=createXlsx([masterHeaders,["10531914","SẢN PHẨM CẬP NHẬT TỪ EXCEL","18","FOOD","1801","BEVERAGE","490000000001","18","TEA DRINKS","https://cdn.example.com/p1.jpg"],["00000999","SẢN PHẨM MỚI","03","FOOD","0301","FRUIT","490000000002","03","FRUIT","https://cdn.example.com/new.jpg"]]);
  const masterForm=new FormData();
  masterForm.set("file",new Blob([workbook],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"master-data.xlsx");
  const masterResponse=await fetch(origin+"/api/master-data/import",{method:"POST",headers:{cookie:staffCookie},body:masterForm});
  assert.equal(masterResponse.status,202);
  const acceptedJob=await masterResponse.json();
  assert.match(acceptedJob.jobId,/^[0-9a-f-]+$/i);
  const completedJob=await waitForImport(staffCookie,acceptedJob.jobId);
  assert.equal(completedJob.percent,100);
  const masterResult=completedJob.result;
  assert.equal(masterResult.created,1);
  assert.equal(masterResult.updated,1);
  assert.equal(masterResult.skipped,0);
  const afterMaster=await (await fetch(origin+"/api/store?includeProducts=1",{headers:{cookie}})).json();
  const preserved=afterMaster.products.find((item)=>item.id==="p1");
  assert.equal(preserved.name,"SẢN PHẨM CẬP NHẬT TỪ EXCEL");
  assert.equal(preserved.supplierBarcode,"490000000001");
  assert.equal(preserved.line,"18");
  assert.equal(preserved.imageUrl,"https://cdn.example.com/p1.jpg");
  assert.equal(preserved.stock,5);
  assert.equal(preserved.bay,3);
  assert.equal(preserved.price,450000);
  assert.equal(afterMaster.picking[0].productId,undefined);
  assert.equal(afterMaster.picking[0].id,"p1");
  assert.equal(afterMaster.picking[0].quantity,3);
  assert.equal(afterMaster.products.length,4);
  assert.doesNotMatch(JSON.stringify(afterMaster),/passwordHash|tokenHash|sessions/);
  const importedProduct=afterMaster.products.find((item)=>item.sku==="00000999");
  const editProduct=await fetch(origin+"/api/store",{method:"POST",headers:{"content-type":"application/json",cookie:staffCookie},body:JSON.stringify({action:"upsertProduct",product:{...importedProduct,name:"SẢN PHẨM ĐÃ SỬA",imageUrl:"https://cdn.example.com/manual.jpg"}})});
  assert.equal(editProduct.status,200);
  const deleteProduct=await fetch(origin+"/api/store",{method:"POST",headers:{"content-type":"application/json",cookie:staffCookie},body:JSON.stringify({action:"deleteProduct",id:importedProduct.id})});
  assert.equal(deleteProduct.status,200);
  const afterDelete=await (await fetch(origin+"/api/store?includeProducts=1",{headers:{cookie}})).json();
  assert.equal(afterDelete.products.some((item)=>item.id===importedProduct.id),false);

  const bulkRows=[masterHeaders];
  for(let index=1;index<=12000;index++)bulkRows.push(["BULK"+String(index).padStart(6,"0"),"SẢN PHẨM KIỂM THỬ LỚN "+index,"10","FOOD","1001","BULK TEST","893"+String(index).padStart(10,"0"),String(index%28+1).padStart(2,"0"),"LINE TEST"]);
  const bulkForm=new FormData();bulkForm.set("file",new Blob([createXlsx(bulkRows)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"master-data-12000.xlsx");
  const bulkResponse=await fetch(origin+"/api/master-data/import",{method:"POST",headers:{cookie:staffCookie,"x-import-id":"9cb534fe-a240-4d7a-9811-5f809d24ec89"},body:bulkForm});
  assert.equal(bulkResponse.status,202);
  const bulkAccepted=await bulkResponse.json();
  const [healthDuringImport,pageDuringImport]=await Promise.all([fetch(origin+"/healthz"),fetch(origin+"/api/products?pageSize=5",{headers:{cookie}})]);
  assert.equal(healthDuringImport.status,200);
  assert.equal(pageDuringImport.status,200);
  const bulkCompleted=await waitForImport(staffCookie,bulkAccepted.jobId);
  assert.equal(bulkCompleted.result.imported,12000);
  assert.equal(bulkCompleted.result.totalProducts,12003);
  const compactAfterBulk=await (await fetch(origin+"/api/store",{headers:{cookie}})).json();
  assert.equal(compactAfterBulk.products.length,0);
  assert.equal(compactAfterBulk.productTotal,12003);
  const assignForCustomer=await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"assignPick",productId:"p1",assigneeId:staffAccount.userId,quantity:1,customerName:"Khách lịch sử",customerPhone:"0901 234 567",note:"Giao buổi chiều"})});
  assert.equal(assignForCustomer.status,200);
  const assignedStore=await (await fetch(origin+"/api/store",{headers:{cookie:staffCookie}})).json();
  assert.ok(assignedStore.assignedPicking.some((item)=>item.customerName==="Khách lịch sử"&&item.customerPhone==="0901234567"));
  const clearAssigned=await fetch(origin+"/api/store",{method:"POST",headers:{"content-type":"application/json",cookie:staffCookie},body:JSON.stringify({action:"clearPick"})});
  assert.equal(clearAssigned.status,200);
  const historyStore=await (await fetch(origin+"/api/store",{headers:{cookie:staffCookie}})).json();
  assert.ok(historyStore.orderHistory.some((item)=>item.customerName==="Khách lịch sử"&&item.customerPhone==="0901234567"&&item.completedAt));
  const exportMonth=new Date().toISOString().slice(0,7);
  const orderExport=await fetch(origin+"/api/orders/export.xlsx?month="+exportMonth,{headers:{cookie:staffCookie}});
  assert.equal(orderExport.status,200);
  assert.match(orderExport.headers.get("content-type")||"",/spreadsheetml/);
  assert.match(orderExport.headers.get("content-disposition")||"",/Don_soan_khach_hang_/);
  const orderExportBytes=new Uint8Array(await orderExport.arrayBuffer());
  assert.equal(orderExportBytes[0],0x50);
  assert.equal(orderExportBytes[1],0x4b);
  const orderWorkbook=unzipSync(orderExportBytes);
  assert.ok(orderWorkbook["xl/worksheets/sheet1.xml"]);
  assert.match(new TextDecoder().decode(orderWorkbook["xl/worksheets/sheet1.xml"]),/Khách lịch sử/);
  const disableManager=await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"updateAccount",account:{userId:staffAccount.userId,active:false}})});
  assert.equal(disableManager.status,200);
  assert.equal((await fetch(origin+"/api/store",{headers:{cookie:staffCookie}})).status,200);

  const logoutResponse=await fetch(origin+"/api/auth/logout",{method:"POST",headers:{cookie}});
  assert.equal(logoutResponse.status,200);
  assert.match(logoutResponse.headers.get("set-cookie")||"",/Max-Age=0/);
  assert.equal((await fetch(origin+"/api/store",{headers:{cookie}})).status,200);

  const missing=await fetch(origin+"/api/does-not-exist");
  assert.equal(missing.status,404);
  assert.match(missing.headers.get("content-type")||"",/^application\/json/);
  console.log("Smoke tests passed: page, health, identity, picking, grounded AI, async 12k-row Excel import, pagination, API 404");
}finally{await stopServer()}
