"use client";

import { db, newId, nowIso } from "@/lib/db";
import type { Degree, DegreeColor, Subject, SubjectStatus } from "@/lib/types";

export interface DegreeInput {
  name: string;
  shortName: string;
  institution?: string;
  color: DegreeColor;
  totalYears: number;
}

export interface SubjectInput {
  degreeId: string;
  name: string;
  year: number;
  semester: 1 | 2;
  status: SubjectStatus;
  finalGrade?: number;
  correlatives: string[];
  professorEmail?: string;
  campusUrl?: string;
  driveUrl?: string;
}

// Quita las claves en undefined para no guardar campos vacíos en IndexedDB.
function clean<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export async function saveDegree(input: DegreeInput, existing?: Degree): Promise<string> {
  const record: Degree = clean({
    ...existing,
    ...input,
    id: existing?.id ?? newId(),
    createdAt: existing?.createdAt ?? nowIso(),
  });
  await db.degrees.put(record);
  return record.id;
}

export async function saveSubject(input: SubjectInput, existing?: Subject): Promise<string> {
  const record: Subject = clean({
    ...existing,
    ...input,
    id: existing?.id ?? newId(),
    createdAt: existing?.createdAt ?? nowIso(),
  });
  await db.subjects.put(record);
  return record.id;
}

// Borra materias, sus tareas, y saca sus ids de las correlativas de las demás.
async function removeSubjects(ids: string[]) {
  if (!ids.length) return;
  const gone = new Set(ids);
  await db.tasks.where("subjectId").anyOf(ids).delete();
  await db.subjects.bulkDelete(ids);
  await db.subjects
    .filter((s) => s.correlatives.some((c) => gone.has(c)))
    .modify((s) => {
      s.correlatives = s.correlatives.filter((c) => !gone.has(c));
    });
}

export async function deleteSubjectCascade(subjectId: string) {
  await db.transaction("rw", db.subjects, db.tasks, async () => {
    await removeSubjects([subjectId]);
  });
}

// Borra la carrera, sus materias y sus tareas.
export async function deleteDegreeCascade(degreeId: string) {
  await db.transaction("rw", db.degrees, db.subjects, db.tasks, async () => {
    const subjectIds = await db.subjects.where("degreeId").equals(degreeId).primaryKeys();
    await removeSubjects(subjectIds);
    await db.tasks.where("degreeId").equals(degreeId).delete();
    await db.degrees.delete(degreeId);
  });
}
