"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { useNow } from "@/components/dashboard/use-now";
import { MonthGrid, dayKey, type ExternalEvent } from "@/components/calendar/month-grid";
import { useSettings } from "@/components/settings/apply-settings";
import { useOpen } from "@/components/workspace/use-open";
import { CALENDAR_BORDER_L, syncAllCalendars, useCalendarEvents, useCalendars } from "@/lib/calendars/sync";
import { db } from "@/lib/db";
import { toast } from "@/lib/undo";
import { byDueDate } from "@/components/tasks/task-meta";
import { useTasks } from "@/lib/hooks";
import type { Task } from "@/lib/types";

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Calendario de mes a pantalla completa, con una barra fina arriba.
export function CalendarioView() {
  const now = useNow();
  const [offset, setOffset] = useState(0); // meses respecto del actual
  const tasks = useTasks();
  const [settings] = useSettings();
  const open = useOpen();
  const calendars = useCalendars();
  const events = useCalendarEvents();
  const [syncing, setSyncing] = useState(false);

  // Los mails sin confirmar no se muestran en el calendario.
  const scheduled = tasks.filter((t) => t.dueDate && t.status !== "INBOX_EMAIL" && (settings.showDoneTasks || t.status !== "DONE"));

  async function sync() {
    setSyncing(true);
    await syncAllCalendars().catch(() => {});
    setSyncing(false);
    const failed = (await db.calendars.toArray()).filter((c) => c.error);
    if (failed.length) toast(`No pudimos sincronizar ${failed.map((c) => c.name).join(", ")}. Revisalo en Ajustes.`, { tone: "error" });
  }

  if (!now) return <div />;

  const month = addMonths(startOfMonth(now), offset);
  const weekStartsOn = settings.weekStart === "dom" ? 0 : 1;
  const days = eachDayOfInterval({
    start: startOfWeek(month, { weekStartsOn }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn }),
  });

  const tasksByDay = new Map<string, Task[]>();
  for (const task of scheduled) {
    if (!task.dueDate) continue;
    const key = dayKey(new Date(task.dueDate));
    tasksByDay.set(key, [...(tasksByDay.get(key) ?? []), task]);
  }
  for (const list of tasksByDay.values()) list.sort(byDueDate);

  // Un evento largo aparece en cada día que ocupa (hasta 31 días).
  const eventsByDay = new Map<string, ExternalEvent[]>();
  for (const event of events) {
    const start = new Date(event.start);
    const end = event.end ? new Date(new Date(event.end).getTime() - (event.allDay ? 1 : 0)) : start;
    let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    for (let n = 0; n < 31 && (day <= end || n === 0); n++, day = addDays(day, 1)) {
      const key = dayKey(day);
      eventsByDay.set(key, [...(eventsByDay.get(key) ?? []), event]);
    }
  }
  for (const list of eventsByDay.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex h-9 flex-none items-center gap-1 border-b border-border px-3">
        <span className="text-[15px] font-semibold text-text">{capitalize(format(month, "LLLL yyyy", { locale: es }))}</span>
        <div className="ml-auto flex items-center gap-1">
          {calendars.length > 0 ? (
            <>
              {calendars.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={c.enabled}
                  title={c.error ?? (c.enabled ? "Ocultar este calendario" : "Mostrar este calendario")}
                  onClick={() => void db.calendars.update(c.id, { enabled: !c.enabled })}
                  className={clsx(
                    "btn btn-sm max-w-[160px] border-l-2 aria-pressed:bg-primary-tint aria-pressed:text-primary-soft",
                    CALENDAR_BORDER_L[c.color],
                    !c.enabled && "opacity-60",
                  )}
                >
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
              <button type="button" className="icon-btn" aria-label="Sincronizar calendarios" disabled={syncing} onClick={() => void sync()}>
                <RefreshCw strokeWidth={1.75} className={clsx(syncing && "animate-spin")} />
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={(e) => open({ type: "ajustes", section: "calendarios" }, e)}>
              Conectar calendario
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Mes anterior" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft strokeWidth={1.75} />
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setOffset(0)}>
            Hoy
          </button>
          <button type="button" className="icon-btn" aria-label="Mes siguiente" onClick={() => setOffset((o) => o + 1)}>
            <ChevronRight strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex-1 p-3">
        <MonthGrid days={days} month={month} tasksByDay={tasksByDay} eventsByDay={eventsByDay} weekStart={settings.weekStart} />
      </div>
    </div>
  );
}
