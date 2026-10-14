"use client";

import { useState } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import { ClipboardPaste, ListPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { db, newId } from "@/lib/db";
import { useAppState } from "@/lib/app-state";
import { parseScheduleText, scheduleDateLabel, sortSchedule } from "@/lib/cronograma";
import { SCHEDULE_KIND_LABEL, type ScheduleEntry, type ScheduleKind, type Subject, type TaskType } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { useNow } from "@/components/dashboard/use-now";
import { END_OF_DAY } from "@/components/tasks/task-meta";

const KINDS = Object.keys(SCHEDULE_KIND_LABEL) as ScheduleKind[];

const KIND_BADGE: Record<ScheduleKind, string> = {
  CLASE: "badge-primary",
  PARCIAL: "badge-rose",
  FINAL: "badge-rose",
  ENTREGA: "badge-amber",
  FERIADO: "badge-mint",
  OTRO: "",
};

const TASK_TYPE: Partial<Record<ScheduleKind, TaskType>> = { PARCIAL: "PARCIAL", FINAL: "FINAL", ENTREGA: "TP" };

function save(subject: Subject, schedule: ScheduleEntry[]) {
  return db.subjects.update(subject.id, { schedule: sortSchedule(schedule) });
}

function EntryDialog({ subject, entry, onClose }: { subject: Subject; entry?: ScheduleEntry; onClose: () => void }) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [date, setDate] = useState(entry?.date ?? today);
  const [kind, setKind] = useState<ScheduleKind>(entry?.kind ?? "CLASE");
  const [title, setTitle] = useState(entry?.title ?? "");

  async function submit() {
    if (!date) return;
    const next: ScheduleEntry = { id: entry?.id ?? newId(), date, kind, title: title.trim() || SCHEDULE_KIND_LABEL[kind], done: entry?.done };
    const rest = (subject.schedule ?? []).filter((e) => e.id !== next.id);
    await save(subject, [...rest, next]);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={entry ? "Editar fecha" : "Agregar al cronograma"}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={!date} onClick={() => void submit()}>
            Guardar
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>Fecha</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Tipo</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {SCHEDULE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>Tema o actividad</span>
          <input className="input" autoFocus value={title} placeholder="Límites y continuidad" onChange={(e) => setTitle(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

function PasteDialog({ subject, onClose }: { subject: Subject; onClose: () => void }) {
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseScheduleText(text) : [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;

  async function add() {
    await save(subject, [...(subject.schedule ?? []), ...parsed]);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Pegar cronograma"
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={parsed.length === 0} onClick={() => void add()}>
            {parsed.length ? `Agregar ${parsed.length} ${parsed.length === 1 ? "fecha" : "fechas"}` : "Agregar"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="t-small text-muted">Pegá el cronograma de la cátedra con una fecha por línea. Detectamos la fecha y el tipo (clase, parcial, entrega, final).</p>
        <textarea
          className="input min-h-[140px] py-2 font-mono"
          autoFocus
          value={text}
          placeholder={"14/10 Límites y continuidad\n21/10 Derivadas\n28 de octubre - Parcial 1\n11/11 Entrega TP 1"}
          onChange={(e) => setText(e.target.value)}
        />
        {text.trim() && (
          <div className="flex flex-col">
            <p className="t-small text-faint">
              {parsed.length} de {lines} {lines === 1 ? "línea" : "líneas"} con fecha
            </p>
            {parsed.slice(0, 12).map((e) => (
              <div key={e.id} className="row">
                <span className="t-small num w-20 flex-none whitespace-nowrap text-muted">{scheduleDateLabel(e.date)}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <span className={clsx("badge", KIND_BADGE[e.kind])}>{SCHEDULE_KIND_LABEL[e.kind]}</span>
              </div>
            ))}
            {parsed.length > 12 && <p className="t-small px-2 text-faint">y {parsed.length - 12} más</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EntryRow({ subject, entry, past, onEdit }: { subject: Subject; entry: ScheduleEntry; past: boolean; onEdit: () => void }) {
  const { openTaskDialog } = useAppState();
  const { open, menu } = useContextMenu();
  const schedule = subject.schedule ?? [];

  const items: MenuItem[] = [
    { label: "Editar", icon: Pencil, onSelect: onEdit },
    ...(TASK_TYPE[entry.kind]
      ? [
          {
            label: "Crear tarea",
            icon: ListPlus,
            onSelect: () =>
              openTaskDialog({
                title: entry.title,
                type: TASK_TYPE[entry.kind],
                subjectId: subject.id,
                degreeId: subject.degreeId,
                dueDate: new Date(`${entry.date}T${END_OF_DAY}`).toISOString(),
              }),
          } satisfies MenuItem,
        ]
      : []),
    { type: "separator" },
    { label: "Eliminar", icon: Trash2, danger: true, onSelect: () => void save(subject, schedule.filter((e) => e.id !== entry.id)) },
  ];

  return (
    <>
      <div className={clsx("row group", (entry.done || (past && entry.kind === "CLASE")) && "opacity-60")} onContextMenu={(e) => open(e, items)}>
        <input
          type="checkbox"
          className="h-4 w-4 flex-none cursor-pointer accent-primary"
          checked={!!entry.done}
          aria-label={`Marcar como hecho: ${entry.title}`}
          onChange={(e) => void save(subject, schedule.map((x) => (x.id === entry.id ? { ...x, done: e.target.checked } : x)))}
        />
        <span className="t-small num w-20 flex-none whitespace-nowrap text-muted">{scheduleDateLabel(entry.date)}</span>
        <span className={clsx("min-w-0 flex-1 truncate text-text", entry.done && "line-through")}>{entry.title}</span>
        {entry.kind !== "CLASE" && <span className={clsx("badge flex-none", KIND_BADGE[entry.kind])}>{SCHEDULE_KIND_LABEL[entry.kind]}</span>}
        <button type="button" className="icon-btn opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={onEdit} aria-label="Editar" title="Editar">
          <Pencil strokeWidth={1.75} />
        </button>
      </div>
      {menu}
    </>
  );
}

// Cronograma de la materia: qué se ve en cada clase y las fechas de parciales, entregas y finales.
export function CronogramaSection({ subject }: { subject: Subject }) {
  const now = useNow();
  const [dialog, setDialog] = useState<{ entry?: ScheduleEntry } | "pegar" | null>(null);
  const list = sortSchedule(subject.schedule ?? []);
  const todayKey = now ? format(now, "yyyy-MM-dd") : "";
  const pending = list.filter((e) => e.date >= todayKey && !e.done).length;

  return (
    <section className="flex flex-col gap-0.5">
      <div className="mb-1 flex items-center justify-between pr-1">
        <h2 className="section-label">{list.length ? `Cronograma · ${pending} por venir` : "Cronograma"}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn" onClick={() => setDialog("pegar")} aria-label="Pegar cronograma" title="Pegar cronograma">
            <ClipboardPaste strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setDialog({})} aria-label="Agregar fecha" title="Agregar fecha">
            <Plus strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <button type="button" className="row text-left text-faint hover:text-text" onClick={() => setDialog("pegar")}>
          Cargar el cronograma de la cátedra
        </button>
      ) : (
        list.map((e) => <EntryRow key={e.id} subject={subject} entry={e} past={!!todayKey && e.date < todayKey} onEdit={() => setDialog({ entry: e })} />)
      )}
      {dialog === "pegar" && <PasteDialog subject={subject} onClose={() => setDialog(null)} />}
      {dialog && dialog !== "pegar" && <EntryDialog subject={subject} entry={dialog.entry} onClose={() => setDialog(null)} />}
    </section>
  );
}
