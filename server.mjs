import express from "express";
import multer from "multer";
import { Pool } from "pg";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createReadStream, existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { normalizeMasterProduct } from "./lib/master-data.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(root, process.env.DATA_DIR || "data");
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || path.join(dataDir,"uploads"));
const importDir = path.join(dataDir,"master-imports");
const statePath = path.join(dataDir, "store.json");
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
const scryptAsync = promisify(scryptCallback);
const sessionMaxAgeSeconds = 12 * 60 * 60;
const masterImportMaxRows = 500_000;
const masterImportMaxFileBytes = 100 * 1024 * 1024;

const lineDefaults = [
  ["01","Souvenir","#dfb100",""],["02","Choco","#c00057",""],["03","Fruit","#c8185d",""],["04","Confec","#bf0d59",""],
  ["05","Milk","#62676a",""],["06","Milk","#62676a",""],["07","Kid","#bf0d59",""],["08","Kid","#bf0d59",""],
  ["09","Nonfood","#07978d",""],["10","Home Coordy","#214ab5","TOPVALU"],["11","Home Coordy","#214ab5","TOPVALU"],["12","Household","#214ab5",""],
  ["13","Household","#214ab5",""],["14","Nonfood","#07978d",""],["15","Nonfood","#07978d",""],["16","Nonfood","#07978d",""],
  ["17","Beer Liquor","#62676a",""],["18","Tea Drinks","#dfb100",""],["19","Coffee","#dfb100",""],["20","Topvalu","#b00059","TOPVALU"],
  ["21","Topvalu","#b00059","TOPVALU"],["22","Asia","#62676a",""],["23","Asia","#62676a",""],["24","Noodles","#62676a",""],
  ["25","Rice","#62676a",""],["26","Sauces","#62676a",""],["27","Spices","#62676a",""],["28","Sea Food","#62676a",""],
];

function initialState() {
  const now = Date.now();
  return {
    products: [
      { id:"p1",sku:"10531914",barcode:"45497410531914",supplierBarcode:"45497410531914",name:"HC TẤM TRẢI LÀM MÁT ICECOLD 160X200GY",division:"12",divisionName:"HOME & LIVING",department:"1201",departmentName:"HOME COORDY",line:"12",lineName:"HOUSEHOLD",side:"A",bay:3,price:450000,stock:5,loss:0,expDate:"2026-12-31",updatedAt:now },
      { id:"p2",sku:"10763049",barcode:"45497410763049",supplierBarcode:"45497410763049",name:"HC GỐI MOCHI PILLOW BE",division:"12",divisionName:"HOME & LIVING",department:"1201",departmentName:"HOME COORDY",line:"12",lineName:"HOUSEHOLD",side:"B",bay:2,price:185000,stock:45,loss:2,expDate:"2026-06-15",updatedAt:now },
      { id:"p3",sku:"8969583",barcode:"8801260418800",supplierBarcode:"8801260418800",name:"BVS SOONSOOHANMYEON 23CM 18 MIẾNG",division:"10",divisionName:"HEALTH & BEAUTY",department:"1002",departmentName:"FEMININE CARE",line:"16",lineName:"NONFOOD",side:"A",bay:5,price:45000,stock:0,loss:0,expDate:"2027-01-10",updatedAt:now },
    ],
    accounts: [], sessions: [], roles: [], logs: [], picking: [], pogFiles: [], stockRecords: [], manualChecks: [], stockImport: null,
    appBrand: { logo:"/aeon-logo.svg", logoSize:220, updatedAt:now },
    lineConfigs: lineDefaults.map(([line,name,color,logo]) => ({ line,name,color,logo,updatedAt:now })),
  };
}

async function writeLocalState(state) {
  const tempPath=path.join(path.dirname(statePath),".store-"+randomUUID()+".tmp"),handle=await fs.open(tempPath,"w",0o600);
  try {
    const entries=Object.entries(state);await handle.write("{");
    for(let entryIndex=0;entryIndex<entries.length;entryIndex++){
      const [key,value]=entries[entryIndex];if(entryIndex)await handle.write(",");await handle.write(JSON.stringify(key)+":");
      if((key==="products"||key==="stockRecords")&&Array.isArray(value)){
        await handle.write("[");
        for(let index=0;index<value.length;index+=1000){const batch=value.slice(index,index+1000).map((item)=>JSON.stringify(item)).join(",");await handle.write((index?",":"")+batch);}
        await handle.write("]");
      }else await handle.write(JSON.stringify(value));
    }
    await handle.write("}");await handle.sync();
  } catch(error){await handle.close();await fs.unlink(tempPath).catch(()=>undefined);throw error;}
  await handle.close();
  try { await fs.rename(tempPath,statePath); }
  catch(error){await fs.unlink(tempPath).catch(()=>undefined);throw error;}
}

function asText(value, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function asInt(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }
function cleanLine(value) { return asText(value, "01").replace(/\D/g, "").padStart(2, "0").slice(-2); }
function canManage(role) { return role === "ADMIN" || role === "MANAGER"; }
function normalizeText(value) { return asText(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }
const defaultLineNames = new Map(lineDefaults.map(([line,name]) => [line,name.toUpperCase()]));
function ensureStateShape(source) {
  const state=source&&typeof source==="object"?source:initialState();
  state.products=(Array.isArray(state.products)?state.products:[]).map((product)=>normalizeMasterProduct(product,defaultLineNames.get(cleanLine(product?.line))||""));
  state.accounts=Array.isArray(state.accounts)?state.accounts:[];
  state.sessions=(Array.isArray(state.sessions)?state.sessions:[]).filter((session)=>Number(session.expiresAt)>Date.now());
  state.roles=Array.isArray(state.roles)?state.roles:[];
  state.logs=Array.isArray(state.logs)?state.logs:[];
  state.picking=Array.isArray(state.picking)?state.picking:[];
  state.pogFiles=Array.isArray(state.pogFiles)?state.pogFiles:[];
  state.stockRecords=Array.isArray(state.stockRecords)?state.stockRecords.filter((item)=>asText(item?.sku)).map((item)=>({sku:asText(item.sku),stock:Math.max(0,asInt(item.stock)),sales:Math.max(0,asInt(item.sales)),updatedAt:asInt(item.updatedAt,Date.now())})):[];
  state.manualChecks=Array.isArray(state.manualChecks)?state.manualChecks.filter((item)=>asText(item?.productId)).map((item)=>({productId:asText(item.productId),stock:item.stock===undefined?undefined:Math.max(0,asInt(item.stock)),loss:item.loss===undefined?undefined:Math.max(0,asInt(item.loss)),expDate:asText(item.expDate),updatedAt:asInt(item.updatedAt,Date.now())})):[];
  state.stockImport=state.stockImport&&typeof state.stockImport==="object"?state.stockImport:null;
  state.appBrand=state.appBrand&&typeof state.appBrand==="object"&&typeof state.appBrand.logo==="string"?{logo:state.appBrand.logo,logoSize:Math.max(120,Math.min(320,asInt(state.appBrand.logoSize,220))),updatedAt:asInt(state.appBrand.updatedAt,Date.now())}:{logo:"/aeon-logo.svg",logoSize:220,updatedAt:Date.now()};
  state.lineConfigs=Array.isArray(state.lineConfigs)&&state.lineConfigs.length?state.lineConfigs:lineDefaults.map(([line,name,color,logo])=>({line,name,color,logo,updatedAt:Date.now()}));
  return state;
}
function normalizeUsername(value) { return asText(value).toLowerCase(); }
function validateAccountInput({username,name,password},requirePassword=true) {
  if(!/^[a-z0-9._-]{3,32}$/.test(normalizeUsername(username)))return "Tên đăng nhập cần 3–32 ký tự: chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới";
  if(asText(name).length<2||asText(name).length>64)return "Tên hiển thị cần từ 2 đến 64 ký tự";
  if(requirePassword&&(typeof password!=="string"||password.length<8||password.length>128))return "Mật khẩu cần từ 8 đến 128 ký tự";
  return "";
}
async function hashPassword(password) {
  const salt=randomBytes(16).toString("hex");
  const derived=Buffer.from(await scryptAsync(password,salt,64));
  return "scrypt:"+salt+":"+derived.toString("hex");
}
async function verifyPassword(password,stored) {
  const [scheme,salt,encoded]=asText(stored).split(":");
  if(scheme!=="scrypt"||!salt||!/^[a-f0-9]{128}$/i.test(encoded||""))return false;
  const expected=Buffer.from(encoded,"hex"),actual=Buffer.from(await scryptAsync(password,salt,expected.length));
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
function publicAccount(account) {
  return {userId:account.id,username:account.username,email:account.username,name:account.name,role:account.role,active:account.active!==false,createdAt:account.createdAt,updatedAt:account.updatedAt};
}
function sessionCookie(sessionId,maxAge=sessionMaxAgeSeconds) {
  return "fulfillment_session="+encodeURIComponent(sessionId||"")+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+maxAge+(production?"; Secure":"");
}
function createSession(state,accountId) {
  const now=Date.now(),token=randomBytes(32).toString("base64url"),session={tokenHash:createHash("sha256").update(token).digest("hex"),accountId,createdAt:now,expiresAt:now+sessionMaxAgeSeconds*1000};
  state.sessions=state.sessions.filter((item)=>item.accountId!==accountId||item.expiresAt>now).slice(-199);
  state.sessions.push(session);
  return {session,token};
}
function audit(state, actor, action) {
  state.logs.unshift({ id: randomUUID(), action, userId: actor.userId, userName: actor.name, createdAt: Date.now() });
  state.logs = state.logs.slice(0, 500);
}

const aiRateWindows = new Map();
const aiIntentGroups = [
  { triggers:["canh chua","canh chua ca","canh chua tom"], keywords:["ca","tom","thit","dau bam","ca chua","dua","bac ha","rau","gia vi","nuoc mam","me","chanh","ot","hanh","ngo"] },
  { triggers:["lau","hotpot"], keywords:["rau","nam","thit","hai san","tom","ca","mi","bun","sot","nuoc dung","do uong"] },
  { triggers:["nuong","bbq"], keywords:["thit","hai san","sot","gia vi","do uong","giay","khay"] },
  { triggers:["bua sang","an sang"], keywords:["sua","banh","ngu coc","ca phe","tra","trung"] },
  { triggers:["sinh nhat","tiec"], keywords:["banh","keo","chocolate","nuoc","tra","ca phe","trang tri"] },
  { triggers:["du lich","da ngoai","picnic"], keywords:["nuoc","banh","mi","do hop","khan","tui","nonfood"] },
];

function availableProducts(products) {
  const today = new Date().toISOString().slice(0,10);
  return products.filter((product) => product.stock > 0 && (!product.expDate || product.expDate >= today));
}

function stockIndex(records) {
  return new Map(records.map((record)=>[normalizeText(record.sku),record]));
}
function withUploadedStock(product,index) {
  const record=index.get(normalizeText(product.sku));
  return {...product,stock:record?.stock||0,stockKnown:Boolean(record),loss:0,expDate:""};
}
function manualCheckGroups(state) {
  const productsById=new Map(state.products.map((product)=>[product.id,product]));
  const groups={stock:[],loss:[],expiry:[]};
  for(const check of state.manualChecks){
    const product=productsById.get(check.productId);if(!product)continue;
    if(check.stock!==undefined)groups.stock.push({...product,stock:check.stock,stockKnown:true,updatedAt:check.updatedAt});
    if(check.loss!==undefined)groups.loss.push({...product,loss:check.loss,updatedAt:check.updatedAt});
    if(check.expDate)groups.expiry.push({...product,expDate:check.expDate,updatedAt:check.updatedAt});
  }
  return groups;
}
function productSummary(products,stockRecords=[],manualChecks=[]) {
  const today=new Date();today.setHours(0,0,0,0);const soon=today.getTime()+30*86400000;
  const stats={total:0,outCount:0,lowCount:0,totalLoss:0,expiring:0},alerts=[],lines=new Set();
  const uploaded=stockIndex(stockRecords),manualById=new Map(manualChecks.map((item)=>[item.productId,item]));
  for(const source of products){
    const product=withUploadedStock(source,uploaded),manual=manualById.get(product.id),loss=Number(manual?.loss)||0,expiryText=asText(manual?.expDate),expiry=expiryText?new Date(expiryText+"T00:00:00").getTime():Infinity;
    stats.total++;if(product.stockKnown&&product.stock===0)stats.outCount++;if(product.stockKnown&&product.stock>0&&product.stock<10)stats.lowCount++;stats.totalLoss+=loss;lines.add(product.line);
    if(expiry<=soon)stats.expiring++;
    if(alerts.length<6&&((product.stockKnown&&product.stock<10)||loss>0||expiry<=soon))alerts.push({...product,loss,expDate:expiryText});
  }
  return {stats,alerts,lines:[...lines].sort((a,b)=>Number(a)-Number(b))};
}
const productSearchCache=new WeakMap(),productLookupCache=new WeakMap(),productApiCache=new WeakMap();
function getProductSummary(state){return productSummary(state.products,state.stockRecords,state.manualChecks);}
function productSearchText(product){let value=productSearchCache.get(product);if(!value){value=normalizeText([product.name,product.sku,product.barcode,product.supplierBarcode,product.division,product.divisionName,product.department,product.departmentName,product.line,product.lineName,product.side].join(" "));productSearchCache.set(product,value);}return value;}
function productLookup(products){let lookup=productLookupCache.get(products);if(!lookup){lookup=new Map();for(const product of products){for(const value of [product.sku,product.barcode,product.supplierBarcode]){const key=normalizeText(value);if(key&&!lookup.has(key))lookup.set(key,product);}}productLookupCache.set(products,lookup);}return lookup;}
function getProductApiCache(products){let cache=productApiCache.get(products);if(!cache){cache=new Map();productApiCache.set(products,cache);}return cache;}
function expiryRank(product){if(!product.expDate)return 0;const value=Date.parse(product.expDate+"T00:00:00");return Number.isFinite(value)?value:Number.MAX_SAFE_INTEGER;}
function pushExpiryTop(heap,product,limit){
  if(limit<=0)return;const entry={product,rank:expiryRank(product)},later=(a,b)=>a.rank>b.rank||(a.rank===b.rank&&String(a.product.sku)>String(b.product.sku));
  if(heap.length<limit){heap.push(entry);let index=heap.length-1;while(index>0){const parent=Math.floor((index-1)/2);if(!later(heap[index],heap[parent]))break;[heap[index],heap[parent]]=[heap[parent],heap[index]];index=parent;}return;}
  if(!later(heap[0],entry))return;heap[0]=entry;let index=0;for(;;){const left=index*2+1,right=left+1;let largest=index;if(left<heap.length&&later(heap[left],heap[largest]))largest=left;if(right<heap.length&&later(heap[right],heap[largest]))largest=right;if(largest===index)break;[heap[index],heap[largest]]=[heap[largest],heap[index]];index=largest;}
}

function intentTerms(query) {
  const normalized = normalizeText(query);
  const terms = new Set(normalized.split(/[^a-z0-9]+/).filter((term) => term.length > 1));
  for (const group of aiIntentGroups) if (group.triggers.some((trigger) => normalized.includes(trigger))) group.keywords.forEach((term) => terms.add(term));
  return [...terms];
}

function rankedProducts(query, products) {
  const terms = intentTerms(query);
  return availableProducts(products).map((product) => {
    const haystack = productSearchText(product);
    const score = terms.reduce((total,term) => total + (haystack.includes(term) ? (term.length > 3 ? 5 : 2) : 0),0) + Math.min(2,product.stock/20);
    return { product, score };
  }).sort((a,b) => b.score-a.score || b.product.stock-a.product.stock);
}

const suggestionCache=new Map();

function localProductSuggestions(query, products, notice = "") {
  const ranked = rankedProducts(query, products);
  const matching = ranked.filter((entry) => entry.score > 2.1);
  const selected = (matching.length ? matching : ranked).slice(0,12);
  return {
    mode:"local",
    model:null,
    summary:selected.length
      ? "Đã chọn "+selected.length+" sản phẩm có sẵn phù hợp nhất với nhu cầu của bạn."
      : "Hiện chưa có sản phẩm còn hàng phù hợp trong danh sách.",
    notice,
    items:selected.map(({product}) => ({
      productId:product.id,sku:product.sku,name:product.name,line:product.line,side:product.side,bay:product.bay,
      price:product.price,stock:product.stock,quantity:1,
      reason:"Phù hợp theo tên hàng, nhóm Line và lượng tồn hiện có."
    }))
  };
}

function takeAiQuota(userId) {
  const now=Date.now(),windowMs=60_000,limit=Math.max(1,Math.min(30,asInt(process.env.AI_RATE_LIMIT,8)));
  const recent=(aiRateWindows.get(userId)||[]).filter((time) => now-time<windowMs);
  if(recent.length>=limit)return Math.max(1,Math.ceil((windowMs-(now-recent[0]))/1000));
  recent.push(now);aiRateWindows.set(userId,recent);return 0;
}

async function openAiProductSuggestions(query, products) {
  const apiKey=asText(process.env.OPENAI_API_KEY);
  if(!apiKey)return localProductSuggestions(query,products,"Chưa cấu hình khóa AI; ứng dụng đang dùng bộ phân tích nội bộ.");
  const model=asText(process.env.OPENAI_MODEL,"gpt-5.4-mini");
  const baseUrl=asText(process.env.OPENAI_BASE_URL,"https://api.openai.com/v1").replace(/\/+$/,"");
  const catalogLimit=Math.max(50,Math.min(1000,asInt(process.env.AI_PRODUCT_LIMIT,800)));
  const catalog=rankedProducts(query,products).slice(0,catalogLimit).map(({product}) => ({
    productId:product.id,sku:product.sku,name:product.name,division:product.division,divisionName:product.divisionName,
    department:product.department,departmentName:product.departmentName,supplierBarcode:product.supplierBarcode,
    line:product.line,lineName:product.lineName,side:product.side,bay:product.bay,
    price:product.price,stock:product.stock,expDate:product.expDate
  }));
  if(!catalog.length)return localProductSuggestions(query,products);

  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20_000);
  try {
    const response=await fetch(baseUrl+"/responses",{
      method:"POST",signal:controller.signal,
      headers:{"content-type":"application/json","authorization":"Bearer "+apiKey},
      body:JSON.stringify({
        model,store:false,max_output_tokens:1800,
        instructions:[
          "Bạn là trợ lý chọn sản phẩm cho nhân viên Fulfillment.",
          "Chỉ được chọn productId có trong DANH_SACH_SAN_PHAM; tuyệt đối không tự tạo sản phẩm.",
          "Danh sách đã được lọc còn tồn và chưa hết hạn. Với yêu cầu là một món ăn, hãy suy luận công thức phổ biến và chọn ĐẦY ĐỦ các nguyên liệu thiết yếu có trong danh sách (ví dụ canh chua cần đạm như cá/tôm, rau, quả tạo vị chua và gia vị). Không chỉ chọn một sản phẩm đại diện; có thể chọn nhiều sản phẩm thuộc các nhóm khác nhau.",
          "Trả lời bằng tiếng Việt. Lý do ngắn gọn, cụ thể và không quá 120 ký tự.",
          "Số lượng là số nguyên từ 1 đến 20. Trả tối đa 12 sản phẩm; nếu có nhiều nguyên liệu phù hợp thì trả tất cả nguyên liệu thiết yếu đang có tồn."
        ].join("\n"),
        input:"NHU_CAU: "+query+"\nDANH_SACH_SAN_PHAM:\n"+JSON.stringify(catalog),
        text:{format:{
          type:"json_schema",name:"fulfillment_product_recommendations",strict:true,
          schema:{
            type:"object",additionalProperties:false,
            properties:{
              summary:{type:"string"},
              items:{type:"array",maxItems:12,items:{
                type:"object",additionalProperties:false,
                properties:{productId:{type:"string"},quantity:{type:"integer",minimum:1,maximum:20},reason:{type:"string"}},
                required:["productId","quantity","reason"]
              }}
            },
            required:["summary","items"]
          }
        }}
      })
    });
    if(!response.ok)throw new Error("OpenAI status "+response.status);
    const payload=await response.json();
    const outputText=asText(payload.output_text)||asText(payload.output?.flatMap((item)=>item.content||[]).find((item)=>item.type==="output_text")?.text);
    if(!outputText)throw new Error("OpenAI returned no output text");
    const parsed=JSON.parse(outputText),byId=new Map(catalog.map((product)=>[product.productId,product])),seen=new Set();
    const items=(Array.isArray(parsed.items)?parsed.items:[]).flatMap((item)=>{
      const product=byId.get(asText(item.productId));
      if(!product||seen.has(product.productId))return [];
      seen.add(product.productId);
      return [{...product,quantity:Math.max(1,Math.min(20,asInt(item.quantity,1))),reason:asText(item.reason,"Phù hợp với nhu cầu đã nhập.").slice(0,160)}];
    });
    if(!items.length)return localProductSuggestions(query,products,"AI chưa tìm được kết quả hợp lệ; đã chuyển sang phân tích nội bộ.");
    return {mode:"ai",model,summary:asText(parsed.summary,"Đã tìm thấy "+items.length+" sản phẩm phù hợp.").slice(0,300),notice:"",items};
  } catch(error) {
    console.error("AI suggestion fallback:",error instanceof Error?error.message:"unknown error");
    return localProductSuggestions(query,products,"AI tạm thời chưa phản hồi; kết quả dưới đây được phân tích nội bộ.");
  } finally { clearTimeout(timeout); }
}

class StateStore {
  queue = Promise.resolve();
  localState = null;
  remoteState = null;
  remoteStateAt = 0;
  async init() {
    mkdirSync(uploadDir, { recursive: true });
    mkdirSync(importDir, { recursive: true });
    const staleBefore=Date.now()-6*60*60_000;
    for(const entry of await fs.readdir(importDir,{withFileTypes:true})){
      if(!entry.isFile()||!/^[0-9a-f-]+\.(?:xlsx|result\.json(?:\.part)?)$/i.test(entry.name))continue;
      const candidate=path.join(importDir,entry.name),stat=await fs.stat(candidate).catch(()=>null);if(stat&&stat.mtimeMs<staleBefore)await fs.unlink(candidate).catch(()=>undefined);
    }
    if (pool) {
      await pool.query("CREATE TABLE IF NOT EXISTS fulfillment_state (id BOOLEAN PRIMARY KEY DEFAULT TRUE, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await pool.query("INSERT INTO fulfillment_state (id,state) VALUES (TRUE,$1::jsonb) ON CONFLICT (id) DO NOTHING", [JSON.stringify(initialState())]);
    } else {
      mkdirSync(path.dirname(statePath), { recursive: true });
      if (!existsSync(statePath)) await fs.writeFile(statePath, JSON.stringify(initialState(), null, 2));
      console.warn("DATABASE_URL is not set: using data/store.json for local demo mode.");
    }
    const bootstrapUsername=normalizeUsername(process.env.BOOTSTRAP_ADMIN_USERNAME),bootstrapName=asText(process.env.BOOTSTRAP_ADMIN_NAME,"Quản trị hệ thống"),bootstrapPassword=asText(process.env.BOOTSTRAP_ADMIN_PASSWORD);
    if(bootstrapUsername&&bootstrapPassword){
      const validation=validateAccountInput({username:bootstrapUsername,name:bootstrapName,password:bootstrapPassword});
      if(validation)throw new Error("Bootstrap Admin không hợp lệ: "+validation);
      if(!(await this.read()).accounts.length){
        const passwordHash=await hashPassword(bootstrapPassword);
        await this.mutate((state)=>{
          if(state.accounts.length)return false;
          const now=Date.now(),account={id:randomUUID(),username:bootstrapUsername,name:bootstrapName,role:"ADMIN",active:true,passwordHash,createdAt:now,updatedAt:now};
          state.accounts.push(account);audit(state,publicAccount(account),"Khởi tạo Admin từ cấu hình máy chủ");return true;
        });
      }
    }
  }
  async read() {
    if (pool) { if(this.remoteState&&Date.now()-this.remoteStateAt<3000)return this.remoteState;const fresh=ensureStateShape((await pool.query("SELECT state FROM fulfillment_state WHERE id=TRUE")).rows[0].state);this.remoteState=fresh;this.remoteStateAt=Date.now();return fresh; }
    if(!this.localState)this.localState=ensureStateShape(JSON.parse(await fs.readFile(statePath, "utf8")));
    return this.localState;
  }
  async save(state) {
    if (pool) { await pool.query("UPDATE fulfillment_state SET state=$1::jsonb, updated_at=NOW() WHERE id=TRUE", [JSON.stringify(state)]);this.remoteState=state;this.remoteStateAt=Date.now();productApiCache.delete(state.products); }
    else { try{await writeLocalState(state);this.localState=state;productApiCache.delete(state.products);}catch(error){this.localState=null;throw error;} }
  }
  async mutate(callback) {
    const run = async () => {
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await client.query("SELECT state FROM fulfillment_state WHERE id=TRUE FOR UPDATE");
          const state = ensureStateShape(result.rows[0].state);
          const value = await callback(state);
          await client.query("UPDATE fulfillment_state SET state=$1::jsonb, updated_at=NOW() WHERE id=TRUE", [JSON.stringify(state)]);
          await client.query("COMMIT");this.remoteState=state;this.remoteStateAt=Date.now();productApiCache.delete(state.products);
          return value;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally { client.release(); }
      }
      const state = await this.read();
      try { const value = await callback(state);await this.save(state);return value; }
      catch(error){this.localState=null;throw error;}
    };
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => undefined);
    return task;
  }
}

const store = new StateStore();
const app = express();
app.disable("x-powered-by");
if(production)app.set("trust proxy",1);
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const masterUpload = multer({ storage: multer.diskStorage({destination:(_req,_file,done)=>{mkdirSync(importDir,{recursive:true});done(null,importDir);},filename:(_req,_file,done)=>done(null,randomUUID()+".xlsx")}), limits: { fileSize: masterImportMaxFileBytes, files:1 } });
app.use((req,res,next)=>{
  const cookies=Object.fromEntries((req.headers.cookie||"").split(";").map((part)=>part.trim().split(/=(.*)/s).slice(0,2)).filter(([key])=>key));
  req.fulfillmentSessionId=decodeURIComponent(asText(cookies.fulfillment_session));
  next();
});
app.use("/api",(req,res,next)=>{
  if(["GET","HEAD","OPTIONS"].includes(req.method))return next();
  const origin=asText(req.headers.origin);
  if(origin){try{if(new URL(origin).host!==req.get("host"))return res.status(403).json({error:"Yêu cầu không cùng nguồn"});}catch{return res.status(403).json({error:"Nguồn yêu cầu không hợp lệ"});}}
  next();
});
app.get("/healthz", (_req,res) => res.json({ ok:true, storage:pool?"postgres":"local-json" }));

function actorFrom(req, state) {
  const tokenHash=req.fulfillmentSessionId?createHash("sha256").update(req.fulfillmentSessionId).digest("hex"):"";
  const session=state.sessions.find((item)=>item.tokenHash===tokenHash&&item.expiresAt>Date.now());
  if(!session)return null;
  const account=state.accounts.find((item)=>item.id===session.accountId&&item.active!==false);
  return account?publicAccount(account):null;
}

async function requireManager(req,res,next) {
  try {
    const state=await store.read(),actor=actorFrom(req,state);
    if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    if(!canManage(actor.role))return res.status(403).json({error:"Cần quyền Manager hoặc Admin"});
    req.fulfillmentActor=actor;
    next();
  } catch(error){next(error);}
}

const importIdPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireImportCapacity(req,res,next) {
  const requestedId=asText(req.headers["x-import-id"]),existing=importIdPattern.test(requestedId)?masterJobs.get(requestedId):null;
  if(existing&&existing.ownerId===req.fulfillmentActor.userId)return next();
  const active=[...masterJobs.values()].filter((job)=>["queued","processing"].includes(job.status));
  if(active.some((job)=>job.ownerId===req.fulfillmentActor.userId))return res.status(409).json({error:"Tài khoản đang có một file Master Data được xử lý"});
  if(active.length>=3)return res.status(503).json({error:"Hệ thống đang xử lý nhiều file Excel. Vui lòng thử lại sau."});
  next();
}

const masterJobs=new Map(),masterJobQueue=[];
let masterJobRunning=false;
const stockJobs=new Map();

function publicMasterJob(job) {
  return {
    jobId:job.id,status:job.status,phase:job.phase,percent:job.percent,
    processedRows:job.processedRows||0,totalRows:job.totalRows||0,fileName:job.fileName,
    createdAt:job.createdAt,updatedAt:job.updatedAt,result:job.result||null,error:job.error||"",
  };
}

function updateMasterJob(job,patch) {
  Object.assign(job,patch,{updatedAt:Date.now()});
}

function pruneMasterJobs() {
  const finished=[...masterJobs.values()].filter((job)=>["completed","failed"].includes(job.status)).sort((a,b)=>b.updatedAt-a.updatedAt);
  for(const job of finished.slice(50))masterJobs.delete(job.id);
}

function runMasterWorker(job,resultPath) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./workers/master-import-worker.mjs",import.meta.url),{
      workerData:{filePath:job.filePath,resultPath,maxRows:masterImportMaxRows},
      resourceLimits:{maxOldGenerationSizeMb:1024},
    });
    let settled=false;
    const timeout=setTimeout(()=>void fail(new Error("Xử lý file vượt quá 30 phút và đã được dừng"),true),30*60_000);
    const succeed=(value)=>{if(settled)return;settled=true;clearTimeout(timeout);resolve(value);};
    const fail=async(error,terminate=false)=>{if(settled)return;settled=true;clearTimeout(timeout);if(terminate)await worker.terminate().catch(()=>undefined);reject(error);};
    worker.on("message",(message)=>{
      if(message?.type==="progress")updateMasterJob(job,{status:"processing",phase:message.phase,percent:Math.max(job.percent||0,Number(message.percent)||0),processedRows:Number(message.processedRows)||0,totalRows:Number(message.totalRows)||0});
      if(message?.type==="done")succeed(message.resultPath);
      if(message?.type==="error")void fail(new Error(asText(message.error,"Không thể xử lý file Excel")),true);
    });
    worker.on("error",(error)=>void fail(error));
    worker.on("exit",(code)=>{if(!settled)void fail(new Error("Tiến trình đọc Excel đã dừng mà chưa tạo kết quả (mã "+code+")"));});
  });
}

function runStockWorker(job,resultPath) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL("./workers/stock-import-worker.mjs",import.meta.url),{workerData:{filePath:job.filePath,resultPath,maxRows:masterImportMaxRows},resourceLimits:{maxOldGenerationSizeMb:1024}});
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else resolve(value);};
    const timeout=setTimeout(()=>{void worker.terminate();finish(new Error("Xử lý file Stock vượt quá 30 phút và đã được dừng"));},30*60_000);
    worker.on("message",(message)=>{if(message?.type==="progress")updateMasterJob(job,{status:"processing",phase:message.phase,percent:Math.max(job.percent||0,Number(message.percent)||0),processedRows:Number(message.processedRows)||0,totalRows:Number(message.totalRows)||0});if(message?.type==="done")finish(null,message.resultPath);if(message?.type==="error")finish(new Error(asText(message.error,"Không thể xử lý file Stock")));});
    worker.on("error",(error)=>finish(error));worker.on("exit",(code)=>{if(!settled&&code!==0)finish(new Error("Tiến trình đọc Stock đã dừng (mã "+code+")"));});
  });
}
async function runStockJob(job) {
  const resultPath=path.join(importDir,job.id+".stock.result.json");
  try {
    updateMasterJob(job,{status:"processing",phase:"Đang khởi động bộ xử lý tồn kho",percent:8});await runStockWorker(job,resultPath);
    const result=await store.mutate(async(state)=>{
      const account=state.accounts.find((item)=>item.id===job.ownerId&&item.active!==false);if(!account||!canManage(account.role))throw new Error("Tài khoản không còn quyền cập nhật Stock");
      const reader=createInterface({input:createReadStream(resultPath,{encoding:"utf8"}),crlfDelay:Infinity});let metadata=null,records=[],processed=0;
      for await(const line of reader){if(!line)continue;if(!metadata){metadata=JSON.parse(line);continue;}records.push({...JSON.parse(line),updatedAt:Date.now()});processed++;if(processed%5000===0){updateMasterJob(job,{phase:"Đang lưu danh sách tồn kho",percent:82,processedRows:processed,totalRows:job.totalRows||processed});await yieldToServer();}}
      if(!metadata)throw new Error("Không tìm thấy kết quả file Stock");state.stockRecords=records;state.stockImport={fileName:job.fileName,updatedAt:Date.now(),recordCount:records.length,skipped:metadata.skipped};audit(state,publicAccount(account),"Nhập file Stock: "+records.length+" SKU");
      return {fileName:job.fileName,imported:records.length,headerRow:metadata.headerRow,skipped:metadata.skipped,duplicates:metadata.duplicates,issues:metadata.issues};
    });
    updateMasterJob(job,{status:"completed",phase:"Hoàn tất",percent:100,processedRows:result.imported,totalRows:result.imported,result});
  } catch(error) { updateMasterJob(job,{status:"failed",phase:"Nhập Stock thất bại",error:error instanceof Error?error.message:"Không thể đọc file Stock"}); }
  finally { await Promise.allSettled([fs.unlink(job.filePath),fs.unlink(resultPath),fs.unlink(resultPath+".part")]); }
}

const masterFields=["sku","name","division","divisionName","department","departmentName","supplierBarcode","line","lineName"];
const yieldToServer=()=>new Promise((resolve)=>setImmediate(resolve));
async function mergeMasterResultFile(products,resultPath,job) {
  const nextProducts=products.slice(),indexBySku=new Map();
  for(let index=0;index<nextProducts.length;index++){
    const key=asText(nextProducts[index]?.sku).toUpperCase();if(key&&!indexBySku.has(key))indexBySku.set(key,index);
    if(index>0&&index%5000===0)await yieldToServer();
  }
  const reader=createInterface({input:createReadStream(resultPath,{encoding:"utf8"}),crlfDelay:Infinity});
  let metadata=null,created=0,updated=0,unchanged=0,processed=0;
  for await(const line of reader){
    if(!line)continue;
    if(!metadata){metadata=JSON.parse(line);continue;}
    const source=JSON.parse(line),sku=asText(source.sku),key=sku.toUpperCase();if(!key)continue;
    const master={sku,name:asText(source.name),division:asText(source.division),divisionName:asText(source.divisionName),department:asText(source.department),departmentName:asText(source.departmentName),supplierBarcode:asText(source.supplierBarcode),line:cleanLine(source.line),lineName:asText(source.lineName)};
    const index=indexBySku.get(key);
    if(index===undefined){indexBySku.set(key,nextProducts.length);nextProducts.push({...master,id:randomUUID(),barcode:master.supplierBarcode,side:"A",bay:1,price:0,stock:0,loss:0,expDate:"",updatedAt:Date.now()});created++;}
    else {const current=nextProducts[index],changed=masterFields.some((field)=>asText(current?.[field])!==master[field])||asText(current?.barcode)!==master.supplierBarcode;if(changed){nextProducts[index]={...current,...master,barcode:master.supplierBarcode,updatedAt:Date.now()};updated++;}else unchanged++;}
    processed++;
    if(processed%2000===0){const percent=70+Math.round(processed/Math.max(1,job.totalRows||processed)*16);updateMasterJob(job,{phase:"Đang hợp nhất Master Data",percent:Math.min(86,percent),processedRows:processed,totalRows:job.totalRows||processed});await yieldToServer();}
  }
  if(!metadata)throw new Error("Không tìm thấy kết quả đọc Master Data");
  return {products:nextProducts,metadata,created,updated,unchanged,imported:processed};
}

async function runMasterJob(job) {
  const resultPath=path.join(importDir,job.id+".result.json");
  try {
    updateMasterJob(job,{status:"processing",phase:"Đang khởi động bộ xử lý nền",percent:8});
    await runMasterWorker(job,resultPath);
    updateMasterJob(job,{status:"processing",phase:"Đang hợp nhất Master Data",percent:70});
    const result=await store.mutate(async(state)=>{
      const account=state.accounts.find((item)=>item.id===job.ownerId&&item.active!==false);
      if(!account||!canManage(account.role))throw new Error("Tài khoản không còn quyền cập nhật Master Data");
      const actor=publicAccount(account),merged=await mergeMasterResultFile(state.products,resultPath,job),parsed=merged.metadata;
      updateMasterJob(job,{phase:"Đang lưu dữ liệu sản phẩm",percent:88});state.products=merged.products;
      audit(state,actor,"Nhập Excel Master Data: "+merged.created+" mới, "+merged.updated+" cập nhật, "+parsed.skipped+" bỏ qua");
      return {fileName:job.fileName,created:merged.created,updated:merged.updated,unchanged:merged.unchanged,imported:merged.imported,totalProducts:state.products.length,headerRow:parsed.headerRow,skipped:parsed.skipped,duplicates:parsed.duplicates,issues:parsed.issues};
    });
    updateMasterJob(job,{status:"completed",phase:"Hoàn tất",percent:100,processedRows:result.imported,totalRows:result.imported,result});
  } catch(error) {
    const raw=error instanceof Error?error.message:"Không thể xử lý file Excel";
    const friendly=/^(File Excel|Thiếu cột|File vượt|Không tìm|Tài khoản|Xử lý file)/.test(raw)?raw:"Không thể đọc file Excel. Hãy kiểm tra lại định dạng .xlsx.";
    updateMasterJob(job,{status:"failed",phase:"Nhập dữ liệu thất bại",error:friendly});
  } finally {
    await Promise.allSettled([fs.unlink(job.filePath),fs.unlink(resultPath),fs.unlink(resultPath+".part")]);
    pruneMasterJobs();
  }
}

async function runNextMasterJob() {
  if(masterJobRunning)return;
  const job=masterJobQueue.shift();if(!job)return;
  masterJobRunning=true;
  try { await runMasterJob(job); }
  finally { masterJobRunning=false;void runNextMasterJob(); }
}

function enqueueMasterJob(job) {
  masterJobQueue.push(job);
  void runNextMasterJob();
}

const loginRateWindows=new Map();
function takeLoginQuota(key) {
  const now=Date.now(),windowMs=5*60_000,limit=10,recent=(loginRateWindows.get(key)||[]).filter((time)=>now-time<windowMs);
  if(recent.length>=limit)return Math.max(1,Math.ceil((windowMs-(now-recent[0]))/1000));
  recent.push(now);loginRateWindows.set(key,recent);return 0;
}

app.get("/api/auth/status", async(req,res,next)=>{
  try { const state=await store.read(),actor=actorFrom(req,state);res.set("Cache-Control","no-store").json({authenticated:Boolean(actor),setupRequired:state.accounts.length===0,actor}); }
  catch(error){next(error);}
});

app.post("/api/auth/setup", async(req,res,next)=>{
  try {
    const source=req.body||{},username=normalizeUsername(source.username),name=asText(source.name),password=typeof source.password==="string"?source.password:"",validation=validateAccountInput({username,name,password});
    if(validation)return res.status(400).json({error:validation});
    const passwordHash=await hashPassword(password);
    const result=await store.mutate((state)=>{
      if(state.accounts.length)return {error:"Tài khoản quản trị đã được thiết lập",status:409};
      const now=Date.now(),account={id:randomUUID(),username,name,role:"ADMIN",active:true,passwordHash,createdAt:now,updatedAt:now};
      state.accounts.push(account);const {token}=createSession(state,account.id),actor=publicAccount(account);
      audit(state,actor,"Thiết lập tài khoản quản trị đầu tiên");return {ok:true,actor,sessionToken:token};
    });
    if(result.sessionToken)res.append("Set-Cookie",sessionCookie(result.sessionToken));
    res.status(result.status||200).json(result.error?{error:result.error}:{ok:true,actor:result.actor});
  } catch(error){next(error);}
});

app.post("/api/auth/login", async(req,res,next)=>{
  try {
    const username=normalizeUsername(req.body?.username),password=typeof req.body?.password==="string"?req.body.password:"",quotaKey=req.ip+":"+username,retryAfter=takeLoginQuota(quotaKey);
    if(retryAfter){res.set("Retry-After",String(retryAfter));return res.status(429).json({error:"Đăng nhập quá nhiều lần. Vui lòng thử lại sau "+retryAfter+" giây."});}
    const result=await store.mutate(async(state)=>{
      const account=state.accounts.find((item)=>item.username===username);
      if(!account||account.active===false||!await verifyPassword(password,account.passwordHash))return {error:"Tên đăng nhập hoặc mật khẩu không đúng",status:401};
      const {token}=createSession(state,account.id),actor=publicAccount(account);audit(state,actor,"Đăng nhập hệ thống");
      return {ok:true,actor,sessionToken:token};
    });
    if(result.sessionToken){loginRateWindows.delete(quotaKey);res.append("Set-Cookie",sessionCookie(result.sessionToken));}
    res.status(result.status||200).json(result.error?{error:result.error}:{ok:true,actor:result.actor});
  } catch(error){next(error);}
});

app.post("/api/auth/logout", async(req,res,next)=>{
  try {
    await store.mutate((state)=>{const actor=actorFrom(req,state),tokenHash=req.fulfillmentSessionId?createHash("sha256").update(req.fulfillmentSessionId).digest("hex"):"";state.sessions=state.sessions.filter((item)=>item.tokenHash!==tokenHash);if(actor)audit(state,actor,"Đăng xuất hệ thống");return {ok:true};});
    res.append("Set-Cookie",sessionCookie("",0)).json({ok:true});
  } catch(error){next(error);}
});

app.get("/api/store", async (req, res, next) => {
  try {
    const state=await store.read(),actor=actorFrom(req,state);
    if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập",setupRequired:state.accounts.length===0});
    const uploaded=stockIndex(state.stockRecords),accountsById=new Map(state.accounts.map((account)=>[account.id,account]));
    const pickItem=(item)=>{const product=state.products.find((p)=>p.id===item.productId),assignee=accountsById.get(item.userId);return product?{...withUploadedStock(product,uploaded),pickId:asText(item.id,item.productId),quantity:item.quantity,picked:item.picked,available:item.available!==false,customerName:asText(item.customerName),note:asText(item.note),assignedBy:asText(item.assignedBy),assigneeId:item.userId,assigneeName:asText(assignee?.name,"Nhân viên đã xóa")}:null;};
    const picking=state.picking.filter((item)=>item.userId===actor.userId).map(pickItem).filter(Boolean),assignedPicking=(canManage(actor.role)?state.picking:state.picking.filter((item)=>item.userId===actor.userId)).map(pickItem).filter(Boolean);
    const users=(canManage(actor.role)?state.accounts:state.accounts.filter((account)=>account.id===actor.userId)).map(publicAccount),summary=getProductSummary(state),manual=manualCheckGroups(state);
    const data={actor,products:req.query.includeProducts==="1"?state.products.map((product)=>withUploadedStock(product,uploaded)):[],productTotal:summary.stats.total,productStats:summary.stats,alertProducts:summary.alerts,availableLines:summary.lines,logs:state.logs.slice(0,80),picking,assignedPicking,users,pogFiles:state.pogFiles,lineConfigs:state.lineConfigs,appBrand:state.appBrand,manualChecks:manual,stockImport:state.stockImport};
    res.status(data.status||200).json(data);
  } catch (error) { next(error); }
});

app.get("/api/products", async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const id=asText(req.query.id);
    const uploaded=stockIndex(state.stockRecords);
    if(id){const product=state.products.find((item)=>item.id===id);return product?res.json({products:[withUploadedStock(product,uploaded)],total:1,page:1,pageSize:1}):res.status(404).json({error:"Không tìm thấy sản phẩm"});}
    const query=normalizeText(asText(req.query.q).slice(0,200)),line=asText(req.query.line),side=asText(req.query.side),stock=asText(req.query.stock,"all"),sort=asText(req.query.sort),skuValues=asText(req.query.skus).slice(0,20000).split(",").map(normalizeText).filter(Boolean),skuSet=new Set(skuValues),page=Math.max(1,asInt(req.query.page,1)),pageSize=Math.max(1,Math.min(200,asInt(req.query.pageSize,100))),start=(page-1)*pageSize;
    const cacheKey=[query,line,side,stock,sort,skuValues.join(","),page,pageSize,asInt(state.stockImport?.updatedAt,0)].join("|");
    const apiCache=getProductApiCache(state.products),cached=apiCache.get(cacheKey);if(cached)return res.set("Cache-Control","no-store").json(cached);
    if(query&&!line&&!side&&!skuSet.size&&stock==="all"&&!sort){const exact=productLookup(state.products).get(query);if(exact){const product=withUploadedStock(exact,uploaded);return res.set("Cache-Control","no-store").json({products:[product],total:1,page:1,pageSize:1,matchedLines:[product.line]});}}
    if(!query&&(!line||line==="all")&&!side&&!skuSet.size&&stock==="all"&&!sort)return res.set("Cache-Control","no-store").json({products:state.products.slice(start,start+pageSize).map((product)=>withUploadedStock(product,uploaded)),total:state.products.length,page,pageSize,matchedLines:[]});
    const passesFilters=(product)=>{
      if(skuSet.size&&![product.sku,product.barcode,product.supplierBarcode].map(normalizeText).some((key)=>skuSet.has(key)))return false;if(line&&line!=="all"&&product.line!==line)return false;if(side&&product.side!==side)return false;
      const current=uploaded.get(normalizeText(product.sku));
      if(stock==="available"&&!(current?.stock>0))return false;if(stock==="low"&&!(current?.stock>0&&current.stock<10))return false;if(stock==="out"&&current?.stock!==0)return false;
      return !query||productSearchText(product).includes(query);
    };
    if(sort==="expiry"){
      let total=0,scanned=0;const heap=[],matchedLines=new Set(),limit=start+pageSize;
      for(const product of state.products){if(++scanned%5000===0){await yieldToServer();if(req.destroyed)return;}if(!passesFilters(product))continue;total++;matchedLines.add(product.line);pushExpiryTop(heap,product,limit);}
      const ordered=heap.sort((a,b)=>a.rank-b.rank||String(a.product.sku).localeCompare(String(b.product.sku))).map((entry)=>entry.product);
      const payload={products:ordered.slice(start,start+pageSize).map((product)=>withUploadedStock(product,uploaded)),total,page,pageSize,matchedLines:[...matchedLines]};if(apiCache.size>100)apiCache.delete(apiCache.keys().next().value);apiCache.set(cacheKey,payload);return res.set("Cache-Control","no-store").json(payload);
    }
    let total=0,ordinarySeen=0,scanned=0;const matches=[],exact=[],matchedLines=new Set();
    for(const product of state.products){
      if(++scanned%5000===0){await yieldToServer();if(req.destroyed)return;}if(!passesFilters(product))continue;
      total++;matchedLines.add(product.line);
      const isExact=query&&(normalizeText(product.sku)===query||normalizeText(product.barcode)===query||normalizeText(product.supplierBarcode)===query);
      if(isExact){exact.push(product);continue;}
      if(ordinarySeen>=start&&matches.length<pageSize)matches.push(product);ordinarySeen++;
    }
    if(exact.length){
      matches.length=0;let orderedIndex=0;
      for(const product of exact){if(orderedIndex>=start&&matches.length<pageSize)matches.push(product);orderedIndex++;}
      if(matches.length<pageSize){let rescanned=0;for(const product of state.products){
        if(++rescanned%5000===0){await yieldToServer();if(req.destroyed)return;}
        if(!passesFilters(product))continue;
        if(normalizeText(product.sku)===query||normalizeText(product.barcode)===query||normalizeText(product.supplierBarcode)===query)continue;
        if(orderedIndex>=start&&matches.length<pageSize)matches.push(product);orderedIndex++;if(matches.length>=pageSize)break;
      }}
    }
    const payload={products:matches.map((product)=>withUploadedStock(product,uploaded)),total,page,pageSize,matchedLines:[...matchedLines]};if(apiCache.size>100)apiCache.delete(apiCache.keys().next().value);apiCache.set(cacheKey,payload);res.set("Cache-Control","no-store").json(payload);
  } catch(error){next(error);}
});

app.get("/api/stock", async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const query=normalizeText(asText(req.query.q).slice(0,200)),page=Math.max(1,asInt(req.query.page,1)),pageSize=Math.max(1,Math.min(200,asInt(req.query.pageSize,100))),start=(page-1)*pageSize,bySku=stockIndex(state.stockRecords),productsBySku=new Map(state.products.map((product)=>[normalizeText(product.sku),product]));
    const rows=[];for(const record of state.stockRecords){const product=productsBySku.get(normalizeText(record.sku)),row={...(product||{id:"stock-"+record.sku,sku:record.sku,name:"SKU chưa có trong Master Data",line:"--",lineName:"",side:"",bay:0}),stock:record.stock,stockKnown:true,updatedAt:record.updatedAt};if(!query||productSearchText(row).includes(query))rows.push(row);}
    rows.sort((a,b)=>a.sku.localeCompare(b.sku));res.set("Cache-Control","no-store").json({products:rows.slice(start,start+pageSize),total:rows.length,page,pageSize,stockImport:state.stockImport,unmatched:state.stockRecords.length-bySku.size+rows.filter((row)=>!productsBySku.has(normalizeText(row.sku))).length});
  } catch(error){next(error);}
});

app.get("/api/stock/export.csv",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const csvCell=(value)=>'"'+String(value??"").replace(/"/g,'""')+'"',productsBySku=new Map(state.products.map((product)=>[normalizeText(product.sku),product]));
    res.set({"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=Stock_Fulfillment.csv","Cache-Control":"no-store"});
    res.write("\uFEFF"+["SKU","TÊN SẢN PHẨM","Department","Department Name","Division","Line","Line Name","Sales","Closing Stock"].map(csvCell).join(",")+"\n");
    for(const record of state.stockRecords){const product=productsBySku.get(normalizeText(record.sku))||{},row=[record.sku,product.name,product.department,product.departmentName,product.division,product.line,product.lineName,record.sales,record.stock].map(csvCell).join(",")+"\n";if(!res.write(row))await once(res,"drain");}
    res.end();
  } catch(error){next(error);}
});

app.get("/api/master-data/export.csv",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const csvCell=(value)=>'"'+String(value??"").replace(/"/g,'""')+'"';
    res.set({"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=MasterData_Fulfillment.csv","Cache-Control":"no-store"});
    res.write("\uFEFF"+["SKU","TÊN SẢN PHẨM","Division","DIVISION NAME","Department","DEPARTMENT","SUPPLIER BARCODE","Line","LINE NAME"].map(csvCell).join(",")+"\n");
    for(const product of state.products){const row=[product.sku,product.name,product.division,product.divisionName,product.department,product.departmentName,product.supplierBarcode,product.line,product.lineName].map(csvCell).join(",")+"\n";if(!res.write(row))await once(res,"drain");}
    res.end();
  } catch(error){next(error);}
});

app.post("/api/store", async (req, res, next) => {
  try {
    const result = await store.mutate(async(state) => {
      const actor = actorFrom(req, state), body = req.body || {}, action = asText(body.action);
      const fail = (error, status = 400) => ({ error, status });
      if(!actor)return fail("Vui lòng đăng nhập",401);
      if(action==="createAccount"){
        if(actor.role!=="ADMIN")return fail("Chỉ Admin được tạo tài khoản",403);
        const source=body.account||{},username=normalizeUsername(source.username),name=asText(source.name),password=typeof source.password==="string"?source.password:"",role=asText(source.role,"STAFF"),validation=validateAccountInput({username,name,password});
        if(validation)return fail(validation);
        if(!["ADMIN","MANAGER","STAFF"].includes(role))return fail("Quyền tài khoản không hợp lệ");
        if(state.accounts.some((account)=>account.username===username))return fail("Tên đăng nhập đã tồn tại");
        const now=Date.now(),account={id:randomUUID(),username,name,role,active:true,passwordHash:await hashPassword(password),createdAt:now,updatedAt:now};
        state.accounts.push(account);audit(state,actor,"Tạo tài khoản "+username+" với quyền "+role);return {ok:true,account:publicAccount(account)};
      }
      if(action==="updateAccount"){
        if(actor.role!=="ADMIN")return fail("Chỉ Admin được phân quyền tài khoản",403);
        const source=body.account||{},account=state.accounts.find((item)=>item.id===asText(source.userId));
        if(!account)return fail("Không tìm thấy tài khoản",404);
        const name=asText(source.name,account.name),role=asText(source.role,account.role),active=typeof source.active==="boolean"?source.active:account.active!==false,password=typeof source.password==="string"?source.password:"";
        const validation=validateAccountInput({username:account.username,name,password:""},false);
        if(validation)return fail(validation);
        if(!["ADMIN","MANAGER","STAFF"].includes(role))return fail("Quyền tài khoản không hợp lệ");
        if(account.id===actor.userId&&(role!==account.role||!active))return fail("Bạn không thể tự hạ quyền hoặc khóa tài khoản đang dùng");
        const activeAdmins=state.accounts.filter((item)=>item.active!==false&&item.role==="ADMIN").length;
        if(account.role==="ADMIN"&&account.active!==false&&(role!=="ADMIN"||!active)&&activeAdmins<=1)return fail("Hệ thống phải còn ít nhất một Admin");
        if(password&&(password.length<8||password.length>128))return fail("Mật khẩu mới cần từ 8 đến 128 ký tự");
        account.name=name;account.role=role;account.active=active;account.updatedAt=Date.now();
        if(password){account.passwordHash=await hashPassword(password);state.sessions=state.sessions.filter((session)=>session.accountId!==account.id);}
        if(!active)state.sessions=state.sessions.filter((session)=>session.accountId!==account.id);
        audit(state,actor,"Cập nhật tài khoản "+account.username+": "+role+(active?"":" · đã khóa"));return {ok:true,account:publicAccount(account)};
      }
      if(action==="changeOwnPassword"){
        const account=state.accounts.find((item)=>item.id===actor.userId),currentPassword=typeof body.currentPassword==="string"?body.currentPassword:"",newPassword=typeof body.newPassword==="string"?body.newPassword:"";
        if(!account||!await verifyPassword(currentPassword,account.passwordHash))return fail("Mật khẩu hiện tại không đúng");
        if(newPassword.length<8||newPassword.length>128)return fail("Mật khẩu mới cần từ 8 đến 128 ký tự");
        account.passwordHash=await hashPassword(newPassword);account.updatedAt=Date.now();
        const currentHash=createHash("sha256").update(req.fulfillmentSessionId).digest("hex");state.sessions=state.sessions.filter((session)=>session.accountId!==account.id||session.tokenHash===currentHash);
        audit(state,actor,"Đổi mật khẩu tài khoản");return {ok:true};
      }
      if (action === "upsertProduct") {
        if (!canManage(actor.role)) return fail("Cần quyền Manager hoặc Admin",403);
        const source=body.product||{}, sku=asText(source.sku), name=asText(source.name),requestedId=asText(source.id);
        if (!sku || !name) return fail("SKU và tên sản phẩm là bắt buộc");
        const idIndex=requestedId?state.products.findIndex((item)=>item.id===requestedId):-1;
        const skuIndex=state.products.findIndex((item)=>normalizeText(item.sku)===normalizeText(sku));
        if(skuIndex>=0&&skuIndex!==idIndex)return fail("SKU đã tồn tại trong Master Data");
        const index=idIndex,existing=index>=0?state.products[index]:null,line=cleanLine(source.line);
        if(!defaultLineNames.has(line))return fail("Line phải từ 01 đến 28");
        const supplierBarcode=asText(source.supplierBarcode)||asText(source.barcode);
        const product={...existing,id:requestedId||existing?.id||randomUUID(),sku,name,division:asText(source.division),divisionName:asText(source.divisionName),department:asText(source.department),departmentName:asText(source.departmentName),supplierBarcode,barcode:supplierBarcode,line,lineName:asText(source.lineName)||defaultLineNames.get(line)||"",side:asText(source.side,"A")==="B"?"B":"A",bay:Math.max(1,asInt(source.bay,1)),price:Math.max(0,asInt(source.price)),stock:0,loss:0,expDate:"",updatedAt:Date.now()};
        if(index>=0) state.products[index]=product; else state.products.unshift(product);
        audit(state,actor,"Lưu Master Data SKU "+sku); return {ok:true,id:product.id};
      }
      if (action === "deleteProduct") {
        if (!canManage(actor.role)) return fail("Cần quyền Manager hoặc Admin",403);
        const index=state.products.findIndex((p)=>p.id===asText(body.id));
        if(index>=0){const [item]=state.products.splice(index,1);state.picking=state.picking.filter((p)=>p.productId!==item.id);state.manualChecks=state.manualChecks.filter((check)=>check.productId!==item.id);audit(state,actor,"Xóa sản phẩm SKU "+item.sku);} return {ok:true};
      }
      if (action === "setManualCheck") {
        const kind=asText(body.kind),sku=asText(body.sku),product=state.products.find((p)=>normalizeText(p.sku)===normalizeText(sku));if(!product)return fail("SKU không có trong Master Data",404);
        const value=body.value,now=Date.now(),index=state.manualChecks.findIndex((item)=>item.productId===product.id),current=index>=0?state.manualChecks[index]:{productId:product.id};
        if(kind==="stock")current.stock=Math.max(0,asInt(value));else if(kind==="loss")current.loss=Math.max(0,asInt(value));else if(kind==="expiry"){const date=asText(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return fail("Hạn dùng cần theo định dạng ngày hợp lệ");current.expDate=date;}else return fail("Loại kiểm tra không hợp lệ");
        current.updatedAt=now;if(index>=0)state.manualChecks[index]=current;else state.manualChecks.push(current);audit(state,actor,"Nhập thủ công "+(kind==="stock"?"kiểm tồn":kind==="loss"?"thất thoát":"hạn dùng")+" SKU "+product.sku);return {ok:true};
      }
      if(action==="addPick"){const productId=asText(body.productId),quantity=Math.max(1,Math.min(99,asInt(body.quantity,1))),product=state.products.find((p)=>p.id===productId),record=product&&stockIndex(state.stockRecords).get(normalizeText(product.sku));if(!product)return fail("Không tìm thấy sản phẩm",404);if(!record)return fail("Chưa có dữ liệu tồn kho từ file Stock cho sản phẩm này",409);if(record.stock<=0)return fail("Sản phẩm đang hết hàng",409);const found=state.picking.find((item)=>item.userId===actor.userId&&item.productId===productId);if(found){found.quantity=Math.min(99,found.quantity+quantity);found.picked=false;}else state.picking.push({userId:actor.userId,productId,quantity,picked:false,createdAt:Date.now()});audit(state,actor,"Thêm sản phẩm vào đơn soạn");return {ok:true};}
      if(action==="assignPick"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const productId=asText(body.productId),assigneeId=asText(body.assigneeId),quantity=Math.max(1,Math.min(999,asInt(body.quantity,1))),customerName=asText(body.customerName).slice(0,100),note=asText(body.note).slice(0,500),product=state.products.find((p)=>p.id===productId),assignee=state.accounts.find((account)=>account.id===assigneeId&&account.active!==false),record=product&&stockIndex(state.stockRecords).get(normalizeText(product.sku));if(!product)return fail("Không tìm thấy sản phẩm",404);if(!assignee)return fail("Không tìm thấy nhân viên nhận đơn",404);if(!record||record.stock<=0)return fail("Sản phẩm không có tồn kho từ file Stock",409);if(quantity>record.stock)return fail("Số lượng giao vượt tồn kho hiện có ("+record.stock+")",400);if(!customerName)return fail("Tên khách hàng là bắt buộc");state.picking.push({id:randomUUID(),userId:assigneeId,productId,quantity,picked:false,customerName,note,assignedBy:actor.name,createdAt:Date.now()});audit(state,actor,"Gán SKU "+product.sku+" cho "+assignee.name+" · khách "+customerName);return {ok:true};}
      if(action==="updatePickQuantity"){const key=asText(body.pickId)||asText(body.productId),item=state.picking.find((p)=>(p.id===key||p.productId===key)&&p.userId===actor.userId);if(!item)return fail("Sản phẩm không còn trong đơn",404);item.quantity=Math.max(1,Math.min(99,asInt(body.quantity,1)));item.picked=false;audit(state,actor,"Cập nhật số lượng cần lấy");return {ok:true};}
      if(action==="togglePick"){const key=asText(body.pickId)||asText(body.productId),item=state.picking.find((p)=>(p.id===key||p.productId===key)&&p.userId===actor.userId);if(item)item.picked=!item.picked;audit(state,actor,"Cập nhật trạng thái lấy hàng");return {ok:true};}
      if(action==="markPickAvailability"){const key=asText(body.pickId)||asText(body.productId),item=state.picking.find((p)=>(p.id===key||p.productId===key)&&p.userId===actor.userId);if(!item)return fail("Sản phẩm không còn trong đơn",404);item.available=Boolean(body.available);audit(state,actor,"Đánh dấu sản phẩm "+(item.available?"có hàng":"không có hàng"));return {ok:true};}
      if(action==="removePick"){const key=asText(body.pickId)||asText(body.productId);state.picking=state.picking.filter((p)=>!((p.id===key||p.productId===key)&&p.userId===actor.userId));audit(state,actor,"Bỏ sản phẩm khỏi đơn soạn");return {ok:true};}
      if(action==="clearPick"){state.picking=state.picking.filter((p)=>p.userId!==actor.userId);audit(state,actor,"Hoàn tất và làm trống đơn soạn");return {ok:true};}
      if(action==="updateLineConfig"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const source=body.lineConfig||{},line=cleanLine(source.line),name=asText(source.name).slice(0,48),color=asText(source.color).toUpperCase(),logo=asText(source.logo).slice(0,36);if(!name)return fail("Tên Line là bắt buộc");if(!/^#[0-9A-F]{6}$/.test(color))return fail("Màu cần theo định dạng #RRGGBB");const config={line,name,color,logo,updatedAt:Date.now()},index=state.lineConfigs.findIndex((item)=>item.line===line);if(index>=0)state.lineConfigs[index]=config;else state.lineConfigs.push(config);audit(state,actor,"Cập nhật layout Line "+line+": "+name);return {ok:true};}
      if(action==="updatePogPage"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const line=cleanLine(body.line),side=asText(body.side,"A")==="B"?"B":"A",record=state.pogFiles.find((item)=>item.id===line+"_"+side);if(!record)return fail("Chưa có file POG cho mặt kệ này",404);record.page=Math.max(1,Math.min(99,asInt(body.page,1)));record.updatedAt=Date.now();audit(state,actor,"Đổi trang POG Line "+line+" mặt "+side);return {ok:true};}
      if(action==="updateAppBrand"){if(actor.role!=="ADMIN")return fail("Chỉ Admin được thay đổi logo ứng dụng",403);const logo=asText(body.logo)||state.appBrand?.logo||"/aeon-logo.svg",logoSize=Math.max(120,Math.min(320,asInt(body.logoSize,state.appBrand?.logoSize||220)));if(logo!=="/aeon-logo.svg"&&(!/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,/i.test(logo)||logo.length>1_500_000))return fail("Logo cần là PNG, JPG, WEBP hoặc SVG, dung lượng tối đa 1 MB");state.appBrand={logo,logoSize,updatedAt:Date.now()};audit(state,actor,"Cập nhật logo ứng dụng");return {ok:true};}
      return fail("Thao tác không hợp lệ");
    });
    res.status(result.status||200).json(result);
  } catch (error) { next(error); }
});

app.post("/api/master-data/import", requireManager, requireImportCapacity, masterUpload.single("file"), async (req, res, next) => {
  try {
    if(!req.file)return res.status(400).json({error:"Hãy chọn file Excel .xlsx"});
    const removeUpload=()=>fs.unlink(req.file.path).catch(()=>undefined);
    if(!req.file.originalname.toLowerCase().endsWith(".xlsx")){await removeUpload();return res.status(400).json({error:"Chỉ hỗ trợ file Excel định dạng .xlsx"});}
    const handle=await fs.open(req.file.path,"r");let signature;
    try { signature=Buffer.alloc(4);await handle.read(signature,0,4,0); } finally { await handle.close(); }
    if(req.file.size<4||signature[0]!==0x50||signature[1]!==0x4b){await removeUpload();return res.status(400).json({error:"File .xlsx không hợp lệ hoặc đã bị hỏng"});}
    const requestedId=asText(req.headers["x-import-id"]),jobId=importIdPattern.test(requestedId)?requestedId:randomUUID(),existing=masterJobs.get(jobId);
    if(existing){await removeUpload();if(existing.ownerId!==req.fulfillmentActor.userId)return res.status(409).json({error:"Mã lần nhập đã được sử dụng"});return res.status(202).json(publicMasterJob(existing));}
    const now=Date.now(),job={id:jobId,ownerId:req.fulfillmentActor.userId,fileName:req.file.originalname,filePath:req.file.path,status:"queued",phase:"Đã nhận file, đang chờ xử lý",percent:5,processedRows:0,totalRows:0,createdAt:now,updatedAt:now,result:null,error:""};
    masterJobs.set(job.id,job);
    res.status(202).set("Location","/api/master-data/import/"+job.id).json(publicMasterJob(job));
    enqueueMasterJob(job);
  } catch(error) { next(error); }
});

app.get("/api/master-data/import/:jobId",async(req,res,next)=>{
  try {
    const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const job=masterJobs.get(asText(req.params.jobId));if(!job)return res.status(404).json({error:"Không tìm thấy lần nhập dữ liệu này"});
    if(job.ownerId!==actor.userId&&actor.role!=="ADMIN")return res.status(403).json({error:"Bạn không có quyền xem lần nhập này"});
    res.set("Cache-Control","no-store").json(publicMasterJob(job));
  } catch(error){next(error);}
});

app.post("/api/stock/import", requireManager, masterUpload.single("file"), async(req,res,next)=>{
  try {
    if(!req.file)return res.status(400).json({error:"Hãy chọn file Excel .xlsx"});
    const removeUpload=()=>fs.unlink(req.file.path).catch(()=>undefined);
    if(!req.file.originalname.toLowerCase().endsWith(".xlsx")){await removeUpload();return res.status(400).json({error:"Chỉ hỗ trợ file Excel định dạng .xlsx"});}
    const handle=await fs.open(req.file.path,"r");let signature;try{signature=Buffer.alloc(4);await handle.read(signature,0,4,0);}finally{await handle.close();}
    if(req.file.size<4||signature[0]!==0x50||signature[1]!==0x4b){await removeUpload();return res.status(400).json({error:"File .xlsx không hợp lệ hoặc đã bị hỏng"});}
    const active=[...stockJobs.values()].find((job)=>["queued","processing"].includes(job.status));if(active){await removeUpload();return res.status(409).json({error:"Hệ thống đang xử lý một file Stock khác"});}
    const now=Date.now(),job={id:randomUUID(),ownerId:req.fulfillmentActor.userId,fileName:req.file.originalname,filePath:req.file.path,status:"queued",phase:"Đã nhận file Stock",percent:5,processedRows:0,totalRows:0,createdAt:now,updatedAt:now,result:null,error:""};stockJobs.set(job.id,job);res.status(202).set("Location","/api/stock/import/"+job.id).json(publicMasterJob(job));void runStockJob(job);
  }catch(error){next(error);}
});
app.get("/api/stock/import/:jobId",async(req,res,next)=>{
  try{const state=await store.read(),actor=actorFrom(req,state);if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});const job=stockJobs.get(asText(req.params.jobId));if(!job)return res.status(404).json({error:"Không tìm thấy lần nhập Stock"});if(job.ownerId!==actor.userId&&actor.role!=="ADMIN")return res.status(403).json({error:"Bạn không có quyền xem lần nhập này"});res.set("Cache-Control","no-store").json(publicMasterJob(job));}catch(error){next(error);}
});

app.post("/api/ai/suggest", async (req, res, next) => {
  try {
    const state=await store.read(),actor=actorFrom(req,state);
    if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const query=asText(req.body?.query).slice(0,500);
    if(query.length<2)return res.status(400).json({error:"Hãy mô tả nhu cầu bằng ít nhất 2 ký tự."});
    const cacheKey=normalizeText(query)+"|"+asInt(state.stockImport?.updatedAt,0),cached=suggestionCache.get(cacheKey);
    if(cached&&cached.expiresAt>Date.now())return res.set("Cache-Control","no-store").json(cached.result);
    if(asText(process.env.OPENAI_API_KEY)){
      const retryAfter=takeAiQuota(actor.userId);
      if(retryAfter){res.set("Retry-After",String(retryAfter));return res.status(429).json({error:"Bạn đang phân tích quá nhanh. Vui lòng thử lại sau "+retryAfter+" giây."});}
    }
    const productsBySku=new Map(state.products.map((product)=>[normalizeText(product.sku),product]));
    const stockProducts=state.stockRecords.map((record)=>{const product=productsBySku.get(normalizeText(record.sku));return product?{...product,stock:record.stock,stockKnown:true,loss:0,expDate:"",sales:record.sales||0}:null;}).filter((product)=>product&&product.stock>0).sort((a,b)=>b.stock-a.stock).slice(0,5000);
    const suggestions=await openAiProductSuggestions(query,stockProducts);
    const result={...suggestions,productCount:stockProducts.length};
    suggestionCache.set(cacheKey,{result,expiresAt:Date.now()+60_000});if(suggestionCache.size>100){const oldest=suggestionCache.keys().next().value;if(oldest)suggestionCache.delete(oldest);}
    res.set("Cache-Control","no-store").json(result);
  } catch (error) { next(error); }
});

app.get("/api/pog", async (req, res, next) => {
  try {
    const state=await store.read();
    if(!actorFrom(req,state))return res.status(401).send("Unauthorized");
    const record=state.pogFiles.find((file)=>file.id===asText(req.query.id));
    if(!record)return res.status(404).send("Not found");
    const shelf=asText(req.query.asset)==="shelf"&&record.shelfFileKey,sourceIndex=Math.max(0,asInt(req.query.source)),sources=Array.isArray(record.sources)&&record.sources.length?record.sources:[{fileKey:record.fileKey,fileName:record.fileName,mimeType:record.mimeType}],source=sources[Math.min(sourceIndex,sources.length-1)],fileKey=shelf?record.shelfFileKey:source.fileKey,mimeType=shelf?(record.shelfMimeType||"image/webp"):source.mimeType,fileName=shelf?(record.shelfFileName||"pog-shelf.webp"):source.fileName;
    const filePath=path.join(uploadDir,fileKey);if(!existsSync(filePath))return res.status(404).send("Not found");
    res.type(mimeType).set("Content-Disposition","inline; filename="+fileName.replace(/"/g,"")).sendFile(filePath);
  } catch (error) { next(error); }
});

app.post("/api/pog", requireManager, upload.fields([{name:"file",maxCount:1},{name:"shelfImage",maxCount:1}]), async (req, res, next) => {
  try {
    const files=req.files||{},sourceFile=files.file?.[0],shelfFile=files.shelfImage?.[0];
    if(!sourceFile)return res.status(400).json({error:"Thiếu tệp"});
    const isPdf=sourceFile.mimetype==="application/pdf"||/\.pdf$/i.test(sourceFile.originalname),isImage=sourceFile.mimetype.startsWith("image/");
    if(!isImage&&!isPdf)return res.status(400).json({error:"Chỉ nhận ảnh hoặc PDF"});
    const result=await store.mutate(async(state)=>{
      const actor=actorFrom(req,state);if(!actor)return {error:"Vui lòng đăng nhập",status:401};if(!canManage(actor.role))return {error:"Cần quyền Manager hoặc Admin",status:403};
      const line=cleanLine(req.body.line),side=asText(req.body.side,"A")==="B"?"B":"A",id=line+"_"+side,index=state.pogFiles.findIndex((item)=>item.id===id),existing=index>=0?state.pogFiles[index]:null,mode=["append","reanalyze"].includes(asText(req.body.mode))?asText(req.body.mode):"replace",safeName=sourceFile.originalname.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100),fileKey=Date.now()+"-"+createHash("sha1").update(sourceFile.buffer).digest("hex").slice(0,10)+"-"+safeName,oldSources=existing?(Array.isArray(existing.sources)&&existing.sources.length?existing.sources:[{fileKey:existing.fileKey,fileName:existing.fileName,mimeType:existing.mimeType}]):[];
      let sources;if(mode==="reanalyze"&&oldSources.length)sources=oldSources;else{await fs.writeFile(path.join(uploadDir,fileKey),sourceFile.buffer);const uploadedSource={fileKey,fileName:sourceFile.originalname,mimeType:isPdf?"application/pdf":sourceFile.mimetype};sources=mode==="append"?[...oldSources,uploadedSource]:[uploadedSource];}const primary=sources[0];
      let positions=[];try{positions=JSON.parse(asText(req.body.positions,"[]"));}catch{positions=[];}positions=Array.isArray(positions)?positions.slice(0,10000).map((position)=>({number:Math.max(0,asInt(position.number)),sku:asText(position.sku).slice(0,40),barcode:asText(position.barcode).slice(0,40),name:asText(position.name).slice(0,300),x:Math.max(0,Math.min(1,Number(position.x)||0)),y:Math.max(0,Math.min(1,Number(position.y)||0))})).filter((position)=>position.number&&position.sku):[];
      let shelfFileKey="",shelfFileName="",shelfMimeType="";if(shelfFile&&shelfFile.mimetype.startsWith("image/")){shelfFileName=shelfFile.originalname.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100);shelfFileKey=Date.now()+"-shelf-"+createHash("sha1").update(shelfFile.buffer).digest("hex").slice(0,10)+"-"+shelfFileName;shelfMimeType=shelfFile.mimetype;await fs.writeFile(path.join(uploadDir,shelfFileKey),shelfFile.buffer);}
      const item={id,line,side,fileKey:primary.fileKey,fileName:primary.fileName,mimeType:primary.mimeType,sources,page:Math.max(1,Math.min(99,asInt(req.body.page,existing?.page||1))),shelfFileKey,shelfFileName,shelfMimeType,shelfImage:Boolean(shelfFileKey),shelfWidth:Math.max(0,asInt(req.body.shelfWidth)),shelfHeight:Math.max(0,asInt(req.body.shelfHeight)),positions,sourcePages:asText(req.body.sourcePages).split(",").map((value)=>asInt(value)).filter(Boolean),analysisVersion:Math.max(0,asInt(req.body.analysisVersion)),updatedAt:Date.now()};
      if(index>=0)state.pogFiles[index]=item;else state.pogFiles.push(item);
      audit(state,actor,(mode==="append"?"Thêm file vào":"Cập nhật")+" POG Line "+line+" mặt "+side+": "+sourceFile.originalname+" · "+sources.length+" file · "+positions.length+" SKU đã liên kết");return {ok:true,id,fileName:item.fileName,mimeType:item.mimeType,fileCount:sources.length,mappedCount:positions.length,analyzedPages:item.sourcePages.length};
    });
    res.status(result.status||200).json(result);
  } catch (error) { next(error); }
});

await store.init();
app.use("/api",(_req,res)=>res.status(404).json({error:"API không tồn tại"}));
if(production)app.use(express.static(path.join(root,"dist")));
else { const {createServer:createViteServer}=await import("vite");const vite=await createViteServer({root,server:{middlewareMode:true},appType:"spa"});app.use(vite.middlewares); }
app.use((req,res,next)=>{if(req.method!=="GET"||!req.accepts("html"))return next();res.sendFile(path.join(root,"dist/index.html"));});
app.use((_req,res)=>res.status(404).json({error:"Không tìm thấy"}));
app.use((error,_req,res,next)=>{void next;console.error(error);res.status(error.code==="LIMIT_FILE_SIZE"?413:500).json({error:error.code==="LIMIT_FILE_SIZE"?"Tệp vượt quá dung lượng cho phép (Excel 100 MB, POG 20 MB).":"Máy chủ gặp lỗi. Vui lòng thử lại."});});
app.listen(port,"0.0.0.0",()=>console.log("Fulfillment SmartOps listening on http://0.0.0.0:"+port));
