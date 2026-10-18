"use client";

// Tareas enlazadas a una nota (o clase), arriba del editor. Se tildan desde acá.

import { useProfiles } from "@/lib/profiles";
import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { useAppState } from "@/lib/app-state";
import { isSpecialFolder } from "@/lib/nav/actions";
import { isClassNote, taskFromNote } from "@/lib/tasks/class-tasks";
import { shortDateTime } from "@/lib/format";
import type { Note } from "@/lib/types";
import { t } from "@/lib/i18n";

export function NoteTasks({ note }: { note: Note }) {
  const { openTaskDialog } = useAppState();
  const { taskLabel } = useProfiles();
  const tasks = useLiveQuery(() => db.tasks.filter((t) => t.noteId === note.id).toArray(), [note.id]) ?? [];
  if (isSpecialFolder(note.subjectId)) return null;
  const klass = isClassNote(note);

  return (
    <div className="flex flex-col gap-1">
      {tasks.length > 0 && <p className="section-label">{klass ? t("Tareas de esta clase") : t("Tareas de esta nota")}</p>}
      {tasks
        .sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))
        .map((task) => (
          <div key={task.id} className="row gap-2">
            <input
              type="checkbox"
              checked={task.status === "DONE"}
              onChange={(e) => void db.tasks.update(task.id, { status: e.target.checked ? "DONE" : "TODO" })}
              aria-label={t("Marcar «{title}» como hecha", { title: task.title })}
            />
            <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => openTaskDialog(task)}>
              <span className={clsx(task.status === "DONE" && "text-faint line-through")}>{task.title}</span>
            </button>
            <span className="badge badge-amber">{taskLabel(task)}</span>
            {task.dueDate && <span className="num text-[length:calc(12px*var(--ui-scale,1))] text-faint">{shortDateTime(task.dueDate)}</span>}
          </div>
        ))}
      <button
        type="button"
        className="flex items-center gap-1 self-start text-[length:calc(13px*var(--ui-scale,1))] text-faint hover:text-text"
        onClick={async () => openTaskDialog(await taskFromNote(note))}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {klass ? t("Tarea para esta clase") : t("Tarea desde esta nota")}
      </button>
    </div>
  );
}
