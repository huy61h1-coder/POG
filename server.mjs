import express from "express";
import multer from "multer";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || "data/uploads");
const statePath = path.resolve(root, "data/store.json");
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
function audit(state, actor, action) {
  state.logs.unshift({ id: randomUUID(), action, userId: actor.userId, userName: actor.name, createdAt: Date.now() });
  state.logs = state.logs.slice(0, 500);
}

class StateStore {
  async init() {
    mkdirSync(uploadDir, { recursive: true });
    if (pool) {
      await pool.query("CREATE TABLE IF NOT EXISTS fulfillment_state (id BOOLEAN PRIMARY KEY DEFAULT TRUE, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      const result = await pool.query("SELECT state FROM fulfillment_state WHERE id=TRUE");
      if (!result.rowCount) await pool.query("INSERT INTO fulfillment_state (id,state) VALUES (TRUE,$1::jsonb)", [JSON.stringify(initialState())]);
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
  async mutate(callback) { const state = await this.read(); const value = await callback(state); await this.save(state); return value; }
}

const store = new StateStore();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function actorFrom(req, state) {
  const userId = asText(req.header("x-user-id"), "local-user");
  const email = asText(req.header("x-user-email"), "local@fulfillment.smartops");
  const name = asText(req.header("x-user-name"), email.split("@")[0] || "Nhân viên");
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
          const product={id:asText(row.id)||randomUUID(),sku,barcode:asText(row.barcode),name,line:cleanLine(row.line),side:asText(row.side,"A")==="B"?"B":"A",bay:Math.max(1,asInt(row.bay,1)),price:Math.max(0,asInt(row.price)),stock:Math.max(0,asInt(row.stock)),loss:Math.max(0,asInt(row.loss)),expDate:asText(row.expDate),updatedAt:Date.now()};
          const index=state.products.findIndex((item)=>item.sku===sku); if(index>=0)state.products[index]=product;else state.products.unshift(product); count++;
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
      if(action==="addPick"){const productId=asText(body.productId);if(!state.products.some((p)=>p.id===productId))return fail("Không tìm thấy sản phẩm",404);const found=state.picking.find((item)=>item.userId===actor.userId&&item.productId===productId);if(found)found.quantity=Math.max(1,Math.min(99,asInt(body.quantity,1)));else state.picking.push({userId:actor.userId,productId,quantity:Math.max(1,Math.min(99,asInt(body.quantity,1))),picked:false,createdAt:Date.now()});audit(state,actor,"Thêm sản phẩm vào đơn soạn");return {ok:true};}
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
      if(index>=0){await fs.rm(path.join(uploadDir,state.pogFiles[index].fileKey),{force:true});state.pogFiles[index]=item;}else state.pogFiles.push(item);
      audit(state,actor,"Cập nhật POG Line "+line+" mặt "+side+": "+req.file.originalname);return {ok:true,id,fileName:req.file.originalname,mimeType:req.file.mimetype};
    });
    res.status(result.status||200).json(result);
  } catch (error) { next(error); }
});

app.use((error,_req,res,_next)=>{console.error(error);res.status(error.code==="LIMIT_FILE_SIZE"?413:500).json({error:error.code==="LIMIT_FILE_SIZE"?"Tệp vượt quá 20 MB":"Máy chủ gặp lỗi. Vui lòng thử lại."});});
await store.init();
if(production)app.use(express.static(path.join(root,"dist")));
else { const vite=await createViteServer({root,server:{middlewareMode:true},appType:"spa"});app.use(vite.middlewares); }
app.use((_req,res)=>res.sendFile(path.join(root,"dist/index.html")));
app.listen(port,"0.0.0.0",()=>console.log("Fulfillment SmartOps listening on http://0.0.0.0:"+port));
