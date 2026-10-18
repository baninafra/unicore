"use client";

// Vista de día / semana con horas (como Thunderbird): arriba lo de todo el día, abajo la grilla de 24 horas.
// Arrastrar en un hueco crea un evento; arrastrar un evento o una tarea lo mueve (también a otro día);
// el borde de abajo estira la duración. Las tareas de la lista se pueden soltar en una hora.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { addDays, differenceInCalendarDays, format, isSameDay, isToday, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import type { CalItem } from "@/lib/calendars/events";
import { BORDER_L, editable, ItemChip, ItemIcons, itemTooltip, TASK_MIME, TINT } from "./calendar-parts";

const HOUR = 48; // px por hora
const SNAP = 15; // minutos
const DAY_MS = 86_400_000;

export interface GridHandlers {
  onOpen: (it: CalItem) => void;
  onContext: (e: React.MouseEvent, it: CalItem) => void;
  onToggleTask: (it: CalItem) => void;
  onCreate: (start: Date, end: Date, allDay: boolean) => void;
  onMove: (it: CalItem, start: Date, end: Date, allDay: boolean) => void;
  onDropTask: (taskId: string, start: Date, allDay: boolean) => void;
  onPickDay: (day: Date) => void;
}

type Drag =
  | { kind: "create"; day: number; from: number; to: number } // minutos desde las 00
  | { kind: "move"; it: CalItem; dayDelta: number; minDelta: number; moved: boolean; grabMin: number; grabDay: number }
  | { kind: "resize"; it: CalItem; minDelta: number };

// Columnas para eventos que se superponen (cada grupo se reparte el ancho).
function layout(items: CalItem[], day: Date): { it: CalItem; top: number; height: number; col: number; cols: number }[] {
  const d0 = startOfDay(day).getTime();
  const d1 = d0 + DAY_MS;
  const boxes = items
    .map((it) => {
      const s = Math.max(it.start.getTime(), d0);
      const e = Math.min(Math.max(it.end.getTime(), it.start.getTime() + 15 * 60_000), d1);
      return { it, s, e, col: 0, cols: 1 };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  let group: typeof boxes = [];
  let groupEnd = 0;
  const flush = () => {
    const ends: number[] = [];
    for (const b of group) {
      let c = ends.findIndex((end) => end <= b.s);
      if (c < 0) c = ends.length;
      ends[c] = b.e;
      b.col = c;
    }
    for (const b of group) b.cols = ends.length;
    group = [];
  };
  for (const b of boxes) {
    if (group.length && b.s >= groupEnd) flush();
    group.push(b);
    groupEnd = Math.max(groupEnd, b.e);
  }
  flush();
  return boxes.map((b) => ({ it: b.it, top: ((b.s - d0) / 3_600_000) * HOUR, height: Math.max(18, ((b.e - b.s) / 3_600_000) * HOUR), col: b.col, cols: b.cols }));
}

const isAllDayRow = (it: CalItem) => it.allDay || it.end.getTime() - it.start.getTime() >= DAY_MS;

// Barras de "todo el día" que ocupan varios días, acomodadas en renglones.
function lanes(items: CalItem[], days: Date[]) {
  const first = startOfDay(days[0]);
  const rows: { it: CalItem; from: number; to: number; lane: number }[] = [];
  const laneEnds: number[] = [];
  for (const it of items) {
    const from = Math.max(0, differenceInCalendarDays(it.start, first));
    const to = Math.min(days.length - 1, differenceInCalendarDays(new Date(it.end.getTime() - 1), first));
    if (to < 0 || from > days.length - 1) continue;
    let lane = laneEnds.findIndex((end) => end < from);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = to;
    rows.push({ it, from, to, lane });
  }
  return { rows, count: laneEnds.length };
}

export function TimeGrid({ days, items, h }: { days: Date[]; items: CalItem[]; h: GridHandlers }) {
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [dropAt, setDropAt] = useState<{ day: number; min: number } | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Arranca mostrando desde las 7 (o una hora antes de ahora si es más tarde).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const hasToday = days.some((d) => isToday(d));
    const hour = hasToday ? Math.min(16, Math.max(7, new Date().getHours() - 2)) : 7;
    el.scrollTop = hour * HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.getTime(), days.length]);

  const allDay = items.filter(isAllDayRow);
  const timed = items.filter((it) => !isAllDayRow(it));
  const { rows, count } = lanes(allDay, days);

  // Posición del puntero → día y minuto (redondeado a 15).
  const pointAt = (clientX: number, clientY: number) => {
    const el = cols.current!;
    const r = el.getBoundingClientRect();
    const day = Math.min(days.length - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * days.length)));
    const min = Math.min(24 * 60, Math.max(0, Math.round((((clientY - r.top) / HOUR) * 60) / SNAP) * SNAP));
    return { day, min };
  };

  const atMin = (day: number, min: number) => new Date(startOfDay(days[day]).getTime() + min * 60_000);

  const startCreate = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = pointAt(e.clientX, e.clientY);
    const from = Math.floor(p.min / 30) * 30;
    setDrag({ kind: "create", day: p.day, from, to: from + 30 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const startMove = (e: React.PointerEvent, it: CalItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!editable(it)) return;
    const p = pointAt(e.clientX, e.clientY);
    setDrag({ kind: "move", it, dayDelta: 0, minDelta: 0, moved: false, grabMin: p.min, grabDay: p.day });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const startResize = (e: React.PointerEvent, it: CalItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDrag({ kind: "resize", it, minDelta: 0 });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = pointAt(e.clientX, e.clientY);
    if (drag.kind === "create") setDrag({ ...drag, to: Math.max(p.min, drag.from + SNAP) });
    else if (drag.kind === "move") {
      const minDelta = p.min - drag.grabMin;
      const dayDelta = p.day - drag.grabDay;
      setDrag({ ...drag, minDelta, dayDelta, moved: drag.moved || minDelta !== 0 || dayDelta !== 0 });
    } else {
      const rect = cols.current!.getBoundingClientRect();
      const min = Math.round((((e.clientY - rect.top) / HOUR) * 60) / SNAP) * SNAP;
      const startMin = (drag.it.start.getTime() - startOfDay(drag.it.start).getTime()) / 60_000;
      const endMin = startMin + (drag.it.end.getTime() - drag.it.start.getTime()) / 60_000;
      setDrag({ ...drag, minDelta: Math.max(min, startMin + SNAP) - endMin });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === "create") h.onCreate(atMin(drag.day, drag.from), atMin(drag.day, drag.to), false);
    else if (drag.kind === "move") {
      if (!drag.moved) h.onOpen(drag.it);
      else {
        const shift = drag.dayDelta * DAY_MS + drag.minDelta * 60_000;
        h.onMove(drag.it, new Date(drag.it.start.getTime() + shift), new Date(drag.it.end.getTime() + shift), false);
      }
    } else if (drag.minDelta) h.onMove(drag.it, drag.it.start, new Date(drag.it.end.getTime() + drag.minDelta * 60_000), false);
    setDrag(null);
  };

  // Vista previa mientras se arrastra.
  const preview = (it: CalItem): CalItem => {
    if (!drag || drag.kind === "create" || drag.it.key !== it.key) return it;
    if (drag.kind === "move") {
      const shift = drag.dayDelta * DAY_MS + drag.minDelta * 60_000;
      return { ...it, start: new Date(it.start.getTime() + shift), end: new Date(it.end.getTime() + shift) };
    }
    return { ...it, end: new Date(it.end.getTime() + drag.minDelta * 60_000) };
  };
  const shown = timed.map(preview);

  const taskDrop = (e: React.DragEvent, allDayRow: boolean, day?: number) => {
    const id = e.dataTransfer.getData(TASK_MIME);
    setDropAt(null);
    if (!id) return;
    e.preventDefault();
    if (allDayRow && day !== undefined) h.onDropTask(id, startOfDay(days[day]), true);
    else {
      const p = pointAt(e.clientX, e.clientY);
      h.onDropTask(id, atMin(p.day, p.min), false);
    }
  };

  const gridCols = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Encabezado con los días */}
      <div className="flex flex-none border-b border-border pr-[10px]">
        <div className="w-14 flex-none" />
        <div className="grid flex-1" style={gridCols}>
          {days.map((d) => (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => h.onPickDay(d)}
              title="Ver este día"
              className="flex items-baseline justify-center gap-1.5 border-l border-border py-1.5 hover:bg-surface-raised"
            >
              <span className="t-label">{format(d, "EEE", { locale: es })}</span>
              <span className={clsx("num flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[length:calc(13px*var(--ui-scale,1))]", isToday(d) ? "bg-primary-fill font-semibold text-on-primary" : "text-text")}>{format(d, "d")}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Todo el día */}
      <div className="flex flex-none border-b border-border pr-[10px]">
        <div className="t-label flex w-14 flex-none items-start justify-end px-1.5 pt-1.5 text-[length:calc(10px*var(--ui-scale,1))]">todo el día</div>
        <div className="relative grid flex-1" style={{ ...gridCols, minHeight: Math.max(28, count * 22 + 6) }}>
          {days.map((d, i) => (
            <div
              key={d.toISOString()}
              className={clsx("border-l border-border", dropAt?.day === i && dropAt.min < 0 && "bg-primary-tint")}
              onDoubleClick={() => h.onCreate(startOfDay(d), addDays(startOfDay(d), 1), true)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(TASK_MIME)) return;
                e.preventDefault();
                setDropAt({ day: i, min: -1 });
              }}
              onDragLeave={() => setDropAt(null)}
              onDrop={(e) => taskDrop(e, true, i)}
            />
          ))}
          {rows.map(({ it, from, to, lane }) => (
            <div key={it.key} className="absolute px-0.5" style={{ left: `${(from / days.length) * 100}%`, width: `${((to - from + 1) / days.length) * 100}%`, top: 3 + lane * 22, height: 20 }}>
              <ItemChip it={it} onOpen={h.onOpen} onContext={h.onContext} onToggleTask={h.onToggleTask} showTime={false} className="h-5" />
            </div>
          ))}
        </div>
      </div>

      {/* Horas */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-scroll">
        <div className="flex" style={{ height: 24 * HOUR }}>
          <div className="relative w-14 flex-none">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="num absolute right-2 -translate-y-1/2 text-[length:calc(11px*var(--ui-scale,1))] text-faint" style={{ top: (i + 1) * HOUR }}>
                {String(i + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div
            ref={cols}
            className="relative grid flex-1 select-none"
            style={gridCols}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TASK_MIME)) return;
              e.preventDefault();
              setDropAt(pointAt(e.clientX, e.clientY));
            }}
            onDragLeave={() => setDropAt(null)}
            onDrop={(e) => taskDrop(e, false)}
          >
            {/* Líneas de cada hora y media hora */}
            <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR / 2}px, color-mix(in srgb, var(--border) 45%, transparent) ${HOUR / 2}px ${HOUR / 2 + 1}px, transparent ${HOUR / 2 + 1}px ${HOUR}px)` }} />
            {days.map((d, i) => {
              const dayItems = shown.filter((it) => it.start < addDays(startOfDay(d), 1) && it.end > startOfDay(d));
              return (
                <div key={d.toISOString()} className={clsx("relative border-l border-border", isToday(d) && "bg-primary-tint/30")} onPointerDown={startCreate}>
                  {layout(dayItems, d).map(({ it, top, height, col, cols: n }) => {
                    const dragging = drag && drag.kind !== "create" && drag.it.key === it.key;
                    return (
                      <div
                        key={it.key}
                        title={itemTooltip(it)}
                        onPointerDown={(e) => startMove(e, it)}
                        onContextMenu={(e) => h.onContext(e, it)}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!editable(it)) h.onOpen(it);
                        }}
                        className={clsx(
                          "group absolute overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5 text-[length:calc(12px*var(--ui-scale,1))] leading-4 text-text shadow-sm",
                          BORDER_L[it.color],
                          TINT[it.color],
                          editable(it) ? "cursor-grab" : "cursor-default",
                          dragging && "z-10 cursor-grabbing opacity-90 ring-1 ring-primary",
                          (it.done || it.cancelled) && "text-faint line-through opacity-70",
                          it.tentative && "border-dashed",
                        )}
                        style={{ top, height: height - 1, left: `calc(${(col / n) * 100}% + 1px)`, width: `calc(${100 / n}% - 3px)` }}
                      >
                        <div className="flex items-center gap-1">
                          <ItemIcons it={it} onToggleTask={h.onToggleTask} />
                          <span className="truncate font-medium">{it.title}</span>
                        </div>
                        {height > 30 && (
                          <div className="num truncate text-[length:calc(11px*var(--ui-scale,1))] text-muted">
                            {format(it.start, "HH:mm")}
                            {it.kind !== "task" && ` – ${format(it.end, "HH:mm")}`}
                            {it.location && ` · ${it.location}`}
                          </div>
                        )}
                        {it.kind === "event" && (
                          <div onPointerDown={(e) => startResize(e, it)} className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100" style={{ background: "linear-gradient(transparent, var(--border-strong))" }} />
                        )}
                      </div>
                    );
                  })}
                  {drag?.kind === "create" && drag.day === i && (
                    <div className="pointer-events-none absolute inset-x-0.5 rounded-sm border border-primary bg-primary-tint px-1.5 text-[length:calc(12px*var(--ui-scale,1))] text-primary-soft" style={{ top: (drag.from / 60) * HOUR, height: ((drag.to - drag.from) / 60) * HOUR }}>
                      {format(atMin(i, drag.from), "HH:mm")} – {format(atMin(i, drag.to), "HH:mm")}
                    </div>
                  )}
                  {dropAt && dropAt.min >= 0 && dropAt.day === i && <div className="pointer-events-none absolute inset-x-0.5 h-6 rounded-sm border border-dashed border-primary bg-primary-tint" style={{ top: (dropAt.min / 60) * HOUR }} />}
                  {isSameDay(d, now) && (
                    <div className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-rose" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }}>
                      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-rose" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
