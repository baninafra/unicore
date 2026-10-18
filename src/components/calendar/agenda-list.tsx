"use client";

// Vista de agenda: todo lo que viene, día por día, como una lista. También muestra los resultados de búsqueda.

import clsx from "clsx";
import { format, isToday, isTomorrow, startOfDay } from "date-fns";
import { MapPin } from "lucide-react";
import type { CalItem } from "@/lib/calendars/events";
import { t, dateLocale } from "@/lib/i18n";
import { DOT, ItemIcons } from "./calendar-parts";
import type { GridHandlers } from "./time-grid";

function dayTitle(d: Date) {
  const base = format(d, t("EEEE d 'de' MMMM"), { locale: dateLocale() });
  const label = isToday(d) ? t("Hoy · {base}", { base }) : isTomorrow(d) ? t("Mañana · {base}", { base }) : base;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function AgendaList({ items, h, empty }: { items: CalItem[]; h: GridHandlers; empty: string }) {
  const groups = new Map<number, CalItem[]>();
  for (const it of items) {
    const k = startOfDay(it.start).getTime();
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const days = [...groups.keys()].sort((a, b) => a - b);

  if (!days.length) return <div className="t-small p-8 text-center text-faint">{empty}</div>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4">
      {days.map((k) => (
        <section key={k} className="flex flex-col gap-0.5">
          <button type="button" className={clsx("section-label mb-1 self-start hover:text-text", isToday(new Date(k)) && "text-primary-soft")} onClick={() => h.onPickDay(new Date(k))}>
            {dayTitle(new Date(k))}
          </button>
          {groups.get(k)!.map((it) => (
            <div
              key={it.key}
              role="button"
              tabIndex={0}
              onClick={() => h.onOpen(it)}
              onKeyDown={(e) => e.key === "Enter" && h.onOpen(it)}
              onContextMenu={(e) => h.onContext(e, it)}
              className={clsx("row min-h-9 items-center gap-3", (it.done || it.cancelled) && "line-through opacity-60")}
            >
              <span className="num w-24 flex-none text-[length:calc(12px*var(--ui-scale,1))] text-faint">{it.allDay ? t("Todo el día") : `${format(it.start, "HH:mm")}${it.kind === "task" ? "" : ` – ${format(it.end, "HH:mm")}`}`}</span>
              <span className={clsx("h-2 w-2 flex-none rounded-full", DOT[it.color])} />
              <ItemIcons it={it} onToggleTask={h.onToggleTask} />
              <span className="min-w-0 flex-1 truncate text-text">{it.title}</span>
              {it.location && (
                <span className="hidden max-w-[200px] items-center gap-1 truncate text-[length:calc(12px*var(--ui-scale,1))] text-faint md:flex">
                  <MapPin className="h-3 w-3" />
                  {it.location}
                </span>
              )}
              <span className="max-w-[160px] truncate text-[length:calc(12px*var(--ui-scale,1))] text-faint">{it.calendarName}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
