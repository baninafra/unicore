// Cronograma de una materia: orden, lectura de texto pegado, y conversión a eventos del calendario y a bloques para exportar.

import * as chrono from "chrono-node";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { newId, nowIso } from "./db";
import { type CalendarColor, type CalendarEvent, type Note, type ScheduleEntry, type ScheduleKind, type Subject, SCHEDULE_KIND_LABEL } from "./types";

export const dayStart = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function sortSchedule(list: ScheduleEntry[]): ScheduleEntry[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export function scheduleDateLabel(date: string): string {
  return format(dayStart(date), "EEE d/M", { locale: es });
}

const KIND_COLOR: Record<ScheduleKind, CalendarColor> = {
  CLASE: "primary",
  PARCIAL: "rose",
  FINAL: "rose",
  ENTREGA: "amber",
  FERIADO: "mint",
  OTRO: "cyan",
};
export const scheduleColor = (kind: ScheduleKind) => KIND_COLOR[kind];

function guessKind(text: string): ScheduleKind {
  const t = text.toLowerCase();
  if (/\bfinal(es)?\b/.test(t)) return "FINAL";
  if (/parcial|examen|evaluaci[oó]n|recuperatorio|\bpp\b/.test(t)) return "PARCIAL";
  if (/entrega|\btp\b|trabajo pr[aá]ctico|informe/.test(t)) return "ENTREGA";
  if (/feriado|asueto|sin clase|no hay clase/.test(t)) return "FERIADO";
  return "CLASE";
}

const tidy = (t: string) =>
  t
    .replace(/[()\[\]]/g, " ")
    .replace(/^[\s\-–—:·|,.]+|[\s\-–—:·|,.]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([:;,.])/g, "$1");

// Las filas de tablas ("| 14/10 | Límites | Cap. 1 |", de Excel o Word) pasan a una línea; los separadores se descartan.
function flattenTableRow(line: string): string | null {
  if (!line.startsWith("|")) return line;
  const cells = line
    .split("|")
    .map((c) => c.trim())
    .filter(Boolean);
  if (!cells.length || cells.every((c) => /^:?-{2,}:?$/.test(c))) return null;
  return cells.join(" – ");
}

// "Clase 3", "Semana 2", "Unidad 4": ese número no es un día (chrono lo tomaría como parte de un rango de fechas).
const NUMBERED = /\b(clase|semana|unidad|tema|encuentro|m[oó]dulo|bolilla|cap[ií]tulo|pr[aá]ctica|tp|trabajo pr[aá]ctico|parcial)\s*(?:n[°ºo.]*\s*)?(\d+)/gi;
const maskNumbers = (line: string) => line.replace(NUMBERED, (m, _w, n: string) => m.slice(0, m.length - n.length) + "§".repeat(n.length));
const GENERIC = /^(clase|semana|unidad|tema|encuentro|m[oó]dulo|bolilla|cap[ií]tulo)\s*(?:n[°ºo.]*\s*)?\d*$/i;

// Lee un cronograma pegado o sacado de un archivo. Acepta una fecha por línea ("14/10 Límites y continuidad"),
// títulos con la fecha al final ("Parcial 1 - 28 de octubre"), varias fechas en una misma línea (PDF corrido)
// y filas de tablas. Si el tema quedó en la línea siguiente a la fecha, lo toma de ahí.
export function parseScheduleText(text: string, now = new Date()): ScheduleEntry[] {
  const ref = new Date(now.getFullYear(), 0, 1, 12);
  const out: ScheduleEntry[] = [];
  const state: { waiting: ScheduleEntry | null } = { waiting: null }; // fecha sin tema todavía

  for (const raw of text.split(/\r?\n/)) {
    const line = flattenTableRow(raw.trim());
    if (!line) continue;
    const hits = chrono.es.parse(maskNumbers(line), ref, { forwardDate: true });

    if (!hits.length) {
      if (state.waiting && line.length <= 160) {
        const w = state.waiting;
        w.title = GENERIC.test(w.title) ? `${w.title}: ${tidy(line)}` : tidy(line);
        if (w.kind === "CLASE") w.kind = guessKind(line);
      }
      state.waiting = null;
      continue;
    }

    state.waiting = null;
    hits.forEach((hit, k) => {
      const end = hit.index + hit.text.length;
      const after = line.slice(end, hits[k + 1]?.index ?? line.length);
      const title = tidy(k === 0 ? `${line.slice(0, hit.index)} ${after}` : after);
      const kind = guessKind(hits.length === 1 ? line : title);
      const entry: ScheduleEntry = { id: newId(), date: format(hit.start.date(), "yyyy-MM-dd"), title: title || SCHEDULE_KIND_LABEL[kind], kind };
      if (!title || GENERIC.test(title)) state.waiting = entry;
      out.push(entry);
    });
  }
  return sortSchedule(out);
}

// Entradas del cronograma como eventos de día completo para la grilla del calendario.
export function scheduleEvents(subjects: Subject[]): (CalendarEvent & { color: CalendarColor; calendarName: string })[] {
  return subjects.flatMap((s) =>
    (s.schedule ?? []).map((e) => {
      const start = dayStart(e.date);
      return {
        id: `crono:${s.id}:${e.id}`,
        calendarId: "cronograma",
        title: `${s.name}: ${e.title}`,
        start: start.toISOString(),
        end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).toISOString(),
        allDay: true,
        description: SCHEDULE_KIND_LABEL[e.kind],
        color: KIND_COLOR[e.kind],
        calendarName: `Cronograma · ${s.name}`,
      };
    }),
  );
}

// Nota de sólo lectura con el cronograma, para incluirla al exportar la materia.
export function scheduleNote(subject: Subject): Note | null {
  if (!subject.schedule?.length) return null;
  const stamp = nowIso();
  return {
    id: `cronograma-${subject.id}`,
    subjectId: subject.id,
    title: "Cronograma",
    unitNumber: 0,
    content: sortSchedule(subject.schedule).map((e) => ({
      type: "bulletListItem",
      props: {},
      content: [{ type: "text", text: `${format(dayStart(e.date), "EEE d/M/yyyy", { locale: es })} · ${SCHEDULE_KIND_LABEL[e.kind]} · ${e.title}${e.done ? " (hecho)" : ""}`, styles: {} }],
      children: [],
    })),
    plainTextCache: "",
    updatedAt: stamp,
    createdAt: stamp,
  };
}
