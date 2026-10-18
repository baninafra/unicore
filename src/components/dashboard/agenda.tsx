"use client";

import { addDays, endOfDay } from "date-fns";
import type { Subject, Task } from "@/lib/types";
import { byDueDate } from "@/components/tasks/task-meta";
import { TaskRow } from "@/components/tasks/task-row";
import { t } from "@/lib/i18n";

// Hoy (incluye lo vencido sin terminar) y los próximos 7 días, como filas.
export function Agenda({ tasks, subjectMap, now }: { tasks: Task[]; subjectMap: Record<string, Subject>; now?: Date }) {
  if (!now) return null;

  const todayEnd = endOfDay(now).getTime();
  const weekEnd = endOfDay(addDays(now, 7)).getTime();

  const open = tasks
    .filter((t) => t.status !== "INBOX_EMAIL" && t.status !== "DONE" && t.dueDate)
    .sort(byDueDate);

  const today = open.filter((t) => new Date(t.dueDate!).getTime() <= todayEnd);
  const upcoming = open.filter((t) => {
    const due = new Date(t.dueDate!).getTime();
    return due > todayEnd && due <= weekEnd;
  });

  const render = (list: Task[], empty: string) =>
    list.length === 0 ? (
      <p className="t-small px-2 py-1 text-faint">{empty}</p>
    ) : (
      list.map((t) => <TaskRow key={t.id} task={t} subject={t.subjectId ? subjectMap[t.subjectId] : undefined} />)
    );

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-0.5">
        <h2 className="section-label mb-1">{t("Hoy · {n}", { n: today.length })}</h2>
        {render(today, t("Nada para hoy"))}
      </section>
      <section className="flex flex-col gap-0.5">
        <h2 className="section-label mb-1">{t("Próximos 7 días · {n}", { n: upcoming.length })}</h2>
        {render(upcoming, t("Nada en los próximos 7 días"))}
      </section>
    </div>
  );
}
