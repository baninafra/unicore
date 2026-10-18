"use client";

// Convierte archivos (PDF, Excel, PowerPoint, Word, CSV, texto) en notas de UniCore
// o en texto para pasarle a la IA.

import { createNote } from "@/components/notes/note-utils";
import { saveFile } from "../db";
import { markdownToBlocks, tableBlock, type MdBlock } from "../notes/md-blocks";
import { t } from "@/lib/i18n";
import { docxToMarkdown, pptxToMarkdown, xlsxToMarkdown } from "./office";

export const IMPORT_ACCEPT =
  ".pdf,.xlsx,.xlsm,.pptx,.docx,.csv,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/plain,text/markdown";

export function fileKind(file: File): "pdf" | "xlsx" | "pptx" | "docx" | "csv" | "text" | "image" | "old-office" | null {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (file.type.startsWith("image/")) return "image";
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "xlsx" || ext === "xlsm") return "xlsx";
  if (ext === "pptx") return "pptx";
  if (ext === "docx") return "docx";
  if (ext === "csv") return "csv";
  if (["txt", "md", "markdown", "json"].includes(ext) || file.type.startsWith("text/")) return "text";
  if (["xls", "ppt", "doc"].includes(ext)) return "old-office";
  return null;
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || t("Importado");

function parseCsv(text: string): string[][] {
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export interface Converted {
  title: string;
  blocks: MdBlock[];
  text: string; // texto plano/Markdown para la IA
}

export async function convertFile(file: File, onProgress?: (text: string) => void): Promise<Converted> {
  const kind = fileKind(file);
  const title = baseName(file.name);
  switch (kind) {
    case "pdf": {
      onProgress?.(t("Leyendo el PDF…"));
      const { extractPdf, pdfToBlocks } = await import("../pdf/import-pdf");
      const ex = await extractPdf(file, (p) =>
        onProgress?.(t("{action} página {page} de {total}…", { action: p.stage === "ocr" ? t("Reconociendo texto") : t("Leyendo"), page: p.page, total: p.total })),
      );
      return { title, blocks: pdfToBlocks(ex) as MdBlock[], text: ex.plainText };
    }
    case "xlsx": {
      const { markdown, sheets } = await xlsxToMarkdown(await file.arrayBuffer());
      const blocks: MdBlock[] = [];
      for (const s of sheets) {
        if (!s.rows.length) continue;
        if (sheets.length > 1) blocks.push({ type: "heading", props: { level: 2 }, content: s.name });
        blocks.push(tableBlock(s.rows.slice(0, 500)));
      }
      return { title, blocks, text: markdown };
    }
    case "pptx": {
      const md = await pptxToMarkdown(await file.arrayBuffer());
      return { title, blocks: markdownToBlocks(md), text: md };
    }
    case "docx": {
      const md = await docxToMarkdown(await file.arrayBuffer());
      return { title, blocks: markdownToBlocks(md), text: md };
    }
    case "csv": {
      const rows = parseCsv(await file.text());
      const md = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
      return { title, blocks: [tableBlock(rows.slice(0, 500))], text: md };
    }
    case "text": {
      const txt = await file.text();
      return { title, blocks: markdownToBlocks(txt), text: txt };
    }
    case "image": {
      const url = await saveFile(file);
      return { title, blocks: [{ type: "image", props: { url, name: file.name } }], text: "" };
    }
    case "old-office":
      throw new Error(t("Ese formato es viejo (.xls, .ppt, .doc). Abrilo y guardalo como .xlsx, .pptx o .docx."));
    default:
      throw new Error(t("No sabemos leer ese tipo de archivo. Probá con PDF, Excel, PowerPoint, Word o texto."));
  }
}

// Importa un archivo como nota nueva. Devuelve el id de la nota.
export async function importFileAsNote(file: File, subjectId: string, onProgress?: (text: string) => void): Promise<string> {
  const c = await convertFile(file, onProgress);
  return createNote({ subjectId, title: c.title, unitNumber: 1, content: c.blocks });
}
