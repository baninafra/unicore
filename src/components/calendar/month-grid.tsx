"use client";

import { useState } from "react";
import clsx from "clsx";
import { format, isSameMonth, isToday } from "date-fns";
import { useAppState } from "@/lib/app-state";
import type { Task, TaskType } from "@/lib/types";
import { TASK_TYPE_LABEL } from "@/lib/types";
import { endOfDayIso } from "@/components/tasks/task-meta";
import { useTaskMenu } from "@/components/tasks/task-menu";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const VISIBLE_EVENTS = 3;

export function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

// Color del borde izquierdo según el tipo: parciales y finales en rosa, entregas en ámbar, el resto en gris.
function borderFor(type: TaskType) {
  if (type === "PARCIAL" || type === "FINAL") return "border-rose";
  if (type === "TP" || type === "FORO") return "border-amber";
  return "border-border-strong";
}

function EventLine({ task }: { task: Task }) {
  const { openTaskDialog } = useAppState();
  const { show, menu } = useTaskMenu();
  const done = task.status === "DONE";
  return (
    <>
      <button
        type="button"
        title={`${TASK_TYPE_LABEL[task.type]}: ${task.title}`}
        onClick={(e) => {
          e.stopPropagation();
          openTaskDialog(task);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          show(e, task);
        }}
        className={clsx(
          "flex w-full min-w-0 cursor-default items-center border-l-2 pl-1.5 text-left text-xs leading-5 text-text hover:bg-surface-raised",
          borderFor(task.type),
          done && "text-faint line-through opacity-70",
        )}
      >
        <span className="truncate">{task.title}</span>
      </button>
      {menu}
    </>
  );
}

// Grilla de mes lunes a domingo con líneas finas. Clic en un día vacío crea una tarea con esa fecha.
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
    <div className="min-w-[640px] overflow-x-auto">
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((d) => (
          <div key={d} className="t-label px-2 pb-1.5">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden border-y border-border bg-border">
        {days.map((day) => {
          const key = dayKey(day);
          const dayTasks = tasksByDay.get(key) ?? [];
          const isExpanded = expanded.has(key);
          const shown = isExpanded ? dayTasks : dayTasks.slice(0, VISIBLE_EVENTS);
          const hidden = dayTasks.length - shown.length;
          const today = isToday(day);
          const inMonth = isSameMonth(day, month);

          return (
            <div
              key={key}
              onClick={() => openTaskDialog({ dueDate: endOfDayIso(day) })}
              className="flex min-h-[104px] min-w-0 cursor-default flex-col gap-0.5 bg-surface p-1.5 hover:bg-surface-raised"
            >
              <span
                className={clsx(
                  "num t-small flex h-5 w-5 flex-none items-center justify-center rounded-full",
                  today ? "bg-primary-fill text-on-primary" : inMonth ? "text-muted" : "text-faint",
                )}
              >
                {format(day, "d")}
              </span>

              {shown.map((task) => (
                <EventLine key={task.id} task={task} />
              ))}

              {dayTasks.length > VISIBLE_EVENTS && (
                <button
                  type="button"
                  className="px-1.5 text-left text-xs text-faint hover:text-text"
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
  );
}
