"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { endOfWeek, startOfDay, startOfWeek } from "date-fns";
import clsx from "clsx";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { relativeDays, shortDateTime } from "@/lib/format";
import { useSubjects } from "@/lib/hooks";
import type { Degree, Flashcard, StudySession, Subject, Task } from "@/lib/types";
import { byDueDate } from "@/components/tasks/task-meta";

// "6 h 40", "45 min", "3 h"
export function formatStudyTime(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

function StatCard({
  label,
  href,
  onClick,
  children,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const interactive = !!href || !!onClick;
  const className = clsx("card flex min-w-0 flex-col gap-2 text-left", interactive && "card-hover");
  const content = (
    <>
      <span className="t-label">{label}</span>
      {children}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}

// Las cuatro tarjetas de resumen de Inicio. Respetan el filtro de carrera.
export function SummaryCards({
  tasks,
  degrees,
  subjectMap,
  now,
}: {
  tasks: Task[]; // ya filtradas por carrera (useTasks)
  degrees: Degree[];
  subjectMap: Record<string, Subject>;
  now?: Date;
}) {
  const { degreeFilter, openTaskDialog } = useAppState();
  const subjects = useSubjects(); // ya filtradas por carrera
  const subjectIds = new Set(subjects.map((s) => s.id));
  const inScope = (subjectId?: string) => degreeFilter === "all" || (!!subjectId && subjectIds.has(subjectId));

  const nowIso = now?.toISOString();
  const weekStartIso = now ? startOfWeek(now, { weekStartsOn: 1 }).toISOString() : undefined;

  const dueCards = useLiveQuery(async (): Promise<Flashcard[]> => {
    if (!nowIso) return [];
    return db.flashcards.where("due").belowOrEqual(nowIso).toArray();
  }, [nowIso]);
  const sessions = useLiveQuery(async (): Promise<StudySession[]> => {
    if (!weekStartIso) return [];
    return db.studySessions.where("completedAt").aboveOrEqual(weekStartIso).toArray();
  }, [weekStartIso]);

  const dueToday = (dueCards ?? []).filter((c) => inScope(c.subjectId)).length;
  const studiedMinutes = (sessions ?? []).filter((s) => inScope(s.subjectId)).reduce((sum, s) => sum + s.durationMinutes, 0);

  // Semana en curso: desde hoy hasta el domingo (sin contar lo ya entregado ni lo que todavía está en el inbox).
  const todayStart = now ? startOfDay(now) : undefined;
  const weekEnd = now ? endOfWeek(now, { weekStartsOn: 1 }) : undefined;
  const deliveries = tasks.filter((t) => {
    if (t.status === "DONE" || t.status === "INBOX_EMAIL" || !t.dueDate || !todayStart || !weekEnd) return false;
    const due = new Date(t.dueDate);
    return due >= todayStart && due <= weekEnd;
  });
  const breakdown = degrees
    .map((d) => ({ name: d.shortName, count: deliveries.filter((t) => t.degreeId === d.id).length }))
    .filter((x) => x.count > 0)
    .map((x) => `${x.count} ${x.name}`)
    .join(" · ");

  const nextExam = tasks
    .filter((t) => t.type === "PARCIAL" && t.status !== "DONE" && t.status !== "INBOX_EMAIL" && t.dueDate)
    .filter((t) => !todayStart || new Date(t.dueDate!) >= todayStart)
    .sort(byDueDate)[0];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Próximo parcial" onClick={nextExam ? () => openTaskDialog(nextExam) : undefined}>
        {nextExam ? (
          <>
            <span className="t-h3 truncate">{(nextExam.subjectId && subjectMap[nextExam.subjectId]?.name) || nextExam.title}</span>
            <span className="t-small num text-rose">
              {shortDateTime(nextExam.dueDate)} · {relativeDays(nextExam.dueDate)}
            </span>
          </>
        ) : (
          <span className="t-small text-muted">Sin parciales cargados</span>
        )}
      </StatCard>

      <StatCard label="Entregas esta semana">
        <span className="t-h1 num">{deliveries.length}</span>
        <span className="t-small text-muted">{breakdown || "Nada para esta semana"}</span>
      </StatCard>

      <StatCard label="Para repasar hoy" href="/repaso">
        <span className="t-h1 num">{dueToday}</span>
        <span className="t-small text-muted">{dueToday > 0 ? "Tarjetas listas en Repaso" : "Nada pendiente por hoy"}</span>
      </StatCard>

      <StatCard label="Estudiado esta semana">
        <span className="t-h1 num">{formatStudyTime(studiedMinutes)}</span>
        <span className="t-small text-muted">Desde el lunes</span>
      </StatCard>
    </div>
  );
}
