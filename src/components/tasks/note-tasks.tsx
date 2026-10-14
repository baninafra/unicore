"use client";

// Tareas enlazadas a una nota (o clase), arriba del editor. Se tildan desde acá.

import { useLiveQuery } from "dexie-react-hooks";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { useAppState } from "@/lib/app-state";
import { isSpecialFolder } from "@/lib/nav/actions";
import { isClassNote, taskFromNote } from "@/lib/tasks/class-tasks";
import { shortDateTime } from "@/lib/format";
import { TASK_TYPE_LABEL, type Note } from "@/lib/types";

export function NoteTasks({ note }: { note: Note }) {
  const { openTaskDialog } = useAppState();
  const tasks = useLiveQuery(() => db.tasks.filter((t) => t.noteId === note.id).toArray(), [note.id]) ?? [];
  if (isSpecialFolder(note.subjectId)) return null;
  const klass = isClassNote(note);

  return (
    <div className="flex flex-col gap-1">
      {tasks.length > 0 && <p className="section-label">{klass ? "Tareas de esta clase" : "Tareas de esta nota"}</p>}
      {tasks
        .sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))
        .map((t) => (
          <div key={t.id} className="row gap-2">
            <input
              type="checkbox"
              checked={t.status === "DONE"}
              onChange={(e) => void db.tasks.update(t.id, { status: e.target.checked ? "DONE" : "TODO" })}
              aria-label={`Marcar «${t.title}» como hecha`}
            />
            <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => openTaskDialog(t)}>
              <span className={clsx(t.status === "DONE" && "text-faint line-through")}>{t.title}</span>
            </button>
            <span className="badge badge-amber">{TASK_TYPE_LABEL[t.type]}</span>
            {t.dueDate && <span className="num text-[12px] text-faint">{shortDateTime(t.dueDate)}</span>}
          </div>
        ))}
      <button
        type="button"
        className="flex items-center gap-1 self-start text-[13px] text-faint hover:text-text"
        onClick={async () => openTaskDialog(await taskFromNote(note))}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        {klass ? "Tarea para esta clase" : "Tarea desde esta nota"}
      </button>
    </div>
  );
}
