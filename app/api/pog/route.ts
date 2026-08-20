import { actorFrom, addAudit, d1, files } from "../../../lib/store-db";

export async function GET(request: Request) {
  try {
    await actorFrom(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });
    const row = await d1().prepare("SELECT file_key AS fileKey,mime_type AS mimeType,file_name AS fileName FROM pog_files WHERE id=?")
      .bind(id).first<{fileKey:string;mimeType:string;fileName:string}>();
    if (!row) return new Response("Not found", { status: 404 });
    const object = await files().get(row.fileKey);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, { headers: { "content-type": row.mimeType, "content-disposition": `inline; filename="${row.fileName.replace(/"/g,"")}"`, "cache-control": "private, max-age=300" } });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Upload unavailable", { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await actorFrom(request);
    if (actor.role === "STAFF") return Response.json({ error: "Cần quyền Manager hoặc Admin" }, { status: 403 });
    const form = await request.formData();
    const file = form.get("file");
    const line = String(form.get("line") || "").replace(/[^0-9A-Z]/gi,"").slice(0,8);
    const side = String(form.get("side") || "A") === "B" ? "B" : "A";
    if (!(file instanceof File) || !line) return Response.json({ error: "Thiếu tệp hoặc dãy hàng" }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Tệp vượt quá 20 MB" }, { status: 400 });
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return Response.json({ error: "Chỉ nhận ảnh hoặc PDF" }, { status: 400 });
    const id = `${line}_${side}`;
    const old = await d1().prepare("SELECT file_key AS fileKey FROM pog_files WHERE id=?").bind(id).first<{fileKey:string}>();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g,"-").slice(-100);
    const key = `pog/${line}/${side}/${Date.now()}-${safeName}`;
    await files().put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    await d1().prepare(`INSERT INTO pog_files (id,line,side,file_key,file_name,mime_type,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET file_key=excluded.file_key,file_name=excluded.file_name,
      mime_type=excluded.mime_type,updated_at=excluded.updated_at`)
      .bind(id,line,side,key,file.name,file.type,Date.now()).run();
    if (old?.fileKey && old.fileKey !== key) await files().delete(old.fileKey);
    await addAudit(actor, `Cập nhật POG Line ${line} mặt ${side}: ${file.name}`);
    return Response.json({ ok: true, id, fileName: file.name, mimeType: file.type });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không thể tải POG" }, { status: 500 });
  }
}
