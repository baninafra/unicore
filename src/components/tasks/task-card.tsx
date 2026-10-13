"use client";

import { BookOpen, Calendar } from "lucide-react";
import clsx from "clsx";
import { useAppState } from "@/lib/app-state";
import { degreeBadgeClass, isUrgent, relativeDays, shortDate, TASK_TYPE_BADGE } from "@/lib/format";
import type { Degree, Subject, Task } from "@/lib/types";
import { TASK_TYPE_LABEL } from "@/lib/types";
import { TASK_TYPE_ICON } from "./task-meta";

// Tarjeta de tarea. Quien la usa le pasa la carrera y la materia ya resueltas.
export function TaskCard({ task, degree, subject }: { task: Task; degree?: Degree; subject?: Subject }) {
  const { openTaskDialog } = useAppState();
  const TypeIcon = TASK_TYPE_ICON[task.type];
  const done = task.status === "DONE";
  const urgent = !done && !!task.dueDate && isUrgent(task.type, task.dueDate);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTaskDialog(task)}
      onKeyDown={(e) => {
        // Enter abre; Space queda para el arrastre por teclado del kanban.
        if (e.key === "Enter") {
          e.preventDefault();
          openTaskDialog(task);
        }
      }}
      className={clsx(
        "flex w-full cursor-pointer flex-col gap-2 rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong",
        done && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={TASK_TYPE_BADGE[task.type]}>
          <TypeIcon strokeWidth={1.75} />
          {TASK_TYPE_LABEL[task.type]}
        </span>
        {degree && <span className={degreeBadgeClass(degree)}>{degree.shortName}</span>}
        {task.source === "EMAIL_AUTO" && <span className="badge badge-amber ml-auto">Mail</span>}
      </div>

      <div className={clsx("t-h3", done && "line-through")}>{task.title}</div>

      {subject && (
        <div className="t-small flex items-center gap-1.5 text-muted">
          <BookOpen className="h-4 w-4 flex-none" strokeWidth={1.75} />
          <span className="truncate">{subject.name}</span>
        </div>
      )}

      {task.dueDate && (
        <div className={clsx("t-small flex items-center gap-1.5", urgent ? "text-rose" : "text-muted")}>
          <Calendar className="h-4 w-4 flex-none" strokeWidth={1.75} />
          <span className="num">
            {shortDate(task.dueDate)} · {relativeDays(task.dueDate)}
          </span>
        </div>
      )}
    </div>
  );
}
