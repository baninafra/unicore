"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useAllSubjects, useDegrees } from "@/lib/hooks";
import type { Flashcard } from "@/lib/types";
import { QuickCardForm } from "./quick-card-form";
import { endOfToday, minutesFor, plural } from "./review-utils";
import { Select } from "@/components/ui/select";

export interface ReviewRun {
  cards: Flashcard[];
  subjectIds: string[];
}

// Elección de carrera y materia como texto, y el botón para empezar. Sin tarjetas, un formulario para crear una.
export function ReviewSetup({ initialSubjectId, onStart }: { initialSubjectId: string; onStart: (run: ReviewRun) => void }) {
  const { degreeFilter } = useAppState();
  const degrees = useDegrees();
  const subjects = useAllSubjects();
  const cards = useLiveQuery(() => db.flashcards.toArray(), []) ?? [];

  const subjectDegree = subjects.find((s) => s.id === initialSubjectId)?.degreeId;
  const [degreeOverride, setDegreeOverride] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [todayOnly, setTodayOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  // Por defecto: la carrera de la materia que llegó por URL, o el filtro global.
  const degreeId = degreeOverride ?? (initialSubjectId && subjectDegree ? subjectDegree : degreeFilter);
  const degreeSubjects = subjects
    .filter((s) => degreeId === "all" || s.degreeId === degreeId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedSubject = degreeSubjects.some((s) => s.id === subjectId) ? subjectId : "";

  const scopeIds = new Set(degreeSubjects.filter((s) => !selectedSubject || s.id === selectedSubject).map((s) => s.id));
  const limit = todayOnly ? endOfToday() : Date.now();
  const due = cards.filter((c) => scopeIds.has(c.subjectId) && new Date(c.due).getTime() <= limit);

  const TEXT_SELECT = "cursor-pointer appearance-none bg-transparent text-text outline-none hover:text-primary-soft";

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="t-small flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted">
        <Select
          aria-label="Carrera"
          className={TEXT_SELECT}
          value={degreeId}
          onChange={(e) => {
            setDegreeOverride(e.target.value);
            setSubjectId("");
          }}
        >
          <option value="all">Todas las carreras</option>
          {degrees.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <span className="text-faint">/</span>
        <Select aria-label="Materia" className={TEXT_SELECT} value={selectedSubject} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Todas las materias</option>
          {degreeSubjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <span className="text-faint">/</span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} />
          Hasta hoy
        </label>
      </div>

      {due.length > 0 ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="t-h2 num">
            {plural(due.length, "tarjeta para hoy", "tarjetas para hoy")}
          </p>
          <p className="t-small num text-faint">unos {plural(minutesFor(due.length), "minuto", "minutos")}</p>
          <button type="button" className="btn btn-primary" onClick={() => onStart({ cards: due, subjectIds: [...scopeIds] })}>
            Empezar repaso
          </button>
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-4">
          <p className="t-small text-faint">Sin tarjetas para hoy</p>
          {adding ? (
            <QuickCardForm defaultSubjectId={selectedSubject} />
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
              Nueva tarjeta
            </button>
          )}
        </div>
      )}
    </div>
  );
}
