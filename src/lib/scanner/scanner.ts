"use client";

// Escáner de documentos: fotos (de la cámara o del equipo) → hojas derechas y limpias → PDF con texto buscable.
// El trabajo de imagen corre en scanner.worker.ts (OpenCV); el texto, con el OCR de la app (Tesseract).

import type { Worker as OcrWorker } from "tesseract.js";
import { t } from "@/lib/i18n";

export type Pt = { x: number; y: number };
export type ScanFilter = "color" | "mejorado" | "gris" | "byn";

export const FILTER_LABEL: Record<ScanFilter, string> = {
  mejorado: t("Mejorado"),
  color: t("Original"),
  gris: t("Grises"),
  byn: t("Blanco y negro"),
};

// ---------- Worker ----------

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

function call(type: "init" | "detect" | "warp", payload: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<Record<string, unknown>> {
  if (!worker) {
    worker = new Worker(new URL("./scanner.worker.ts", import.meta.url));
    worker.onmessage = (e) => {
      const d = e.data as { id: number; ok: boolean; error?: string };
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d as unknown as Record<string, unknown>);
      else p.reject(new Error(d.error ?? t("El escáner falló.")));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error(t("No se pudo iniciar el escáner.")));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, type, ...payload }, transfer);
  });
}

// Arranca el motor de imágenes antes de que haga falta (tarda un par de segundos la primera vez).
export function warmUpScanner(): Promise<void> {
  return call("init").then(() => undefined);
}

// ---------- Imágenes ----------

const MAX_SOURCE = 3200; // lado más largo que se guarda de cada foto

export async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function imageDataOf(src: CanvasImageSource, w: number, h: number, maxSide = Infinity): ImageData {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = canvasOf(Math.round(w * k), Math.round(h * k));
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height);
}

export function toBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("No se pudo crear la imagen.")))), type, quality));
}

// Achica la foto si es enorme y la deja como JPEG (es la "original" de la página).
export async function normalizeSource(blob: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await loadBitmap(blob);
  const k = Math.min(1, MAX_SOURCE / Math.max(bmp.width, bmp.height));
  const c = canvasOf(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return { blob: await toBlob(c, "image/jpeg", 0.92), width: c.width, height: c.height };
}

// Busca la hoja en la imagen. Devuelve las esquinas en píxeles de la imagen (o null si no la encuentra).
export async function detectCorners(src: CanvasImageSource, w: number, h: number): Promise<Pt[] | null> {
  const small = imageDataOf(src, w, h, 640);
  const k = w / small.width;
  const r = await call("detect", { image: small }, [small.data.buffer]);
  const corners = r.corners as Pt[] | null;
  return corners ? corners.map((p) => ({ x: p.x * k, y: p.y * k })) : null;
}

// Esquinas por defecto: casi toda la foto.
export function defaultCorners(w: number, h: number, inset = 0.04): Pt[] {
  const dx = w * inset;
  const dy = h * inset;
  return [
    { x: dx, y: dy },
    { x: w - dx, y: dy },
    { x: w - dx, y: h - dy },
    { x: dx, y: h - dy },
  ];
}

// Endereza la hoja, aplica el filtro y la rotación. Devuelve el JPEG final.
export async function renderPage(source: Blob, corners: Pt[], filter: ScanFilter, rotation: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await loadBitmap(source);
  const image = imageDataOf(bmp, bmp.width, bmp.height);
  bmp.close();
  const r = await call("warp", { image, corners, filter }, [image.data.buffer]);
  const out = r.image as ImageData;
  const flat = canvasOf(out.width, out.height);
  flat.getContext("2d")!.putImageData(out, 0, 0);
  const turn = ((rotation % 360) + 360) % 360;
  if (!turn) return { blob: await toBlob(flat), width: flat.width, height: flat.height };
  const swap = turn === 90 || turn === 270;
  const c = canvasOf(swap ? flat.height : flat.width, swap ? flat.width : flat.height);
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((turn * Math.PI) / 180);
  g.drawImage(flat, -flat.width / 2, -flat.height / 2);
  return { blob: await toBlob(c), width: c.width, height: c.height };
}

// ---------- OCR ----------

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

let ocr: Promise<OcrWorker> | null = null;

function ocrWorker(): Promise<OcrWorker> {
  ocr ??= import("tesseract.js").then(({ createWorker }) => createWorker(["spa", "eng"]));
  return ocr;
}

export async function recognize(image: Blob): Promise<OcrResult> {
  const w = await ocrWorker();
  const { data } = await w.recognize(image, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? [])
    for (const p of block.paragraphs)
      for (const line of p.lines)
        for (const word of line.words) if (word.text.trim() && word.confidence > 30) words.push({ text: word.text, ...word.bbox });
  return { text: data.text.trim(), words };
}

export async function stopOcr(): Promise<void> {
  const w = ocr;
  ocr = null;
  if (w) await (await w).terminate();
}

// ---------- PDF ----------

export type PageSize = "original" | "a4" | "carta";

export interface PdfPageInput {
  jpeg: Blob;
  width: number; // píxeles
  height: number;
  words?: OcrWord[];
}

const SIZES: Record<Exclude<PageSize, "original">, [number, number]> = { a4: [595.28, 841.89], carta: [612, 792] };

// Texto PDF en WinAnsi (alcanza para español); lo que no entra se reemplaza.
function pdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const b = c < 256 ? c : ch === "€" ? 0x80 : ch === "“" || ch === "”" ? 0x22 : ch === "‘" || ch === "’" ? 0x27 : ch === "–" || ch === "—" ? 0x2d : 0x3f;
    out += b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 || b > 126 ? `\\${b.toString(8).padStart(3, "0")}` : String.fromCharCode(b);
  }
  return out;
}

const n2 = (n: number) => (Math.round(n * 100) / 100).toString();

// Arma un PDF con una imagen por página y, encima, el texto del OCR invisible (se puede buscar y copiar).
export async function buildPdf(pages: PdfPageInput[], size: PageSize = "original", title = t("Escaneo")): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
  const obj = (n: number, body: (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push("\nendobj\n");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1 catálogo, 2 páginas, 3 fuente, 4 info; después 3 objetos por página (página, imagen, contenido).
  const first = 5;
  const kids = pages.map((_, i) => `${first + i * 3} 0 R`).join(" ");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`]);
  obj(3, ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]);
  obj(4, [latin1(`<< /Title (${pdfText(title)}) /Producer (UniCore) >>`)]);

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const [pageN, imgN, contN] = [first + i * 3, first + i * 3 + 1, first + i * 3 + 2];
    // Tamaño de la página en puntos: el de la foto a 150 ppp, o A4/Carta con la imagen centrada.
    let pw: number;
    let ph: number;
    if (size === "original") {
      const k = Math.min(72 / 150, 841.89 / Math.max(p.width, p.height));
      pw = p.width * k;
      ph = p.height * k;
    } else {
      [pw, ph] = SIZES[size];
      if (p.width > p.height) [pw, ph] = [ph, pw];
    }
    const k = Math.min(pw / p.width, ph / p.height);
    const iw = p.width * k;
    const ih = p.height * k;
    const ox = (pw - iw) / 2;
    const oy = (ph - ih) / 2;

    let content = `q ${n2(iw)} 0 0 ${n2(ih)} ${n2(ox)} ${n2(oy)} cm /Im0 Do Q\n`;
    if (p.words?.length) {
      content += "BT 3 Tr\n";
      for (const w of p.words) {
        const height = (w.y1 - w.y0) * k;
        const width = (w.x1 - w.x0) * k;
        const fs = Math.max(1, height * 0.9);
        const natural = fs * 0.5 * [...w.text].length;
        const scale = natural > 0 ? Math.max(10, Math.min(400, (width / natural) * 100)) : 100;
        const x = ox + w.x0 * k;
        const y = oy + ih - w.y1 * k + height * 0.15;
        content += `/F1 ${n2(fs)} Tf ${n2(scale)} Tz 1 0 0 1 ${n2(x)} ${n2(y)} Tm (${pdfText(w.text)}) Tj\n`;
      }
      content += "ET\n";
    }
    const contentBytes = latin1(content);
    const jpeg = new Uint8Array(await p.jpeg.arrayBuffer());

    obj(pageN, [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(pw)} ${n2(ph)}] /Resources << /XObject << /Im0 ${imgN} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contN} 0 R >>`,
    ]);
    obj(imgN, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      "\nendstream",
    ]);
    obj(contN, [`<< /Length ${contentBytes.length} >>\nstream\n`, contentBytes, "\nendstream"]);
  }

  const total = first + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

// Nombre sugerido a partir del texto: el primer renglón con sentido.
export function guessTitle(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.replace(/[^\p{L}\p{N} ,.:()¿?¡!-]/gu, "").trim())
    .find((l) => l.length >= 4 && /\p{L}{3}/u.test(l));
  return line ? line.slice(0, 60) : "";
}
