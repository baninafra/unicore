"use client";

import type { PDFPageProxy } from "pdfjs-dist";
import type { Worker as OcrWorker } from "tesseract.js";
import { t } from "@/lib/i18n";

// CONTRATO: importar PDFs como texto. Todo corre en el navegador.

export interface PdfParagraph {
  text: string;
  kind: "heading" | "paragraph";
}

export interface PdfPage {
  number: number;
  paragraphs: PdfParagraph[];
  usedOcr: boolean;
}

export interface PdfExtraction {
  fileName: string;
  pages: PdfPage[];
  plainText: string;
  usedOcr: boolean;
}

export interface PdfProgress {
  page: number;
  total: number;
  stage: "texto" | "ocr";
}

// Por debajo de esta cantidad de caracteres reales, la página se trata como escaneo.
const MIN_TEXT_CHARS = 25;
const OCR_SCALE = 2;
const LETTER = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";

// Fragmento de texto con su posición. y crece hacia arriba (como en PDF).
interface Span {
  text: string;
  x: number;
  end: number;
  y: number;
  size: number;
}

interface Line {
  text: string;
  y: number;
  x0: number;
  x1: number;
  size: number;
}

interface RawPage {
  number: number;
  lines: Line[];
  ocrText: string;
  usedOcr: boolean;
}

// Extrae el texto de un PDF en el navegador. Si una página es una imagen (escaneo), usa OCR en español.
export async function extractPdf(file: File, onProgress?: (p: PdfProgress) => void): Promise<PdfExtraction> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const total = doc.numPages;
  let worker: OcrWorker | null = null;

  try {
    const raw: RawPage[] = [];
    for (let n = 1; n <= total; n++) {
      onProgress?.({ page: n, total, stage: "texto" });
      const page = await doc.getPage(n);
      const lines = await readLines(page);
      if (countChars(lines) >= MIN_TEXT_CHARS) {
        raw.push({ number: n, lines, ocrText: "", usedOcr: false });
      } else {
        onProgress?.({ page: n, total, stage: "ocr" });
        worker ??= await createOcrWorker();
        const ocrText = await recognizePage(page, worker);
        raw.push({ number: n, lines: [], ocrText, usedOcr: true });
      }
      page.cleanup();
    }

    // El tamaño de fuente "normal" del documento sirve de referencia para detectar títulos.
    const docSize = median(raw.flatMap((r) => r.lines.map((l) => l.size))) || 10;

    const pages: PdfPage[] = raw.map((r) => ({
      number: r.number,
      usedOcr: r.usedOcr,
      paragraphs: r.usedOcr ? ocrParagraphs(r.ocrText) : buildParagraphs(r.lines, docSize),
    }));

    const plainText = pages
      .flatMap((p) => p.paragraphs.map((x) => x.text))
      .join("\n\n");

    return {
      fileName: file.name,
      pages,
      plainText,
      usedOcr: pages.some((p) => p.usedOcr),
    };
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}

// Convierte la extracción en bloques de BlockNote (PartialBlock[]) para insertar en un apunte.
export function pdfToBlocks(extraction: PdfExtraction): unknown[] {
  const blocks: unknown[] = [];
  const multiPage = extraction.pages.length > 1;

  for (const page of extraction.pages) {
    if (page.paragraphs.length === 0) continue;
    if (multiPage && page.paragraphs[0].kind !== "heading") {
      blocks.push({ type: "heading", props: { level: 3 }, content: t("Página {n}", { n: page.number }) });
    }
    for (const p of page.paragraphs) {
      blocks.push(
        p.kind === "heading"
          ? { type: "heading", props: { level: 2 }, content: p.text }
          : { type: "paragraph", content: p.text },
      );
    }
  }
  return blocks;
}

// ---------- Lectura de la capa de texto ----------

async function readLines(page: PDFPageProxy): Promise<Line[]> {
  const content = await page.getTextContent();
  const spans: Span[] = [];

  for (const item of content.items) {
    // Las marcas de contenido (TextMarkedContent) no tienen "str": se descartan.
    if (!("str" in item) || !item.str.trim()) continue;
    const size = item.height > 0 ? item.height : Math.hypot(item.transform[2], item.transform[3]);
    const x = item.transform[4];
    const width = item.width > 0 ? item.width : item.str.length * size * 0.5;
    spans.push({ text: item.str, x, end: x + width, y: item.transform[5], size });
  }

  return groupLines(spans);
}

// Agrupa fragmentos por coordenada Y (tolerancia según el tamaño de fuente) y ordena cada renglón por X.
// Si entre dos fragmentos hay un hueco grande, lo corta en otro renglón (suele ser otra columna).
function groupLines(spans: Span[]): Line[] {
  if (spans.length === 0) return [];
  const tolerance = Math.max(1, median(spans.map((s) => s.size)) * 0.5);

  const sorted = [...spans].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Span[][] = [];
  for (const s of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - s.y) <= tolerance) row.push(s);
    else rows.push([s]);
  }

  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let segment: Span[] = [];
    for (const s of row) {
      const prev = segment[segment.length - 1];
      if (prev && s.x - prev.end > Math.max(prev.size, s.size) * 3) {
        lines.push(makeLine(segment));
        segment = [];
      }
      segment.push(s);
    }
    if (segment.length) lines.push(makeLine(segment));
  }
  return lines;
}

function makeLine(segment: Span[]): Line {
  let text = "";
  let prev: Span | undefined;
  for (const s of segment) {
    if (prev && !/\s$/.test(text) && !/^\s/.test(s.text) && s.x - prev.end > prev.size * 0.15) text += " ";
    text += s.text;
    prev = s;
  }
  return {
    text: text.replace(/\s+/g, " ").trim(),
    y: segment[0].y,
    x0: segment[0].x,
    x1: Math.max(...segment.map((s) => s.end)),
    size: Math.max(...segment.map((s) => s.size)),
  };
}

function countChars(lines: Line[]): number {
  return lines.reduce((acc, l) => acc + l.text.replace(/\s/g, "").length, 0);
}

// Arma párrafos y títulos a partir de los renglones de una página.
function buildParagraphs(lines: Line[], docSize: number): PdfParagraph[] {
  if (lines.length === 0) return [];

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0.5) gaps.push(gap);
  }
  const lineGap = median(gaps) || docSize * 1.3;
  const maxWidth = Math.max(...lines.map((l) => l.x1 - l.x0));
  const isHeading = (l: Line) => l.size >= docSize * 1.25 && l.text.length <= 120;

  const out: PdfParagraph[] = [];
  let current: { kind: PdfParagraph["kind"]; text: string } | null = null;
  let prev: Line | null = null;

  for (const line of lines) {
    const kind: PdfParagraph["kind"] = isHeading(line) ? "heading" : "paragraph";

    if (current && prev) {
      const gap = prev.y - line.y;
      // Un renglón corto suele cerrar el párrafo; un salto grande siempre lo corta.
      const shortPrev = prev.x1 - prev.x0 < maxWidth * 0.6;
      const newParagraph =
        kind !== current.kind ||
        gap > lineGap * 1.6 ||
        (kind === "paragraph" && shortPrev && gap > lineGap * 1.15);
      if (newParagraph) {
        out.push({ kind: current.kind, text: cleanText(current.text) });
        current = null;
      }
    }

    if (!current) {
      current = { kind, text: line.text };
    } else {
      current.text = joinWords(current.text, line.text);
    }
    prev = line;
  }

  if (current) out.push({ kind: current.kind, text: cleanText(current.text) });
  return out.filter((p) => p.text.length > 0);
}

// ---------- OCR ----------

async function createOcrWorker(): Promise<OcrWorker> {
  const { createWorker } = await import("tesseract.js");
  return createWorker("spa");
}

// Texto de una foto o captura (por ejemplo, un cronograma sacado con el celular).
export async function ocrImage(file: Blob): Promise<string> {
  const worker = await createOcrWorker();
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

async function recognizePage(page: PDFPageProxy, worker: OcrWorker): Promise<string> {
  const viewport = page.getViewport({ scale: OCR_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("No hay contexto 2D para renderizar la página"));

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;

  const { data } = await worker.recognize(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return data.text;
}

// El OCR no trae tamaños de fuente: los párrafos son los bloques separados por líneas en blanco.
function ocrParagraphs(text: string): PdfParagraph[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      let joined = "";
      for (const raw of block.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        joined = joined ? joinWords(joined, line) : line;
      }
      return { kind: "paragraph" as const, text: cleanText(joined) };
    })
    .filter((p) => p.text.length > 0);
}

// ---------- Utilidades ----------

// Une dos renglones. Si el primero termina en guion pegado a una letra y el siguiente arranca en minúscula,
// la palabra quedó cortada por el renglón: se pega sin guion. (Un compuesto "teórico-práctico" partido
// justo ahí también se pega mal; es el costo de la heurística.)
const HYPHEN_END = new RegExp(`[${LETTER}]-$`);
function joinWords(a: string, b: string): string {
  if (HYPHEN_END.test(a) && /^[a-záéíóúüñ]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
