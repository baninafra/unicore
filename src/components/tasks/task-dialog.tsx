"use client";

import { cap, useProfiles } from "@/lib/profiles";
import { useCallback, useState, type FormEvent } from "react";
import { deleteWithUndo } from "@/lib/undo";
import { Sparkles, Trash2 } from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { Modal } from "@/components/ui/modal";
import { useAppState } from "@/lib/app-state";
import { db, newId, nowIso } from "@/lib/db";
import { useAllSubjects, useDegrees } from "@/lib/hooks";
import { TASK_TYPE_LABEL, type Task, type TaskPriority, type TaskStatus, type TaskType } from "@/lib/types";
import { END_OF_DAY, PRIORITY_LABEL, STATUS_LABEL, stripUndefined } from "./task-meta";
import { Select } from "@/components/ui/select";
import dynamic from "next/dynamic";
import { markdownToBlocks } from "@/lib/notes/md-blocks";
import { useLiveQuery } from "dexie-react-hooks";
import { useWorkspace } from "@/lib/workspace";
import { subjectNotesForLinking } from "@/lib/tasks/class-tasks";
import { plainTextOf, type BlockLike } from "@/lib/notes/index-note";

const RichField = dynamic(() => import("@/components/notes/rich-field").then((m) => m.RichField), {
  ssr: false,
  loading: () => <div className="min-h-[200px]" />,
});

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

const CONTROL = "input h-7 min-w-0 border-transparent bg-transparent px-2 hover:bg-surface-raised";

// Fila "nombre · control", como una propiedad de Obsidian.
function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span>{label}</span>
      <div className="flex min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

function TaskEditor({ task, onClose }: { task?: Partial<Task>; onClose: () => void }) {
  const { degreeFilter } = useAppState();
  const { termsFor, termsForSubject, inScope } = useProfiles();
  const allDegrees = useDegrees();
  const subjects = useAllSubjects();
  const editing = !!task?.id;
  const fromMail = task?.source === "EMAIL_AUTO" || !!task?.rawEmailBody;

  const [title, setTitle] = useState(task?.title ?? "");
  const [type, setType] = useState<TaskType>(task?.type ?? "TAREA");
  const [degreeId, setDegreeId] = useState(task?.degreeId ?? (degreeFilter !== "all" ? degreeFilter : ""));
  const [subjectId, setSubjectId] = useState(task?.subjectId ?? "");
  // Nombres según el espacio elegido (o el perfil que se está viendo).
  const terms = degreeId ? termsFor(degreeId) : subjectId ? termsForSubject(subjectId) : termsFor();
  // Espacios del perfil activo (y el de la tarea, aunque sea de otro perfil).
  const degrees = allDegrees.filter((d) => inScope(d.id) || d.id === degreeId);
  const [noteId, setNoteId] = useState(task?.noteId ?? "");
  const linkable = useLiveQuery(() => (subjectId ? subjectNotesForLinking(subjectId) : Promise.resolve([])), [subjectId]) ?? [];
  const { openView } = useWorkspace();
  const [date, setDate] = useState(task?.dueDate ? toDateInput(task.dueDate) : "");
  const [time, setTime] = useState(task?.dueDate ? toTimeInput(task.dueDate) : "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "MEDIUM");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "TODO");
  const [description, setDescription] = useState(task?.description ?? "");
  // Detalle en bloques: si la tarea vieja sólo tenía texto, se convierte.
  const [initialContent] = useState<unknown[]>(() => task?.content ?? (task?.description ? markdownToBlocks(task.description) : []));
  const [content, setContent] = useState<unknown[]>(initialContent);
  const onContent = useCallback((blocks: unknown[]) => {
    setContent(blocks);
    setDescription(plainTextOf(blocks as BlockLike[]));
  }, []);
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
        noteId: subjectId && noteId ? noteId : "",
        dueDate: buildDueIso(),
        priority,
        status,
        description: description.trim() || undefined,
        content: description.trim() || content.some((b) => (b as { type?: string }).type === "image") ? content : [],
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
    const id = task.id;
    onClose();
    await deleteWithUndo(`Se eliminó «${task.title ?? "la tarea"}»`, () => db.tasks.delete(id));
  }

  const footer = confirmingDelete ? (
    <>
      <span className="t-small mr-auto text-muted">¿Eliminar esta tarea?</span>
      <button className="btn btn-sm" onClick={() => setConfirmingDelete(false)}>
        Cancelar
      </button>
      <button className="btn btn-danger btn-sm" onClick={onDelete}>
        Eliminar
      </button>
    </>
  ) : (
    <>
      {editing && (
        <button className="btn btn-ghost btn-sm mr-auto" onClick={() => void onDelete()}>
          <Trash2 strokeWidth={1.75} />
          Eliminar
        </button>
      )}
      <button className="btn btn-sm" onClick={onClose}>
        Cancelar
      </button>
      <button className="btn btn-primary btn-sm" type="submit" form="task-form" disabled={saving}>
        Guardar
      </button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={editing ? "Editar tarea" : "Nueva tarea"} footer={footer} width={760} className="max-h-[90vh]">
      <form id="task-form" className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        <input
          className={clsx("w-full bg-transparent t-h2 outline-none placeholder:text-faint", error && "text-rose")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título"
          aria-label="Título"
          autoFocus
        />
        {error && <p className="t-small text-rose">{error}</p>}

        {task?.aiSummary && (
          <p className="t-small flex items-start gap-2 text-muted">
            <Sparkles className="mt-0.5 h-4 w-4 flex-none text-primary-soft" strokeWidth={1.75} />
            <span>{task.aiSummary}</span>
          </p>
        )}

        <div className="flex flex-col">
          <Prop label="Tipo">
            <Select className={CONTROL} value={type} onChange={(e) => setType(e.target.value as TaskType)}>
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
                <option key={t} value={t}>
                  {terms.taskTypes[t]}
                </option>
              ))}
            </Select>
          </Prop>

          <Prop label={cap(terms.space.one)}>
            <Select className={CONTROL} value={degreeId} onChange={(e) => changeDegree(e.target.value)}>
              <option value="">Sin {terms.space.one}</option>
              {degrees.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Prop>

          <Prop label={cap(terms.item.one)}>
            <Select className={CONTROL} value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setNoteId(""); }}>
              <option value="">Sin {terms.item.one}</option>
              {visibleSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {!degreeId && degreeName(s.degreeId) ? `${s.name} · ${degreeName(s.degreeId)}` : s.name}
                </option>
              ))}
            </Select>
          </Prop>

          {subjectId && (
            <Prop label={terms.study ? "Clase" : "Nota"}>
              <Select className={CONTROL} value={noteId} onChange={(e) => setNoteId(e.target.value)} aria-label="Clase o nota enlazada">
                <option value="">Sin enlazar</option>
                {linkable.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title || "Sin título"}
                  </option>
                ))}
              </Select>
              {noteId && (
                <button
                  type="button"
                  className="flex-none text-[length:calc(12px*var(--ui-scale,1))] text-primary-soft hover:underline"
                  onClick={() => {
                    onClose();
                    openView({ type: "nota", id: noteId }, "tab");
                  }}
                >
                  Abrir
                </button>
              )}
            </Prop>
          )}

          <Prop label="Vence">
            <input type="date" className={CONTROL} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha" />
            <input
              type="time"
              className={clsx(CONTROL, "w-24")}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!date}
              aria-label="Hora"
              placeholder={END_OF_DAY}
            />
          </Prop>

          <Prop label="Prioridad">
            <Select className={CONTROL} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Prop>

          <Prop label="Estado">
            <Select className={CONTROL} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Prop>
        </div>

        <div className="rounded-md border border-border bg-bg/40 py-1 focus-within:border-primary">
          <RichField
            initial={initialContent}
            onChange={onContent}
            placeholder="Detalles, consignas, links, fotos… Escribí / para agregar listas, tablas o imágenes"
          />
        </div>

        {fromMail && (
          <details className="rounded-md border border-border px-3 py-2">
            <summary className="t-small cursor-pointer text-muted">Mail original</summary>
            <div className="mt-2 flex flex-col gap-2">
              {task?.rawEmailFrom && <p className="t-small text-muted">De: {task.rawEmailFrom}</p>}
              <pre className="t-small whitespace-pre-wrap font-sans">{task?.rawEmailBody ?? "Sin contenido."}</pre>
            </div>
          </details>
        )}
      </form>
    </Modal>
  );
}
