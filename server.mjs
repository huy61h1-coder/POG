import express from "express";
import multer from "multer";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(root, process.env.DATA_DIR || "data");
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || path.join(dataDir,"uploads"));
const statePath = path.join(dataDir, "store.json");
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

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
      { id:"p1",sku:"10531914",barcode:"45497410531914",name:"HC TẤM TRẢI LÀM MÁT ICECOLD 160X200GY",line:"12",side:"A",bay:3,price:450000,stock:5,loss:0,expDate:"2026-12-31",updatedAt:now },
      { id:"p2",sku:"10763049",barcode:"45497410763049",name:"HC GỐI MOCHI PILLOW BE",line:"12",side:"B",bay:2,price:185000,stock:45,loss:2,expDate:"2026-06-15",updatedAt:now },
      { id:"p3",sku:"8969583",barcode:"8801260418800",name:"BVS SOONSOOHANMYEON 23CM 18 MIẾNG",line:"16",side:"A",bay:5,price:45000,stock:0,loss:0,expDate:"2027-01-10",updatedAt:now },
    ],
    roles: [], logs: [], picking: [], pogFiles: [],
    lineConfigs: lineDefaults.map(([line,name,color,logo]) => ({ line,name,color,logo,updatedAt:now })),
  };
}

function asText(value, fallback = "") { return typeof value === "string" ? value.trim() : fallback; }
function asInt(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.trunc(n) : fallback; }
function cleanLine(value) { return asText(value, "01").replace(/\D/g, "").padStart(2, "0").slice(-2); }
function canManage(role) { return role === "ADMIN" || role === "MANAGER"; }
function normalizeText(value) { return asText(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }
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
    const haystack = normalizeText([product.name,product.sku,product.barcode,product.line,product.side].join(" "));
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
    productId:product.id,sku:product.sku,name:product.name,line:product.line,side:product.side,bay:product.bay,
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
  }
  async read() {
    if (pool) return (await pool.query("SELECT state FROM fulfillment_state WHERE id=TRUE")).rows[0].state;
    return JSON.parse(await fs.readFile(statePath, "utf8"));
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
          const state = result.rows[0].state;
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
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.use((req,res,next)=>{
  const cookies=Object.fromEntries((req.headers.cookie||"").split(";").map((part)=>part.trim().split(/=(.*)/s).slice(0,2)).filter(([key])=>key));
  const existing=asText(cookies.fulfillment_device);
  const userId=/^device-[a-f0-9-]{36}$/.test(existing)?existing:"device-"+randomUUID();
  req.fulfillmentUserId=userId;
  if(userId!==existing)res.append("Set-Cookie","fulfillment_device="+userId+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000"+(production?"; Secure":""));
  next();
});
app.get("/healthz", (_req,res) => res.json({ ok:true, storage:pool?"postgres":"local-json" }));

function actorFrom(req, state) {
  const userId = req.fulfillmentUserId;
  const suffix = userId.slice(-4).toUpperCase();
  const email = "device-"+suffix.toLowerCase()+"@fulfillment.local";
  const name = "Nhân viên "+suffix;
  let role = state.roles.find((item) => item.userId === userId);
  if (!role) { role = { userId, email, name, role: state.roles.length ? "STAFF" : "ADMIN", createdAt: Date.now() }; state.roles.push(role); }
  else { role.email = email; role.name = name; }
  return { userId, email, name, role: role.role };
}

app.get("/api/store", async (req, res, next) => {
  try {
    const data = await store.mutate((state) => {
      const actor = actorFrom(req, state);
      const picking = state.picking.filter((item) => item.userId === actor.userId).map((item) => {
        const product = state.products.find((p) => p.id === item.productId);
        return product ? { ...product, quantity: item.quantity, picked: item.picked } : null;
      }).filter(Boolean);
      return { actor, products: state.products, logs: state.logs.slice(0,80), picking, users: state.roles, pogFiles: state.pogFiles, lineConfigs: state.lineConfigs };
    });
    res.json(data);
  } catch (error) { next(error); }
});

app.post("/api/store", async (req, res, next) => {
  try {
    const result = await store.mutate((state) => {
      const actor = actorFrom(req, state), body = req.body || {}, action = asText(body.action);
      const fail = (error, status = 400) => ({ error, status });
      if (action === "upsertProduct") {
        if (!canManage(actor.role)) return fail("Cần quyền Manager hoặc Admin",403);
        const source=body.product||{}, sku=asText(source.sku), name=asText(source.name);
        if (!sku || !name) return fail("SKU và tên sản phẩm là bắt buộc");
        const product={id:asText(source.id)||randomUUID(),sku,barcode:asText(source.barcode),name,line:cleanLine(source.line),side:asText(source.side,"A")==="B"?"B":"A",bay:Math.max(1,asInt(source.bay,1)),price:Math.max(0,asInt(source.price)),stock:Math.max(0,asInt(source.stock)),loss:Math.max(0,asInt(source.loss)),expDate:asText(source.expDate),updatedAt:Date.now()};
        const index=state.products.findIndex((item)=>item.sku===sku||item.id===product.id);
        if(index>=0) state.products[index]=product; else state.products.unshift(product);
        audit(state,actor,"Lưu Master Data SKU "+sku); return {ok:true,id:product.id};
      }
      if (action === "importProducts") {
        if (!canManage(actor.role)) return fail("Cần quyền Manager hoặc Admin",403);
        const rows=Array.isArray(body.products)?body.products.slice(0,1000):[]; let count=0;
        for(const row of rows) {
          const sku=asText(row.sku),name=asText(row.name); if(!sku||!name)continue;
          const index=state.products.findIndex((item)=>item.sku===sku),existing=index>=0?state.products[index]:null;
          const product={id:asText(row.id)||existing?.id||randomUUID(),sku,barcode:asText(row.barcode),name,line:cleanLine(row.line),side:asText(row.side,"A")==="B"?"B":"A",bay:Math.max(1,asInt(row.bay,1)),price:Math.max(0,asInt(row.price)),stock:Math.max(0,asInt(row.stock)),loss:Math.max(0,asInt(row.loss)),expDate:asText(row.expDate),updatedAt:Date.now()};
          if(index>=0)state.products[index]=product;else state.products.unshift(product); count++;
        }
        audit(state,actor,"Nhập CSV Master Data: "+count+" sản phẩm"); return {ok:true,count};
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
      if(action==="setRole"){if(actor.role!=="ADMIN")return fail("Chỉ Admin được phân quyền",403);const role=asText(body.role);if(!["ADMIN","MANAGER","STAFF"].includes(role))return fail("Quyền không hợp lệ");const member=state.roles.find((item)=>item.userId===asText(body.userId));if(!member)return fail("Không tìm thấy người dùng",404);member.role=role;audit(state,actor,"Phân quyền người dùng thành "+role);return {ok:true};}
      if(action==="updateLineConfig"){if(!canManage(actor.role))return fail("Cần quyền Manager hoặc Admin",403);const source=body.lineConfig||{},line=cleanLine(source.line),name=asText(source.name).slice(0,48),color=asText(source.color).toUpperCase(),logo=asText(source.logo).slice(0,36);if(!name)return fail("Tên Line là bắt buộc");if(!/^#[0-9A-F]{6}$/.test(color))return fail("Màu cần theo định dạng #RRGGBB");const config={line,name,color,logo,updatedAt:Date.now()},index=state.lineConfigs.findIndex((item)=>item.line===line);if(index>=0)state.lineConfigs[index]=config;else state.lineConfigs.push(config);audit(state,actor,"Cập nhật layout Line "+line+": "+name);return {ok:true};}
      return fail("Thao tác không hợp lệ");
    });
    res.status(result.status||200).json(result);
  } catch (error) { next(error); }
});

app.post("/api/ai/suggest", async (req, res, next) => {
  try {
    const query=asText(req.body?.query).slice(0,500);
    if(query.length<2)return res.status(400).json({error:"Hãy mô tả nhu cầu bằng ít nhất 2 ký tự."});
    if(asText(process.env.OPENAI_API_KEY)){
      const retryAfter=takeAiQuota(req.fulfillmentUserId);
      if(retryAfter){res.set("Retry-After",String(retryAfter));return res.status(429).json({error:"Bạn đang phân tích quá nhanh. Vui lòng thử lại sau "+retryAfter+" giây."});}
    }
    const state=await store.read();
    const result=await openAiProductSuggestions(query,state.products);
    res.set("Cache-Control","no-store").json({...result,productCount:state.products.length});
  } catch (error) { next(error); }
});

app.get("/api/pog", async (req, res, next) => {
  try {
    const record=(await store.read()).pogFiles.find((file)=>file.id===asText(req.query.id));
    if(!record)return res.status(404).send("Not found");
    const filePath=path.join(uploadDir,record.fileKey);if(!existsSync(filePath))return res.status(404).send("Not found");
    res.type(record.mimeType).set("Content-Disposition","inline; filename="+record.fileName.replace(/"/g,"")).sendFile(filePath);
  } catch (error) { next(error); }
});

app.post("/api/pog", upload.single("file"), async (req, res, next) => {
  try {
    if(!req.file)return res.status(400).json({error:"Thiếu tệp"});
    if(!req.file.mimetype.startsWith("image/")&&req.file.mimetype!=="application/pdf")return res.status(400).json({error:"Chỉ nhận ảnh hoặc PDF"});
    const result=await store.mutate(async(state)=>{
      const actor=actorFrom(req,state);if(!canManage(actor.role))return {error:"Cần quyền Manager hoặc Admin",status:403};
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
app.use((error,_req,res,next)=>{void next;console.error(error);res.status(error.code==="LIMIT_FILE_SIZE"?413:500).json({error:error.code==="LIMIT_FILE_SIZE"?"Tệp vượt quá 20 MB":"Máy chủ gặp lỗi. Vui lòng thử lại."});});
app.listen(port,"0.0.0.0",()=>console.log("Fulfillment SmartOps listening on http://0.0.0.0:"+port));
