"use client";

// Conexión con calendarios externos. Google Calendar, Outlook, iCloud y la mayoría de los campus
// publican un enlace iCal (.ics) de sólo lectura: lo pedimos de tiempo en tiempo y copiamos los eventos.

import { useLiveQuery } from "dexie-react-hooks";
import { addYears, subYears } from "date-fns";
import { db, newId, nowIso } from "../db";
import { get } from "../ai/web";
import type { CalendarColor, CalendarEvent, CalendarSource } from "../types";
import { parseIcs } from "./ics";
import { t } from "@/lib/i18n";

export const CALENDAR_COLORS: CalendarColor[] = ["primary", "cyan", "mint", "amber", "rose"];

export const CALENDAR_COLOR_LABEL: Record<CalendarColor, string> = {
  primary: t("Violeta"),
  cyan: t("Celeste"),
  mint: t("Verde"),
  amber: t("Ámbar"),
  rose: t("Rosa"),
};

// Clases completas para que Tailwind las detecte.
export const CALENDAR_BORDER: Record<CalendarColor, string> = {
  primary: "border-primary",
  cyan: "border-cyan",
  mint: "border-mint",
  amber: "border-amber",
  rose: "border-rose",
};

// Sólo el borde izquierdo, para tarjetas y botones que ya tienen borde propio.
export const CALENDAR_BORDER_L: Record<CalendarColor, string> = {
  primary: "border-l-primary",
  cyan: "border-l-cyan",
  mint: "border-l-mint",
  amber: "border-l-amber",
  rose: "border-l-rose",
};

export function normalizeCalendarUrl(raw: string): string {
  return raw.trim().replace(/^webcal:\/\//i, "https://");
}

async function readUrl(url: string): Promise<string> {
  let text: string;
  try {
    text = await get(url);
  } catch {
    throw new Error(
      t("No pudimos abrir el enlace. Revisá que esté bien copiado y que tengas internet."),
    );
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error(t("El enlace no devolvió un calendario. Copiá la dirección en formato iCal (termina en .ics)."));
  }
  return text;
}

// Vuelve a leer un calendario y reemplaza sus eventos. Si falla, deja los eventos anteriores y guarda el motivo.
export async function syncCalendar(cal: CalendarSource): Promise<void> {
  try {
    const text = cal.url ? await readUrl(normalizeCalendarUrl(cal.url)) : (cal.ics ?? "");
    const now = new Date();
    const events = parseIcs(text, subYears(now, 1), addYears(now, 2));
    const rows: CalendarEvent[] = events.map((e) => ({
      id: `${cal.id}:${e.uid}:${e.start.getTime()}`,
      calendarId: cal.id,
      title: e.title,
      start: e.start.toISOString(),
      end: e.end?.toISOString(),
      allDay: e.allDay,
      location: e.location,
      description: e.description,
    }));
    await db.transaction("rw", db.calendars, db.calendarEvents, async () => {
      await db.calendarEvents.where("calendarId").equals(cal.id).delete();
      await db.calendarEvents.bulkPut(rows);
      await db.calendars.update(cal.id, { lastSync: nowIso(), error: undefined, eventCount: rows.length });
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : t("No pudimos sincronizar este calendario.");
    await db.calendars.update(cal.id, { error });
  }
}

export async function syncAllCalendars(): Promise<void> {
  const list = (await db.calendars.toArray()).filter((c) => !c.local);
  await Promise.all(list.map(syncCalendar));
}

export async function addCalendar(input: { name: string; url?: string; ics?: string; color: CalendarColor }): Promise<CalendarSource> {
  const cal: CalendarSource = {
    id: newId(),
    name: input.name.trim() || t("Calendario"),
    url: input.url ? normalizeCalendarUrl(input.url) : undefined,
    ics: input.ics,
    color: input.color,
    enabled: true,
    createdAt: nowIso(),
  };
  await db.calendars.add(cal);
  await syncCalendar(cal);
  return (await db.calendars.get(cal.id)) ?? cal;
}

export async function removeCalendar(id: string): Promise<void> {
  await db.transaction("rw", db.calendars, db.calendarEvents, async () => {
    await db.calendarEvents.where("calendarId").equals(id).delete();
    await db.calendars.delete(id);
  });
}

// Calendarios suscritos (los propios están en events.ts).
export function useCalendars(): CalendarSource[] {
  return useLiveQuery(async () => (await db.calendars.orderBy("createdAt").toArray()).filter((c) => !c.local), []) ?? [];
}

// Eventos de los calendarios que están visibles.
export function useCalendarEvents(): (CalendarEvent & { color: CalendarColor; calendarName: string })[] {
  return (
    useLiveQuery(async () => {
      const cals = (await db.calendars.toArray()).filter((c) => c.enabled);
      const byId = new Map(cals.map((c) => [c.id, c]));
      const events = await db.calendarEvents.filter((e) => byId.has(e.calendarId)).toArray();
      return events.map((e) => ({ ...e, color: byId.get(e.calendarId)!.color, calendarName: byId.get(e.calendarId)!.name }));
    }, []) ?? []
  );
}
