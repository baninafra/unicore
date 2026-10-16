"use client";

// Recordatorios de los eventos propios: cada medio minuto se fija si toca avisar de alguno
// (un aviso en la app y, si el sistema lo permite, una notificación). Lo ya avisado se recuerda en este equipo.

import { useEffect } from "react";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { occurrences } from "@/lib/calendars/events";
import { toast } from "@/lib/undo";
import { openEventDialog } from "./event-dialog";

const KEY = "uc-reminders-fired";
const LOOK_AHEAD = 8 * 86_400_000; // el recordatorio más largo es una semana antes

function readFired(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveFired(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s].slice(-400)));
  } catch {}
}

function whenText(start: Date, allDay: boolean): string {
  const min = Math.round((start.getTime() - Date.now()) / 60_000);
  if (allDay) return `el ${format(start, "dd/MM")}`;
  if (min <= 0) return "ahora";
  if (min < 60) return `en ${min} min`;
  if (min < 24 * 60) return `a las ${format(start, "HH:mm")}`;
  return `el ${format(start, "dd/MM 'a las' HH:mm")}`;
}

export function EventReminders() {
  useEffect(() => {
    let last = Date.now() - 60_000;
    const check = async () => {
      const now = Date.now();
      const from = new Date(now - 60_000);
      const events = await db.events.filter((e) => !!e.reminders?.length && e.status !== "CANCELLED").toArray();
      const visible = new Set((await db.calendars.toArray()).filter((c) => c.enabled).map((c) => c.id));
      const fired = readFired();
      let changed = false;
      for (const ev of events) {
        if (!visible.has(ev.calendarId)) continue;
        for (const start of occurrences(ev, from, new Date(now + LOOK_AHEAD))) {
          for (const min of ev.reminders!) {
            const at = start.getTime() - min * 60_000;
            const id = `${ev.id}:${start.getTime()}:${min}`;
            // Avisa lo que cayó desde la última revisión (o hace poco, si la app estaba cerrada).
            if (at > now || at < Math.min(last, now - 15 * 60_000) || fired.has(id)) continue;
            fired.add(id);
            changed = true;
            const text = `${ev.title} · ${whenText(start, ev.allDay)}${ev.location ? ` · ${ev.location}` : ""}`;
            toast(text, {
              ms: 15000,
              action: {
                label: "Ver",
                run: () => {
                  const length = new Date(ev.end).getTime() - new Date(ev.start).getTime();
                  openEventDialog({
                    item: { key: id, kind: "event", title: ev.title, start, end: new Date(start.getTime() + length), allDay: ev.allDay, color: "primary", calendarName: "", event: ev, occurrence: start },
                  });
                },
              },
            });
            try {
              if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(ev.title, { body: text, tag: id });
            } catch {}
          }
        }
      }
      last = now;
      if (changed) saveFired(fired);
    };
    void check();
    const t = window.setInterval(() => void check(), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return null;
}
