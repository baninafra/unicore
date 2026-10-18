"use client";

// Notificaciones: entregas vencidas, lo de hoy y mañana, parciales y finales de la semana
// y las flashcards para repasar. Se calculan de la base; "Descartar" se recuerda en este equipo.

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { useSettings } from "@/components/settings/apply-settings";
import { db } from "./db";
import { shortDateTime } from "./format";
import { TASK_TYPE_LABEL, type Task } from "./types";
import { t } from "./i18n";

export type NotifLevel = "vencida" | "hoy" | "manana" | "semana" | "repaso";

export interface Notif {
  id: string; // estable: taskId:nivel
  level: NotifLevel;
  title: string;
  detail: string;
  task?: Task;
  subjectId?: string;
}

const KEY = "uc-notif-dismissed";
const EVENT = "uc:notif-dismissed";

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function dismiss(ids: string[]) {
  const s = readDismissed();
  ids.forEach((i) => s.add(i));
  try {
    localStorage.setItem(KEY, JSON.stringify([...s].slice(-500)));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function useNotifications(): { items: Notif[]; unread: number } {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [, tick] = useState(0);
  const [settings] = useSettings();
  useEffect(() => {
    setDismissed(readDismissed());
    const on = () => setDismissed(readDismissed());
    window.addEventListener(EVENT, on);
    // Se recalcula cada 5 minutos (cambia "hoy", "mañana", etc.).
    const t = window.setInterval(() => tick((n) => n + 1), 5 * 60_000);
    return () => {
      window.removeEventListener(EVENT, on);
      window.clearInterval(t);
    };
  }, []);

  const data = useLiveQuery(async () => {
    const from = startOfDay(new Date());
    const [tasks, subjects, dueCards, calendars, events] = await Promise.all([
      db.tasks.filter((t) => t.status !== "DONE" && !!t.dueDate).toArray(),
      db.subjects.toArray(),
      db.flashcards.where("due").belowOrEqual(new Date().toISOString()).count(),
      db.calendars.toArray(),
      db.calendarEvents
        .where("start")
        .between(from.toISOString(), new Date(from.getTime() + 2 * 86_400_000).toISOString())
        .toArray(),
    ]);
    const visible = new Map(calendars.filter((c) => c.enabled).map((c) => [c.id, c.name]));
    return { tasks, subjects, dueCards, events: events.filter((e) => visible.has(e.calendarId)).map((e) => ({ ...e, calendarName: visible.get(e.calendarId)! })) };
  }, []);

  const items: Notif[] = [];
  if (data) {
    const names = new Map(data.subjects.map((s) => [s.id, s.name]));
    const today = startOfDay(new Date()).getTime();
    const day = 86_400_000;
    for (const t of data.tasks) {
      const due = new Date(t.dueDate!);
      const d = startOfDay(due).getTime();
      const exam = t.type === "PARCIAL" || t.type === "FINAL";
      let level: NotifLevel | null = null;
      if (due.getTime() < Date.now()) level = "vencida";
      else if (d === today) level = "hoy";
      else if (d === today + day) level = "manana";
      else if (exam && d <= today + 7 * day) level = "semana";
      else if (!exam && d <= today + 3 * day) level = "semana";
      if (!level) continue;
      if (level === "vencida" && !settings.notifOverdue) continue;
      if (level === "hoy" && !settings.notifToday) continue;
      if (level === "manana" && !settings.notifTomorrow) continue;
      if (level === "semana" && !settings.notifUpcoming) continue;
      const hour = format(due, "HH:mm");
      items.push({
        id: `${t.id}:${level}`,
        level,
        title: t.title,
        detail: [TASK_TYPE_LABEL[t.type], t.subjectId ? names.get(t.subjectId) : undefined, level === "hoy" || level === "manana" ? hour : shortDateTime(t.dueDate)]
          .filter(Boolean)
          .join(" · "),
        task: t,
        subjectId: t.subjectId,
      });
    }
    if (settings.notifEvents) {
      for (const e of data.events) {
        const start = new Date(e.start);
        const d = startOfDay(start).getTime();
        const level: NotifLevel | null = d === today ? "hoy" : d === today + day ? "manana" : null;
        if (!level || (!e.allDay && start.getTime() < Date.now() - 3_600_000)) continue;
        items.push({
          id: `ev:${e.id}:${level}`,
          level,
          title: e.title,
          detail: [e.calendarName, e.allDay ? t("Todo el día") : format(start, "HH:mm"), e.location].filter(Boolean).join(" · "),
        });
      }
    }
    if (data.dueCards > 0 && settings.notifReview) {
      const key = new Date().toISOString().slice(0, 10);
      items.push({
        id: `repaso:${key}`,
        level: "repaso",
        title: data.dueCards === 1 ? t("{n} flashcard para repasar", { n: data.dueCards }) : t("{n} flashcards para repasar", { n: data.dueCards }),
        detail: t("Repaso de hoy"),
      });
    }
  }
  const order: NotifLevel[] = ["vencida", "hoy", "manana", "semana", "repaso"];
  items.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level) || (a.task?.dueDate ?? "").localeCompare(b.task?.dueDate ?? ""));
  const visible = items.filter((i) => !dismissed.has(i.id));
  return { items: visible, unread: visible.filter((i) => i.level !== "semana").length };
}

export const LEVEL_LABEL: Record<NotifLevel, string> = {
  vencida: t("Vencidas"),
  hoy: t("Hoy"),
  manana: t("Mañana"),
  semana: t("Próximos días"),
  repaso: t("Repaso"),
};
