"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Agenda } from "@/components/dashboard/agenda";
import { Kanban } from "@/components/dashboard/kanban";
import { MailPanel } from "@/components/dashboard/mail-panel";
import { SummaryLines } from "@/components/dashboard/summary-lines";
import { useNow } from "@/components/dashboard/use-now";
import { useOpen } from "@/components/workspace/use-open";
import { useAllSubjects, useSubjectMap, useTasks } from "@/lib/hooks";
import { useProfiles } from "@/lib/profiles";

// "Buen día", "Buenas tardes" o "Buenas noches" según la hora.
function greeting(now: Date) {
  const h = now.getHours();
  return h >= 6 && h < 13 ? "Buen día" : h >= 13 && h < 20 ? "Buenas tardes" : "Buenas noches";
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Inicio: agenda y tablero a la izquierda; mails y resumen a la derecha.
export function InicioView() {
  const now = useNow();
  const tasks = useTasks();
  const subjectMap = useSubjectMap();
  const allSubjects = useAllSubjects();
  const open = useOpen();
  const { profile } = useProfiles();
  const firstName = profile.name.trim().split(/\s+/)[0];

  // Sin la hora del navegador la fecha queda vacía un instante, para no diferir del servidor.
  const dateLabel = now ? capitalize(format(now, "EEEE d 'de' MMMM", { locale: es })) : "";

  return (
    <div className="view-wide @container mx-auto grid max-w-[1280px] gap-8 @min-[820px]:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex min-h-5 flex-col gap-0.5">
          {now && firstName && <h1 className="t-h2 font-semibold">{`${greeting(now)}, ${firstName}`}</h1>}
          <p className="t-small text-faint">{dateLabel}</p>
        </div>
        <Agenda tasks={tasks} subjectMap={subjectMap} now={now} />
        <Kanban tasks={tasks} subjectMap={subjectMap} />
      </div>

      <aside className="flex min-w-0 flex-col gap-6">
        <MailPanel tasks={tasks} subjects={allSubjects} onOpenAll={(e) => open({ type: "mails" }, e)} />
        <SummaryLines now={now} />
      </aside>
    </div>
  );
}
