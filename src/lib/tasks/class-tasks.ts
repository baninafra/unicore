"use client";

// Tareas enlazadas a clases (o a cualquier nota de una materia).
// Una "clase" es una nota con la propiedad tipo = "clase" y fecha = "YYYY-MM-DD" (las crea el cronograma).

import { db } from "../db";
import type { Note, Task } from "../types";

export const isClassNote = (n: Pick<Note, "properties">) => n.properties?.tipo === "clase";
export const classDate = (n: Pick<Note, "properties">) => (typeof n.properties?.fecha === "string" ? n.properties.fecha : undefined);

// Clases de una materia ordenadas por fecha, después el resto de las notas.
export async function subjectNotesForLinking(subjectId: string): Promise<Note[]> {
  const notes = await db.notes.where("subjectId").equals(subjectId).toArray();
  return notes.sort((a, b) => {
    const ca = isClassNote(a) ? 0 : 1;
    const cb = isClassNote(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return (classDate(a) ?? a.createdAt).localeCompare(classDate(b) ?? b.createdAt);
  });
}

// Datos para una tarea nueva a partir de una nota. Si es una clase, vence en la clase siguiente.
export async function taskFromNote(note: Note): Promise<Partial<Task>> {
  const subject = await db.subjects.get(note.subjectId);
  let dueDate: string | undefined;
  const date = classDate(note);
  if (isClassNote(note) && date) {
    const next = (await db.notes.where("subjectId").equals(note.subjectId).toArray())
      .filter((n) => isClassNote(n) && (classDate(n) ?? "") > date)
      .sort((a, b) => classDate(a)!.localeCompare(classDate(b)!))[0];
    const d = classDate(next ?? {});
    if (d) {
      const [y, m, day] = d.split("-").map(Number);
      dueDate = new Date(y, m - 1, day, 8, 0).toISOString();
    }
  }
  return {
    title: isClassNote(note) ? `Tarea de ${note.title.replace(/^Clase \d+ · \d{2}\/\d{2} · /, "")}` : "",
    type: "TAREA",
    subjectId: subject?.id,
    degreeId: subject?.degreeId,
    noteId: note.id,
    dueDate,
  };
}
