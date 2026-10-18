"use client";

import { useProfiles } from "@/lib/profiles";
import clsx from "clsx";
import { useAppState } from "@/lib/app-state";
import { shortDate, isUrgent, TASK_TYPE_BADGE } from "@/lib/format";
import type { Subject, Task } from "@/lib/types";
import { useTaskMenu } from "./task-menu";

// Fila de tarea para listas: tipo, título, materia y fecha. Clic abre, clic derecho da acciones.
export function TaskRow({ task, subject }: { task: Task; subject?: Subject }) {
  const { openTaskDialog } = useAppState();
  const { show, menu } = useTaskMenu();
  const done = task.status === "DONE";
  const { taskLabel } = useProfiles();
  const urgent = !done && !!task.dueDate && isUrgent(task.type, task.dueDate);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={clsx("row", done && "opacity-60")}
        onClick={() => openTaskDialog(task)}
        onKeyDown={(e) => {
          if (e.key === "Enter") openTaskDialog(task);
        }}
        onContextMenu={(e) => show(e, task)}
      >
        <span className={clsx(TASK_TYPE_BADGE[task.type], "flex-none")}>{taskLabel(task)}</span>
        <span className={clsx("min-w-0 flex-1 truncate text-text", done && "line-through")}>{task.title}</span>
        {subject && <span className="max-w-[160px] flex-none truncate text-faint">{subject.name}</span>}
        {task.dueDate && (
          <span className={clsx("t-small num flex-none", urgent ? "text-rose" : "text-faint")}>{shortDate(task.dueDate)}</span>
        )}
      </div>
      {menu}
    </>
  );
}
