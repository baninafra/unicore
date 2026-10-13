"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { Kanban } from "@/components/dashboard/kanban";
import { MailPanel } from "@/components/dashboard/mail-panel";
import { useNow } from "@/components/dashboard/use-now";
import { useAllSubjects, useDegreeMap, useDegrees, useSubjectMap, useTasks } from "@/lib/hooks";

function greetingFor(hour: number) {
  if (hour < 12) return "Buen día";
  if (hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

export function InicioView() {
  const now = useNow();
  const tasks = useTasks();
  const degrees = useDegrees();
  const degreeMap = useDegreeMap();
  const subjectMap = useSubjectMap();
  const allSubjects = useAllSubjects();

  // Las tareas del inbox no están en el kanban: van al panel de mails.
  const boardTasks = tasks.filter((t) => t.status !== "INBOX_EMAIL");

  // Sin la hora del navegador el saludo queda vacío un instante, para no mostrar algo distinto al servidor.
  const greeting = now ? greetingFor(now.getHours()) : "";
  const dateLabel = now ? format(now, "EEEE d 'de' MMMM", { locale: es }) : "";

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-6 p-6">
      <header>
        <h1 className="t-h1">{greeting}</h1>
        <p className="t-small min-h-5 text-muted">{dateLabel}</p>
      </header>

      <SummaryCards tasks={tasks} degrees={degrees} subjectMap={subjectMap} now={now} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="t-h2 px-1">Tareas</h2>
          <Kanban tasks={boardTasks} degreeMap={degreeMap} subjectMap={subjectMap} />
        </section>

        <aside className="w-full flex-none lg:w-[340px]">
          <MailPanel tasks={tasks} subjects={allSubjects} />
        </aside>
      </div>
    </div>
  );
}
