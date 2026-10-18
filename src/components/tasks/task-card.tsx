"use client";

import { useProfiles } from "@/lib/profiles";
import clsx from "clsx";
import { useAppState } from "@/lib/app-state";
import { isUrgent, shortDate } from "@/lib/format";
import type { Subject, Task } from "@/lib/types";
import { useTaskMenu } from "./task-menu";

// Tarjeta mínima del kanban: título, y debajo tipo · materia · fecha.
export function TaskCard({ task, subject }: { task: Task; subject?: Subject }) {
  const { openTaskDialog } = useAppState();
  const { show, menu } = useTaskMenu();
  const { taskLabel } = useProfiles();
  const done = task.status === "DONE";
  const urgent = !done && !!task.dueDate && isUrgent(task.type, task.dueDate);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => openTaskDialog(task)}
        onKeyDown={(e) => {
          // Enter abre; Space queda para el arrastre por teclado del kanban.
          if (e.key === "Enter") openTaskDialog(task);
        }}
        onContextMenu={(e) => show(e, task)}
        className={clsx(
          "flex w-full cursor-default flex-col gap-0.5 rounded-md border border-border bg-surface px-2.5 py-2 hover:border-border-strong",
          done && "opacity-60",
        )}
      >
        <span className={clsx("t-small truncate text-text", done && "line-through")}>{task.title}</span>
        <span className="t-small flex min-w-0 items-center gap-1.5 text-faint">
          <span className="flex-none">{taskLabel(task)}</span>
          {subject && (
            <>
              <span aria-hidden>·</span>
              <span className="min-w-0 truncate">{subject.name}</span>
            </>
          )}
          {task.dueDate && (
            <span className={clsx("num ml-auto flex-none", urgent && "text-rose")}>{shortDate(task.dueDate)}</span>
          )}
        </span>
      </div>
      {menu}
    </>
  );
}
