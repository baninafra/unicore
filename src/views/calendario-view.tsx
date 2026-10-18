"use client";

// Calendario completo, inspirado en el de Thunderbird: vistas de día, semana, varias semanas, mes y agenda;
// calendarios propios (con eventos que se repiten y recordatorios) y suscritos; búsqueda; y las tareas al
// costado, para marcarlas, ponerles fecha o reservar tiempo arrastrándolas al calendario.
//
// Atajos (fuera de un campo de texto): T hoy · D día · S semana · V varias semanas · M mes · A agenda ·
// N evento nuevo · ← → anterior / siguiente.

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import {
  CalendarClock,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  ListPlus,
  ListTodo,
  PanelLeft,
  PanelRight,
  Pencil,
  Search,
  Trash2,
  Undo2,
  Check,
  X,
  CalendarX,
  FolderInput,
} from "lucide-react";
import { useNow } from "@/components/dashboard/use-now";
import { useSettings } from "@/components/settings/apply-settings";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useAllSubjects, useTasks } from "@/lib/hooks";
import { toast, deleteWithUndo } from "@/lib/undo";
import { endOfDayIso } from "@/components/tasks/task-meta";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { askScope, openEventDialog } from "@/components/calendar/event-dialog";
import { TimeGrid, type GridHandlers } from "@/components/calendar/time-grid";
import { MonthGrid } from "@/components/calendar/month-grid";
import { AgendaList } from "@/components/calendar/agenda-list";
import { CalendarList, MiniMonth, TasksPane } from "@/components/calendar/calendar-sidebar";
import { deleteOccurrence, duplicateEvent, eventToTask, planTask, saveEvent, defaultCalendarId, updateOccurrence, useCalendarItems, useLocalCalendars, type CalItem } from "@/lib/calendars/events";

type CalView = "dia" | "semana" | "multisemana" | "mes" | "agenda";

const VIEW_LABEL: Record<CalView, string> = { dia: "Día", semana: "Semana", multisemana: "Varias semanas", mes: "Mes", agenda: "Agenda" };
const VIEW_KEY: Record<string, CalView> = { d: "dia", s: "semana", v: "multisemana", m: "mes", a: "agenda" };

// Preferencias de la vista que se recuerdan en este equipo.
function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {}
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {}
    },
    [key],
  );
  return [value, set];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function CalendarioView() {
  const now = useNow();
  const [settings, setSettings] = useSettings();
  const { openTaskDialog } = useAppState();
  const tasks = useTasks();
  const subjects = useAllSubjects();
  const locals = useLocalCalendars();
  const { open: openMenu, menu } = useContextMenu();

  const [view, setView] = usePref<CalView>("uc-cal-view", "semana");
  const [weeks, setWeeks] = usePref<number>("uc-cal-weeks", 4);
  const [hideWeekend, setHideWeekend] = usePref<boolean>("uc-cal-hide-weekend", false);
  const [showLeft, setShowLeft] = usePref<boolean>("uc-cal-left", true);
  const [showRight, setShowRight] = usePref<boolean>("uc-cal-right", true);
  const [showTasks, setShowTasks] = usePref<boolean>("uc-cal-tasks", true);
  const [cursor, setCursor] = useState<Date | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (now && !cursor) setCursor(startOfDay(now));
  }, [now, cursor]);

  const weekStartsOn = settings.weekStart === "dom" ? 0 : 1;
  const base = cursor ?? startOfDay(new Date());

  // Rango visible de la vista actual.
  const { from, to, days, title } = useMemo(() => {
    const ws = { weekStartsOn: weekStartsOn as 0 | 1 };
    if (view === "dia") return { from: base, to: addDays(base, 1), days: [base], title: cap(format(base, "EEEE d 'de' MMMM yyyy", { locale: es })) };
    if (view === "semana") {
      const s = startOfWeek(base, ws);
      let list = eachDayOfInterval({ start: s, end: addDays(s, 6) });
      if (hideWeekend) list = list.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
      const e = addDays(s, 6);
      const t = s.getMonth() === e.getMonth() ? `${format(s, "d")} – ${format(e, "d 'de' MMMM yyyy", { locale: es })}` : `${format(s, "d MMM", { locale: es })} – ${format(e, "d MMM yyyy", { locale: es })}`;
      return { from: s, to: addDays(s, 7), days: list, title: t };
    }
    if (view === "multisemana") {
      const s = startOfWeek(base, ws);
      const e = addDays(s, weeks * 7);
      return { from: s, to: e, days: eachDayOfInterval({ start: s, end: addDays(e, -1) }), title: `${format(s, "d MMM", { locale: es })} – ${format(addDays(e, -1), "d MMM yyyy", { locale: es })}` };
    }
    if (view === "mes") {
      const m = startOfMonth(base);
      const s = startOfWeek(m, ws);
      const e = addDays(endOfWeek(endOfMonth(m), ws), 1);
      return { from: s, to: e, days: eachDayOfInterval({ start: s, end: addDays(e, -1) }), title: cap(format(m, "LLLL yyyy", { locale: es })) };
    }
    return { from: base, to: addDays(base, 45), days: [], title: `Desde el ${format(base, "d 'de' MMMM", { locale: es })}` };
  }, [view, base.getTime(), weekStartsOn, weeks, hideWeekend]); // eslint-disable-line react-hooks/exhaustive-deps

  const searching = query.trim().length > 1;
  const searchFrom = useMemo(() => addDays(startOfDay(new Date()), -365), []);
  const searchTo = useMemo(() => addDays(startOfDay(new Date()), 730), []);
  const filters = { tasks: showTasks, doneTasks: settings.showDoneTasks, cronogramas: settings.showCronogramas };
  const items = useCalendarItems(searching ? searchFrom : from, searching ? searchTo : to, filters, tasks, subjects);

  const found = useMemo(() => {
    if (!searching) return [];
    const q = fold(query.trim());
    return items.filter((it) => fold(`${it.title} ${it.location ?? ""} ${it.description ?? ""} ${it.calendarName}`).includes(q));
  }, [items, query, searching]);

  const marks = useMemo(() => new Set(items.map((it) => format(it.start, "yyyy-MM-dd"))), [items]);

  const step = (dir: 1 | -1) => {
    if (view === "dia") setCursor(addDays(base, dir));
    else if (view === "semana") setCursor(addWeeks(base, dir));
    else if (view === "multisemana") setCursor(addWeeks(base, dir));
    else if (view === "mes") setCursor(addMonths(base, dir));
    else setCursor(addDays(base, dir * 30));
  };

  const newEvent = useCallback(
    (start?: Date, end?: Date, allDay = false) => {
      const s = start ?? (() => {
        const d = new Date(base);
        const n = new Date();
        d.setHours(d.toDateString() === n.toDateString() ? n.getHours() + 1 : 9, 0, 0, 0);
        return d;
      })();
      openEventDialog({ defaults: { start: s.toISOString(), end: (end ?? new Date(s.getTime() + 3_600_000)).toISOString(), allDay } });
    },
    [base],
  );

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || t?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (k === "t") setCursor(startOfDay(new Date()));
      else if (VIEW_KEY[k]) setView(VIEW_KEY[k]);
      else if (k === "n") newEvent();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleTask = useCallback((it: CalItem) => {
    if (it.task) void db.tasks.update(it.task.id, { status: it.task.status === "DONE" ? "TODO" : "DONE" });
  }, []);

  const moveItem = useCallback(async (it: CalItem, start: Date, end: Date, allDay: boolean) => {
    if (it.kind === "task" && it.task) {
      // Una tarea que vence "ese día" sigue venciendo al final del día nuevo.
      const due = it.allDay || allDay ? endOfDayIso(start) : start.toISOString();
      await db.tasks.update(it.task.id, { dueDate: due });
      return;
    }
    if (it.kind !== "event" || !it.event || !it.occurrence) return;
    let scope: "one" | "following" | "all" = "all";
    if (it.event.rrule) {
      const picked = await askScope("cambiar");
      if (!picked) return;
      scope = picked;
    }
    await updateOccurrence(it.event, it.occurrence, { start: start.toISOString(), end: end.toISOString() }, scope);
  }, []);

  const removeEvent = useCallback(async (it: CalItem) => {
    if (!it.event || !it.occurrence) return;
    let scope: "one" | "following" | "all" = "all";
    if (it.event.rrule) {
      const picked = await askScope("borrar");
      if (!picked) return;
      scope = picked;
    }
    await deleteOccurrence(it.event, it.occurrence, scope);
    toast("Evento borrado.");
  }, []);

  const contextFor = useCallback(
    (it: CalItem): MenuItem[] => {
      if (it.kind === "task" && it.task) {
        const t = it.task;
        const done = t.status === "DONE";
        return [
          { label: "Editar tarea", icon: Pencil, onSelect: () => openTaskDialog(t) },
          done
            ? { label: "Reabrir", icon: Undo2, onSelect: () => void db.tasks.update(t.id, { status: "TODO" }) }
            : { label: "Marcar como hecha", icon: Check, onSelect: () => void db.tasks.update(t.id, { status: "DONE" }) },
          { label: "Planificar un bloque en el calendario", icon: CalendarClock, onSelect: () => void planTask(t).then(() => toast("Bloque agregado al calendario.")) },
          { label: "Quitar la fecha", icon: CalendarX, onSelect: () => void db.tasks.update(t.id, { dueDate: undefined }) },
          { type: "separator" },
          { label: "Borrar tarea", icon: Trash2, danger: true, onSelect: () => void deleteWithUndo(`Se eliminó «${t.title}»`, () => db.tasks.delete(t.id)) },
        ];
      }
      if (it.kind === "event" && it.event) {
        const ev = it.event;
        return [
          { label: "Editar evento", icon: Pencil, onSelect: () => openEventDialog({ item: it }) },
          { label: "Duplicar", icon: Copy, onSelect: () => void duplicateEvent(ev, it.occurrence) },
          ev.taskId
            ? {
                label: "Abrir la tarea vinculada",
                icon: ListTodo,
                onSelect: async () => {
                  const t = await db.tasks.get(ev.taskId!);
                  if (t) openTaskDialog(t);
                },
              }
            : { label: "Convertir en tarea", icon: ListTodo, onSelect: () => void eventToTask(ev, it.occurrence).then(() => toast("Tarea creada y vinculada.")) },
          ...(locals.length > 1
            ? [
                {
                  label: "Mover a otro calendario",
                  icon: FolderInput,
                  submenu: locals.filter((c) => c.id !== ev.calendarId).map((c) => ({ label: c.name, onSelect: () => void db.events.update(ev.id, { calendarId: c.id }) })),
                } as MenuItem,
              ]
            : []),
          { type: "separator" },
          { label: ev.rrule ? "Borrar…" : "Borrar evento", icon: Trash2, danger: true, onSelect: () => void removeEvent(it) },
        ];
      }
      return [
        { label: "Ver detalles", icon: ExternalLink, onSelect: () => openEventDialog({ item: it }) },
        {
          label: "Copiar a mi calendario",
          icon: CalendarPlus,
          onSelect: async () => {
            await saveEvent({ calendarId: await defaultCalendarId(), title: it.title, start: it.start.toISOString(), end: it.end.toISOString(), allDay: it.allDay, location: it.location, description: it.description });
            toast("Copiado a tu calendario.");
          },
        },
      ];
    },
    [locals, openTaskDialog, removeEvent],
  );

  const h: GridHandlers = {
    onOpen: (it) => (it.kind === "task" && it.task ? openTaskDialog(it.task) : openEventDialog({ item: it })),
    onContext: (e, it) => openMenu(e, contextFor(it)),
    onToggleTask: toggleTask,
    onCreate: (start, end, allDay) => newEvent(start, end, allDay),
    onMove: (it, start, end, allDay) => void moveItem(it, start, end, allDay),
    // A un día: la tarea vence ese día. A una hora: se reserva un bloque para hacerla (la fecha de entrega no cambia).
    onDropTask: async (taskId, start, allDay) => {
      const t = await db.tasks.get(taskId);
      if (!t) return;
      if (allDay) {
        const prev = t.dueDate ? new Date(t.dueDate) : null;
        const due = new Date(start);
        if (prev && !(prev.getHours() === 23 && prev.getMinutes() === 59)) due.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
        else due.setHours(23, 59, 0, 0);
        await db.tasks.update(taskId, { dueDate: due.toISOString() });
        toast(`«${t.title}» vence el ${format(due, "EEEE d/M", { locale: es })}.`);
      } else {
        await planTask(t, start);
        toast(`Reservaste tiempo para «${t.title}».`);
      }
    },
    onPickDay: (d) => {
      setCursor(startOfDay(d));
      setView("dia");
    },
  };

  if (!cursor) return <div />;

  const newMenu: MenuItem[] = [
    { label: "Evento", icon: CalendarPlus, hint: "N", onSelect: () => newEvent() },
    { label: "Tarea", icon: ListPlus, onSelect: () => openTaskDialog({ dueDate: endOfDayIso(base) }) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra de herramientas */}
      <div className="flex h-10 flex-none items-center gap-1.5 border-b border-border px-2">
        <button type="button" className="icon-btn" aria-pressed={showLeft} aria-label="Mostrar u ocultar los calendarios" title="Calendarios" onClick={() => setShowLeft(!showLeft)}>
          <PanelLeft />
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setCursor(startOfDay(new Date()))} title="Ir a hoy (T)">
          Hoy
        </button>
        <button type="button" className="icon-btn" aria-label="Anterior" title="Anterior (←)" onClick={() => step(-1)}>
          <ChevronLeft />
        </button>
        <button type="button" className="icon-btn" aria-label="Siguiente" title="Siguiente (→)" onClick={() => step(1)}>
          <ChevronRight />
        </button>
        <span className="ml-1 truncate text-[length:calc(15px*var(--ui-scale,1))] font-semibold text-text">{searching ? `Resultados para «${query.trim()}»` : title}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input className="input h-7 w-44 pl-7 pr-6 text-[length:calc(12px*var(--ui-scale,1))]" placeholder="Buscar eventos y tareas" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setQuery("")} aria-label="Buscar en el calendario" />
            {query && (
              <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 text-faint hover:text-text" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}>
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Vista">
            {(Object.keys(VIEW_LABEL) as CalView[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v && !searching}
                title={`${VIEW_LABEL[v]} (${Object.keys(VIEW_KEY).find((k) => VIEW_KEY[k] === v)?.toUpperCase()})`}
                onClick={() => (setQuery(""), setView(v))}
                className="h-6 rounded-sm px-2 text-[length:calc(12px*var(--ui-scale,1))] text-muted hover:text-text aria-selected:bg-surface-raised aria-selected:text-text"
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          {view === "multisemana" && !searching && (
            <select className="input h-7 w-auto px-1.5 text-[length:calc(12px*var(--ui-scale,1))]" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Cantidad de semanas">
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} semanas
                </option>
              ))}
            </select>
          )}
          {view === "semana" && !searching && (
            <button type="button" className="btn btn-sm" aria-pressed={hideWeekend} title="Mostrar sólo de lunes a viernes" onClick={() => setHideWeekend(!hideWeekend)}>
              {hideWeekend ? "Lun a vie" : "7 días"}
            </button>
          )}
          <div className="flex">
            <button type="button" className="btn btn-primary btn-sm rounded-r-none" onClick={() => newEvent()} title="Nuevo evento (N)">
              <CalendarPlus />
              Nuevo
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm btn-icon rounded-l-none border-l border-l-[color-mix(in_srgb,var(--on-primary)_25%,transparent)]"
              aria-label="Más opciones para crear"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openMenu({ clientX: r.right - 180, clientY: r.bottom + 4 }, newMenu);
              }}
            >
              <ChevronDown />
            </button>
          </div>
          <button type="button" className="icon-btn" aria-pressed={showRight} aria-label="Mostrar u ocultar las tareas" title="Tareas" onClick={() => setShowRight(!showRight)}>
            <PanelRight />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {showLeft && (
          <aside className="flex w-[232px] flex-none flex-col overflow-y-auto border-r border-border">
            <MiniMonth cursor={base} from={from} to={to} marks={marks} weekStart={weekStartsOn as 0 | 1} onPick={(d) => setCursor(startOfDay(d))} />
            <CalendarList
              showTasks={showTasks}
              setShowTasks={setShowTasks}
              showDone={settings.showDoneTasks}
              setShowDone={(v) => setSettings({ showDoneTasks: v })}
              showCronogramas={settings.showCronogramas}
              setShowCronogramas={(v) => setSettings({ showCronogramas: v })}
            />
          </aside>
        )}

        <main className={clsx("min-h-0 min-w-0 flex-1", (view === "mes" || view === "multisemana") && !searching && "p-2", (view === "agenda" || searching) && "overflow-y-auto")}>
          {searching ? (
            <AgendaList items={found} h={h} empty="No hay eventos ni tareas que coincidan." />
          ) : view === "dia" || view === "semana" ? (
            <TimeGrid days={days} items={items} h={h} />
          ) : view === "agenda" ? (
            <AgendaList items={items.filter((it) => it.end > base)} h={h} empty="Nada en los próximos 45 días." />
          ) : (
            <MonthGrid days={days} month={view === "mes" ? startOfMonth(base) : undefined} items={items} weekStart={settings.weekStart} h={h} compact={view === "multisemana" && weeks > 4} />
          )}
        </main>

        {showRight && (
          <aside className="flex w-[272px] flex-none flex-col border-l border-border">
            <div className="flex h-9 flex-none items-center gap-2 border-b border-border px-3">
              <span className="t-label">Tareas</span>
              <span className="t-small ml-auto text-faint" title="Arrastrá una tarea a un día para ponerle fecha, o a una hora para reservar tiempo para hacerla">
                Arrastralas al calendario
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <TasksPane tasks={tasks} subjects={subjects} />
            </div>
          </aside>
        )}
      </div>
      {menu}
    </div>
  );
}
