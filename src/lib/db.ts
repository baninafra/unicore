"use client";

import Dexie, { type EntityTable } from "dexie";
import { nanoid } from "nanoid";
import type {
  Degree,
  Flashcard,
  Note,
  StoredFile,
  StudySession,
  Subject,
  SubjectDocument,
  Task,
} from "./types";

// Base local en IndexedDB. Todo queda en este navegador hasta que conectemos Supabase.
export const db = new Dexie("unicore") as Dexie & {
  degrees: EntityTable<Degree, "id">;
  subjects: EntityTable<Subject, "id">;
  tasks: EntityTable<Task, "id">;
  notes: EntityTable<Note, "id">;
  documents: EntityTable<SubjectDocument, "id">;
  files: EntityTable<StoredFile, "id">;
  flashcards: EntityTable<Flashcard, "id">;
  studySessions: EntityTable<StudySession, "id">;
};

db.version(1).stores({
  degrees: "id, createdAt",
  subjects: "id, degreeId, status, [degreeId+year]",
  tasks: "id, degreeId, subjectId, status, type, dueDate",
  notes: "id, subjectId, updatedAt",
  documents: "id, subjectId",
  files: "id",
  flashcards: "id, subjectId, noteId, due",
  studySessions: "id, subjectId, completedAt",
});

export const newId = () => nanoid(12);
export const nowIso = () => new Date().toISOString();

// Guarda un archivo y devuelve una URL interna "idb://<id>" para referenciarlo en apuntes.
export async function saveFile(file: File | Blob, name?: string): Promise<string> {
  const id = newId();
  await db.files.add({
    id,
    name: name ?? (file instanceof File ? file.name : "archivo"),
    type: file.type,
    size: file.size,
    blob: file,
    createdAt: nowIso(),
  });
  return `idb://${id}`;
}

const urlCache = new Map<string, string>();

// Convierte "idb://<id>" en una blob: URL que el navegador puede mostrar.
export async function resolveFileUrl(url: string): Promise<string> {
  if (!url.startsWith("idb://")) return url;
  const cached = urlCache.get(url);
  if (cached) return cached;
  const rec = await db.files.get(url.slice(6));
  if (!rec) return url;
  const objectUrl = URL.createObjectURL(rec.blob);
  urlCache.set(url, objectUrl);
  return objectUrl;
}
