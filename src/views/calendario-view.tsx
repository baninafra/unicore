"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { useNow } from "@/components/dashboard/use-now";
import { MonthGrid, dayKey } from "@/components/calendar/month-grid";
import { byDueDate } from "@/components/tasks/task-meta";
import { useTasks } from "@/lib/hooks";
import type { Task } from "@/lib/types";

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Calendario de mes a pantalla completa, con una barra fina arriba.
export function CalendarioView() {
  const now = useNow();
  const [offset, setOffset] = useState(0); // meses respecto del actual
  const tasks = useTasks();

  // Los mails sin confirmar no se muestran en el calendario.
  const scheduled = tasks.filter((t) => t.dueDate && t.status !== "INBOX_EMAIL");

  if (!now) return <div />;

  const month = addMonths(startOfMonth(now), offset);
  const days = eachDayOfInterval({
    start: startOfWeek(month, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  const tasksByDay = new Map<string, Task[]>();
  for (const task of scheduled) {
    if (!task.dueDate) continue;
    const key = dayKey(new Date(task.dueDate));
    tasksByDay.set(key, [...(tasksByDay.get(key) ?? []), task]);
  }
  for (const list of tasksByDay.values()) list.sort(byDueDate);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex h-9 flex-none items-center gap-1 border-b border-border px-3">
        <span className="text-[15px] font-semibold text-text">{capitalize(format(month, "LLLL yyyy", { locale: es }))}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="icon-btn" aria-label="Mes anterior" onClick={() => setOffset((o) => o - 1)}>
            <ChevronLeft strokeWidth={1.75} />
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setOffset(0)}>
            Hoy
          </button>
          <button type="button" className="icon-btn" aria-label="Mes siguiente" onClick={() => setOffset((o) => o + 1)}>
            <ChevronRight strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex-1 p-3">
        <MonthGrid days={days} month={month} tasksByDay={tasksByDay} />
      </div>
    </div>
  );
}
