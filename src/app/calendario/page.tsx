"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, eachDayOfInterval, endOfDay, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { useNow } from "@/components/dashboard/use-now";
import { MonthGrid, dayKey } from "@/components/calendar/month-grid";
import { TaskCard } from "@/components/tasks/task-card";
import { byDueDate } from "@/components/tasks/task-meta";
import { useDegreeMap, useSubjectMap, useTasks } from "@/lib/hooks";
import type { Task } from "@/lib/types";

const UPCOMING_DAYS = 14;

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function CalendarioPage() {
  const now = useNow();
  const [offset, setOffset] = useState(0); // meses respecto del actual
  const tasks = useTasks();
  const degreeMap = useDegreeMap();
  const subjectMap = useSubjectMap();

  // Las tareas del inbox todavía no están confirmadas, así que no se muestran en el calendario.
  const scheduled = tasks.filter((t) => t.dueDate && t.status !== "INBOX_EMAIL");

  if (!now) return <div className="p-6" />;

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

  const from = startOfDay(now);
  const to = endOfDay(addDays(now, UPCOMING_DAYS));
  const upcoming = scheduled
    .filter((t) => {
      if (t.status === "DONE" || !t.dueDate) return false;
      const due = new Date(t.dueDate);
      return due >= from && due <= to;
    })
    .sort(byDueDate);

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 p-6 lg:flex-row lg:items-start">
      <section className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-h1">{capitalize(format(month, "LLLL yyyy", { locale: es }))}</h1>
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost btn-icon" aria-label="Mes anterior" onClick={() => setOffset((o) => o - 1)}>
              <ChevronLeft strokeWidth={1.75} />
            </button>
            <button className="btn btn-sm" onClick={() => setOffset(0)}>
              Hoy
            </button>
            <button className="btn btn-ghost btn-icon" aria-label="Mes siguiente" onClick={() => setOffset((o) => o + 1)}>
              <ChevronRight strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <MonthGrid days={days} month={month} tasksByDay={tasksByDay} />
      </section>

      <aside className="flex w-full flex-none flex-col gap-3 lg:w-[300px]">
        <h2 className="t-h2 px-1">Próximos {UPCOMING_DAYS} días</h2>
        {upcoming.length === 0 ? (
          <p className="t-small rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted">
            Nada para los próximos {UPCOMING_DAYS} días.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                degree={task.degreeId ? degreeMap[task.degreeId] : undefined}
                subject={task.subjectId ? subjectMap[task.subjectId] : undefined}
              />
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
