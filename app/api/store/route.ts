import { actorFrom, addAudit, d1 } from "../../../lib/store-db";

type Payload = Record<string, unknown> & { action?: string };
const asText = (value: unknown, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const asInt = (value: unknown, fallback = 0) => { const number = Number(value); return Number.isFinite(number) ? Math.round(number) : fallback; };
const cleanLine = (value: unknown) => {
  const raw = asText(value, "01").toUpperCase().replace(/^LINE\s*/, "");
  if (raw === "DAILY" || raw === "PROMO") return raw;
  return String(Math.min(28, Math.max(1, asInt(raw, 1)))).padStart(2, "0");
};
const canManage = (role: string) => role === "ADMIN" || role === "MANAGER";

export async function GET(request: Request) {
  try {
    const actor = await actorFrom(request);
    const db = d1();
    const [productsResult, logsResult, pickingResult, usersResult, pogResult] = await Promise.all([
      db.prepare("SELECT id,sku,barcode,name,line,side,bay,price,stock,loss,exp_date AS expDate,updated_at AS updatedAt FROM products ORDER BY CAST(line AS INTEGER),name").all(),
      db.prepare("SELECT id,action,user_id AS userId,user_name AS userName,created_at AS createdAt FROM logs ORDER BY created_at DESC LIMIT 80").all(),
      db.prepare(`SELECT p.id,p.sku,p.barcode,p.name,p.line,p.side,p.bay,p.price,p.stock,p.loss,p.exp_date AS expDate,
        i.quantity,i.picked FROM picking_items i JOIN products p ON p.id=i.product_id
        WHERE i.user_id=? ORDER BY i.created_at`).bind(actor.userId).all(),
      db.prepare("SELECT user_id AS userId,email,name,role,created_at AS createdAt FROM roles ORDER BY created_at").all(),
      db.prepare("SELECT id,line,side,file_name AS fileName,mime_type AS mimeType,updated_at AS updatedAt FROM pog_files ORDER BY line,side").all(),
    ]);
    return Response.json({ actor, products: productsResult.results, logs: logsResult.results, picking: pickingResult.results, users: usersResult.results, pogFiles: pogResult.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không thể tải dữ liệu" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await actorFrom(request);
    const payload = await request.json() as Payload;
    const action = asText(payload.action);
    const db = d1();

    if (action === "adjustStock" || action === "adjustLoss") {
      const id = asText(payload.id);
      const delta = Math.max(-999, Math.min(999, asInt(payload.delta)));
      const field = action === "adjustStock" ? "stock" : "loss";
      const item = await db.prepare("SELECT sku," + field + " AS value FROM products WHERE id=?").bind(id).first<{sku:string;value:number}>();
      if (!item) return Response.json({ error: "Không tìm thấy sản phẩm" }, { status: 404 });
      const next = Math.max(0, item.value + delta);
      await db.prepare("UPDATE products SET " + field + "=?,updated_at=? WHERE id=?").bind(next,Date.now(),id).run();
      await addAudit(actor, `${action === "adjustStock" ? "Cập nhật tồn kho" : "Ghi nhận loss"} SKU ${item.sku}: ${item.value} → ${next}`);
      return Response.json({ ok: true, value: next });
    }

    if (action === "updateDate") {
      const id = asText(payload.id);
      const expDate = asText(payload.expDate);
      const item = await db.prepare("SELECT sku FROM products WHERE id=?").bind(id).first<{sku:string}>();
      if (!item) return Response.json({ error: "Không tìm thấy sản phẩm" }, { status: 404 });
      await db.prepare("UPDATE products SET exp_date=?,updated_at=? WHERE id=?").bind(expDate,Date.now(),id).run();
      await addAudit(actor, `Cập nhật HSD SKU ${item.sku}: ${expDate || "trống"}`);
      return Response.json({ ok: true });
    }

    if (action === "upsertProduct") {
      if (!canManage(actor.role)) return Response.json({ error: "Cần quyền Manager hoặc Admin" }, { status: 403 });
      const product = (payload.product || {}) as Record<string, unknown>;
      const sku = asText(product.sku);
      const name = asText(product.name);
      if (!sku || !name) return Response.json({ error: "SKU và tên sản phẩm là bắt buộc" }, { status: 400 });
      const id = asText(product.id) || crypto.randomUUID();
      const side = asText(product.side, "A") === "B" ? "B" : "A";
      await db.prepare(`INSERT INTO products (id,sku,barcode,name,line,side,bay,price,stock,loss,exp_date,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(sku) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,line=excluded.line,
        side=excluded.side,bay=excluded.bay,price=excluded.price,stock=excluded.stock,
        loss=excluded.loss,exp_date=excluded.exp_date,updated_at=excluded.updated_at`)
        .bind(id,sku,asText(product.barcode),name,cleanLine(product.line),side,Math.max(1,asInt(product.bay,1)),
          Math.max(0,asInt(product.price)),Math.max(0,asInt(product.stock)),Math.max(0,asInt(product.loss)),asText(product.expDate),Date.now()).run();
      await addAudit(actor, `Lưu Master Data SKU ${sku}`);
      return Response.json({ ok: true, id });
    }

    if (action === "importProducts") {
      if (!canManage(actor.role)) return Response.json({ error: "Cần quyền Manager hoặc Admin" }, { status: 403 });
      const rows = Array.isArray(payload.products) ? payload.products.slice(0, 1000) as Array<Record<string, unknown>> : [];
      const valid = rows.filter((row) => asText(row.sku) && asText(row.name));
      const now = Date.now();
      const statements = valid.map((row) => db.prepare(`INSERT INTO products
        (id,sku,barcode,name,line,side,bay,price,stock,loss,exp_date,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(sku) DO UPDATE SET barcode=excluded.barcode,name=excluded.name,line=excluded.line,
        side=excluded.side,bay=excluded.bay,price=excluded.price,stock=excluded.stock,
        loss=excluded.loss,exp_date=excluded.exp_date,updated_at=excluded.updated_at`)
        .bind(asText(row.id) || crypto.randomUUID(),asText(row.sku),asText(row.barcode),asText(row.name),
          cleanLine(row.line),asText(row.side,"A") === "B" ? "B" : "A",Math.max(1,asInt(row.bay,1)),
          Math.max(0,asInt(row.price)),Math.max(0,asInt(row.stock)),Math.max(0,asInt(row.loss)),asText(row.expDate),now));
      if (statements.length) await db.batch(statements);
      await addAudit(actor, `Nhập CSV Master Data: ${statements.length} sản phẩm`);
      return Response.json({ ok: true, count: statements.length });
    }

    if (action === "deleteProduct") {
      if (!canManage(actor.role)) return Response.json({ error: "Cần quyền Manager hoặc Admin" }, { status: 403 });
      const id = asText(payload.id);
      const item = await db.prepare("SELECT sku FROM products WHERE id=?").bind(id).first<{sku:string}>();
      if (item) {
        await db.batch([db.prepare("DELETE FROM picking_items WHERE product_id=?").bind(id),db.prepare("DELETE FROM products WHERE id=?").bind(id)]);
        await addAudit(actor, `Xóa sản phẩm SKU ${item.sku}`);
      }
      return Response.json({ ok: true });
    }

    if (action === "addPick") {
      const productId = asText(payload.productId);
      const quantity = Math.max(1,Math.min(99,asInt(payload.quantity,1)));
      await db.prepare(`INSERT INTO picking_items (user_id,product_id,quantity,picked,created_at)
        VALUES (?,?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET quantity=excluded.quantity`)
        .bind(actor.userId,productId,quantity,0,Date.now()).run();
      await addAudit(actor, "Thêm sản phẩm vào đơn soạn");
      return Response.json({ ok: true });
    }

    if (action === "togglePick") {
      const productId = asText(payload.productId);
      await db.prepare("UPDATE picking_items SET picked=CASE picked WHEN 1 THEN 0 ELSE 1 END WHERE user_id=? AND product_id=?").bind(actor.userId,productId).run();
      await addAudit(actor, "Cập nhật trạng thái lấy hàng");
      return Response.json({ ok: true });
    }

    if (action === "removePick") {
      await db.prepare("DELETE FROM picking_items WHERE user_id=? AND product_id=?").bind(actor.userId,asText(payload.productId)).run();
      await addAudit(actor, "Bỏ sản phẩm khỏi đơn soạn");
      return Response.json({ ok: true });
    }

    if (action === "clearPick") {
      await db.prepare("DELETE FROM picking_items WHERE user_id=?").bind(actor.userId).run();
      await addAudit(actor, "Hoàn tất và làm trống đơn soạn");
      return Response.json({ ok: true });
    }

    if (action === "setRole") {
      if (actor.role !== "ADMIN") return Response.json({ error: "Chỉ Admin được phân quyền" }, { status: 403 });
      const role = asText(payload.role);
      if (!["ADMIN","MANAGER","STAFF"].includes(role)) return Response.json({ error: "Quyền không hợp lệ" }, { status: 400 });
      await db.prepare("UPDATE roles SET role=? WHERE user_id=?").bind(role,asText(payload.userId)).run();
      await addAudit(actor, `Phân quyền người dùng thành ${role}`);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Thao tác không hợp lệ" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không thể cập nhật dữ liệu" }, { status: 500 });
  }
}
