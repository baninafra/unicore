"use client";

// Lee Excel (.xlsx), PowerPoint (.pptx) y Word (.docx) sin librerías: son ZIPs con XML adentro.
// Devuelve Markdown, que después se convierte en nota (md-blocks) o se le pasa a la IA.

// ---------- ZIP mínimo (sólo lectura, "stored" y "deflate") ----------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(buf: ArrayBuffer): Promise<Map<string, () => Promise<Uint8Array>>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // Fin del directorio central: firma 0x06054b50 cerca del final.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no es un documento de Office válido.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const csize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    files.set(name, async () => {
      const lNameLen = view.getUint16(local + 26, true);
      const lExtraLen = view.getUint16(local + 28, true);
      const start = local + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error("Formato de compresión no soportado.");
    });
  }
  return files;
}

async function xml(files: Map<string, () => Promise<Uint8Array>>, path: string): Promise<Document | null> {
  const get = files.get(path);
  if (!get) return null;
  return new DOMParser().parseFromString(new TextDecoder().decode(await get()), "application/xml");
}

// Elementos por nombre local (ignora el prefijo w:, a:, p:).
const tags = (root: Document | Element, local: string) => [...root.getElementsByTagNameNS("*", local)];

// ---------- Excel ----------

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// Fecha de Excel (número de días desde 1899-12-30) → "dd/mm/aaaa".
function excelDate(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

const mdCell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

export async function xlsxToMarkdown(buf: ArrayBuffer): Promise<{ markdown: string; sheets: { name: string; rows: string[][] }[] }> {
  const files = await readZip(buf);
  const shared = (await xml(files, "xl/sharedStrings.xml")) ;
  const strings = shared ? tags(shared, "si").map((si) => tags(si, "t").map((t) => t.textContent ?? "").join("")) : [];

  // Estilos con formato de fecha (para mostrar 45943 como 14/10/2025).
  const styles = await xml(files, "xl/styles.xml");
  const dateFmtIds = new Set([14, 15, 16, 17, 22, 165, 166]);
  if (styles) {
    for (const f of tags(styles, "numFmt")) {
      const code = (f.getAttribute("formatCode") ?? "").toLowerCase();
      if (/[dy]/.test(code) && !/\[h\]/.test(code)) dateFmtIds.add(Number(f.getAttribute("numFmtId")));
    }
  }
  const cellXfs = styles ? tags(styles, "cellXfs")[0] : undefined;
  const xfIsDate = cellXfs ? tags(cellXfs, "xf").map((xf) => dateFmtIds.has(Number(xf.getAttribute("numFmtId")))) : [];

  const wb = await xml(files, "xl/workbook.xml");
  const rels = await xml(files, "xl/_rels/workbook.xml.rels");
  const relMap = new Map(rels ? tags(rels, "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]) : []);
  const sheetsMeta = wb ? tags(wb, "sheet") : [];

  const sheets: { name: string; rows: string[][] }[] = [];
  for (const s of sheetsMeta) {
    const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? s.getAttribute("r:id");
    let target = relMap.get(rid) ?? "";
    target = target.replace(/^\/?xl\//, "");
    const doc = await xml(files, `xl/${target}`);
    if (!doc) continue;
    const rows: string[][] = [];
    for (const row of tags(doc, "row")) {
      const r: string[] = [];
      for (const c of tags(row, "c")) {
        const i = colIndex(c.getAttribute("r") ?? "A");
        const t = c.getAttribute("t");
        const v = tags(c, "v")[0]?.textContent ?? "";
        let val = v;
        if (t === "s") val = strings[Number(v)] ?? "";
        else if (t === "inlineStr") val = tags(c, "t").map((x) => x.textContent ?? "").join("");
        else if (t === "b") val = v === "1" ? "VERDADERO" : "FALSO";
        else if (v && !t && xfIsDate[Number(c.getAttribute("s") ?? -1)]) val = excelDate(Number(v));
        else if (v && /^-?\d+\.\d{6,}$/.test(v)) val = String(Math.round(Number(v) * 1e4) / 1e4).replace(".", ",");
        r[i] = val;
      }
      if (r.some((x) => x && x.trim())) rows.push(Array.from(r, (x) => x ?? ""));
    }
    sheets.push({ name: s.getAttribute("name") ?? `Hoja ${sheets.length + 1}`, rows });
  }

  const md = sheets
    .filter((s) => s.rows.length)
    .map((s) => {
      const width = Math.max(...s.rows.map((r) => r.length));
      const rows = s.rows.map((r) => Array.from({ length: width }, (_, i) => mdCell(r[i] ?? "")));
      const [head, ...body] = rows;
      return [
        `## ${s.name}`,
        "",
        `| ${head.join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...body.map((r) => `| ${r.join(" | ")} |`),
      ].join("\n");
    })
    .join("\n\n");
  return { markdown: md, sheets };
}

// ---------- PowerPoint ----------

export async function pptxToMarkdown(buf: ArrayBuffer): Promise<string> {
  const files = await readZip(buf);
  const slidePaths = [...files.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  const out: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const doc = await xml(files, slidePaths[i]);
    if (!doc) continue;
    let title = "";
    const lines: string[] = [];
    for (const sp of tags(doc, "sp")) {
      const ph = tags(sp, "ph")[0]?.getAttribute("type") ?? "";
      const paras = tags(sp, "p")
        .map((p) => ({
          text: tags(p, "t").map((t) => t.textContent ?? "").join("").trim(),
          lvl: Number(tags(p, "pPr")[0]?.getAttribute("lvl") ?? 0),
        }))
        .filter((p) => p.text);
      if (!paras.length) continue;
      if ((ph === "title" || ph === "ctrTitle") && !title) {
        title = paras.map((p) => p.text).join(" ");
        continue;
      }
      for (const p of paras) lines.push(`${"  ".repeat(p.lvl)}- ${p.text}`);
    }
    // Tablas dentro de la diapositiva
    for (const tbl of tags(doc, "tbl")) {
      const rows = tags(tbl, "tr").map((tr) => tags(tr, "tc").map((tc) => mdCell(tags(tc, "t").map((t) => t.textContent ?? "").join(" "))));
      if (!rows.length) continue;
      lines.push("", `| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`), "");
    }
    // Notas del orador
    const notes = await xml(files, slidePaths[i].replace("slides/slide", "notesSlides/notesSlide"));
    const noteText = notes
      ? tags(notes, "p")
          .map((p) => tags(p, "t").map((t) => t.textContent ?? "").join("").trim())
          .filter((t) => t && !/^\d+$/.test(t))
          .join(" ")
      : "";
    out.push(`## ${title || `Diapositiva ${i + 1}`}`, ...lines, ...(noteText ? [`> ${noteText}`] : []), "");
  }
  return out.join("\n");
}

// ---------- Word ----------

export async function docxToMarkdown(buf: ArrayBuffer): Promise<string> {
  const files = await readZip(buf);
  const doc = await xml(files, "word/document.xml");
  if (!doc) throw new Error("No pudimos leer el documento.");
  const body = tags(doc, "body")[0];
  const out: string[] = [];
  for (const el of body ? [...body.children] : []) {
    if (el.localName === "p") {
      const style = tags(el, "pStyle")[0]?.getAttribute("w:val") ?? tags(el, "pStyle")[0]?.getAttributeNS("*", "val") ?? "";
      const runs = tags(el, "r").map((r) => {
        const t = tags(r, "t").map((x) => x.textContent ?? "").join("");
        if (!t.trim()) return t;
        const bold = tags(r, "b").length > 0;
        const italic = tags(r, "i").length > 0;
        return bold ? `**${t}**` : italic ? `*${t}*` : t;
      });
      const text = runs.join("").replace(/\*\*\s*\*\*/g, "").trim();
      if (!text) {
        out.push("");
        continue;
      }
      const h = style.match(/(?:Heading|Ttulo|Titulo|título)\s*(\d)/i);
      const isList = tags(el, "numPr").length > 0 || /List/i.test(style);
      if (h) out.push(`${"#".repeat(Math.min(3, Number(h[1])))} ${text.replace(/\*\*/g, "")}`);
      else if (/^Title$/i.test(style)) out.push(`# ${text.replace(/\*\*/g, "")}`);
      else if (isList) out.push(`- ${text}`);
      else out.push(text, "");
    } else if (el.localName === "tbl") {
      const rows = tags(el, "tr").map((tr) => tags(tr, "tc").map((tc) => mdCell(tags(tc, "t").map((t) => t.textContent ?? "").join(" "))));
      if (rows.length) out.push("", `| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`), "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
