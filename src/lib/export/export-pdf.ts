"use client";

// Exportar a PDF: una nota, una materia, una carrera o una carpeta especial.
// Arma un documento HTML con portada, índice y las notas, y abre el diálogo de impresión
// del sistema, donde se elige "Guardar como PDF" / "Microsoft Print to PDF".

import { db } from "../db";
import { DAILY_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Note } from "../types";

export type ExportTarget =
  | { kind: "note"; id: string }
  | { kind: "subject"; id: string }
  | { kind: "degree"; id: string }
  | { kind: "folder"; folder: typeof DAILY_FOLDER | typeof LOOSE_FOLDER | typeof TEMPLATES_FOLDER };

const FOLDER_NAMES: Record<string, string> = {
  [DAILY_FOLDER]: "Diario",
  [LOOSE_FOLDER]: "Notas",
  [TEMPLATES_FOLDER]: "Plantillas",
};

// ---------- Bloques de BlockNote → HTML ----------

type Json = Record<string, unknown>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function fileToDataUrl(url: string): Promise<string | undefined> {
  if (!url.startsWith("idb://")) return url;
  const rec = await db.files.get(url.slice(6));
  if (!rec) return undefined;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => resolve(undefined);
    r.readAsDataURL(rec.blob);
  });
}

function inlineToHtml(content: unknown): string {
  if (typeof content === "string") return esc(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((node) => {
      const n = node as Json;
      if (n.type === "text") {
        let t = esc(String(n.text ?? "")).replace(/\n/g, "<br>");
        const st = (n.styles ?? {}) as Json;
        if (st.code) t = `<code>${t}</code>`;
        if (st.bold) t = `<strong>${t}</strong>`;
        if (st.italic) t = `<em>${t}</em>`;
        if (st.underline) t = `<u>${t}</u>`;
        if (st.strike) t = `<s>${t}</s>`;
        return t;
      }
      if (n.type === "link") return `<a href="${esc(String(n.href ?? ""))}">${inlineToHtml(n.content)}</a>`;
      if (n.type === "wikilink") {
        const p = (n.props ?? {}) as Json;
        return `<span class="wl">${esc(String(p.alias || p.title || ""))}</span>`;
      }
      // Otro contenido inline custom: intentamos mostrar su texto
      if (n.content) return inlineToHtml(n.content);
      const p = (n.props ?? {}) as Json;
      return p.title ? esc(String(p.title)) : "";
    })
    .join("");
}

function tableToHtml(content: Json): string {
  const rows = (content.rows ?? []) as { cells: unknown[] }[];
  return `<table>${rows
    .map(
      (r, i) =>
        `<tr>${r.cells
          .map((c) => {
            const cell = c as Json;
            const inner = Array.isArray(c) ? inlineToHtml(c) : inlineToHtml(cell.content);
            return i === 0 ? `<th>${inner}</th>` : `<td>${inner}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</table>`;
}

async function blocksToHtml(blocks: unknown[]): Promise<string> {
  let html = "";
  let listTag: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listTag) html += `</${listTag}>`;
    listTag = null;
  };

  for (const raw of blocks) {
    const b = raw as Json;
    const props = (b.props ?? {}) as Json;
    const children = Array.isArray(b.children) && b.children.length ? await blocksToHtml(b.children) : "";
    const text = inlineToHtml(b.content);
    const type = String(b.type);

    const wantList = type === "bulletListItem" || type === "checkListItem" ? "ul" : type === "numberedListItem" ? "ol" : null;
    if (wantList !== listTag) {
      closeList();
      if (wantList) {
        html += wantList === "ul" && type === "checkListItem" ? `<ul class="check">` : `<${wantList}>`;
        listTag = wantList;
      }
    }

    switch (type) {
      case "heading": {
        const level = Math.min(Number(props.level ?? 1) + 1, 6); // h1 queda para el título de la nota
        html += `<h${level}>${text}</h${level}>${children}`;
        break;
      }
      case "bulletListItem":
      case "numberedListItem":
        html += `<li>${text}${children}</li>`;
        break;
      case "checkListItem":
        html += `<li class="${props.checked ? "done" : ""}"><span class="box">${props.checked ? "&#10003;" : ""}</span>${text}${children}</li>`;
        break;
      case "quote":
        html += `<blockquote>${text}${children}</blockquote>`;
        break;
      case "codeBlock":
        html += `<pre><code>${text}</code></pre>`;
        break;
      case "table":
        html += tableToHtml(b.content as Json);
        break;
      case "image": {
        const src = await fileToDataUrl(String(props.url ?? ""));
        if (src) html += `<figure><img src="${src}">${props.caption ? `<figcaption>${esc(String(props.caption))}</figcaption>` : ""}</figure>`;
        break;
      }
      case "callout":
        html += `<div class="callout"><div class="callout-type">${esc(String(props.type ?? props.kind ?? "Nota"))}</div>${text}${children}</div>`;
        break;
      case "audio":
      case "video":
      case "file":
        html += `<p class="muted">[${esc(String(props.name || (type === "audio" ? "Audio" : "Archivo")))}]</p>`;
        break;
      default:
        if (text || children) html += `<p>${text}</p>${children}`;
        else html += `<p class="empty"></p>`;
    }
  }
  closeList();
  return html;
}

// Texto "pregunta :: respuesta #tarjeta" y otros bloques se exportan tal cual.

function propsTable(note: Note): string {
  const rows: [string, string][] = [];
  for (const [k, v] of Object.entries(note.properties ?? {})) rows.push([k, Array.isArray(v) ? v.join(", ") : String(v)]);
  if (note.aliases?.length) rows.push(["alias", note.aliases.join(", ")]);
  if (note.tags?.length) rows.push(["etiquetas", note.tags.map((t) => `#${t}`).join(" ")]);
  if (!rows.length) return "";
  return `<table class="props">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
}

// ---------- Armado del documento ----------

interface Section {
  title: string; // "Unidad 1", nombre de materia, etc.
  notes: Note[];
}

function sortNotes(notes: Note[]) {
  return [...notes].sort((a, b) => a.unitNumber - b.unitNumber || a.createdAt.localeCompare(b.createdAt));
}

function byUnit(notes: Note[], prefix = ""): Section[] {
  const units = new Map<number, Note[]>();
  for (const n of sortNotes(notes)) units.set(n.unitNumber, [...(units.get(n.unitNumber) ?? []), n]);
  if (units.size <= 1) return [{ title: prefix, notes: sortNotes(notes) }];
  return [...units.entries()].map(([u, ns]) => ({ title: `${prefix ? `${prefix} · ` : ""}Unidad ${u}`, notes: ns }));
}

export async function collect(target: ExportTarget): Promise<{ title: string; subtitle?: string; sections: Section[] }> {
  if (target.kind === "note") {
    const note = await db.notes.get(target.id);
    if (!note) throw new Error("No encontramos la nota.");
    const subject = await db.subjects.get(note.subjectId);
    return { title: note.title || "Sin título", subtitle: subject?.name ?? FOLDER_NAMES[note.subjectId], sections: [{ title: "", notes: [note] }] };
  }
  if (target.kind === "subject") {
    const subject = await db.subjects.get(target.id);
    if (!subject) throw new Error("No encontramos la materia.");
    const degree = await db.degrees.get(subject.degreeId);
    const notes = await db.notes.where("subjectId").equals(subject.id).toArray();
    return { title: subject.name, subtitle: degree?.name, sections: byUnit(notes) };
  }
  if (target.kind === "degree") {
    const degree = await db.degrees.get(target.id);
    if (!degree) throw new Error("No encontramos la carrera.");
    const subjects = (await db.subjects.where("degreeId").equals(degree.id).toArray()).sort(
      (a, b) => a.year - b.year || a.semester - b.semester || a.name.localeCompare(b.name),
    );
    const sections: Section[] = [];
    for (const s of subjects) {
      const notes = await db.notes.where("subjectId").equals(s.id).toArray();
      if (notes.length) sections.push(...byUnit(notes, s.name));
    }
    return { title: degree.name, subtitle: degree.institution, sections };
  }
  const notes = await db.notes.where("subjectId").equals(target.folder).toArray();
  const sorted =
    target.folder === DAILY_FOLDER
      ? notes.sort((a, b) => (a.dailyDate ?? a.createdAt).localeCompare(b.dailyDate ?? b.createdAt))
      : sortNotes(notes);
  return { title: FOLDER_NAMES[target.folder] ?? "Notas", sections: [{ title: "", notes: sorted }] };
}

const CSS = `
@page { size: A4; margin: 20mm 18mm 22mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.55; color: #1b1b1f; margin: 0; }
.cover { height: 240mm; display: flex; flex-direction: column; justify-content: flex-end; page-break-after: always; }
.cover .mark { width: 44px; height: 44px; margin-bottom: 28px; }
.cover h1 { font-size: 30pt; line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.02em; }
.cover .sub { color: #6b6b7d; font-size: 12pt; }
.cover .date { color: #9a9aa8; font-size: 10pt; margin-top: 40px; }
.toc { page-break-after: always; }
.toc h2 { font-size: 14pt; margin: 0 0 12px; }
.toc .sec { margin: 14px 0 4px; font-weight: 600; font-size: 10pt; color: #6b6b7d; text-transform: uppercase; letter-spacing: .05em; }
.toc .item { display: flex; font-size: 11pt; padding: 2px 0; }
.toc .item::after { content: ""; flex: 1; border-bottom: 1px dotted #c8c8d2; margin: 0 6px 5px; order: 1; }
.toc .item span:last-child { order: 2; color: #9a9aa8; }
.section-title { font-size: 10pt; font-weight: 600; color: #6366f1; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 4px; }
.note { page-break-before: always; }
.note:first-of-type { page-break-before: auto; }
.note > h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.01em; }
.note .meta { color: #9a9aa8; font-size: 9pt; margin-bottom: 14px; }
h2 { font-size: 15pt; margin: 18px 0 6px; } h3 { font-size: 13pt; margin: 16px 0 4px; } h4, h5, h6 { font-size: 11.5pt; margin: 14px 0 4px; }
p { margin: 0 0 6px; } p.empty { height: 6px; margin: 0; } .muted { color: #9a9aa8; }
ul, ol { margin: 0 0 6px; padding-left: 22px; } li { margin: 1px 0; }
ul.check { list-style: none; padding-left: 4px; } ul.check .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #9a9aa8; border-radius: 3px; margin-right: 6px; font-size: 8pt; line-height: 10px; text-align: center; }
ul.check li.done { color: #9a9aa8; text-decoration: line-through; }
blockquote { margin: 8px 0; padding: 2px 0 2px 12px; border-left: 3px solid #6366f1; color: #3f3f4a; }
pre { background: #f3f3f7; border-radius: 6px; padding: 10px 12px; font-size: 9.5pt; white-space: pre-wrap; }
code { font-family: Consolas, "Cascadia Mono", monospace; font-size: 0.92em; background: #f3f3f7; padding: 1px 4px; border-radius: 3px; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10pt; page-break-inside: avoid; }
th, td { border: 1px solid #dcdce4; padding: 5px 8px; text-align: left; vertical-align: top; }
th { background: #f3f3f7; font-weight: 600; }
table.props { width: auto; margin: 0 0 14px; font-size: 9.5pt; } table.props th, table.props td { border: none; padding: 1px 12px 1px 0; background: none; } table.props th { color: #9a9aa8; font-weight: 400; }
figure { margin: 10px 0; page-break-inside: avoid; } img { max-width: 100%; max-height: 180mm; border-radius: 4px; } figcaption { font-size: 9pt; color: #6b6b7d; margin-top: 4px; }
.callout { background: #f1f1fe; border-radius: 6px; padding: 8px 12px; margin: 8px 0; page-break-inside: avoid; }
.callout-type { font-size: 9pt; font-weight: 600; color: #4f52e0; text-transform: capitalize; margin-bottom: 2px; }
.wl { color: #4f52e0; }
a { color: #4f52e0; text-decoration: none; }
`;

const MARK = `<svg class="mark" viewBox="0 0 38 38"><path d="M19 3l14 8v16l-14 8-14-8V11z" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linejoin="round"/><circle cx="19" cy="19" r="5.5" fill="#6366f1"/></svg>`;

export async function buildExportHtml(target: ExportTarget): Promise<{ html: string; title: string; noteCount: number }> {
  const { title, subtitle, sections } = await collect(target);
  const notes = sections.flatMap((s) => s.notes);
  const single = target.kind === "note";
  const today = new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

  let body = "";
  if (!single) {
    body += `<section class="cover">${MARK}<h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}<div class="date">${notes.length} ${notes.length === 1 ? "nota" : "notas"} · ${today}</div></section>`;
    if (notes.length > 1) {
      body += `<section class="toc"><h2>Índice</h2>`;
      for (const s of sections) {
        if (s.title) body += `<div class="sec">${esc(s.title)}</div>`;
        for (const n of s.notes) body += `<div class="item"><span>${esc(n.title || "Sin título")}</span></div>`;
      }
      body += `</section>`;
    }
  }

  for (const s of sections) {
    for (const [i, n] of s.notes.entries()) {
      const updated = new Date(n.updatedAt).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });
      body += `<article class="note">`;
      if (s.title && i === 0) body += `<div class="section-title">${esc(s.title)}</div>`;
      body += `<h1>${esc(n.title || "Sin título")}</h1>`;
      body += `<div class="meta">${single && subtitle ? `${esc(subtitle)} · ` : ""}${updated}</div>`;
      body += propsTable(n);
      body += await blocksToHtml(Array.isArray(n.content) ? n.content : []);
      body += `</article>`;
    }
  }

  if (!notes.length) body += `<p class="muted">Sin notas para exportar.</p>`;

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
  return { html, title, noteCount: notes.length };
}

// Abre el diálogo de impresión con el documento listo. El nombre sugerido del PDF es el título.
export async function exportToPdf(target: ExportTarget): Promise<number> {
  const { html, title, noteCount } = await buildExportHtml(target);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0", visibility: "hidden" });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();

  // Esperamos a que carguen las imágenes antes de imprimir.
  await new Promise<void>((resolve) => {
    const imgs = Array.from(doc.images);
    let pending = imgs.filter((i) => !i.complete).length;
    if (!pending) return resolve();
    const done = () => --pending <= 0 && resolve();
    imgs.forEach((i) => {
      if (!i.complete) {
        i.addEventListener("load", done);
        i.addEventListener("error", done);
      }
    });
    setTimeout(resolve, 4000);
  });

  const prevTitle = document.title;
  document.title = title; // Chromium usa el título como nombre sugerido del archivo
  const win = iframe.contentWindow!;
  win.focus();
  win.print();
  setTimeout(() => {
    document.title = prevTitle;
    iframe.remove();
  }, 1000);
  return noteCount;
}
