// Shared storage API for the Content Path Overlap Checker.
// Data lives in a Netlify Blobs store, so everyone who opens the site sees the same courses.
//
// Keys:
//   courses/<lang>/<id>          JSON: course record (paths, file info, previous versions)
//   files/<lang>/<id>/<stamp>    binary: original uploaded report file
//   state                        JSON: { lastChange, lastBackup }
//   languages                    JSON: [{ code, name }]  (English and Hindi by default)
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const DEFAULT_LANGS = [{ code: "en", name: "English" }, { code: "hi", name: "Hindi" }];
async function getLangs(s) {
  const l = await s.get("languages", { type: "json" });
  return Array.isArray(l) && l.length ? l : DEFAULT_LANGS;
}
function makeCode(name, used) {
  let base = String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 12);
  if (!base) base = "lang";
  let code = base, n = 2;
  while (used.has(code)) code = base + n++;
  return code;
}
const store = () => getStore({ name: "content-path-checker", consistency: "strong" });

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const err = (msg, status = 400) => json({ error: msg }, status);

function passcode() {
  try { return (globalThis.Netlify?.env?.get("TEAM_PASSCODE")) || process.env.TEAM_PASSCODE || ""; }
  catch { return process.env.TEAM_PASSCODE || ""; }
}
const cleanId = s => String(s || "").trim().toLowerCase().slice(0, 200);
const b64ToBytes = b64 => Uint8Array.from(Buffer.from(b64, "base64"));

async function touch(s, extra = {}) {
  const st = (await s.get("state", { type: "json" })) || {};
  await s.setJSON("state", { ...st, lastChange: new Date().toISOString(), ...extra });
}

async function listCourses(s, lang) {
  const { blobs } = await s.list({ prefix: `courses/${lang}/` });
  const all = await Promise.all(blobs.map(b => s.get(b.key, { type: "json" })));
  return all.filter(Boolean);
}

async function saveCourse(s, lang, body, { keepHistory = true, importMode = false } = {}) {
  const id = cleanId(body.name);
  if (!id) throw new Error("Course name is required.");
  if (!Array.isArray(body.entries)) throw new Error("Missing content paths.");
  const key = `courses/${lang}/${id}`;
  const existing = await s.get(key, { type: "json" });
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let fileKey = null;
  if (body.fileB64) {
    fileKey = `files/${lang}/${id}/${stamp}`;
    await s.set(fileKey, b64ToBytes(body.fileB64));
  }

  let history = [];
  if (importMode) {
    // history items arrive with their own base64 files
    for (const h of body.history || []) {
      let hk = null;
      if (h.fileB64) {
        hk = `files/${lang}/${id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        await s.set(hk, b64ToBytes(h.fileB64));
      }
      history.push({ file: h.file, fileType: h.fileType || "", uploadedAt: h.uploadedAt, uploadedBy: h.uploadedBy || "", pathCount: h.pathCount || 0, fileKey: hk });
    }
    if (existing) for (const k of [existing.fileKey, ...(existing.history || []).map(h => h.fileKey)]) if (k) await s.delete(k);
  } else if (existing && keepHistory) {
    history = [...(existing.history || []), {
      file: existing.file, fileType: existing.fileType || "", uploadedAt: existing.uploadedAt,
      uploadedBy: existing.uploadedBy || "", pathCount: (existing.entries || []).length, fileKey: existing.fileKey || null
    }];
  }

  const rec = {
    id, lang, name: String(body.name).trim(), file: body.file || "", fileType: body.fileType || "",
    uploadedAt: importMode && body.uploadedAt ? body.uploadedAt : new Date().toISOString(),
    uploadedBy: String(body.uploadedBy || "").slice(0, 80),
    pathColumn: body.pathColumn || "", titleColumn: body.titleColumn || "",
    entries: body.entries.map(e => ({ row: e.row, path: String(e.path), title: String(e.title || "") })),
    fileKey, history
  };
  await s.setJSON(key, rec);
  await touch(s);
  return { existed: !!existing, course: rec };
}

async function deleteCourse(s, lang, id) {
  const key = `courses/${lang}/${id}`;
  const c = await s.get(key, { type: "json" });
  if (!c) return false;
  for (const k of [c.fileKey, ...(c.history || []).map(h => h.fileKey)]) if (k) await s.delete(k);
  await s.delete(key);
  return true;
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const lang = url.searchParams.get("lang");
  const s = store();
  let langs = DEFAULT_LANGS;
  try { langs = await getLangs(s); } catch (e) { /* storage not reachable: fall back to defaults */ }
  const LANGS = langs.map(l => l.code);
  const isWrite = req.method !== "GET";

  if (isWrite) {
    const pc = passcode();
    if (pc && req.headers.get("x-passcode") !== pc) return err("Passcode required", 401);
  }

  try {
    if (route === "health") return json({ ok: true, passcode: !!passcode() });

    if (route === "languages") {
      if (req.method === "GET") return json(langs);
      if (req.method === "POST") {
        const body = await req.json();
        const name = String(body.name || "").trim().slice(0, 40);
        if (!name) return err("Language name is required.");
        const found = langs.find(l => l.name.toLowerCase() === name.toLowerCase());
        if (found) return json({ language: found, languages: langs, existed: true });
        const code = body.code && /^[a-z0-9]{1,12}$/.test(body.code) && !LANGS.includes(body.code)
          ? body.code : makeCode(name, new Set(LANGS));
        const next = [...langs, { code, name }];
        await s.setJSON("languages", next);
        return json({ language: { code, name }, languages: next });
      }
      if (req.method === "DELETE") {
        const code = url.searchParams.get("code");
        if (!LANGS.includes(code)) return err("Unknown language");
        if (langs.length <= 1) return err("At least one language must remain.");
        const { blobs } = await s.list({ prefix: `courses/${code}/` });
        if (blobs.length) return err("Delete this language's courses first.");
        const next = langs.filter(l => l.code !== code);
        await s.setJSON("languages", next);
        return json({ languages: next });
      }
    }

    if (route === "state" && req.method === "GET") return json((await s.get("state", { type: "json" })) || {});
    if (route === "backup-done" && req.method === "POST") {
      const now = new Date().toISOString();
      const st = (await s.get("state", { type: "json" })) || {};
      await s.setJSON("state", { ...st, lastBackup: now });
      return json({ ok: true, lastBackup: now });
    }

    if (route === "courses") {
      if (req.method === "GET") {
        if (lang === "all") {
          const out = {};
          for (const l of LANGS) out[l] = await listCourses(s, l);
          return json(out);
        }
        if (!LANGS.includes(lang)) return err("Unknown category");
        return json(await listCourses(s, lang));
      }
      if (!LANGS.includes(lang)) return err("Unknown category");
      if (req.method === "POST") {
        const body = await req.json();
        const r = await saveCourse(s, lang, body, { importMode: url.searchParams.get("import") === "1" });
        return json(r);
      }
      if (req.method === "DELETE") {
        const id = url.searchParams.get("id");
        if (id) { await deleteCourse(s, lang, cleanId(id)); }
        else { for (const c of await listCourses(s, lang)) await deleteCourse(s, lang, c.id); }
        await touch(s);
        return json({ ok: true });
      }
    }

    if (route === "file" && req.method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (!key.startsWith("files/")) return err("Bad key");
      const data = await s.get(key, { type: "arrayBuffer" });
      if (!data) return err("File not found", 404);
      const name = url.searchParams.get("name") || "report";
      return new Response(data, {
        headers: {
          "content-type": url.searchParams.get("type") || "application/octet-stream",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          "cache-control": "no-store"
        }
      });
    }

    return err("Not found", 404);
  } catch (e) {
    return err(e.message || "Server error", 500);
  }
};
