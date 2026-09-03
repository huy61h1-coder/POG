import { actorFrom, addAudit, d1, files } from "../../../lib/store-db";

type StoredSource = { key:string; fileName:string; mimeType:string };
const jsonArray = <T,>(value:unknown):T[] => {
  try { const parsed = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
};

export async function GET(request: Request) {
  try {
    await actorFrom(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (!id) return new Response("Missing id", { status: 400 });
    const row = await d1().prepare(`SELECT file_key AS fileKey,mime_type AS mimeType,file_name AS fileName,
      shelf_image_key AS shelfImageKey,sources_json AS sourcesJson FROM pog_files WHERE id=?`)
      .bind(id).first<{fileKey:string;mimeType:string;fileName:string;shelfImageKey?:string|null;sourcesJson?:string}>();
    if (!row) return new Response("Not found", { status: 404 });
    const sourceIndex = params.has("source") ? Number(params.get("source")) : NaN;
    const sources = jsonArray<StoredSource>(row.sourcesJson);
    let key = row.fileKey, mimeType = row.mimeType, fileName = row.fileName;
    if (Number.isInteger(sourceIndex) && sourceIndex >= 0 && sources[sourceIndex]?.key) {
      key = sources[sourceIndex].key; mimeType = sources[sourceIndex].mimeType; fileName = sources[sourceIndex].fileName;
    } else if (params.get("asset") === "shelf" && row.shelfImageKey) {
      key = row.shelfImageKey; mimeType = "image/webp"; fileName = `${row.fileName.replace(/\.pdf$/i, "")}-shelf.webp`;
    }
    const object = await files().get(key);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, { headers: { "content-type": mimeType, "content-disposition": `inline; filename="${fileName.replace(/"/g, "")}"`, "cache-control": "private, max-age=300" } });
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
    const shelfImage = form.get("shelfImage");
    const line = String(form.get("line") || "").replace(/[^0-9A-Z]/gi, "").slice(0, 8);
    const side = String(form.get("side") || "A") === "B" ? "B" : "A";
    const operation = String(form.get("mode") || "replace");
    if (!(file instanceof File) || !line) return Response.json({ error: "Thiếu tệp hoặc dãy hàng" }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Tệp vượt quá 20 MB" }, { status: 400 });
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return Response.json({ error: "Chỉ nhận ảnh hoặc PDF" }, { status: 400 });
    if (shelfImage instanceof File && shelfImage.size > 20 * 1024 * 1024) return Response.json({ error: "Ảnh POG sau khi ghép vượt quá 20 MB" }, { status: 400 });
    const id = `${line}_${side}`;
    const old = await d1().prepare("SELECT file_key AS fileKey,shelf_image_key AS shelfImageKey,sources_json AS sourcesJson FROM pog_files WHERE id=?")
      .bind(id).first<{fileKey:string;shelfImageKey?:string|null;sourcesJson?:string}>();
    const now = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(-100);
    const rawKey = `pog/${line}/${side}/${now}-${safeName}`;
    await files().put(rawKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

    const oldSources = jsonArray<StoredSource>(old?.sourcesJson);
    const newSource:StoredSource = { key:rawKey, fileName:file.name, mimeType:file.type };
    const sourceEntries = operation === "append" ? [...oldSources, newSource] : operation === "reanalyze" && oldSources.length
      ? oldSources.map((source, index) => index === 0 ? newSource : source) : [newSource];
    const analyzed = shelfImage instanceof File && shelfImage.size > 0;
    const shelfKey = analyzed ? `pog/${line}/${side}/${now}-shelf.webp` : null;
    if (shelfImage instanceof File && shelfKey) await files().put(shelfKey, await shelfImage.arrayBuffer(), { httpMetadata: { contentType: "image/webp" } });
    let positionsJson = "[]";
    try { const parsed = JSON.parse(String(form.get("positions") || "[]")); if (Array.isArray(parsed)) positionsJson = JSON.stringify(parsed.slice(0, 5000)); } catch { /* keep empty positions */ }
    const sourcePages = String(form.get("sourcePages") || "").replace(/[^0-9,]/g, "").slice(0, 500);
    const shelfWidth = Number(form.get("shelfWidth")), shelfHeight = Number(form.get("shelfHeight")), analysisVersion = Number(form.get("analysisVersion"));
    await d1().prepare(`INSERT INTO pog_files
      (id,line,side,file_key,file_name,mime_type,updated_at,shelf_image_key,shelf_width,shelf_height,positions_json,source_pages,analysis_version,page,sources_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET file_key=excluded.file_key,file_name=excluded.file_name,mime_type=excluded.mime_type,
      updated_at=excluded.updated_at,shelf_image_key=excluded.shelf_image_key,shelf_width=excluded.shelf_width,
      shelf_height=excluded.shelf_height,positions_json=excluded.positions_json,source_pages=excluded.source_pages,
      analysis_version=excluded.analysis_version,sources_json=excluded.sources_json`)
      .bind(id,line,side,rawKey,file.name,file.type,now,shelfKey,Number.isFinite(shelfWidth)?Math.round(shelfWidth):null,
        Number.isFinite(shelfHeight)?Math.round(shelfHeight):null,positionsJson,sourcePages,Number.isFinite(analysisVersion)?Math.round(analysisVersion):0,1,JSON.stringify(sourceEntries)).run();
    const retainedKeys = new Set(sourceEntries.map((source) => source.key));
    if (old?.fileKey && !retainedKeys.has(old.fileKey)) await files().delete(old.fileKey);
    if (old?.shelfImageKey && old.shelfImageKey !== shelfKey) await files().delete(old.shelfImageKey);
    await addAudit(actor, `Cập nhật POG Line ${line} mặt ${side}: ${file.name}`);
    return Response.json({ ok:true, id, fileName:file.name, mimeType:file.type, mappedCount:jsonArray<unknown>(positionsJson).length, analyzedPages:sourcePages ? sourcePages.split(",").filter(Boolean).length : 0, fileCount:sourceEntries.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Không thể tải POG" }, { status: 500 });
  }
}
