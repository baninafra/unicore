"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { useAppState } from "./app-state";
import { useProfiles } from "./profiles";
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

// Materias según el filtro global de carrera y el perfil activo.
export function useSubjects(): Subject[] {
  const { degreeFilter } = useAppState();
  const { inScope } = useProfiles();
  const list = useLiveQuery(
    () => (degreeFilter === "all" ? db.subjects.toArray() : db.subjects.where("degreeId").equals(degreeFilter).toArray()),
    [degreeFilter],
  );
  return useMemo(() => (list ?? []).filter((s) => inScope(s.degreeId)), [list, inScope]);
}

export function useSubjectMap(): Record<string, Subject> {
  const subjects = useAllSubjects();
  return Object.fromEntries(subjects.map((s) => [s.id, s]));
}

// Tareas según el filtro global de carrera y el perfil activo.
export function useTasks(): Task[] {
  const { degreeFilter } = useAppState();
  const { taskInScope } = useProfiles();
  const list = useLiveQuery(
    () => (degreeFilter === "all" ? db.tasks.toArray() : db.tasks.where("degreeId").equals(degreeFilter).toArray()),
    [degreeFilter],
  );
  return useMemo(() => (list ?? []).filter(taskInScope), [list, taskInScope]);
}
