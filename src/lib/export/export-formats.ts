"use client";

// Exportar a Word (.docx), Excel (.xlsx), Markdown (.md) y página web (.html).
// PDF sigue en export-pdf.ts (diálogo de impresión). Sin librerías: los .docx y .xlsx son
// ZIPs con XML que armamos acá.

import { db } from "../db";
import { SUBJECT_STATUS_LABEL, TASK_TYPE_LABEL, type Note, type Task } from "../types";
import { buildExportHtml, collect, type ExportTarget } from "./export-pdf";
import { safeFileName, saveBlob } from "./save";
import { intlLocale, t } from "@/lib/i18n";

export type ExportFormat = "pdf" | "docx" | "xlsx" | "md" | "html";

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  md: "Markdown",
  html: t("página web"),
};

// ---------- ZIP (sin compresión) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: Record<string, string | Uint8Array>, mime: string): Blob {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: mime });
}

const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------- Word: el documento HTML va adentro del .docx y Word lo convierte al abrir ----------

export async function exportDocx(target: ExportTarget): Promise<void> {
  const { html, title } = await buildExportHtml(target);
  // Saltos de página entre notas, como en el PDF.
  const body = html.replace(/<article class="note">/g, '<article class="note" style="page-break-before:always">');
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="html" ContentType="text/html"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>UniCore</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="htmlChunk" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="contenido.html"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:altChunk r:id="htmlChunk"/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    "word/contenido.html": body,
  };
  await saveBlob(`${safeFileName(title)}.docx`, zip(files, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
}

// ---------- Excel ----------

type Cell = string | number | null | undefined;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

function colName(i: number): string {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

export function xlsxBlob(sheets: Sheet[]): Blob {
  const used = new Set<string>();
  const names = sheets.map((s, i) => {
    let n = s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || t("Hoja {n}", { n: i + 1 });
    while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i + 1}`;
    used.add(n.toLowerCase());
    return n;
  });
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${x(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    // Estilo 1: encabezado en negrita con fondo.
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E9FF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`,
  };
  sheets.forEach((s, i) => {
    const width = Math.max(1, ...s.rows.map((r) => r.length));
    const cols = Array.from({ length: width }, (_, c) => {
      const len = Math.max(6, ...s.rows.slice(0, 200).map((r) => String(r[c] ?? "").length));
      return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, len + 2)}" customWidth="1"/>`;
    }).join("");
    const rows = s.rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((v, ci) => {
              if (v === null || v === undefined || v === "") return "";
              const ref = `${colName(ci)}${ri + 1}`;
              const style = ri === 0 ? ' s="1"' : typeof v === "string" && v.length > 60 ? ' s="2"' : "";
              return typeof v === "number"
                ? `<c r="${ref}"${style}><v>${v}</v></c>`
                : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
            })
            .join("")}</row>`,
      )
      .join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zip(files, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

// Texto plano de contenido inline de BlockNote.
function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((n) => {
      const o = n as Record<string, unknown>;
      if (o.type === "text") return String(o.text ?? "");
      if (o.type === "link") return inlineText(o.content);
      const p = (o.props ?? {}) as Record<string, unknown>;
      return String(p.alias || p.title || "");
    })
    .join("");
}

// Tablas de las notas → hojas. Si una nota no tiene tablas, sus renglones van a una hoja.
function notesToSheets(notes: Note[]): Sheet[] {
  const sheets: Sheet[] = [];
  for (const n of notes) {
    const tables: Cell[][][] = [];
    const lines: Cell[][] = [[t("Bloque"), t("Texto")]];
    const walk = (blocks: unknown[]) => {
      for (const b of blocks as Record<string, unknown>[]) {
        if (b.type === "table") {
          const rows = ((b.content as { rows?: { cells: unknown[] }[] })?.rows ?? []).map((r) =>
            r.cells.map((c) => {
              const t = inlineText(Array.isArray(c) ? c : (c as { content?: unknown })?.content);
              const num = Number(t.replace(/\./g, "").replace(",", "."));
              return t.trim() && /^-?[\d.,]+$/.test(t.trim()) && !isNaN(num) ? num : t;
            }),
          );
          tables.push(rows);
        } else {
          const t = inlineText(b.content);
          if (t.trim()) lines.push([String(b.type ?? ""), t]);
        }
        if (Array.isArray(b.children)) walk(b.children);
      }
    };
    walk(Array.isArray(n.content) ? n.content : []);
    if (tables.length) tables.forEach((t, i) => sheets.push({ name: tables.length > 1 ? `${n.title} ${i + 1}` : n.title, rows: t }));
    else if (lines.length > 1) sheets.push({ name: n.title || t("Nota"), rows: lines });
  }
  return sheets.length ? sheets : [{ name: t("Notas"), rows: [[t("Sin contenido")]] }];
}

export async function exportXlsx(target: ExportTarget): Promise<void> {
  const { title, sections } = await collect(target);
  const notes = sections.flatMap((s) => s.notes);
  const sheets = notesToSheets(notes);
  // Si es una materia o carrera, sumamos sus tareas.
  if (target.kind === "subject" || target.kind === "degree") {
    const tasks =
      target.kind === "subject"
        ? await db.tasks.where("subjectId").equals(target.id).toArray()
        : await db.tasks.where("degreeId").equals(target.id).toArray();
    if (tasks.length) sheets.unshift(await tasksSheet(tasks));
  }
  await saveBlob(`${safeFileName(title)}.xlsx`, xlsxBlob(sheets));
}

async function tasksSheet(tasks: Task[]): Promise<Sheet> {
  const subjects = new Map((await db.subjects.toArray()).map((s) => [s.id, s.name]));
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" }) : "");
  const status = { INBOX_EMAIL: t("Bandeja"), TODO: t("Pendiente"), IN_PROGRESS: t("En curso"), DONE: t("Hecha") } as const;
  return {
    name: t("Agenda"),
    rows: [
      [t("Fecha"), t("Tipo"), t("Título"), t("Materia"), t("Estado"), t("Prioridad"), t("Descripción")],
      ...[...tasks]
        .sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))
        .map((task) => [
          fmt(task.dueDate),
          TASK_TYPE_LABEL[task.type],
          task.title,
          task.subjectId ? (subjects.get(task.subjectId) ?? "") : "",
          status[task.status],
          task.priority === "HIGH" ? t("Alta") : task.priority === "LOW" ? t("Baja") : t("Media"),
          task.description ?? "",
        ]),
    ],
  };
}

// Toda la agenda y el plan de estudios en un Excel.
export async function exportAgendaXlsx(): Promise<void> {
  const [tasks, degrees, subjects] = await Promise.all([db.tasks.toArray(), db.degrees.toArray(), db.subjects.toArray()]);
  const sheets: Sheet[] = [await tasksSheet(tasks)];
  for (const d of degrees) {
    sheets.push({
      name: d.shortName || d.name,
      rows: [
        [t("Año"), t("Cuatrimestre"), t("Materia"), t("Código"), t("Estado"), t("Nota")],
        ...subjects
          .filter((s) => s.degreeId === d.id)
          .sort((a, b) => a.year - b.year || a.semester - b.semester)
          .map((s) => [s.year, s.semester, s.name, s.code ?? "", SUBJECT_STATUS_LABEL[s.status], s.finalGrade ?? ""]),
      ],
    });
  }
  await saveBlob(t("UniCore - agenda y plan de estudios.xlsx"), xlsxBlob(sheets));
}

// ---------- Markdown ----------

function inlineMd(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((n) => {
      const o = n as Record<string, unknown>;
      if (o.type === "text") {
        let t = String(o.text ?? "");
        const st = (o.styles ?? {}) as Record<string, unknown>;
        if (st.code) t = `\`${t}\``;
        if (st.bold) t = `**${t}**`;
        if (st.italic) t = `*${t}*`;
        if (st.strike) t = `~~${t}~~`;
        return t;
      }
      if (o.type === "link") return `[${inlineMd(o.content)}](${String(o.href ?? "")})`;
      const p = (o.props ?? {}) as Record<string, unknown>;
      return o.type === "wikilink" ? `[[${String(p.title ?? "")}]]` : String(p.alias || p.title || "");
    })
    .join("");
}

function blocksToMd(blocks: unknown[], depth = 0): string {
  const out: string[] = [];
  let n = 0;
  const pad = "  ".repeat(depth);
  for (const b of blocks as Record<string, unknown>[]) {
    const p = (b.props ?? {}) as Record<string, unknown>;
    const t = inlineMd(b.content);
    if (b.type !== "numberedListItem") n = 0;
    switch (b.type) {
      case "heading":
        out.push(`${"#".repeat(Number(p.level) || 2)} ${t}`, "");
        break;
      case "bulletListItem":
        out.push(`${pad}- ${t}`);
        break;
      case "numberedListItem":
        out.push(`${pad}${++n}. ${t}`);
        break;
      case "checkListItem":
        out.push(`${pad}- [${p.checked ? "x" : " "}] ${t}`);
        break;
      case "quote":
        out.push(`> ${t}`, "");
        break;
      case "codeBlock":
        out.push("```" + String(p.language ?? ""), t, "```", "");
        break;
      case "image":
        out.push(`![${String(p.caption ?? p.name ?? "")}](${String(p.url ?? "")})`, "");
        break;
      case "table": {
        const rows = ((b.content as { rows?: { cells: unknown[] }[] })?.rows ?? []).map((r) =>
          r.cells.map((c) => inlineMd(Array.isArray(c) ? c : (c as { content?: unknown })?.content).replace(/\|/g, "\\|")),
        );
        if (rows.length) out.push(`| ${rows[0].join(" | ")} |`, `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`), "");
        break;
      }
      default:
        out.push(`${pad}${t}`, depth ? "" : "");
    }
    if (Array.isArray(b.children) && b.children.length) out.push(blocksToMd(b.children, depth + 1));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function exportMarkdown(target: ExportTarget): Promise<void> {
  const { title, sections } = await collect(target);
  const parts: string[] = [];
  for (const s of sections) {
    if (s.title) parts.push(`# ${s.title}`, "");
    for (const n of s.notes) parts.push(`## ${n.title || t("Sin título")}`, "", blocksToMd(Array.isArray(n.content) ? n.content : []), "");
  }
  await saveBlob(`${safeFileName(title)}.md`, new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" }));
}

export async function exportHtml(target: ExportTarget): Promise<void> {
  const { html, title } = await buildExportHtml(target);
  await saveBlob(`${safeFileName(title)}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
}

export async function exportAs(format: ExportFormat, target: ExportTarget): Promise<void> {
  if (format === "pdf") {
    const { exportToPdf } = await import("./export-pdf");
    await exportToPdf(target);
  } else if (format === "docx") await exportDocx(target);
  else if (format === "xlsx") await exportXlsx(target);
  else if (format === "md") await exportMarkdown(target);
  else await exportHtml(target);
}
