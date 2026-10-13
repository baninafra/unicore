"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { useAppState } from "./app-state";
import type { Degree, Subject, Task } from "./types";

// Hooks de lectura reactivos: se actualizan solos cuando cambia la base.

export function useDegrees(): Degree[] {
  return useLiveQuery(() => db.degrees.orderBy("createdAt").toArray(), []) ?? [];
}

export function useDegreeMap(): Record<string, Degree> {
  const degrees = useDegrees();
  return Object.fromEntries(degrees.map((d) => [d.id, d]));
}

// Todas las materias (sin filtro) — útil para correlativas.
export function useAllSubjects(): Subject[] {
  return useLiveQuery(() => db.subjects.toArray(), []) ?? [];
}

// Materias según el filtro global de carrera.
export function useSubjects(): Subject[] {
  const { degreeFilter } = useAppState();
  return (
    useLiveQuery(
      () => (degreeFilter === "all" ? db.subjects.toArray() : db.subjects.where("degreeId").equals(degreeFilter).toArray()),
      [degreeFilter],
    ) ?? []
  );
}

export function useSubjectMap(): Record<string, Subject> {
  const subjects = useAllSubjects();
  return Object.fromEntries(subjects.map((s) => [s.id, s]));
}

// Tareas según el filtro global de carrera.
export function useTasks(): Task[] {
  const { degreeFilter } = useAppState();
  return (
    useLiveQuery(
      () => (degreeFilter === "all" ? db.tasks.toArray() : db.tasks.where("degreeId").equals(degreeFilter).toArray()),
      [degreeFilter],
    ) ?? []
  );
}
