"use client";

// Recuperación simple (sin embeddings): junta apuntes y bibliografía de una materia,
// los parte en fragmentos y devuelve los que más coinciden con la pregunta.
// En la app de escritorio lo resuelve el índice de texto de SQLite (src-tauri/src/search.rs);
// la versión de acá queda de respaldo.

import { db } from "@/lib/db";
import { isDesktop } from "@/lib/desktop";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

// Palabras vacías en español, ya normalizadas (sin acentos ni mayúsculas).
const STOPWORDS = new Set(
  (
    "a al de del la las el los lo le les un una unos unas y o u e que qu como cual cuales cuando donde " +
    "por para con sin sobre entre en es son ser sea fue hay haber tiene tienen puede pueden hacer hace " +
    "se su sus mi mis tu tus me te nos si no ya pero mas muy este esta esto estos estas ese esa eso " +
    "quien quienes porque aunque tambien solo cada todo toda todos todas otro otra otros otras " +
    "ademas hola gracias favor dame decime explicame explica explicar ejemplo armame arma tomame " +
    "cuadro comparativo"
  ).split(" "),
);

interface Chunk {
  label: string;
  text: string;
  tokens: string[];
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Parte el texto en trozos de ~CHUNK_SIZE cortando en espacios, con solapamiento.
function splitText(raw: string): string[] {
  const text = raw
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const cut = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
      if (cut > start + CHUNK_SIZE / 2) end = cut;
    }
    const piece = text.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return pieces;
}

function addChunks(out: Chunk[], label: string, body: string | undefined) {
  if (!body || !body.trim()) return;
  for (const text of splitText(body)) {
    out.push({ label, text, tokens: tokenize(`${label} ${text}`) });
  }
}

export async function buildSubjectContext(
  subjectId: string,
  question: string,
  maxChunks = 4,
  excludeNoteId?: string, // la nota abierta ya va entera, no hace falta repetirla en fragmentos
): Promise<{ context: string; sources: { label: string }[] }> {
  if (isDesktop()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const hits = await invoke<{ label: string; text: string }[]>("search_chunks", {
        subjectId,
        question,
        maxChunks,
        excludeNoteId: excludeNoteId ?? null,
      });
      return {
        context: hits.map((h) => `[Fuente: ${h.label}]\n${h.text}`).join("\n\n"),
        sources: [...new Set(hits.map((h) => h.label))].map((label) => ({ label })),
      };
    } catch (e) {
      console.warn("[IA] falló la búsqueda en SQLite, uso la de respaldo", e);
    }
  }
  const [notes, documents] = await Promise.all([
    db.notes.where("subjectId").equals(subjectId).toArray(),
    db.documents.where("subjectId").equals(subjectId).toArray(),
  ]);

  const chunks: Chunk[] = [];
  for (const note of notes) if (note.id !== excludeNoteId) addChunks(chunks, note.title, note.plainTextCache);
  for (const doc of documents) addChunks(chunks, doc.fileName, doc.extractedText);

  const queryTerms = [...new Set(tokenize(question))];
  if (chunks.length === 0 || queryTerms.length === 0) return { context: "", sources: [] };

  // Peso por rareza: un término que aparece en pocos fragmentos vale más.
  const total = chunks.length;
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const df = chunks.reduce((n, c) => n + (c.tokens.includes(term) ? 1 : 0), 0);
    idf.set(term, Math.log(1 + total / (1 + df)));
  }

  const scored = chunks
    .map((chunk) => {
      let score = 0;
      for (const term of queryTerms) {
        const tf = chunk.tokens.reduce((n, t) => n + (t === term ? 1 : 0), 0);
        if (tf > 0) score += (idf.get(term) ?? 0) * (1 + Math.log(tf));
      }
      return { chunk, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks);

  if (scored.length === 0) return { context: "", sources: [] };

  const context = scored.map((s) => `[Fuente: ${s.chunk.label}]\n${s.chunk.text}`).join("\n\n");
  const labels = [...new Set(scored.map((s) => s.chunk.label))];
  return { context, sources: labels.map((label) => ({ label })) };
}
