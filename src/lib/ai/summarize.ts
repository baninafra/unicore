"use client";

// Resumen de bibliografía y apuntes. La búsqueda por palabras (rag.ts) no sirve para "hacé un resumen":
// no hay palabra que coincida. Acá se lee el documento entero, por partes, y se junta todo al final.
// La IA básica tiene 4096 tokens de memoria, así que va parte por parte; la potente lee partes más grandes.

import { db } from "@/lib/db";
import { normalizeText } from "./rag";
import type { LocalAI } from "./use-local-ai";

export interface SummarySource {
  label: string;
  text: string;
}

// "resumen", "resumime", "sintetizá", "de qué trata", "puntos principales"
const SUMMARY_RE = /\b(resum\w*|sintetiz\w*|sintesis|de que (trata|habla)|ideas principales|puntos principales|lo mas importante|lo principal)\b/;
const DOC_WORDS_RE = /\b(bibliograf\w*|biblio\w*|pdf\w*|libro\w*|texto\w*|material\w*|document\w*|lectura\w*|capitulo\w*|unidad\w*|archivo\w*)\b/;
const NOTE_WORDS_RE = /\b(apunte\w*|nota\w*|clase\w*)\b/;

export function isSummaryRequest(text: string): boolean {
  return SUMMARY_RE.test(normalizeText(text));
}

const clean = (t: string) =>
  t
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Parte en trozos de ~size caracteres cortando en párrafo o en espacio.
function splitBy(text: string, size: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const cut = Math.max(text.lastIndexOf("\n\n", end), text.lastIndexOf("\n", end), text.lastIndexOf(". ", end) + 1, text.lastIndexOf(" ", end));
      if (cut > start + size / 2) end = cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }
  return out;
}

// Si hay más partes que las que se pueden leer, se eligen repartidas en todo el documento.
function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const idx = new Set<number>();
  for (let i = 0; i < max; i++) idx.add(Math.round((i * (items.length - 1)) / (max - 1)));
  return [...idx].map((i) => items[i]);
}

// Qué documentos o apunte hay que resumir según lo que pidió el usuario y lo que tiene en pantalla.
export async function summarySources(
  subjectId: string,
  request: string,
  note?: { title: string; plainTextCache: string } | null,
): Promise<SummarySource[]> {
  const q = normalizeText(request);
  const docs = await db.documents.where("subjectId").equals(subjectId).toArray();
  const mentionsDocs = DOC_WORDS_RE.test(q);
  const mentionsNote = NOTE_WORDS_RE.test(q);

  // Pidió el apunte que tiene abierto (o no hay PDFs): se resume la nota.
  if (note?.plainTextCache.trim() && ((mentionsNote && !mentionsDocs) || docs.length === 0)) {
    return [{ label: note.title || "Nota", text: clean(note.plainTextCache) }];
  }

  let list = docs.filter((d) => d.extractedText.trim());
  // "unidad 2", o el nombre del archivo
  const unit = q.match(/unidad\s*(\d+)/)?.[1];
  if (unit && list.some((d) => d.unitNumber === Number(unit))) list = list.filter((d) => d.unitNumber === Number(unit));
  else {
    const named = list.filter((d) => {
      const base = normalizeText(d.fileName.replace(/\.[a-z0-9]+$/i, "")).replace(/\(\d+\)/g, "").trim();
      return base.length > 3 && q.includes(base);
    });
    if (named.length) list = named;
  }

  // Archivos repetidos (mismo texto): se resume uno solo.
  const seen = new Set<string>();
  list = list.filter((d) => {
    const key = clean(d.extractedText).slice(0, 1500);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return list.map((d) => ({ label: d.fileName, text: clean(d.extractedText) }));
}

export interface SummaryProgress {
  (label: string): void;
}

// Devuelve el resumen en Markdown. `onText` recibe el texto de la respuesta final mientras se escribe.
export async function summarize(
  ai: Pick<LocalAI, "generate" | "engine">,
  sources: SummarySource[],
  opts: { topic?: string; signal: AbortSignal; onProgress: SummaryProgress; onText: (text: string) => void },
): Promise<string> {
  const powerful = ai.engine === "servidor";
  const sectionChars = powerful ? 18000 : 4500;
  const maxSections = powerful ? 8 : 12;
  const notesTokens = powerful ? 500 : 220;
  const perSource = Math.max(3, Math.floor(maxSections / sources.length));

  // 1) Notas de cada parte
  const notes: { label: string; body: string }[] = [];
  let step = 0;
  const parts = sources.map((s) => ({ s, sections: spread(splitBy(s.text, sectionChars), perSource) }));
  const total = parts.reduce((n, p) => n + (p.sections.length > 1 ? p.sections.length : 0), 0);

  for (const { s, sections } of parts) {
    if (sections.length === 1) {
      notes.push({ label: s.label, body: sections[0] });
      continue;
    }
    const bullets: string[] = [];
    for (const [i, section] of sections.entries()) {
      if (opts.signal.aborted) return "";
      opts.onProgress(`Leyendo ${sources.length > 1 ? `«${s.label}»` : "el documento"} (${++step} de ${total})…`);
      const out = await ai.generate(
        [
          { role: "system", content: "Sos un asistente que toma notas de estudio. Respondés en español rioplatense, sin introducciones." },
          {
            role: "user",
            content:
              `Fragmento ${i + 1} de ${sections.length} de «${s.label}». Anotá las ideas principales, definiciones y datos clave en viñetas cortas (máximo 6). ` +
              `Usá sólo lo que dice el texto.\n\n"""\n${section}\n"""`,
          },
        ],
        { temperature: 0.2, maxTokens: notesTokens },
      );
      if (out.trim()) bullets.push(out.trim());
    }
    notes.push({ label: s.label, body: bullets.join("\n") });
  }
  if (opts.signal.aborted) return "";

  // 2) Resumen final con todas las notas
  opts.onProgress("Armando el resumen…");
  const budget = powerful ? 30000 : 4800;
  const per = Math.floor(budget / notes.length);
  const material = notes.map((n) => `### ${n.label}\n${n.body.slice(0, per)}`).join("\n\n");
  const partial = parts.some((p) => p.sections.length < splitBy(p.s.text, sectionChars).length);
  const answer = await ai.generate(
    [
      {
        role: "system",
        content:
          "Sos un tutor universitario. Armás resúmenes claros y ordenados, en español rioplatense (usá vos), con Markdown liviano: títulos cortos y viñetas. Usá sólo la información de las notas, no inventes.",
      },
      {
        role: "user",
        content:
          `Con estas notas armá un resumen para estudiar${opts.topic ? ` (pedido: «${opts.topic}»)` : ""}. ` +
          `Agrupalo por temas, con un título corto por tema y las ideas clave en viñetas.${sources.length > 1 ? " Separalo por documento." : ""}\n\nNOTAS:\n${material}`,
      },
    ],
    { temperature: 0.3, maxTokens: powerful ? 2500 : 1100, onToken: (full) => opts.onText(full) },
  );
  const text = answer.trim();
  if (!text) return "";
  return partial ? `${text}\n\n_Leí partes repartidas por todo el documento. Pedime una unidad o un tema para verlo más a fondo._` : text;
}
