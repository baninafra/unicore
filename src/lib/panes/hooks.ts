"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useWorkspace } from "@/lib/workspace";
import type { Note } from "@/lib/types";

const NO_NOTES: Note[] = [];

// Todas las notas, en vivo. Los paneles las filtran en memoria.
export function useAllNotes(): Note[] {
  return useLiveQuery(() => db.notes.toArray(), [], NO_NOTES);
}

// Id de la nota de la vista activa; undefined si la vista activa no es una nota.
export function useActiveNoteId(): string | undefined {
  const { activeView } = useWorkspace();
  return activeView.type === "nota" ? activeView.id : undefined;
}

export function useNote(id: string | undefined): Note | undefined {
  return useLiveQuery(() => (id ? db.notes.get(id) : undefined), [id]);
}
