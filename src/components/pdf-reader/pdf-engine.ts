"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { t } from "@/lib/i18n";
import { db, newId, nowIso } from "@/lib/db";
import type { PdfHighlight } from "@/lib/types";

// Motor del lector de PDF: carga de pdfjs, captura de selección, búsqueda y escritura de resaltados.

export type Pdfjs = typeof import("pdfjs-dist");

// Mismo criterio que la importación de texto: el worker se configura una sola vez.
let loading: Promise<Pdfjs> | null = null;
export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= import("pdfjs-dist").then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    }
    return pdfjs;
  });
  return loading;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  destroy: () => Promise<void>; // libera el documento (lo destruye la tarea de carga)
}

// Abre el PDF original guardado en `db.files`. Devuelve null si el archivo ya no existe.
export async function openPdfFile(fileId: string): Promise<OpenedPdf | null> {
  const rec = await db.files.get(fileId.replace(/^idb:\/\//, ""));
  if (!rec) return null;
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await rec.blob.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  return { doc, destroy: () => task.destroy() };
}

export const HL_COLORS: Record<PdfHighlight["color"], { bg: string; solid: string; label: string }> = {
  amarillo: { bg: "rgba(250,204,21,0.38)", solid: "#facc15", label: t("Amarillo") },
  verde: { bg: "rgba(74,222,128,0.36)", solid: "#4ade80", label: t("Verde") },
  azul: { bg: "rgba(96,165,250,0.38)", solid: "#60a5fa", label: t("Azul") },
  rosa: { bg: "rgba(244,114,182,0.36)", solid: "#f472b6", label: t("Rosa") },
};

export const HL_ORDER: PdfHighlight["color"][] = ["amarillo", "verde", "azul", "rosa"];

// ---------- Selección ----------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Parte de la selección que cae en una página.
export interface SelectionPiece {
  page: number;
  text: string;
  rects: Rect[];
}

function hasOwnText(el: HTMLElement) {
  return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && !!n.textContent);
}

// Convierte una selección del DOM (capas de texto de cada página) en fragmentos por página.
export function captureSelection(range: Range, root: HTMLElement): SelectionPiece[] {
  const out: SelectionPiece[] = [];
  root.querySelectorAll<HTMLElement>(".uc-pdf-textlayer").forEach((layer) => {
    if (!range.intersectsNode(layer)) return;
    const page = Number(layer.parentElement?.dataset.ucPage);
    if (!page) return;
    const box = layer.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const rects: Rect[] = [];
    let text = "";
    let prev: DOMRect | null = null;

    layer.querySelectorAll<HTMLElement>("span").forEach((span) => {
      if (!hasOwnText(span) || !range.intersectsNode(span)) return;
      const r = document.createRange();
      r.selectNodeContents(span);
      if (span.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
      if (span.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
      const piece = r.toString();
      if (!piece.trim()) return;

      const cr = r.getBoundingClientRect();
      if (prev) {
        const sameLine = Math.abs(cr.top - prev.top) < Math.min(cr.height, prev.height) * 0.5;
        if (!sameLine) text += " ";
        else if (cr.left - prev.right > 2 && !/\s$/.test(text) && !/^\s/.test(piece)) text += " ";
      }
      text += piece;
      prev = cr;

      for (const rc of Array.from(r.getClientRects())) {
        if (rc.width < 1 || rc.height < 1) continue;
        rects.push({
          x: (rc.left - box.left) / box.width,
          y: (rc.top - box.top) / box.height,
          w: rc.width / box.width,
          h: rc.height / box.height,
        });
      }
    });

    const clean = text.replace(/\s+/g, " ").trim();
    if (clean && rects.length) out.push({ page, text: clean, rects });
  });
  return out;
}

// ---------- Resaltados (se guardan en SubjectDocument.highlights) ----------

async function mutateHighlights(documentId: string, fn: (list: PdfHighlight[]) => PdfHighlight[]) {
  await db.transaction("rw", db.documents, async () => {
    const doc = await db.documents.get(documentId);
    if (!doc) return;
    await db.documents.update(documentId, { highlights: fn(doc.highlights ?? []) });
  });
}

export async function addHighlights(documentId: string, pieces: SelectionPiece[], color: PdfHighlight["color"]) {
  const now = nowIso();
  const created: PdfHighlight[] = pieces.map((p) => ({
    id: newId(),
    page: p.page,
    text: p.text,
    color,
    rects: p.rects,
    createdAt: now,
  }));
  await mutateHighlights(documentId, (list) => [...list, ...created]);
  return created;
}

export async function updateHighlight(documentId: string, highlightId: string, patch: Partial<PdfHighlight>) {
  await mutateHighlights(documentId, (list) => list.map((h) => (h.id === highlightId ? { ...h, ...patch } : h)));
}

export async function deleteHighlight(documentId: string, highlightId: string) {
  await mutateHighlights(documentId, (list) => list.filter((h) => h.id !== highlightId));
}

// ---------- Búsqueda ----------

// Sin acentos y en minúsculas: "Teoría" coincide con "teoria".
export function normalizeSearch(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es");
}

// Fragmentos de texto de una página, en el mismo orden que la capa de texto (TextLayer.textDivs).
export async function pageItems(doc: PDFDocumentProxy, n: number, cache: Map<number, string[]>): Promise<string[]> {
  const known = cache.get(n);
  if (known) return known;
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  const items = content.items.flatMap((it) => ("str" in it ? [it.str] : []));
  cache.set(n, items);
  page.cleanup();
  return items;
}

export interface SearchHit {
  page: number;
  item: number; // índice del fragmento dentro de la página
}

export async function findInPdf(
  doc: PDFDocumentProxy,
  query: string,
  cache: Map<number, string[]>,
  onPage?: (n: number) => void,
): Promise<SearchHit[]> {
  const q = normalizeSearch(query.trim());
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onPage?.(n);
    const items = await pageItems(doc, n, cache);
    items.forEach((s, i) => {
      if (normalizeSearch(s).includes(q)) hits.push({ page: n, item: i });
    });
  }
  return hits;
}
