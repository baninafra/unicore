"use client";

// Paneles laterales del calendario, como en Thunderbird:
//  - a la izquierda, el mes chico para saltar de fecha y la lista de calendarios (propios, suscritos y qué más mostrar);
//  - a la derecha, las tareas: filtrar, agregar rápido, marcar hechas y arrastrarlas al calendario.

import { useProfiles } from "@/lib/profiles";
import { useMemo, useState } from "react";
import clsx from "clsx";
import * as chrono from "chrono-node";
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { t, dateLocale } from "@/lib/i18n";
import { CalendarClock, ChevronLeft, ChevronRight, Download, FileUp, MoreHorizontal, Palette, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { db, newId, nowIso } from "@/lib/db";
import { CALENDAR_COLORS, CALENDAR_COLOR_LABEL, syncAllCalendars, useCalendars } from "@/lib/calendars/sync";
import { createLocalCalendar, deleteLocalCalendar, exportCalendarIcs, importIcsInto, planTask, useLocalCalendars } from "@/lib/calendars/events";
import { useAppState } from "@/lib/app-state";
import { useOpen } from "@/components/workspace/use-open";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { PromptModal } from "@/components/ui/prompt-modal";
import { saveBlob, safeFileName } from "@/lib/export/save";
import { toast, deleteWithUndo } from "@/lib/undo";
import { byDueDate, END_OF_DAY } from "@/components/tasks/task-meta";
import { type CalendarSource, type Subject, type Task } from "@/lib/types";
import { DOT, TASK_MIME } from "./calendar-parts";

// ---------- Mes chico ----------

export function MiniMonth({ cursor, from, to, marks, weekStart, onPick }: { cursor: Date; from: Date; to: Date; marks: Set<string>; weekStart: 0 | 1; onPick: (d: Date) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(cursor));
  const [last, setLast] = useState(cursor);
  if (!isSameDay(last, cursor)) {
    setLast(cursor);
    if (!isSameMonth(month, cursor)) setMonth(startOfMonth(cursor));
  }
  const days = eachDayOfInterval({ start: startOfWeek(month, { weekStartsOn: weekStart }), end: endOfWeek(endOfMonth(month), { weekStartsOn: weekStart }) });
  const names = weekStart === 1 ? [t("L"), t("M"), t("X"), t("J"), t("V"), t("S"), t("D")] : [t("D"), t("L"), t("M"), t("X"), t("J"), t("V"), t("S")];
  const label = format(month, "LLLL yyyy", { locale: dateLocale() });
  return (
    <div className="flex flex-col gap-1 px-3 pt-3">
      <div className="flex items-center">
        <span className="text-[length:calc(13px*var(--ui-scale,1))] font-semibold capitalize text-text">{label}</span>
        <button type="button" className="icon-btn ml-auto" aria-label={t("Mes anterior")} onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft />
        </button>
        <button type="button" className="icon-btn" aria-label={t("Mes siguiente")} onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {names.map((n, i) => (
          <span key={i} className="text-[length:calc(10px*var(--ui-scale,1))] font-medium text-faint">
            {n}
          </span>
        ))}
        {days.map((d) => {
          const inRange = d >= from && d < to;
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onPick(d)}
              className={clsx(
                "num relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[length:calc(12px*var(--ui-scale,1))]",
                isToday(d) ? "bg-primary-fill font-semibold text-on-primary" : inRange ? "bg-primary-tint text-text" : isSameMonth(d, month) ? "text-muted hover:bg-surface-raised" : "text-faint hover:bg-surface-raised",
              )}
            >
              {format(d, "d")}
              {marks.has(format(d, "yyyy-MM-dd")) && !isToday(d) && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary-soft" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Calendarios ----------

function pickIcs(onPick: (text: string) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".ics,text/calendar";
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) onPick(await f.text());
  };
  input.click();
}

function CalRow({ cal, menu }: { cal: CalendarSource; menu?: MenuItem[] }) {
  const { open, menu: node } = useContextMenu();
  return (
    <div className="group row min-h-7 pr-1" onContextMenu={(e) => menu && open(e, menu)}>
      <label className="flex min-w-0 flex-1 cursor-default items-center gap-2">
        <input type="checkbox" checked={cal.enabled} onChange={(e) => void db.calendars.update(cal.id, { enabled: e.target.checked })} className="sr-only" />
        <span className={clsx("flex h-3.5 w-3.5 flex-none items-center justify-center rounded-[4px] border-2", cal.enabled ? `${DOT[cal.color]} border-transparent` : "border-border-strong")} />
        <span className={clsx("truncate", !cal.enabled && "text-faint")} title={cal.error ?? cal.name}>
          {cal.name}
        </span>
        {cal.error && <span className="h-1.5 w-1.5 flex-none rounded-full bg-rose" title={cal.error} />}
      </label>
      {menu && (
        <button type="button" className="icon-btn opacity-0 group-hover:opacity-100" aria-label={t("Opciones de {name}", { name: cal.name })} onClick={(e) => open(e, menu)}>
          <MoreHorizontal />
        </button>
      )}
      {node}
    </div>
  );
}

function Toggle({ label, checked, onChange, color = "bg-primary" }: { label: string; checked: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <label className="row min-h-7 cursor-default">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span className={clsx("flex h-3.5 w-3.5 flex-none rounded-[4px] border-2", checked ? `${color} border-transparent` : "border-border-strong")} />
      <span className={clsx(!checked && "text-faint")}>{label}</span>
    </label>
  );
}

export function CalendarList({
  showTasks,
  setShowTasks,
  showDone,
  setShowDone,
  showCronogramas,
  setShowCronogramas,
}: {
  showTasks: boolean;
  setShowTasks: (v: boolean) => void;
  showDone: boolean;
  setShowDone: (v: boolean) => void;
  showCronogramas: boolean;
  setShowCronogramas: (v: boolean) => void;
}) {
  const locals = useLocalCalendars();
  const external = useCalendars();
  const open = useOpen();
  const [prompt, setPrompt] = useState<{ title: string; initial: string; done: (v: string) => void } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const localMenu = (cal: CalendarSource): MenuItem[] => [
    { label: t("Renombrar"), icon: Pencil, onSelect: () => setPrompt({ title: t("Renombrar calendario"), initial: cal.name, done: (v) => void db.calendars.update(cal.id, { name: v.trim() || cal.name }) }) },
    {
      label: t("Color"),
      icon: Palette,
      submenu: CALENDAR_COLORS.map((c) => ({ label: CALENDAR_COLOR_LABEL[c], onSelect: () => void db.calendars.update(cal.id, { color: c }) })),
    },
    { type: "separator" },
    {
      label: t("Importar eventos (.ics)"),
      icon: FileUp,
      onSelect: () =>
        pickIcs(async (text) => {
          const n = await importIcsInto(cal.id, text).catch(() => -1);
          toast(n < 0 ? t("Ese archivo no es un calendario válido.") : n === 1 ? t("Se importó {n} evento.", { n }) : t("Se importaron {n} eventos.", { n }), n < 0 ? { tone: "error" } : {});
        }),
    },
    {
      label: t("Exportar (.ics)"),
      icon: Download,
      onSelect: async () => {
        const { name, ics } = await exportCalendarIcs(cal.id);
        await saveBlob(`${safeFileName(name)}.ics`, new Blob([ics], { type: "text/calendar" }));
      },
    },
    { type: "separator" },
    {
      label: t("Borrar calendario"),
      icon: Trash2,
      danger: true,
      onSelect: async () => {
        const count = await db.events.where("calendarId").equals(cal.id).count();
        if (count && !window.confirm(t("¿Borrar «{name}» y sus {count} eventos?", { name: cal.name, count }))) return;
        await deleteLocalCalendar(cal.id);
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3 px-1 py-3">
      <section className="flex flex-col">
        <div className="flex items-center pr-1">
          <h3 className="section-label flex-1">{t("Mis calendarios")}</h3>
          <button type="button" className="icon-btn" aria-label={t("Nuevo calendario")} title={t("Nuevo calendario")} onClick={() => setPrompt({ title: t("Nuevo calendario"), initial: "", done: (v) => void createLocalCalendar(v) })}>
            <Plus />
          </button>
        </div>
        {locals.length === 0 && <p className="t-small px-2 text-faint">{t("Se crea «Personal» con tu primer evento.")}</p>}
        {locals.map((c) => (
          <CalRow key={c.id} cal={c} menu={localMenu(c)} />
        ))}
      </section>

      <section className="flex flex-col">
        <div className="flex items-center pr-1">
          <h3 className="section-label flex-1">{t("Suscripciones")}</h3>
          {external.length > 0 && (
            <button
              type="button"
              className="icon-btn"
              aria-label={t("Sincronizar")}
              title={t("Sincronizar ahora")}
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                await syncAllCalendars().catch(() => {});
                setSyncing(false);
              }}
            >
              <RefreshCw className={clsx(syncing && "animate-spin")} />
            </button>
          )}
          <button type="button" className="icon-btn" aria-label={t("Conectar un calendario")} title={t("Conectar Google Calendar, Outlook, el campus…")} onClick={(e) => open({ type: "ajustes", section: "calendarios" }, e)}>
            <Plus />
          </button>
        </div>
        {external.length === 0 && <p className="t-small px-2 text-faint">{t("Conectá Google Calendar, Outlook o el campus.")}</p>}
        {external.map((c) => (
          <CalRow key={c.id} cal={c} />
        ))}
      </section>

      <section className="flex flex-col">
        <h3 className="section-label">{t("Mostrar")}</h3>
        <Toggle label={t("Tareas")} checked={showTasks} onChange={setShowTasks} color="bg-amber" />
        <Toggle label={t("Tareas hechas")} checked={showDone} onChange={setShowDone} color="bg-mint" />
        <Toggle label={t("Cronogramas de materias")} checked={showCronogramas} onChange={setShowCronogramas} color="bg-cyan" />
      </section>

      <PromptModal
        open={!!prompt}
        title={prompt?.title ?? ""}
        initial={prompt?.initial}
        placeholder={t("Facultad, Trabajo, Gimnasio…")}
        onConfirm={(v) => {
          prompt?.done(v);
          setPrompt(null);
        }}
        onClose={() => setPrompt(null)}
      />
    </div>
  );
}

// ---------- Tareas ----------

type TaskFilter = "pendientes" | "sin-fecha" | "vencidas" | "hoy" | "semana" | "hechas";
const FILTER_LABEL: Record<TaskFilter, string> = {
  pendientes: t("Pendientes"),
  "sin-fecha": t("Sin fecha"),
  vencidas: t("Vencidas"),
  hoy: t("Hoy"),
  semana: t("Próximos 7 días"),
  hechas: t("Hechas"),
};

const LS_FILTER = "uc-cal-task-filter";

export function TasksPane({ tasks, subjects }: { tasks: Task[]; subjects: Subject[] }) {
  const { openTaskDialog } = useAppState();
  const { open, menu } = useContextMenu();
  const { taskLabel } = useProfiles();
  const [filter, setFilter] = useState<TaskFilter>(() => {
    try {
      return (localStorage.getItem(LS_FILTER) as TaskFilter) || "pendientes";
    } catch {
      return "pendientes";
    }
  });
  const [quick, setQuick] = useState("");
  const names = useMemo(() => new Map(subjects.map((s) => [s.id, s.name])), [subjects]);

  const now = Date.now();
  const todayEnd = new Date().setHours(23, 59, 59, 999);
  const list = tasks
    .filter((t) => t.status !== "INBOX_EMAIL")
    .filter((t) => {
      const due = t.dueDate ? new Date(t.dueDate).getTime() : null;
      switch (filter) {
        case "hechas":
          return t.status === "DONE";
        case "sin-fecha":
          return t.status !== "DONE" && !due;
        case "vencidas":
          return t.status !== "DONE" && !!due && due < now;
        case "hoy":
          return t.status !== "DONE" && !!due && due <= todayEnd;
        case "semana":
          return t.status !== "DONE" && !!due && due <= addDays(new Date(todayEnd), 7).getTime();
        default:
          return t.status !== "DONE";
      }
    })
    .sort(byDueDate);

  const pick = (f: TaskFilter) => {
    setFilter(f);
    try {
      localStorage.setItem(LS_FILTER, f);
    } catch {}
  };

  // "Leer capítulo 3 el jueves 18hs" → tarea con fecha.
  const addQuick = async () => {
    const text = quick.trim();
    if (!text) return;
    const parsed = chrono.es.parse(text, new Date(), { forwardDate: true })[0];
    let title = text;
    let due: Date | undefined;
    if (parsed) {
      title = (text.slice(0, parsed.index) + text.slice(parsed.index + parsed.text.length)).replace(/\s{2,}/g, " ").trim() || text;
      due = parsed.start.date();
      if (!parsed.start.isCertain("hour")) {
        const [hh, mm] = END_OF_DAY.split(":").map(Number);
        due.setHours(hh, mm, 0, 0);
      }
    }
    await db.tasks.add({ id: newId(), title, type: "TAREA", status: "TODO", priority: "MEDIUM", dueDate: due?.toISOString(), source: "MANUAL", createdAt: nowIso() });
    setQuick("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-col gap-2 p-3">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(FILTER_LABEL) as TaskFilter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => pick(f)} className="rounded-full border border-border px-2 py-0.5 text-[length:calc(11px*var(--ui-scale,1))] text-muted hover:text-text aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft">
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        <input
          className="input h-8"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void addQuick()}
          placeholder={t("Nueva tarea… (ej: «Leer cap. 3 el jueves 18hs»)")}
          aria-label={t("Nueva tarea rápida")}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {list.length === 0 && <p className="t-small px-2 py-3 text-faint">{t("No hay tareas acá.")}</p>}
        {list.map((task) => {
          const done = task.status === "DONE";
          const due = task.dueDate ? new Date(task.dueDate) : null;
          const late = !done && due && due.getTime() < now;
          return (
            <div
              key={task.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(TASK_MIME, task.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => openTaskDialog(task)}
              onContextMenu={(e) =>
                open(e, [
                  { label: t("Editar tarea"), icon: Pencil, onSelect: () => openTaskDialog(task) },
                  { label: t("Planificar un bloque en el calendario"), icon: CalendarClock, onSelect: () => void planTask(task).then(() => toast(t("Bloque agregado al calendario."))) },
                  { type: "separator" },
                  { label: t("Borrar tarea"), icon: Trash2, danger: true, onSelect: () => void deleteWithUndo(t("Se eliminó «{name}»", { name: task.title }), () => db.tasks.delete(task.id)) },
                ])
              }
              title={t("Arrastrala a un día o a una hora del calendario")}
              className="group flex cursor-grab items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-raised active:cursor-grabbing"
            >
              <input
                type="checkbox"
                checked={done}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => void db.tasks.update(task.id, { status: e.target.checked ? "DONE" : "TODO" })}
                className="mt-0.5 accent-[var(--primary)]"
                aria-label={done ? t("Marcar como pendiente") : t("Marcar como hecha")}
              />
              <div className="min-w-0 flex-1">
                <div className={clsx("truncate text-[length:calc(13px*var(--ui-scale,1))] text-text", done && "text-faint line-through")}>{task.title}</div>
                <div className="flex flex-wrap gap-x-2 text-[length:calc(11px*var(--ui-scale,1))] text-faint">
                  <span>{taskLabel(task)}</span>
                  {due && <span className={clsx(late && "text-rose")}>{format(due, due.getHours() === 23 && due.getMinutes() === 59 ? "EEE d/M" : "EEE d/M HH:mm", { locale: dateLocale() })}</span>}
                  {task.subjectId && names.get(task.subjectId) && <span className="truncate">{names.get(task.subjectId)}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {menu}
    </div>
  );
}
