"use client";

// Vista de mes y de varias semanas: una celda por día con sus eventos, tareas y fechas del cronograma.
// Clic en un hueco crea un evento ese día; se arrastran eventos y tareas de un día a otro (conservan la hora)
// y se sueltan tareas desde la lista. Clic en el número abre el día.

import { useState } from "react";
import clsx from "clsx";
import { addDays, format, isSameMonth, isToday, startOfDay } from "date-fns";
import type { CalItem } from "@/lib/calendars/events";
import { ITEM_MIME, ItemChip, TASK_MIME } from "./calendar-parts";
import type { GridHandlers } from "./time-grid";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const WEEKDAYS_SUNDAY_FIRST = ["dom", ...WEEKDAYS.slice(0, 6)];
const DAY_MS = 86_400_000;

export function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function MonthGrid({
  days,
  month,
  items,
  weekStart = "lun",
  h,
  compact,
}: {
  days: Date[];
  month?: Date; // en la vista de mes, los días de otros meses van más tenues
  items: CalItem[];
  weekStart?: "lun" | "dom";
  h: GridHandlers;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);
  const weeks = Math.ceil(days.length / 7);
  const visible = compact ? 3 : weeks <= 4 ? 5 : 4;

  const byDay = new Map<string, CalItem[]>();
  for (const it of items) {
    // Un evento largo aparece en cada día que ocupa.
    let d = startOfDay(it.start);
    const last = new Date(Math.max(it.start.getTime(), it.end.getTime() - 1));
    for (let n = 0; n < 62 && d <= last; n++, d = addDays(d, 1)) {
      const k = dayKey(d);
      byDay.set(k, [...(byDay.get(k) ?? []), it]);
    }
  }

  const drop = (e: React.DragEvent, day: Date) => {
    setOver(null);
    const task = e.dataTransfer.getData(TASK_MIME);
    const key = e.dataTransfer.getData(ITEM_MIME);
    if (!task && !key) return;
    e.preventDefault();
    if (task) return h.onDropTask(task, startOfDay(day), true);
    const it = items.find((x) => x.key === key);
    if (!it) return;
    const shift = Math.round((startOfDay(day).getTime() - startOfDay(it.start).getTime()) / DAY_MS) * DAY_MS;
    if (!shift) return;
    // Correr días respetando la hora local aunque cambie el horario de verano.
    const move = (d: Date) => {
      const x = new Date(d);
      x.setDate(x.getDate() + Math.round(shift / DAY_MS));
      return x;
    };
    h.onMove(it, move(it.start), move(it.end), it.allDay);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid flex-none grid-cols-7">
        {(weekStart === "dom" ? WEEKDAYS_SUNDAY_FIRST : WEEKDAYS).map((d) => (
          <div key={d} className="t-label px-2 pb-1.5">
            {d}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 gap-px overflow-y-auto border-y border-border bg-border" style={{ gridTemplateRows: `repeat(${weeks}, minmax(${compact ? 96 : 110}px, 1fr))` }}>
        {days.map((day) => {
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const isExpanded = expanded.has(key);
          const shown = isExpanded ? list : list.slice(0, visible);
          const hidden = list.length - shown.length;
          const today = isToday(day);
          const inMonth = !month || isSameMonth(day, month);

          return (
            <div
              key={key}
              onClick={() => {
                const s = new Date(day);
                s.setHours(9, 0, 0, 0);
                h.onCreate(s, new Date(s.getTime() + 3_600_000), false);
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TASK_MIME) && !e.dataTransfer.types.includes(ITEM_MIME)) return;
                e.preventDefault();
                setOver(key);
              }}
              onDragLeave={() => setOver((o) => (o === key ? null : o))}
              onDrop={(e) => drop(e, day)}
              className={clsx("flex min-w-0 cursor-default flex-col gap-0.5 p-1", inMonth ? "bg-surface" : "bg-bg", over === key && "bg-primary-tint", "hover:bg-surface-raised")}
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Ver este día"
                  onClick={(e) => {
                    e.stopPropagation();
                    h.onPickDay(day);
                  }}
                  className={clsx(
                    "num t-small flex h-5 min-w-5 flex-none items-center justify-center rounded-full px-1 hover:bg-surface-raised",
                    today ? "bg-primary-fill font-semibold text-on-primary hover:bg-primary-fill" : inMonth ? "text-muted" : "text-faint",
                  )}
                >
                  {day.getDate() === 1 ? format(day, "d MMM") : format(day, "d")}
                </button>
              </div>

              {shown.map((it) => (
                <ItemChip key={it.key} it={it} onOpen={h.onOpen} onContext={h.onContext} onToggleTask={h.onToggleTask} draggable />
              ))}

              {list.length > visible && (
                <button
                  type="button"
                  className="px-1.5 text-left text-xs text-faint hover:text-text"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                >
                  {isExpanded ? "Ver menos" : `+${hidden} más`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
