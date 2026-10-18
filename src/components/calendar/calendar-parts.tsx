"use client";

// Piezas compartidas por las vistas del calendario: colores, el "chip" de cada cosa y el arrastre de tareas.

import clsx from "clsx";
import { format } from "date-fns";
import { Bell, CheckSquare, Repeat, Square } from "lucide-react";
import type { CalItem } from "@/lib/calendars/events";
import type { CalendarColor } from "@/lib/types";
import { t } from "@/lib/i18n";

export const TINT: Record<CalendarColor, string> = {
  primary: "bg-primary-tint",
  cyan: "bg-cyan-tint",
  mint: "bg-mint-tint",
  amber: "bg-amber-tint",
  rose: "bg-rose-tint",
};

export const BORDER_L: Record<CalendarColor, string> = {
  primary: "border-l-primary",
  cyan: "border-l-cyan",
  mint: "border-l-mint",
  amber: "border-l-amber",
  rose: "border-l-rose",
};

export const DOT: Record<CalendarColor, string> = {
  primary: "bg-primary",
  cyan: "bg-cyan",
  mint: "bg-mint",
  amber: "bg-amber",
  rose: "bg-rose",
};

// Tipo de dato para arrastrar tareas (de la lista de tareas a un día u hora del calendario).
export const TASK_MIME = "application/x-uc-task";
export const ITEM_MIME = "application/x-uc-cal-item";

export const editable = (it: CalItem) => it.kind === "event" || it.kind === "task";

export function itemTooltip(it: CalItem): string {
  const when = it.allDay ? t("Todo el día") : `${format(it.start, "HH:mm")} – ${format(it.end, "HH:mm")}`;
  return [it.title, when, it.location, it.kind === "task" ? t("Tarea") : it.calendarName].filter(Boolean).join("\n");
}

// Ícono chiquito según lo que es: casilla para tareas (clic para marcar hecha), repetición, recordatorio.
export function ItemIcons({ it, onToggleTask }: { it: CalItem; onToggleTask?: (it: CalItem) => void }) {
  return (
    <>
      {it.kind === "task" && (
        <button
          type="button"
          aria-label={it.done ? t("Marcar como pendiente") : t("Marcar como hecha")}
          className="flex-none text-faint hover:text-text"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleTask?.(it);
          }}
        >
          {it.done ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
      )}
      {it.recurring && <Repeat className="h-3 w-3 flex-none text-faint" />}
      {!!it.reminders?.length && <Bell className="h-3 w-3 flex-none text-faint" />}
    </>
  );
}

// Una línea en las vistas de mes y en la fila de "todo el día".
export function ItemChip({
  it,
  onOpen,
  onContext,
  onToggleTask,
  draggable,
  showTime = true,
  className,
}: {
  it: CalItem;
  onOpen: (it: CalItem) => void;
  onContext: (e: React.MouseEvent, it: CalItem) => void;
  onToggleTask: (it: CalItem) => void;
  draggable?: boolean;
  showTime?: boolean;
  className?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={itemTooltip(it)}
      draggable={draggable && editable(it)}
      onDragStart={(e) => {
        e.dataTransfer.setData(ITEM_MIME, it.key);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(it);
      }}
      onKeyDown={(e) => e.key === "Enter" && onOpen(it)}
      onContextMenu={(e) => onContext(e, it)}
      className={clsx(
        "flex min-w-0 cursor-default items-center gap-1 rounded-sm border-l-2 px-1.5 text-left text-xs leading-5 text-text hover:brightness-110",
        BORDER_L[it.color],
        it.allDay || it.kind === "cronograma" ? TINT[it.color] : "hover:bg-surface-raised",
        (it.done || it.cancelled) && "text-faint line-through opacity-70",
        it.tentative && "border-dashed opacity-80",
        className,
      )}
    >
      <ItemIcons it={it} onToggleTask={onToggleTask} />
      <span className="truncate">
        {showTime && !it.allDay && <span className="num text-faint">{format(it.start, "HH:mm")} </span>}
        {it.title}
      </span>
    </div>
  );
}
