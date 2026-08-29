import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("..",import.meta.url));
const port=32000+(process.pid%1000);
const origin=`http://127.0.0.1:${port}`;
const dataDir=await mkdtemp(path.join(tmpdir(),"fulfillment-test-"));
let server;

async function waitForServer(){
  let lastError="";
  server.stderr.on("data",(chunk)=>{lastError+=chunk.toString()});
  for(let attempt=0;attempt<50;attempt++){
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
  await rm(dataDir,{recursive:true,force:true});
}

try{
  server=spawn(process.execPath,["server.mjs","--production"],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataDir,UPLOAD_DIR:path.join(dataDir,"uploads"),DATABASE_URL:""},stdio:["ignore","ignore","pipe"]});
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

  const missing=await fetch(origin+"/api/does-not-exist");
  assert.equal(missing.status,404);
  assert.match(missing.headers.get("content-type")||"",/^application\/json/);
  console.log("Smoke tests passed: page, health, device identity, picking quantity, API 404");
}finally{await stopServer()}
