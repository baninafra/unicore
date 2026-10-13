"use client";

import * as chrono from "chrono-node";
import type { Subject, TaskType } from "./types";

// Parser sin IA para mails pegados a mano: fecha, tipo y materia por reglas.
// La IA (analyzeEmail) queda como segunda pasada opcional desde la tarjeta del mail.

export interface ParsedEmail {
  title: string;
  type: TaskType;
  dueDate?: string; // ISO
  subjectId?: string;
  degreeId?: string;
}

type SubjectRef = Pick<Subject, "id" | "name" | "code" | "degreeId">;

// "Matemática Financiera" → "matematica financiera"
export function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Busca la frase como palabra completa: "matematica i" no tiene que matchear "matematica ii".
function hasPhrase(normalizedText: string, normalizedPhrase: string) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedPhrase)}(?![a-z0-9])`).test(normalizedText);
}

// Gana la materia con el nombre (o código) más largo que aparezca en el texto.
function matchSubject(normalizedText: string, subjects: SubjectRef[]) {
  let best: { subject: SubjectRef; length: number } | undefined;
  for (const subject of subjects) {
    const candidates = [normalize(subject.name), subject.code ? normalize(subject.code) : ""].filter(Boolean);
    for (const candidate of candidates) {
      if (hasPhrase(normalizedText, candidate) && (!best || candidate.length > best.length)) {
        best = { subject, length: candidate.length };
      }
    }
  }
  return best?.subject;
}

const TYPE_RULES: [TaskType, RegExp][] = [
  ["PARCIAL", /\bparcial(es)?\b/],
  ["FINAL", /\bfinal(es)?\b/],
  ["TP", /\b(tp|tps|trabajo practico|trabajos practicos)\b/],
  ["FORO", /\bforos?\b/],
  ["LECTURA", /\b(lectura|lecturas|leer)\b/],
  ["TAREA", /\b(entrega|entregas|entregar)\b/],
];

function detectType(normalizedText: string): TaskType | undefined {
  return TYPE_RULES.find(([, rule]) => rule.test(normalizedText))?.[0];
}

export function parseEmail(input: {
  from?: string;
  subject?: string;
  body: string;
  subjects: SubjectRef[];
}): ParsedEmail {
  const subject = (input.subject ?? "").trim();
  const body = input.body.trim();
  const from = (input.from ?? "").trim();

  // Materia: primero el asunto (y remitente, suele llevar el nombre de la cátedra); si no, el cuerpo.
  const subjectLine = normalize(`${from} ${subject}`);
  const fullText = normalize(`${from} ${subject} ${body}`);
  const matched = matchSubject(subjectLine, input.subjects) ?? matchSubject(fullText, input.subjects);

  // Fecha: "9 hs" no lo entiende chrono, así que lo pasamos a "9:00" antes.
  const dateText = `${subject}\n${body}`.replace(/(\d{1,2})\s*hs\b/gi, "$1:00");
  const ref = new Date();
  const date = chrono.es.parseDate(dateText, ref, { forwardDate: true });
  // parseDate devuelve 12:00 cuando el mail no trae hora. Sin hora explícita, la tarea vence a las 23:59.
  const hasHour = chrono.es.parse(dateText, ref, { forwardDate: true })[0]?.start.isCertain("hour") ?? false;
  if (date && !hasHour) date.setHours(23, 59, 0, 0);

  const type = detectType(normalize(subject)) ?? detectType(normalize(body)) ?? "TAREA";
  const title = (subject || body.split("\n").find((line) => line.trim()) || "Mail sin asunto").trim().slice(0, 120);

  return {
    title,
    type,
    dueDate: date ? date.toISOString() : undefined,
    subjectId: matched?.id,
    degreeId: matched?.degreeId,
  };
}
