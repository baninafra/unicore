"use client";

// Calendario propio, estilo Thunderbird: calendarios locales con eventos que se editan en UniCore
// (con repeticiones, recordatorios y categorías) y todo lo que se ve en el calendario junto:
// eventos propios, calendarios suscritos, tareas y cronogramas de las materias.

import { useLiveQuery } from "dexie-react-hooks";
import { addMinutes } from "date-fns";
import { db, newId, nowIso } from "../db";
import { scheduleEvents } from "../cronograma";
import { buildIcs, expandRRule, parseIcsSeries } from "./ics";
import { CALENDAR_COLORS } from "./sync";
import type { CalEvent, CalendarColor, CalendarSource, EventCategory, Subject, Task } from "../types";
import { EVENT_CATEGORY_LABEL } from "../types";

// ---------- Calendarios propios ----------

export function useLocalCalendars(): CalendarSource[] {
  return useLiveQuery(async () => (await db.calendars.orderBy("createdAt").toArray()).filter((c) => c.local), []) ?? [];
}

// El calendario donde van los eventos nuevos (se crea "Personal" la primera vez).
export async function defaultCalendarId(): Promise<string> {
  const locals = (await db.calendars.orderBy("createdAt").toArray()).filter((c) => c.local);
  const visible = locals.find((c) => c.enabled) ?? locals[0];
  if (visible) return visible.id;
  return createLocalCalendar("Personal", "primary");
}

export async function createLocalCalendar(name: string, color?: CalendarColor): Promise<string> {
  const used = new Set((await db.calendars.toArray()).map((c) => c.color));
  const id = newId();
  await db.calendars.add({
    id,
    name: name.trim() || "Calendario",
    local: true,
    color: color ?? CALENDAR_COLORS.find((c) => !used.has(c)) ?? "cyan",
    enabled: true,
    createdAt: nowIso(),
  });
  return id;
}

export async function deleteLocalCalendar(id: string): Promise<void> {
  await db.transaction("rw", db.calendars, db.events, async () => {
    await db.events.where("calendarId").equals(id).delete();
    await db.calendars.delete(id);
  });
}

// ---------- Repeticiones ----------

const DAY = 86_400_000;

// Inicios de las repeticiones de un evento que tocan el rango [from, to).
export function occurrences(ev: CalEvent, from: Date, to: Date): Date[] {
  const start = new Date(ev.start);
  const length = Math.max(0, new Date(ev.end).getTime() - start.getTime());
  if (!ev.rrule) return start.getTime() < to.getTime() && start.getTime() + Math.max(length, 1) > from.getTime() ? [start] : [];
  const skip = new Set((ev.exdates ?? []).map((x) => new Date(x).getTime()));
  return expandRRule(start, ev.rrule, to).filter((s) => !skip.has(s.getTime()) && s.getTime() + Math.max(length, 1) > from.getTime() && s.getTime() < to.getTime());
}

export type Scope = "one" | "following" | "all";

// Regla sin UNTIL ni COUNT (para cortarla en otra fecha).
function stripEnd(rrule: string): string {
  return rrule
    .split(";")
    .filter((p) => !/^(UNTIL|COUNT)=/i.test(p))
    .join(";");
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Termina la serie justo antes de `at`.
function endSeriesBefore(rrule: string, at: Date): string {
  return `${stripEnd(rrule)};UNTIL=${utc(new Date(at.getTime() - 1000))}`;
}

export async function saveEvent(ev: Omit<CalEvent, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> {
  const now = nowIso();
  if (ev.id && (await db.events.get(ev.id))) {
    await db.events.update(ev.id, { ...ev, updatedAt: now });
    return ev.id;
  }
  const id = ev.id ?? newId();
  await db.events.add({ ...ev, id, createdAt: now, updatedAt: now } as CalEvent);
  return id;
}

// Cambia una repetición (o la serie) a un nuevo horario y/o datos.
// `occurrence` es el inicio de la repetición tocada (para eventos sin repetición, el inicio del evento).
export async function updateOccurrence(ev: CalEvent, occurrence: Date, changes: Partial<CalEvent>, scope: Scope): Promise<string> {
  if (!ev.rrule || scope === "all") {
    // En toda la serie, mover una repetición corre el inicio de la serie lo mismo.
    const next = { ...changes };
    if (ev.rrule && changes.start) {
      const newStart = new Date(changes.start).getTime();
      const length = changes.end ? new Date(changes.end).getTime() - newStart : new Date(ev.end).getTime() - new Date(ev.start).getTime();
      const seriesStart = new Date(ev.start).getTime() + (newStart - occurrence.getTime());
      next.start = new Date(seriesStart).toISOString();
      next.end = new Date(seriesStart + length).toISOString();
    }
    await db.events.update(ev.id, { ...next, updatedAt: nowIso() });
    return ev.id;
  }
  const length = new Date(ev.end).getTime() - new Date(ev.start).getTime();
  const base: Omit<CalEvent, "id" | "createdAt" | "updatedAt"> = {
    ...stripMeta(ev),
    start: occurrence.toISOString(),
    end: new Date(occurrence.getTime() + length).toISOString(),
    ...changes,
  };
  if (scope === "one") {
    await db.events.update(ev.id, { exdates: [...(ev.exdates ?? []), occurrence.toISOString()], updatedAt: nowIso() });
    return saveEvent({ ...base, rrule: undefined, exdates: undefined });
  }
  // Esta y las siguientes: la serie vieja termina antes y empieza una nueva.
  await db.events.update(ev.id, { rrule: endSeriesBefore(ev.rrule, occurrence), updatedAt: nowIso() });
  return saveEvent({ ...base, rrule: changes.rrule ?? ev.rrule, exdates: (ev.exdates ?? []).filter((x) => new Date(x) > occurrence) });
}

export async function deleteOccurrence(ev: CalEvent, occurrence: Date, scope: Scope): Promise<void> {
  if (!ev.rrule || scope === "all") return void (await db.events.delete(ev.id));
  if (scope === "one") return void (await db.events.update(ev.id, { exdates: [...(ev.exdates ?? []), occurrence.toISOString()], updatedAt: nowIso() }));
  if (occurrence.getTime() <= new Date(ev.start).getTime()) return void (await db.events.delete(ev.id));
  await db.events.update(ev.id, { rrule: endSeriesBefore(ev.rrule, occurrence), updatedAt: nowIso() });
}

function stripMeta(ev: CalEvent): Omit<CalEvent, "id" | "createdAt" | "updatedAt"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, updatedAt, ...rest } = ev;
  return rest;
}

export async function duplicateEvent(ev: CalEvent, occurrence?: Date): Promise<string> {
  const length = new Date(ev.end).getTime() - new Date(ev.start).getTime();
  const start = occurrence ?? new Date(ev.start);
  return saveEvent({ ...stripMeta(ev), title: ev.title, start: start.toISOString(), end: new Date(start.getTime() + length).toISOString(), rrule: undefined, exdates: undefined });
}

// ---------- Tareas ↔ eventos ----------

const TASK_FROM_CATEGORY: Partial<Record<EventCategory, Task["type"]>> = { EXAMEN: "PARCIAL", ENTREGA: "TP", ESTUDIO: "LECTURA" };

export async function eventToTask(ev: CalEvent, occurrence?: Date): Promise<string> {
  const due = ev.allDay ? new Date(new Date(occurrence ?? ev.start).setHours(23, 59, 0, 0)) : occurrence ?? new Date(ev.start);
  const subject = ev.subjectId ? await db.subjects.get(ev.subjectId) : undefined;
  const id = newId();
  await db.tasks.add({
    id,
    title: ev.title,
    description: [ev.location, ev.description].filter(Boolean).join("\n") || undefined,
    type: (ev.category && TASK_FROM_CATEGORY[ev.category]) || "TAREA",
    status: "TODO",
    priority: ev.category === "EXAMEN" ? "HIGH" : "MEDIUM",
    dueDate: due.toISOString(),
    subjectId: ev.subjectId,
    degreeId: subject?.degreeId,
    source: "MANUAL",
    createdAt: nowIso(),
  });
  await db.events.update(ev.id, { taskId: id, updatedAt: nowIso() });
  return id;
}

const CATEGORY_FROM_TASK: Record<Task["type"], EventCategory> = { PARCIAL: "EXAMEN", FINAL: "EXAMEN", TP: "ENTREGA", FORO: "ENTREGA", LECTURA: "ESTUDIO", TAREA: "OTRO" };

// Un bloque en el calendario para trabajar en la tarea (por defecto, una hora antes de que venza o mañana a las 18).
export async function planTask(task: Task, start?: Date, minutes = 60): Promise<string> {
  let from = start;
  if (!from) {
    const due = task.dueDate ? new Date(task.dueDate) : null;
    const tomorrow = new Date(Date.now() + DAY);
    tomorrow.setHours(18, 0, 0, 0);
    from = due && due.getHours() !== 23 && due.getTime() - 3_600_000 > Date.now() ? new Date(due.getTime() - minutes * 60_000) : tomorrow;
  }
  return saveEvent({
    calendarId: await defaultCalendarId(),
    title: task.title,
    start: from.toISOString(),
    end: addMinutes(from, minutes).toISOString(),
    allDay: false,
    category: task.type === "PARCIAL" || task.type === "FINAL" ? "ESTUDIO" : CATEGORY_FROM_TASK[task.type],
    subjectId: task.subjectId,
    taskId: task.id,
    reminders: [15],
  });
}

// ---------- Lo que se ve en el calendario ----------

export type CalItemKind = "event" | "external" | "task" | "cronograma";

export interface CalItem {
  key: string; // único por repetición
  kind: CalItemKind;
  title: string;
  start: Date;
  end: Date; // exclusivo
  allDay: boolean;
  color: CalendarColor;
  calendarName: string;
  location?: string;
  description?: string;
  category?: EventCategory;
  tentative?: boolean;
  cancelled?: boolean;
  recurring?: boolean;
  reminders?: number[];
  done?: boolean;
  event?: CalEvent;
  occurrence?: Date;
  task?: Task;
  subjectId?: string;
}

const TASK_COLOR: Record<Task["type"], CalendarColor> = { PARCIAL: "rose", FINAL: "rose", TP: "amber", FORO: "amber", LECTURA: "cyan", TAREA: "primary" };

// Una tarea con hora 23:59 vence "ese día": se muestra como de día completo.
export function taskIsAllDay(task: Task): boolean {
  if (!task.dueDate) return true;
  const d = new Date(task.dueDate);
  return d.getHours() === 23 && d.getMinutes() === 59;
}

export interface ItemFilters {
  tasks: boolean;
  doneTasks: boolean;
  cronogramas: boolean;
}

export function useCalendarItems(from: Date, to: Date, filters: ItemFilters, tasks: Task[], subjects: Subject[]): CalItem[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const data = useLiveQuery(async () => {
    const cals = await db.calendars.toArray();
    const visible = new Map(cals.filter((c) => c.enabled).map((c) => [c.id, c]));
    const [events, external] = await Promise.all([
      db.events.filter((e) => visible.has(e.calendarId)).toArray(),
      db.calendarEvents
        .where("start")
        .below(new Date(toMs).toISOString())
        .filter((e) => visible.has(e.calendarId) && new Date(e.end ?? e.start).getTime() + 1 > fromMs - DAY)
        .toArray(),
    ]);
    return { visible, events, external };
  }, [fromMs, toMs]);

  if (!data) return [];
  const items: CalItem[] = [];
  const range = { from: new Date(fromMs), to: new Date(toMs) };

  for (const ev of data.events) {
    const cal = data.visible.get(ev.calendarId)!;
    const length = new Date(ev.end).getTime() - new Date(ev.start).getTime();
    for (const s of occurrences(ev, range.from, range.to)) {
      items.push({
        key: `ev:${ev.id}:${s.getTime()}`,
        kind: "event",
        title: ev.title,
        start: s,
        end: new Date(s.getTime() + Math.max(length, ev.allDay ? DAY : 15 * 60_000)),
        allDay: ev.allDay,
        color: cal.color,
        calendarName: cal.name,
        location: ev.location,
        description: ev.description,
        category: ev.category,
        tentative: ev.status === "TENTATIVE",
        cancelled: ev.status === "CANCELLED",
        recurring: !!ev.rrule,
        reminders: ev.reminders,
        done: ev.taskId ? tasks.find((t) => t.id === ev.taskId)?.status === "DONE" : undefined,
        event: ev,
        occurrence: s,
        subjectId: ev.subjectId,
      });
    }
  }

  for (const e of data.external) {
    const cal = data.visible.get(e.calendarId)!;
    const start = new Date(e.start);
    const end = e.end ? new Date(e.end) : new Date(start.getTime() + (e.allDay ? DAY : 30 * 60_000));
    if (end.getTime() <= fromMs || start.getTime() >= toMs) continue;
    items.push({ key: `ext:${e.id}`, kind: "external", title: e.title, start, end, allDay: e.allDay, color: cal.color, calendarName: cal.name, location: e.location, description: e.description });
  }

  if (filters.tasks) {
    for (const t of tasks) {
      if (!t.dueDate || t.status === "INBOX_EMAIL" || (!filters.doneTasks && t.status === "DONE")) continue;
      const due = new Date(t.dueDate);
      const allDay = taskIsAllDay(t);
      const start = allDay ? new Date(due.getFullYear(), due.getMonth(), due.getDate()) : due;
      const end = allDay ? new Date(start.getTime() + DAY) : new Date(due.getTime() + 30 * 60_000);
      if (end.getTime() <= fromMs || start.getTime() >= toMs) continue;
      items.push({ key: `task:${t.id}`, kind: "task", title: t.title, start, end, allDay, color: TASK_COLOR[t.type], calendarName: "Tareas", task: t, done: t.status === "DONE", subjectId: t.subjectId });
    }
  }

  if (filters.cronogramas) {
    for (const e of scheduleEvents(subjects)) {
      const start = new Date(e.start);
      const end = new Date(e.end!);
      if (end.getTime() <= fromMs || start.getTime() >= toMs) continue;
      items.push({ key: e.id, kind: "cronograma", title: e.title, start, end, allDay: true, color: e.color, calendarName: e.calendarName, description: e.description });
    }
  }

  return items.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
}

// ---------- Importar y exportar ----------

export async function exportCalendarIcs(calendarId: string): Promise<{ name: string; ics: string }> {
  const cal = await db.calendars.get(calendarId);
  const events = await db.events.where("calendarId").equals(calendarId).toArray();
  const ics = buildIcs(
    cal?.name ?? "Calendario",
    events.map((e) => ({
      uid: `${e.id}@unicore`,
      title: e.title,
      start: new Date(e.start),
      end: new Date(e.end),
      allDay: e.allDay,
      location: e.location,
      description: e.description,
      categories: e.category ? EVENT_CATEGORY_LABEL[e.category] : undefined,
      rrule: e.rrule,
      exdates: e.exdates?.map((x) => new Date(x)),
      reminders: e.reminders,
      status: e.status,
    })),
  );
  return { name: cal?.name ?? "Calendario", ics };
}

// Copia los eventos de un .ics a un calendario propio (con sus repeticiones). Devuelve cuántos agregó.
export async function importIcsInto(calendarId: string, text: string): Promise<number> {
  const series = parseIcsSeries(text);
  const now = nowIso();
  const rows: CalEvent[] = series.map((s) => {
    const end = s.end ?? (s.allDay ? new Date(s.start.getTime() + DAY) : new Date(s.start.getTime() + 3_600_000));
    return {
      id: newId(),
      calendarId,
      title: s.title,
      start: s.start.toISOString(),
      end: end.toISOString(),
      allDay: s.allDay,
      location: s.location,
      description: s.description,
      rrule: s.rrule,
      exdates: s.exdates?.map((d) => d.toISOString()),
      createdAt: now,
      updatedAt: now,
    };
  });
  await db.events.bulkAdd(rows);
  return rows.length;
}
