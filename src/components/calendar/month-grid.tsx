"use client";

import { useState } from "react";
import clsx from "clsx";
import { format, isSameMonth, isToday } from "date-fns";
import { useAppState } from "@/lib/app-state";
import { TASK_TYPE_BADGE } from "@/lib/format";
import type { Task } from "@/lib/types";
import { TASK_TYPE_LABEL } from "@/lib/types";
import { TASK_TYPE_ICON, endOfDayIso } from "@/components/tasks/task-meta";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const VISIBLE_CHIPS = 3;

export function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

// Grilla lunes a domingo. Cada día muestra hasta 3 tareas; el resto se despliega con "+N más".
export function MonthGrid({ days, month, tasksByDay }: { days: Date[]; month: Date; tasksByDay: Map<string, Task[]> }) {
  const { openTaskDialog } = useAppState();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 pb-2">
          {WEEKDAYS.map((d) => (
            <div key={d} className="t-small px-2 text-faint">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {days.map((day) => {
            const key = dayKey(day);
            const dayTasks = tasksByDay.get(key) ?? [];
            const isExpanded = expanded.has(key);
            const shown = isExpanded ? dayTasks : dayTasks.slice(0, VISIBLE_CHIPS);
            const hidden = dayTasks.length - shown.length;
            const isTodayCell = isToday(day);
            const inMonth = isSameMonth(day, month);

            // Clic en el día (fuera de un chip) → nueva tarea con esa fecha.
            return (
              <div
                key={key}
                onClick={() => openTaskDialog({ dueDate: endOfDayIso(day) })}
                className={clsx(
                  "flex min-h-[104px] min-w-0 cursor-pointer flex-col gap-1 bg-surface p-1.5 transition-colors hover:bg-surface-raised",
                  isTodayCell && "bg-primary-tint hover:bg-primary-tint",
                )}
              >
                <span
                  className={clsx(
                    "num t-small self-start px-1",
                    isTodayCell ? "font-semibold text-primary-soft" : inMonth ? "text-muted" : "text-faint",
                  )}
                >
                  {format(day, "d")}
                </span>

                {shown.map((task) => {
                  const Icon = TASK_TYPE_ICON[task.type];
                  return (
                    <button
                      key={task.id}
                      type="button"
                      title={`${TASK_TYPE_LABEL[task.type]}: ${task.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTaskDialog(task);
                      }}
                      className={clsx(TASK_TYPE_BADGE[task.type], "w-full min-w-0 cursor-pointer justify-start", task.status === "DONE" && "opacity-60")}
                    >
                      <Icon strokeWidth={1.75} />
                      <span className={clsx("hidden min-w-0 truncate md:inline", task.status === "DONE" && "line-through")}>{task.title}</span>
                    </button>
                  );
                })}

                {dayTasks.length > VISIBLE_CHIPS && (
                  <button
                    type="button"
                    className="t-small px-1 text-left text-muted hover:text-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(key);
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
    </div>
  );
}
