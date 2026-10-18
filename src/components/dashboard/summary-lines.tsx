"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { startOfWeek } from "date-fns";
import { t } from "@/lib/i18n";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useOpen } from "@/components/workspace/use-open";
import { useSubjects } from "@/lib/hooks";
import type { Flashcard, StudySession } from "@/lib/types";

// "6 h 40", "45 min", "3 h"
export function formatStudyTime(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return t("{m} min", { m });
  if (m === 0) return t("{h} h", { h });
  return t("{h} h {m}", { h, m: String(m).padStart(2, "0") });
}

// Resumen de Inicio en una columna: tarjetas para repasar (clic abre Repaso) y tiempo de estudio de la semana.
export function SummaryLines({ now }: { now?: Date }) {
  const { degreeFilter } = useAppState();
  const open = useOpen();
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

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="row w-full"
        onClick={(e) => open({ type: "repaso" }, e)}
      >
        <span className="num">{t("Para repasar: {n}", { n: dueToday })}</span>
      </button>
      <div className="row">
        <span className="num">{t("Estudiado esta semana: {time}", { time: formatStudyTime(studiedMinutes) })}</span>
      </div>
    </div>
  );
}
