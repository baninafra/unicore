"use client";

// Subnotas: una nota puede tener notas adentro, hasta dos niveles
// (nota → subnota → sub-subnota). Las subnotas viven en la misma carpeta que su nota madre.

import { db, nowIso } from "../db";
import type { Note } from "../types";
import { createNote } from "@/components/notes/note-utils";
import { t } from "@/lib/i18n";

export const MAX_NOTE_DEPTH = 2;

type Lite = Pick<Note, "id" | "parentId">;

// Cuántas notas madre tiene encima (0 = nota común).
export function noteDepth(id: string, all: Lite[]): number {
  const byId = new Map(all.map((n) => [n.id, n]));
  let depth = 0;
  let cur = byId.get(id)?.parentId;
  const seen = new Set<string>();
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    cur = byId.get(cur)?.parentId;
  }
  return depth;
}

// Ids de todas las subnotas (a cualquier profundidad).
export function descendantsOf(id: string, all: Lite[]): string[] {
  const out: string[] = [];
  const walk = (pid: string) => {
    for (const n of all)
      if (n.parentId === pid && !out.includes(n.id)) {
        out.push(n.id);
        walk(n.id);
      }
  };
  walk(id);
  return out;
}

// Niveles de subnotas que cuelgan de esta nota (0 = no tiene).
function heightOf(id: string, all: Lite[]): number {
  const kids = all.filter((n) => n.parentId === id);
  return kids.length ? 1 + Math.max(...kids.map((k) => heightOf(k.id, all))) : 0;
}

// Por qué no se puede poner `childId` adentro de `parentId` (o null si se puede).
export function nestError(childId: string, parentId: string, all: Lite[]): string | null {
  if (childId === parentId || descendantsOf(childId, all).includes(parentId)) return t("Una nota no puede ir adentro de sí misma.");
  if (noteDepth(parentId, all) + 1 + heightOf(childId, all) > MAX_NOTE_DEPTH) return t("Las subnotas llegan hasta dos niveles.");
  return null;
}

export async function createSubnote(parentId: string): Promise<string> {
  const parent = await db.notes.get(parentId);
  if (!parent) throw new Error(t("No encontramos la nota."));
  const all = await db.notes.toArray();
  if (noteDepth(parentId, all) >= MAX_NOTE_DEPTH) throw new Error(t("Las subnotas llegan hasta dos niveles."));
  const id = await createNote({ subjectId: parent.subjectId, title: t("Sin título"), unitNumber: parent.unitNumber });
  await db.notes.update(id, { parentId });
  return id;
}

// Pone una nota (con sus subnotas) adentro de otra.
export async function nestNote(childId: string, parentId: string): Promise<void> {
  const all = await db.notes.toArray();
  const err = nestError(childId, parentId, all);
  if (err) throw new Error(err);
  const parent = all.find((n) => n.id === parentId);
  if (!parent) return;
  await db.transaction("rw", [db.notes, db.flashcards], async () => {
    for (const id of [childId, ...descendantsOf(childId, all)]) {
      await db.notes.update(id, { subjectId: parent.subjectId, unitNumber: parent.unitNumber, updatedAt: nowIso() });
      await db.flashcards.where("noteId").equals(id).modify({ subjectId: parent.subjectId });
    }
    await db.notes.update(childId, { parentId });
  });
}

// Al mover una nota a otra carpeta deja de ser subnota y sus subnotas la acompañan.
export async function detachAndCarry(noteId: string, subjectId: string, unitNumber?: number): Promise<void> {
  const all = await db.notes.toArray();
  await db.notes.update(noteId, { parentId: undefined });
  for (const id of descendantsOf(noteId, all)) {
    await db.notes.update(id, { subjectId, ...(unitNumber !== undefined ? { unitNumber } : {}) });
    await db.flashcards.where("noteId").equals(id).modify({ subjectId });
  }
}

// Al borrar una nota, sus subnotas suben un nivel en lugar de perderse.
export async function liftChildren(noteId: string): Promise<void> {
  const note = await db.notes.get(noteId);
  await db.notes
    .filter((n) => n.parentId === noteId)
    .modify((n) => {
      if (note?.parentId) n.parentId = note.parentId;
      else delete n.parentId;
    });
}
