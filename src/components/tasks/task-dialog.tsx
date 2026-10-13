"use client";

import { useState, type FormEvent } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { Modal } from "@/components/ui/modal";
import { useAppState } from "@/lib/app-state";
import { db, newId, nowIso } from "@/lib/db";
import { useAllSubjects, useDegrees } from "@/lib/hooks";
import { TASK_TYPE_LABEL, type Task, type TaskPriority, type TaskStatus, type TaskType } from "@/lib/types";
import { END_OF_DAY, PRIORITY_LABEL, STATUS_LABEL, stripUndefined } from "./task-meta";

// Diálogo global de tarea: crear, editar y eliminar. Se monta sólo cuando está abierto,
// así cada apertura arranca con el formulario limpio o con la tarea elegida.
export function TaskDialog() {
  const { taskDialog, closeTaskDialog } = useAppState();
  if (!taskDialog.open) return null;
  return <TaskEditor task={taskDialog.task} onClose={closeTaskDialog} />;
}

// "2026-10-17" y "23:59" en la hora local del navegador
function toDateInput(iso: string) {
  return format(new Date(iso), "yyyy-MM-dd");
}
function toTimeInput(iso: string) {
  return format(new Date(iso), "HH:mm");
}

function TaskEditor({ task, onClose }: { task?: Partial<Task>; onClose: () => void }) {
  const { degreeFilter } = useAppState();
  const degrees = useDegrees();
  const subjects = useAllSubjects();
  const editing = !!task?.id;
  const fromMail = task?.source === "EMAIL_AUTO" || !!task?.rawEmailBody;

  const [title, setTitle] = useState(task?.title ?? "");
  const [type, setType] = useState<TaskType>(task?.type ?? "TAREA");
  const [degreeId, setDegreeId] = useState(task?.degreeId ?? (degreeFilter !== "all" ? degreeFilter : ""));
  const [subjectId, setSubjectId] = useState(task?.subjectId ?? "");
  const [date, setDate] = useState(task?.dueDate ? toDateInput(task.dueDate) : "");
  const [time, setTime] = useState(task?.dueDate ? toTimeInput(task.dueDate) : "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "MEDIUM");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "TODO");
  const [description, setDescription] = useState(task?.description ?? "");
  const [error, setError] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // "En el inbox" sólo aparece para tareas que vienen de un mail.
  const statusOptions: TaskStatus[] = ["TODO", "IN_PROGRESS", "DONE"];
  if (task?.status === "INBOX_EMAIL") statusOptions.unshift("INBOX_EMAIL");

  // Materias de la carrera elegida. Sin carrera, se muestran todas.
  const visibleSubjects = subjects.filter((s) => !degreeId || s.degreeId === degreeId);
  const degreeName = (id: string) => degrees.find((d) => d.id === id)?.shortName;

  function changeDegree(next: string) {
    setDegreeId(next);
    const current = subjects.find((s) => s.id === subjectId);
    if (current && next && current.degreeId !== next) setSubjectId("");
  }

  // Combina fecha y hora locales. Sin fecha → sin vencimiento.
  function buildDueIso(): string | undefined {
    if (!date) return undefined;
    const [y, mo, d] = date.split("-").map(Number);
    const [h, m] = (time || END_OF_DAY).split(":").map(Number);
    return new Date(y, mo - 1, d, h, m, 0, 0).toISOString();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) {
      setError("Escribí un título para la tarea.");
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const fields = {
        title: clean,
        type,
        degreeId: degreeId || undefined,
        subjectId: subjectId || undefined,
        dueDate: buildDueIso(),
        priority,
        status,
        description: description.trim() || undefined,
      };
      if (task?.id) {
        const current = await db.tasks.get(task.id);
        const next = stripUndefined({
          ...current,
          ...fields,
          id: task.id,
          source: current?.source ?? "MANUAL",
          createdAt: current?.createdAt ?? nowIso(),
        }) as Task;
        await db.tasks.put(next);
      } else {
        const next = stripUndefined({
          ...fields,
          id: newId(),
          source: "MANUAL" as const,
          createdAt: nowIso(),
        }) as Task;
        await db.tasks.add(next);
      }
      onClose();
    } catch {
      setError("No pudimos guardar la tarea. Probá de nuevo.");
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!task?.id) return;
    await db.tasks.delete(task.id);
    onClose();
  }

  const footer = confirmingDelete ? (
    <>
      <span className="t-small mr-auto text-muted">¿Eliminar esta tarea?</span>
      <button className="btn" onClick={() => setConfirmingDelete(false)}>
        Cancelar
      </button>
      <button className="btn btn-danger" onClick={onDelete}>
        Sí, eliminar
      </button>
    </>
  ) : (
    <>
      {editing && (
        <button className="btn btn-danger mr-auto" onClick={() => setConfirmingDelete(true)}>
          <Trash2 strokeWidth={1.75} />
          Eliminar
        </button>
      )}
      <button className="btn" onClick={onClose}>
        Cancelar
      </button>
      <button className="btn btn-primary" type="submit" form="task-form" disabled={saving}>
        Guardar
      </button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={editing ? "Editar tarea" : "Nueva tarea"} footer={footer} width={560}>
      <form id="task-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        {task?.aiSummary && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-primary-tint p-3">
            <Sparkles className="mt-0.5 h-4 w-4 flex-none text-primary-soft" strokeWidth={1.75} />
            <p className="t-small">{task.aiSummary}</p>
          </div>
        )}

        <label className="field">
          <span>Título</span>
          <input
            className={clsx("input", error && "input-error")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Por ejemplo: TP 2, diagrama de clases"
            autoFocus
          />
          {error && <p className="t-small text-rose">{error}</p>}
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field">
            <span>Tipo</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Carrera</span>
            <select className="input" value={degreeId} onChange={(e) => changeDegree(e.target.value)}>
              <option value="">Sin carrera</option>
              {degrees.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Materia</span>
          <select className="input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Sin materia</option>
            {visibleSubjects.map((s) => (
              <option key={s.id} value={s.id}>
                {!degreeId && degreeName(s.degreeId) ? `${s.name} · ${degreeName(s.degreeId)}` : s.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field">
            <span>Fecha</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Hora</span>
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} disabled={!date} />
          </label>
        </div>
        {date && !time && <p className="t-small text-faint">Sin hora, la tarea vence a las {END_OF_DAY}.</p>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field">
            <span>Prioridad</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Estado</span>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Descripción</span>
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </label>

        {fromMail && (
          <details className="rounded-md border border-border p-3">
            <summary className="t-small cursor-pointer font-medium text-muted">Mail original</summary>
            <div className="mt-3 flex flex-col gap-2">
              {task?.rawEmailFrom && <p className="t-small text-muted">De: {task.rawEmailFrom}</p>}
              <pre className="t-small whitespace-pre-wrap font-sans">{task?.rawEmailBody ?? "Sin contenido."}</pre>
            </div>
          </details>
        )}
      </form>
    </Modal>
  );
}
