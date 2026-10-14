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
  if (/entrega|\btp\b|trabajo pr[aá]ctico|presentaci[oó]n|informe/.test(t)) return "ENTREGA";
  if (/feriado|asueto|sin clase|no hay clase/.test(t)) return "FERIADO";
  return "CLASE";
}

// Una línea por fecha: "14/10 Límites y continuidad", "Parcial 1 - 28 de octubre", "Semana 3 (21/10): Derivadas".
export function parseScheduleText(text: string, now = new Date()): ScheduleEntry[] {
  const ref = new Date(now.getFullYear(), 0, 1, 12);
  const out: ScheduleEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const hit = chrono.es.parse(line, ref, { forwardDate: true })[0];
    if (!hit) continue;
    const title = (line.slice(0, hit.index) + " " + line.slice(hit.index + hit.text.length))
      .replace(/[()\[\]]/g, " ")
      .replace(/^[\s\-–—:·|,.]+|[\s\-–—:·|,.]+$/g, "")
      .replace(/\s{2,}/g, " ");
    const d = hit.start.date();
    out.push({
      id: newId(),
      date: format(d, "yyyy-MM-dd"),
      title: title || SCHEDULE_KIND_LABEL[guessKind(line)],
      kind: guessKind(line),
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
