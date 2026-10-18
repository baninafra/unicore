"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import { FileUp, ListPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { db, newId } from "@/lib/db";
import { useAppState } from "@/lib/app-state";
import { parseScheduleText, scheduleDateLabel, sortSchedule } from "@/lib/cronograma";
import { SCHEDULE_KIND_LABEL, type ScheduleEntry, type ScheduleKind, type Subject, type TaskType } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { useNow } from "@/components/dashboard/use-now";
import { END_OF_DAY } from "@/components/tasks/task-meta";
import { convertFile, fileKind } from "@/lib/import/import-file";

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
      title={entry ? t("Editar fecha") : t("Agregar al cronograma")}
      width={440}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button type="button" className="btn btn-primary" disabled={!date} onClick={() => void submit()}>
            {t("Guardar")}
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
          <span>{t("Fecha")}</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>{t("Tipo")}</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {SCHEDULE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>{t("Tema o actividad")}</span>
          <input className="input" autoFocus value={title} placeholder={t("Límites y continuidad")} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

const FILE_ACCEPT = ".pdf,.docx,.xlsx,.xlsm,.pptx,.csv,.txt,.md,image/*";

// Subir el cronograma de la cátedra (PDF, Word, Excel o foto) desde un archivo (PDF, Word, Excel, PowerPoint, CSV, texto o foto) o pegando el texto.
function LoadDialog({ subject, onClose }: { subject: Subject; onClose: () => void }) {
  const [text, setText] = useState("");
  const [reading, setReading] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>();
  const [error, setError] = useState<string>();
  const [replace, setReplace] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = text.trim() ? parseScheduleText(text) : [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const hadSchedule = (subject.schedule?.length ?? 0) > 0;

  async function readFile(file: File) {
    setError(undefined);
    setReading(t("Leyendo el archivo…"));
    try {
      let content: string;
      if (fileKind(file) === "image") {
        setReading(t("Reconociendo el texto de la foto…"));
        const { ocrImage } = await import("@/lib/pdf/import-pdf");
        content = await ocrImage(file);
      } else {
        content = (await convertFile(file, setReading)).text;
      }
      if (!content.trim()) throw new Error(t("No encontramos texto en el archivo. Probá con otro o pegalo a mano."));
      setFileName(file.name);
      setText(content.slice(0, 60000));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No pudimos leer el archivo. Probá con otro."));
    } finally {
      setReading(null);
    }
  }

  async function add() {
    await save(subject, [...(replace ? [] : (subject.schedule ?? [])), ...parsed]);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Cargar cronograma")}
      width={600}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button type="button" className="btn btn-primary" disabled={parsed.length === 0 || !!reading} onClick={() => void add()}>
            {parsed.length ? (parsed.length === 1 ? t("Agregar 1 fecha") : t("Agregar {n} fechas", { n: parsed.length })) : t("Agregar")}
          </button>
        </>
      }
    >
      <div
        className={clsx("flex flex-col gap-3 rounded-md", over && "outline outline-2 outline-primary")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void readFile(f);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" disabled={!!reading} onClick={() => fileRef.current?.click()}>
            <FileUp strokeWidth={1.75} />
            {t("Subir archivo")}
          </button>
          <span className="t-small text-muted">{reading ?? fileName ?? t("PDF, Word, Excel, PowerPoint, CSV, texto o una foto")}</span>
          <input
            ref={fileRef}
            type="file"
            accept={FILE_ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void readFile(f);
            }}
          />
        </div>
        {error && <p className="t-small text-rose">{error}</p>}
        <p className="t-small text-muted">
          {t("También podés arrastrar el archivo acá o pegar el texto con una fecha por línea. Detectamos la fecha y el tipo (clase, parcial, entrega, final).")}
        </p>
        <textarea
          className="input min-h-[120px] py-2 font-mono"
          autoFocus
          value={text}
          placeholder={t("14/10 Límites y continuidad\n21/10 Derivadas\n28 de octubre - Parcial 1\n11/11 Entrega TP 1")}
          onChange={(e) => setText(e.target.value)}
        />
        {hadSchedule && (
          <label className="t-small flex items-center gap-2 text-muted">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            {subject.schedule!.length === 1 ? t("Reemplazar el cronograma actual (1 fecha)") : t("Reemplazar el cronograma actual ({n} fechas)", { n: subject.schedule!.length })}
          </label>
        )}
        {text.trim() && (
          <div className="flex flex-col">
            <p className="t-small text-faint">
              {lines === 1 ? t("{n} de 1 línea con fecha", { n: parsed.length }) : t("{n} de {lines} líneas con fecha", { n: parsed.length, lines })}
              {parsed.length === 0 && `. ${t("Revisá que las fechas tengan día y mes, por ejemplo 14/10 o 14 de octubre.")}`}
            </p>
            {parsed.map((e) => (
              <div key={e.id} className="row">
                <span className="t-small num w-20 flex-none whitespace-nowrap text-muted">{scheduleDateLabel(e.date)}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <span className={clsx("badge", KIND_BADGE[e.kind])}>{SCHEDULE_KIND_LABEL[e.kind]}</span>
              </div>
            ))}
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
    { label: t("Editar"), icon: Pencil, onSelect: onEdit },
    ...(TASK_TYPE[entry.kind]
      ? [
          {
            label: t("Crear tarea"),
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
    { label: t("Eliminar"), icon: Trash2, danger: true, onSelect: () => void save(subject, schedule.filter((e) => e.id !== entry.id)) },
  ];

  return (
    <>
      <div className={clsx("row group", (entry.done || (past && entry.kind === "CLASE")) && "opacity-60")} onContextMenu={(e) => open(e, items)}>
        <input
          type="checkbox"
          className="h-4 w-4 flex-none cursor-pointer accent-primary"
          checked={!!entry.done}
          aria-label={t("Marcar como hecho: {title}", { title: entry.title })}
          onChange={(e) => void save(subject, schedule.map((x) => (x.id === entry.id ? { ...x, done: e.target.checked } : x)))}
        />
        <span className="t-small num w-20 flex-none whitespace-nowrap text-muted">{scheduleDateLabel(entry.date)}</span>
        <span className={clsx("min-w-0 flex-1 truncate text-text", entry.done && "line-through")}>{entry.title}</span>
        {entry.kind !== "CLASE" && <span className={clsx("badge flex-none", KIND_BADGE[entry.kind])}>{SCHEDULE_KIND_LABEL[entry.kind]}</span>}
        <button type="button" className="icon-btn opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={onEdit} aria-label={t("Editar")} title={t("Editar")}>
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
        <h2 className="section-label">{list.length ? t("Cronograma · {n} por venir", { n: pending }) : t("Cronograma")}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn" onClick={() => setDialog("pegar")} aria-label={t("Subir o pegar cronograma")} title={t("Subir o pegar cronograma")}>
            <FileUp strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setDialog({})} aria-label={t("Agregar fecha")} title={t("Agregar fecha")}>
            <Plus strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <button type="button" className="row text-left text-faint hover:text-text" onClick={() => setDialog("pegar")}>
          {t("Cargar el cronograma de la cátedra")}
        </button>
      ) : (
        list.map((e) => <EntryRow key={e.id} subject={subject} entry={e} past={!!todayKey && e.date < todayKey} onEdit={() => setDialog({ entry: e })} />)
      )}
      {dialog === "pegar" && <LoadDialog subject={subject} onClose={() => setDialog(null)} />}
      {dialog && dialog !== "pegar" && <EntryDialog subject={subject} entry={dialog.entry} onClose={() => setDialog(null)} />}
    </section>
  );
}
