"use client";

// Cuestionarios guardados: son notas de la materia con la propiedad tipo = "cuestionario".
// Guardan las preguntas (JSON), de qué clase salen, para qué parcial y el historial de intentos.
// Se abren como página (QuizPage) y se puede pedir otro sobre lo mismo.

import { db, nowIso } from "../db";
import { t } from "@/lib/i18n";
import { createNote } from "@/components/notes/note-utils";
import type { LocalAI } from "../ai/use-local-ai";
import { generateQuiz, type QuizQuestion } from "../ai/prompts";
import { buildSubjectContext } from "../ai/rag";
import { LOOSE_FOLDER, type Note, type Task } from "../types";
import { classDate, isClassNote } from "../tasks/class-tasks";

export const isQuizNote = (n: Pick<Note, "properties">) => n.properties?.tipo === "cuestionario";

export interface QuizMeta {
  questions: QuizQuestion[];
  claseId?: string;
  parcialId?: string;
  parcial?: string;
  tema?: string;
  intentos: string[]; // "2026-10-14 · 4/5"
}

export function readQuiz(n: Note): QuizMeta {
  const p = n.properties ?? {};
  let questions: QuizQuestion[] = [];
  try {
    questions = JSON.parse(String(p.preguntas ?? "[]"));
  } catch {
    questions = [];
  }
  return {
    questions,
    claseId: typeof p.clase === "string" && p.clase ? p.clase : undefined,
    parcialId: typeof p.parcial_id === "string" && p.parcial_id ? p.parcial_id : undefined,
    parcial: typeof p.parcial === "string" && p.parcial ? p.parcial : undefined,
    tema: typeof p.tema === "string" && p.tema ? p.tema : undefined,
    intentos: Array.isArray(p.intentos) ? p.intentos.map(String) : [],
  };
}

// Las preguntas también quedan como texto de la nota (se buscan, se exportan, la IA las lee).
function questionsToBlocks(qs: QuizQuestion[]): unknown[] {
  const blocks: unknown[] = [];
  qs.forEach((q, i) => {
    blocks.push({ type: "heading", props: { level: 3 }, content: `${i + 1}. ${q.question}` });
    q.options.forEach((o, oi) => blocks.push({ type: "bulletListItem", content: `${"ABCDEF"[oi]}) ${o}` }));
    blocks.push({ type: "paragraph", content: [{ type: "text", text: t("Respuesta: {letra}. {explicacion}", { letra: "ABCDEF"[q.answerIndex], explicacion: q.explanation ?? "" }), styles: { italic: true } }] });
  });
  return blocks;
}

export async function saveQuiz(input: {
  subjectId?: string;
  title: string;
  questions: QuizQuestion[];
  claseId?: string;
  parcialId?: string;
  parcial?: string;
  tema?: string;
}): Promise<string> {
  const id = await createNote({
    subjectId: input.subjectId ?? LOOSE_FOLDER,
    title: input.title,
    unitNumber: 1,
    content: questionsToBlocks(input.questions),
  });
  await db.notes.update(id, {
    properties: {
      tipo: "cuestionario",
      preguntas: JSON.stringify(input.questions),
      ...(input.claseId ? { clase: input.claseId } : {}),
      ...(input.parcialId ? { parcial_id: input.parcialId } : {}),
      ...(input.parcial ? { parcial: input.parcial } : {}),
      ...(input.tema ? { tema: input.tema } : {}),
      intentos: [],
    },
  });
  return id;
}

export async function recordAttempt(note: Note, correct: number, total: number) {
  const meta = readQuiz(note);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const entry = `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${correct}/${total}`;
  await db.notes.update(note.id, { properties: { ...(note.properties ?? {}), intentos: [...meta.intentos, entry].slice(-20) }, updatedAt: nowIso() });
}

// Parciales y finales de una materia (para elegir "para qué parcial").
export async function examsOf(subjectId: string): Promise<Task[]> {
  return (await db.tasks.where("subjectId").equals(subjectId).toArray())
    .filter((t) => t.type === "PARCIAL" || t.type === "FINAL")
    .sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
}

// Material para el cuestionario: la clase, o las clases que entran en el parcial, o lo más relevante de la materia.
export async function quizSource(opts: { subjectId?: string; claseId?: string; parcialId?: string; tema?: string }): Promise<string> {
  const parts: string[] = [];
  if (opts.claseId) {
    const n = await db.notes.get(opts.claseId);
    if (n) parts.push(`[${n.title}]\n${n.plainTextCache}`);
  }
  if (opts.subjectId && opts.parcialId) {
    const exam = await db.tasks.get(opts.parcialId);
    const limit = exam?.dueDate ? exam.dueDate.slice(0, 10) : undefined;
    const notes = (await db.notes.where("subjectId").equals(opts.subjectId).toArray())
      .filter((n) => !isQuizNote(n))
      .filter((n) => !limit || !isClassNote(n) || (classDate(n) ?? "") <= limit);
    for (const n of notes.slice(0, 30)) if (n.plainTextCache.trim()) parts.push(`[${n.title}]\n${n.plainTextCache.slice(0, 1500)}`);
    if (exam?.description) parts.unshift(`[Temas del ${exam.title}]\n${exam.description}`);
  }
  if (opts.subjectId && !opts.claseId && !opts.parcialId) {
    const found = await buildSubjectContext(opts.subjectId, opts.tema ?? "", 8);
    if (found.context) parts.push(found.context);
  }
  // Sin apuntes: temario de la materia (títulos de las clases) o, como último recurso, conocimiento general.
  if (!parts.join("").trim() && opts.subjectId) {
    const subject = await db.subjects.get(opts.subjectId);
    const exam = opts.parcialId ? await db.tasks.get(opts.parcialId) : undefined;
    const classes = (await db.notes.where("subjectId").equals(opts.subjectId).toArray()).filter(isClassNote).map((n) => n.title);
    parts.push(
      [
        `Materia universitaria: ${subject?.name ?? ""}.`,
        exam ? `Evaluación: ${exam.title}.` : "",
        opts.tema ? `Tema: ${opts.tema}.` : "",
        classes.length ? `Temario de las clases:\n${classes.join("\n")}` : "",
        "No hay apuntes cargados: armá las preguntas con conocimiento general de nivel universitario sobre estos temas.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (!parts.length && opts.tema) parts.push(`Tema: ${opts.tema}. Usá conocimiento general de nivel universitario.`);
  return parts.join("\n\n");
}

// Arma otro cuestionario sobre lo mismo (sin repetir preguntas) y lo guarda al lado.
export async function makeAnother(ai: LocalAI, note: Note): Promise<string> {
  const meta = readQuiz(note);
  const subjectId = note.subjectId;
  let source = await quizSource({ subjectId, claseId: meta.claseId, parcialId: meta.parcialId, tema: meta.tema ?? note.title });
  if (!source.trim()) source = note.plainTextCache;
  const avoid = meta.questions.map((q) => `- ${q.question}`).join("\n");
  const questions = await generateQuiz(
    ai,
    `NO repitas estas preguntas que ya se hicieron; buscá otros conceptos o enfoques:\n${avoid}\n\nMATERIAL:\n${source}`,
    Math.max(5, meta.questions.length),
  );
  const base = note.title.replace(/\s*\(\d+\)$/, "");
  const siblings = (await db.notes.where("subjectId").equals(subjectId).toArray()).filter((n) => isQuizNote(n) && n.title.startsWith(base));
  return saveQuiz({
    subjectId,
    title: `${base} (${siblings.length + 1})`,
    questions,
    claseId: meta.claseId,
    parcialId: meta.parcialId,
    parcial: meta.parcial,
    tema: meta.tema,
  });
}

// Cuestionario nuevo desde una clase o nota (botón en la nota).
export async function quizFromNote(ai: LocalAI, note: Note, count = 6): Promise<string> {
  const questions = await generateQuiz(ai, `[${note.title}]\n${note.plainTextCache}`, count);
  return saveQuiz({
    subjectId: note.subjectId,
    title: t("Cuestionario · {title}", { title: note.title.replace(/^Clase (\d+) · \d{2}\/\d{2} · /, "Clase $1: ") }),
    questions,
    claseId: note.id,
    tema: note.title,
  });
}
