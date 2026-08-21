import { env } from "cloudflare:workers";

export type Actor = { userId: string; email: string; name: string; role: "ADMIN" | "MANAGER" | "STAFF" };

export function d1() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export function files() {
  if (!env.FILES) throw new Error("R2 binding FILES is unavailable");
  return env.FILES;
}

const defaultLineConfigs = [
  ["01","Souvenir","#dfb100",""],["02","Choco","#c00057",""],["03","Fruit","#c8185d",""],["04","Confec","#bf0d59",""],
  ["05","Milk","#62676a",""],["06","Milk","#62676a",""],["07","Kid","#bf0d59",""],["08","Kid","#bf0d59",""],
  ["09","Nonfood","#07978d",""],["10","Home Coordy","#214ab5","TOPVALU"],["11","Home Coordy","#214ab5","TOPVALU"],["12","Household","#214ab5",""],
  ["13","Household","#214ab5",""],["14","Nonfood","#07978d",""],["15","Nonfood","#07978d",""],["16","Nonfood","#07978d",""],
  ["17","Beer Liquor","#62676a",""],["18","Tea Drinks","#dfb100",""],["19","Coffee","#dfb100",""],["20","Topvalu","#b00059","TOPVALU"],
  ["21","Topvalu","#b00059","TOPVALU"],["22","Asia","#62676a",""],["23","Asia","#62676a",""],["24","Noodles","#62676a",""],
  ["25","Rice","#62676a",""],["26","Sauces","#62676a",""],["27","Spices","#62676a",""],["28","Sea Food","#62676a",""]
] as const;

export async function ensureSchema() {
  const db = d1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, barcode TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL, line TEXT NOT NULL, side TEXT NOT NULL DEFAULT 'A',
      bay INTEGER NOT NULL DEFAULT 1, price INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0, loss INTEGER NOT NULL DEFAULT 0,
      exp_date TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_products_line_side ON products(line, side)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS roles (
      user_id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'STAFF', created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, user_id TEXT NOT NULL,
      user_name TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS picking_items (
      user_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
      picked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, product_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pog_files (
      id TEXT PRIMARY KEY, line TEXT NOT NULL, side TEXT NOT NULL,
      file_key TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_pog_line_side ON pog_files(line, side)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS line_configs (
      line TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
      logo TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    )`),
  ]);

  const now = Date.now();
  await db.batch(defaultLineConfigs.map(([line, name, color, logo]) => db.prepare(
    "INSERT OR IGNORE INTO line_configs (line,name,color,logo,updated_at) VALUES (?,?,?,?,?)"
  ).bind(line, name, color, logo, now)));

  const count = await db.prepare("SELECT COUNT(*) AS total FROM products").first<{ total: number }>();
  if (!count?.total) {
    const now = Date.now();
    await db.batch([
      db.prepare("INSERT INTO products (id,sku,barcode,name,line,side,bay,price,stock,loss,exp_date,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("p1","10531914","45497410531914","HC TẤM TRẢI LÀM MÁT ICECOLD 160X200GY","12","A",3,450000,5,0,"2026-12-31",now),
      db.prepare("INSERT INTO products (id,sku,barcode,name,line,side,bay,price,stock,loss,exp_date,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("p2","10763049","45497410763049","HC GỐI MOCHI PILLOW BE","12","B",2,185000,45,2,"2026-06-15",now),
      db.prepare("INSERT INTO products (id,sku,barcode,name,line,side,bay,price,stock,loss,exp_date,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind("p3","8969583","8801260418800","BVS SOONSOOHANMYEON 23CM 18 MIẾNG","16","A",5,45000,0,0,"2027-01-10",now),
    ]);
  }
  await db.prepare("PRAGMA optimize").run();
}

function decodeName(value: string | null, encoding: string | null) {
  if (!value) return null;
  if (encoding !== "percent-encoded-utf-8") return value;
  try { return decodeURIComponent(value); } catch { return null; }
}

export async function actorFrom(request: Request): Promise<Actor> {
  await ensureSchema();
  const userId = request.headers.get("oai-authenticated-user-id") || "local-user";
  const email = request.headers.get("oai-authenticated-user-email") || "local@fulfillment.helper";
  const fullName = decodeName(request.headers.get("oai-authenticated-user-full-name"), request.headers.get("oai-authenticated-user-full-name-encoding"));
  const name = fullName || email.split("@")[0] || "Nhân viên";
  const db = d1();
  let row = await db.prepare("SELECT role FROM roles WHERE user_id = ?").bind(userId).first<{ role: Actor["role"] }>();
  if (!row) {
    const count = await db.prepare("SELECT COUNT(*) AS total FROM roles").first<{ total: number }>();
    const role: Actor["role"] = count?.total ? "STAFF" : "ADMIN";
    await db.prepare("INSERT INTO roles (user_id,email,name,role,created_at) VALUES (?,?,?,?,?)").bind(userId,email,name,role,Date.now()).run();
    row = { role };
  } else {
    await db.prepare("UPDATE roles SET email=?, name=? WHERE user_id=?").bind(email,name,userId).run();
  }
  return { userId, email, name, role: row.role };
}

export async function addAudit(actor: Actor, action: string) {
  await d1().prepare("INSERT INTO logs (id,action,user_id,user_name,created_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(), action, actor.userId, actor.name, Date.now()).run();
}
