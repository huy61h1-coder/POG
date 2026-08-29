import express from "express";
import multer from "multer";
import { Pool } from "pg";
import { readSheet } from "read-excel-file/node";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mergeMasterRecords, normalizeMasterProduct, parseMasterDataRows } from "./lib/master-data.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(root, process.env.DATA_DIR || "data");
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || path.join(dataDir,"uploads"));
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
    accounts: [], sessions: [], roles: [], logs: [], picking: [], pogFiles: [],
    lineConfigs: lineDefaults.map(([line,name,color,logo]) => ({ line,name,color,logo,updatedAt:now })),
  };
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

function intentTerms(query) {
  const normalized = normalizeText(query);
  const terms = new Set(normalized.split(/[^a-z0-9]+/).filter((term) => term.length > 1));
  for (const group of aiIntentGroups) if (group.triggers.some((trigger) => normalized.includes(trigger))) group.keywords.forEach((term) => terms.add(term));
  return [...terms];
}

function rankedProducts(query, products) {
  const terms = intentTerms(query);
  return availableProducts(products).map((product) => {
    const haystack = normalizeText([product.name,product.sku,product.barcode,product.supplierBarcode,product.division,product.divisionName,product.department,product.departmentName,product.line,product.lineName,product.side].join(" "));
    const score = terms.reduce((total,term) => total + (haystack.includes(term) ? (term.length > 3 ? 5 : 2) : 0),0) + Math.min(2,product.stock/20);
    return { product, score };
  }).sort((a,b) => b.score-a.score || b.product.stock-a.product.stock);
}

function localProductSuggestions(query, products, notice = "") {
  const ranked = rankedProducts(query, products);
  const matching = ranked.filter((entry) => entry.score > 2.1);
  const selected = (matching.length ? matching : ranked).slice(0,6);
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
        model,store:false,max_output_tokens:1200,
        instructions:[
          "Bạn là trợ lý chọn sản phẩm cho nhân viên Fulfillment.",
          "Chỉ được chọn productId có trong DANH_SACH_SAN_PHAM; tuyệt đối không tự tạo sản phẩm.",
          "Danh sách đã được lọc còn tồn và chưa hết hạn. Ưu tiên một bộ sản phẩm hữu ích, tránh trùng công dụng.",
          "Trả lời bằng tiếng Việt. Lý do ngắn gọn, cụ thể và không quá 120 ký tự.",
          "Số lượng là số nguyên từ 1 đến 20. Trả tối đa 8 sản phẩm."
        ].join("\n"),
        input:"NHU_CAU: "+query+"\nDANH_SACH_SAN_PHAM:\n"+JSON.stringify(catalog),
        text:{format:{
          type:"json_schema",name:"fulfillment_product_recommendations",strict:true,
          schema:{
            type:"object",additionalProperties:false,
            properties:{
              summary:{type:"string"},
              items:{type:"array",maxItems:8,items:{
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
  async init() {
    mkdirSync(uploadDir, { recursive: true });
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
    if (pool) return ensureStateShape((await pool.query("SELECT state FROM fulfillment_state WHERE id=TRUE")).rows[0].state);
    return ensureStateShape(JSON.parse(await fs.readFile(statePath, "utf8")));
  }
  async save(state) {
    if (pool) await pool.query("UPDATE fulfillment_state SET state=$1::jsonb, updated_at=NOW() WHERE id=TRUE", [JSON.stringify(state)]);
    else await fs.writeFile(statePath, JSON.stringify(state, null, 2));
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
          await client.query("COMMIT");
          return value;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally { client.release(); }
      }
      const state = await this.read();
      const value = await callback(state);
      await this.save(state);
      return value;
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
const masterUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: masterImportMaxFileBytes, files:1 } });
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
    const data = await store.mutate((state) => {
      const actor = actorFrom(req, state);
      if(!actor)return {error:"Vui lòng đăng nhập",status:401,setupRequired:state.accounts.length===0};
      const picking = state.picking.filter((item) => item.userId === actor.userId).map((item) => {
        const product = state.products.find((p) => p.id === item.productId);
        return product ? { ...product, quantity: item.quantity, picked: item.picked } : null;
      }).filter(Boolean);
      const users=(actor.role==="ADMIN"?state.accounts:state.accounts.filter((account)=>account.id===actor.userId)).map(publicAccount);
      return { actor, products: state.products, logs: state.logs.slice(0,80), picking, users, pogFiles: state.pogFiles, lineConfigs: state.lineConfigs };
    });
    res.status(data.status||200).json(data);
  } catch (error) { next(error); }
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
        const product={...existing,id:requestedId||existing?.id||randomUUID(),sku,name,division:asText(source.division),divisionName:asText(source.divisionName),department:asText(source.department),departmentName:asText(source.departmentName),supplierBarcode,barcode:supplierBarcode,line,lineName:asText(source.lineName)||defaultLineNames.get(line)||"",side:asText(source.side,"A")==="B"?"B":"A",bay:Math.max(1,asInt(source.bay,1)),price:Math.max(0,asInt(source.price)),stock:Math.max(0,asInt(source.stock)),loss:Math.max(0,asInt(source.loss)),expDate:asText(source.expDate),updatedAt:Date.now()};
        if(index>=0) state.products[index]=product; else state.products.unshift(product);
        audit(state,actor,"Lưu Master Data SKU "+sku); return {ok:true,id:product.id};
      }
      if (action === "deleteProduct") {
        if (!canManage(actor.role)) return fail("Cần quyền Manager hoặc Admin",403);
        const index=state.products.findIndex((p)=>p.id===asText(body.id));
        if(index>=0){const [item]=state.products.splice(index,1);state.picking=state.picking.filter((p)=>p.productId!==item.id);audit(state,actor,"Xóa sản phẩm SKU "+item.sku);} return {ok:true};
      }
      if (action === "adjustStock" || action === "adjustLoss" || action === "updateDate") {
        const product=state.products.find((p)=>p.id===asText(body.id)); if(!product)return fail("Không tìm thấy sản phẩm",404);
        if(action==="adjustStock"){product.stock=Math.max(0,product.stock+asInt(body.delta));audit(state,actor,"Cập nhật tồn SKU "+product.sku);}
        if(action==="adjustLoss"){product.loss=Math.max(0,product.loss+asInt(body.delta));audit(state,actor,"Cập nhật loss SKU "+product.sku);}
        if(action==="updateDate"){product.expDate=asText(body.expDate);audit(state,actor,"Cập nhật HSD SKU "+product.sku);}
        product.updatedAt=Date.now();return {ok:true};
      }
      if(action==="addPick"){const productId=asText(body.productId),quantity=Math.max(1,Math.min(99,asInt(body.quantity,1)));if(!state.products.some((p)=>p.id===productId))return fail("Không tìm thấy sản phẩm",404);const found=state.picking.find((item)=>item.userId===actor.userId&&item.productId===productId);if(found){found.quantity=Math.min(99,found.quantity+quantity);found.picked=false;}else state.picking.push({userId:actor.userId,productId,quantity,picked:false,createdAt:Date.now()});audit(state,actor,"Thêm sản phẩm vào đơn soạn");return {ok:true};}
      if(action==="updatePickQuantity"){const item=state.picking.find((p)=>p.userId===actor.userId&&p.productId===asText(body.productId));if(!item)return fail("Sản phẩm không còn trong đơn",404);item.quantity=Math.max(1,Math.min(99,asInt(body.quantity,1)));item.picked=false;audit(state,actor,"Cập nhật số lượng cần lấy");return {ok:true};}
      if(action==="togglePick"){const item=state.picking.find((p)=>p.userId===actor.userId&&p.productId===asText(body.productId));if(item)item.picked=!item.picked;audit(state,actor,"Cập nhật trạng thái lấy hàng");return {ok:true};}
      if(action==="removePick"){state.picking=state.picking.filter((p)=>!(p.userId===actor.userId&&p.productId===asText(body.productId)));audit(state,actor,"Bỏ sản phẩm khỏi đơn soạn");return {ok:true};}
      if(action==="clearPick"){state.picking=state.picking.filter((p)=>p.userId!==actor.userId);audit(state,actor,"Hoàn tất và làm trống đơn soạn");return {ok:true};}
      if(action==="updateLineConfig"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const source=body.lineConfig||{},line=cleanLine(source.line),name=asText(source.name).slice(0,48),color=asText(source.color).toUpperCase(),logo=asText(source.logo).slice(0,36);if(!name)return fail("Tên Line là bắt buộc");if(!/^#[0-9A-F]{6}$/.test(color))return fail("Màu cần theo định dạng #RRGGBB");const config={line,name,color,logo,updatedAt:Date.now()},index=state.lineConfigs.findIndex((item)=>item.line===line);if(index>=0)state.lineConfigs[index]=config;else state.lineConfigs.push(config);audit(state,actor,"Cập nhật layout Line "+line+": "+name);return {ok:true};}
      return fail("Thao tác không hợp lệ");
    });
    res.status(result.status||200).json(result);
  } catch (error) { next(error); }
});

app.post("/api/master-data/import", masterUpload.single("file"), async (req, res, next) => {
  try {
    const accessState=await store.read(),accessActor=actorFrom(req,accessState);
    if(!accessActor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    if(!canManage(accessActor.role))return res.status(403).json({error:"Cần quyền Manager hoặc Admin"});
    if(!req.file)return res.status(400).json({error:"Hãy chọn file Excel .xlsx"});
    if(!req.file.originalname.toLowerCase().endsWith(".xlsx"))return res.status(400).json({error:"Chỉ hỗ trợ file Excel định dạng .xlsx"});
    if(req.file.buffer.length<4||req.file.buffer[0]!==0x50||req.file.buffer[1]!==0x4b)return res.status(400).json({error:"File .xlsx không hợp lệ hoặc đã bị hỏng"});

    let parsed;
    try {
      const rows=await readSheet(req.file.buffer);
      parsed=parseMasterDataRows(rows,{maxRows:masterImportMaxRows});
    } catch(error) {
      const message=error instanceof Error&&/^(File Excel|Thiếu cột|File vượt|Không tìm)/.test(error.message)?error.message:"Không thể đọc file Excel. Hãy kiểm tra lại định dạng .xlsx.";
      return res.status(422).json({error:message});
    }

    const result=await store.mutate((state)=>{
      const actor=actorFrom(req,state);
      if(!actor)return {error:"Vui lòng đăng nhập",status:401};
      if(!canManage(actor.role))return {error:"Cần quyền Manager hoặc Admin",status:403};
      const merged=mergeMasterRecords(state.products,parsed.records,{createId:randomUUID,now:Date.now()});
      state.products=merged.products;
      audit(state,actor,"Nhập Excel Master Data: "+merged.created+" mới, "+merged.updated+" cập nhật, "+parsed.skipped+" bỏ qua");
      return {ok:true,fileName:req.file.originalname,created:merged.created,updated:merged.updated,unchanged:merged.unchanged,imported:parsed.records.length,totalProducts:state.products.length,headerRow:parsed.headerRow,skipped:parsed.skipped,duplicates:parsed.duplicates,issues:parsed.issues};
    });
    res.status(result.status||200).json(result);
  } catch(error) { next(error); }
});

app.post("/api/ai/suggest", async (req, res, next) => {
  try {
    const state=await store.read(),actor=actorFrom(req,state);
    if(!actor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    const query=asText(req.body?.query).slice(0,500);
    if(query.length<2)return res.status(400).json({error:"Hãy mô tả nhu cầu bằng ít nhất 2 ký tự."});
    if(asText(process.env.OPENAI_API_KEY)){
      const retryAfter=takeAiQuota(actor.userId);
      if(retryAfter){res.set("Retry-After",String(retryAfter));return res.status(429).json({error:"Bạn đang phân tích quá nhanh. Vui lòng thử lại sau "+retryAfter+" giây."});}
    }
    const result=await openAiProductSuggestions(query,state.products);
    res.set("Cache-Control","no-store").json({...result,productCount:state.products.length});
  } catch (error) { next(error); }
});

app.get("/api/pog", async (req, res, next) => {
  try {
    const state=await store.read();
    if(!actorFrom(req,state))return res.status(401).send("Unauthorized");
    const record=state.pogFiles.find((file)=>file.id===asText(req.query.id));
    if(!record)return res.status(404).send("Not found");
    const filePath=path.join(uploadDir,record.fileKey);if(!existsSync(filePath))return res.status(404).send("Not found");
    res.type(record.mimeType).set("Content-Disposition","inline; filename="+record.fileName.replace(/"/g,"")).sendFile(filePath);
  } catch (error) { next(error); }
});

app.post("/api/pog", upload.single("file"), async (req, res, next) => {
  try {
    const accessState=await store.read(),accessActor=actorFrom(req,accessState);
    if(!accessActor)return res.status(401).json({error:"Vui lòng đăng nhập"});
    if(!canManage(accessActor.role))return res.status(403).json({error:"Cần quyền Manager hoặc Admin"});
    if(!req.file)return res.status(400).json({error:"Thiếu tệp"});
    if(!req.file.mimetype.startsWith("image/")&&req.file.mimetype!=="application/pdf")return res.status(400).json({error:"Chỉ nhận ảnh hoặc PDF"});
    const result=await store.mutate(async(state)=>{
      const actor=actorFrom(req,state);if(!actor)return {error:"Vui lòng đăng nhập",status:401};if(!canManage(actor.role))return {error:"Cần quyền Manager hoặc Admin",status:403};
      const line=cleanLine(req.body.line),side=asText(req.body.side,"A")==="B"?"B":"A",id=line+"_"+side,safeName=req.file.originalname.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100),fileKey=Date.now()+"-"+createHash("sha1").update(req.file.buffer).digest("hex").slice(0,10)+"-"+safeName;
      await fs.writeFile(path.join(uploadDir,fileKey),req.file.buffer);const index=state.pogFiles.findIndex((item)=>item.id===id);
      const item={id,line,side,fileKey,fileName:req.file.originalname,mimeType:req.file.mimetype,updatedAt:Date.now()};
      if(index>=0)state.pogFiles[index]=item;else state.pogFiles.push(item);
      audit(state,actor,"Cập nhật POG Line "+line+" mặt "+side+": "+req.file.originalname);return {ok:true,id,fileName:req.file.originalname,mimeType:req.file.mimetype};
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
