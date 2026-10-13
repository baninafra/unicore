"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Layers } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import type { Flashcard } from "@/lib/types";
import { useAllSubjects, useDegrees } from "@/lib/hooks";
import { QuickCardForm } from "./quick-card-form";
import { endOfToday, minutesFor, plural } from "./review-utils";

export interface ReviewRun {
  cards: Flashcard[];
  subjectIds: string[];
}

// Filtros y resumen antes de empezar. Si no hay nada para hoy, muestra el estado vacío con el formulario rápido.
export function ReviewSetup({ initialSubjectId, onStart }: { initialSubjectId: string; onStart: (run: ReviewRun) => void }) {
  const { degreeFilter } = useAppState();
  const degrees = useDegrees();
  const subjects = useAllSubjects();
  const cards = useLiveQuery(() => db.flashcards.toArray(), []) ?? [];

  const subjectDegree = subjects.find((s) => s.id === initialSubjectId)?.degreeId;
  const [degreeOverride, setDegreeOverride] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [todayOnly, setTodayOnly] = useState(false);

  // Por defecto: la carrera de la materia que llegó por URL, o el filtro global.
  const degreeId = degreeOverride ?? (initialSubjectId && subjectDegree ? subjectDegree : degreeFilter);
  const degreeSubjects = subjects
    .filter((s) => degreeId === "all" || s.degreeId === degreeId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedSubject = degreeSubjects.some((s) => s.id === subjectId) ? subjectId : "";

  const scopeIds = new Set(degreeSubjects.filter((s) => !selectedSubject || s.id === selectedSubject).map((s) => s.id));
  const limit = todayOnly ? endOfToday() : Date.now();
  const due = cards.filter((c) => scopeIds.has(c.subjectId) && new Date(c.due).getTime() <= limit);

  return (
    <div className="flex flex-col gap-4">
      <div className="card grid gap-3 sm:grid-cols-2">
        <label className="field">
          <span>Carrera</span>
          <select
            className="input"
            value={degreeId}
            onChange={(e) => {
              setDegreeOverride(e.target.value);
              setSubjectId("");
            }}
          >
            <option value="all">Todas mis carreras</option>
            {degrees.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Materia</span>
          <select className="input" value={selectedSubject} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Todas las materias</option>
            {degreeSubjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="t-small flex items-center gap-2 text-muted sm:col-span-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={todayOnly} onChange={(e) => setTodayOnly(e.target.checked)} />
          Todo lo de hoy
        </label>
      </div>

      {due.length > 0 ? (
        <div className="card flex flex-wrap items-center justify-between gap-4">
          <p className="t-h2 num">
            {plural(due.length, "tarjeta para hoy", "tarjetas para hoy")} · unos {plural(minutesFor(due.length), "minuto", "minutos")}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => onStart({ cards: due, subjectIds: [...scopeIds] })}
          >
            Empezar repaso
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <EmptyState
            icon={Layers}
            title="No tenés tarjetas para hoy"
            text="Generá flashcards desde tus apuntes con la IA o creá una a mano."
          />
          <QuickCardForm defaultSubjectId={selectedSubject} />
        </div>
      )}
    </div>
  );
}
