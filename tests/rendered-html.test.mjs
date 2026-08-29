import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("..",import.meta.url));
const port=32000+(process.pid%1000);
const aiPort=33000+(process.pid%1000);
const origin=`http://127.0.0.1:${port}`;
const dataDir=await mkdtemp(path.join(tmpdir(),"fulfillment-test-"));
let server,aiServer;

async function waitForServer(){
  let lastError="";
  server.stderr.on("data",(chunk)=>{lastError+=chunk.toString()});
  for(let attempt=0;attempt<150;attempt++){
    try{const response=await fetch(origin+"/healthz");if(response.ok)return;}catch(error){void error}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error("Server did not start: "+lastError);
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
  assert.deepEqual(await health.json(),{ok:true,storage:"local-json"});

  const first=await fetch(origin+"/api/store");
  const cookie=(first.headers.get("set-cookie")||"").split(";")[0];
  const data=await first.json();
  assert.equal(data.actor.role,"ADMIN");
  assert.equal(data.products.length,3);
  const product=data.products[0],headers={"content-type":"application/json",cookie};
  await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"addPick",productId:product.id,quantity:2})});
  await fetch(origin+"/api/store",{method:"POST",headers,body:JSON.stringify({action:"addPick",productId:product.id,quantity:1})});
  const updated=await (await fetch(origin+"/api/store",{headers:{cookie}})).json();
  assert.equal(updated.actor.userId,data.actor.userId);
  assert.equal(updated.picking[0].quantity,3);

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

  const missing=await fetch(origin+"/api/does-not-exist");
  assert.equal(missing.status,404);
  assert.match(missing.headers.get("content-type")||"",/^application\/json/);
  console.log("Smoke tests passed: page, health, identity, picking, grounded AI, AI fallback, API 404");
}finally{await stopServer()}
