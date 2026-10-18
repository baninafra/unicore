"use client";

// Tareas de IA reutilizables: tarjetas, examen y análisis de mails.
// Todas piden JSON con un objeto raíz, usan temperatura baja y validan lo que devuelve el modelo.
import type { ChatMessage, LocalAI } from "./use-local-ai";
import type { TaskType } from "../types";

export interface FlashcardDraft {
  front: string;
  back: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

export interface EmailAnalysis {
  summary: string; // un renglón
  dueDate?: string; // ISO
  subjectId?: string;
  type?: TaskType;
}

const TASK_TYPES: TaskType[] = ["PARCIAL", "FINAL", "TP", "FORO", "LECTURA", "TAREA"];
// La IA potente tiene 32k tokens: entra mucho más material.
const SOURCE_CHARS = 40000;
const MAX_EMAIL_CHARS = 3000;
const TEMPERATURE = 0.2;

// ---------- Helpers ----------

function cleanSource(text: string, max: number): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function oneLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Recorre el texto desde `start` y devuelve el índice del cierre que balancea el objeto o arreglo.
function findClosing(s: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

// Saca el primer objeto o arreglo JSON válido del texto (el modelo a veces agrega texto o fences).
function extractJson(raw: string): unknown {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "{" && raw[i] !== "[") continue;
    const end = findClosing(raw, i);
    if (end === -1) continue;
    try {
      return JSON.parse(raw.slice(i, end + 1));
    } catch {
      // seguimos buscando desde el próximo corchete
    }
  }
  return undefined;
}

async function askJson(ai: LocalAI, messages: ChatMessage[], maxTokens: number): Promise<unknown> {
  const raw = await ai.generate(messages, { json: true, temperature: TEMPERATURE, maxTokens });
  return extractJson(raw);
}

// Acepta {"clave": [...]} o directamente un arreglo.
function pickArray(data: unknown, key: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (isRecord(data) && Array.isArray(data[key])) return data[key] as unknown[];
  return [];
}

function shuffleOptions(options: string[], answerIndex: number): { options: string[]; answerIndex: number } {
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { options: order.map((i) => options[i]), answerIndex: order.indexOf(answerIndex) };
}

// "2026-10-17" → 17/10 a las 23:59 (hora local). "2026-10-17T09:30" → esa hora local.
function parseDueDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = m[4] !== undefined ? Number(m[4]) : 23;
  const mi = m[5] !== undefined ? Number(m[5]) : 59;
  const date = new Date(y, mo - 1, d, h, mi);
  const valid =
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d &&
    date.getHours() === h &&
    date.getMinutes() === mi;
  return valid ? date.toISOString() : undefined;
}

function localDateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------- Tareas ----------

// Devuelve entre 1 y `count` tarjetas pregunta/respuesta a partir de un texto.
export async function generateFlashcards(ai: LocalAI, text: string, count = 8): Promise<FlashcardDraft[]> {
  const source = cleanSource(text, SOURCE_CHARS);
  if (!source) throw new Error("No hay texto para armar tarjetas. Agregá un apunte o un PDF con texto.");
  const data = await askJson(
    ai,
    [
      {
        role: "system",
        content:
          "Sos un docente universitario que arma tarjetas de estudio. Respondés sólo con JSON válido, en español rioplatense (usá vos).",
      },
      {
        role: "user",
        content:
          `Generá entre 5 y ${count} tarjetas de repaso a partir del texto. ` +
          "Cada tarjeta tiene una pregunta corta (front) y una respuesta clara en una o dos frases (back). " +
          "Usá sólo información del texto. Sin fórmulas de relleno.\n\n" +
          'Devolvé un objeto con esta forma: {"cards": [{"front": "...", "back": "..."}]}\n\n' +
          `TEXTO:\n"""\n${source}\n"""`,
      },
    ],
    1200,
  );

  const seen = new Set<string>();
  const cards: FlashcardDraft[] = [];
  for (const item of pickArray(data, "cards")) {
    if (!isRecord(item)) continue;
    const front = oneLine(item.front, 240);
    const back = oneLine(item.back, 500);
    const key = front.toLowerCase();
    if (!front || !back || seen.has(key)) continue;
    seen.add(key);
    cards.push({ front, back });
    if (cards.length >= count) break;
  }

  if (cards.length === 0) {
    throw new Error("No pudimos armar tarjetas con este texto. Probá con un apunte más completo.");
  }
  return cards;
}

// Examen multiple choice de autoevaluación.
export async function generateQuiz(ai: LocalAI, text: string, count = 5): Promise<QuizQuestion[]> {
  const source = cleanSource(text, SOURCE_CHARS);
  if (!source) throw new Error("No hay texto para armar el examen. Agregá un apunte o un PDF con texto.");
  const data = await askJson(
    ai,
    [
      {
        role: "system",
        content:
          "Sos un docente universitario que toma exámenes de autoevaluación. Respondés sólo con JSON válido, en español rioplatense (usá vos).",
      },
      {
        role: "user",
        content:
          `Armá ${count} preguntas de opción múltiple sobre el texto. Cada pregunta tiene 4 opciones, una sola correcta, ` +
          "y una explicación breve de por qué es la correcta. Las opciones no pueden ser 'todas las anteriores' ni 'ninguna de las anteriores'. " +
          'answerIndex es la posición de la correcta, de 0 a 3.\n\n' +
          'Devolvé un objeto con esta forma: {"questions": [{"question": "...", "options": ["...", "...", "...", "..."], "answerIndex": 0, "explanation": "..."}]}\n\n' +
          `TEXTO:\n"""\n${source}\n"""`,
      },
    ],
    1400,
  );

  const quiz: QuizQuestion[] = [];
  for (const item of pickArray(data, "questions")) {
    if (!isRecord(item)) continue;
    const question = oneLine(item.question, 300);
    const rawOptions = Array.isArray(item.options)
      ? item.options.map((o) => oneLine(o, 200)).filter((o) => o.length > 0)
      : [];
    const answer = typeof item.answerIndex === "number" ? item.answerIndex : Number(item.answerIndex);
    if (!question || rawOptions.length < 2 || rawOptions.length > 5) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer >= rawOptions.length) continue;

    const shuffled = shuffleOptions(rawOptions, answer); // para que la correcta no quede siempre en la A
    quiz.push({
      question,
      options: shuffled.options,
      answerIndex: shuffled.answerIndex,
      explanation: oneLine(item.explanation, 400),
    });
    if (quiz.length >= count) break;
  }

  if (quiz.length === 0) {
    throw new Error("No pudimos armar el examen con este texto. Probá con un apunte más completo.");
  }
  return quiz;
}

// Resume un mail de la facultad y sugiere fecha, materia y tipo.
export async function analyzeEmail(
  ai: LocalAI,
  input: { from?: string; subject?: string; body: string; subjects: { id: string; name: string }[] },
): Promise<EmailAnalysis> {
  const today = new Date();
  const todayText = today.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const subjectList =
    input.subjects.map((s) => `- id: ${s.id} | materia: ${s.name}`).join("\n") || "(no hay materias cargadas)";
  const body = cleanSource(input.body, MAX_EMAIL_CHARS);

  const data = await askJson(
    ai,
    [
      {
        role: "system",
        content:
          "Sos un asistente que lee mails de la facultad y extrae tareas y fechas. Respondés sólo con JSON válido, en español rioplatense.",
      },
      {
        role: "user",
        content:
          `Hoy es ${todayText} (${localDateKey(today)}).\n\n` +
          `Materias disponibles:\n${subjectList}\n\n` +
          `Mail\nDe: ${input.from ?? "(desconocido)"}\nAsunto: ${input.subject ?? "(sin asunto)"}\n"""\n${body}\n"""\n\n` +
          "Devolvé un objeto con esta forma:\n" +
          '{"summary": "resumen en una sola oración", ' +
          '"dueDate": "YYYY-MM-DD, o YYYY-MM-DDTHH:mm si el mail dice la hora, o null si no hay fecha límite", ' +
          '"subjectId": "el id de la lista que corresponde, o null si no está claro", ' +
          '"type": "PARCIAL, FINAL, TP, FORO, LECTURA o TAREA, o null"}',
      },
    ],
    400,
  );

  const obj = isRecord(data) ? data : {};
  const fallbackSummary = oneLine(input.body, 120);
  const summary = oneLine(obj.summary, 200) || fallbackSummary;

  const subjectId =
    typeof obj.subjectId === "string" && input.subjects.some((s) => s.id === obj.subjectId)
      ? obj.subjectId
      : undefined;
  const typeValue = typeof obj.type === "string" ? obj.type.trim().toUpperCase() : "";
  const type = TASK_TYPES.find((t) => t === typeValue);

  return {
    summary,
    dueDate: parseDueDate(obj.dueDate),
    subjectId,
    type,
  };
}
