import type { PartialBlock } from "@blocknote/core";
import { db, newId, nowIso } from "@/lib/db";
import { indexNote, plainTextOf } from "@/lib/notes/index-note";
import { syncInlineCards } from "@/lib/notes/cards";
import type { Note } from "@/lib/types";
import { t } from "@/lib/i18n";

export { plainTextOf };

// Mínimo de caracteres para que la IA tenga material con qué generar tarjetas o un examen.
export const MIN_CHARS_FOR_AI = 200;

// Párrafos de un texto plano (separados por líneas en blanco) como bloques de BlockNote.
export function paragraphBlocks(text: string): PartialBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => ({ type: "paragraph" as const, content: p }));
}

// Orden de la lista: por unidad y, dentro de cada unidad, por fecha de creación.
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.unitNumber - b.unitNumber || a.createdAt.localeCompare(b.createdAt));
}

export async function createNote(input: {
  subjectId: string;
  title: string;
  unitNumber: number;
  content?: unknown[];
  plainTextCache?: string;
  dailyDate?: string;
}): Promise<string> {
  const id = newId();
  const now = nowIso();
  const content = input.content ?? [];
  const index = indexNote(content as Parameters<typeof indexNote>[0]);
  await db.notes.add({
    id,
    subjectId: input.subjectId,
    title: input.title.trim() || t("Sin título"),
    unitNumber: input.unitNumber,
    content,
    plainTextCache: input.plainTextCache ?? index.plainText,
    links: index.links,
    tags: index.tags,
    ...(input.dailyDate ? { dailyDate: input.dailyDate } : {}),
    createdAt: now,
    updatedAt: now,
  });
  if (content.length) await syncInlineCards({ id, subjectId: input.subjectId }, content as Parameters<typeof indexNote>[0]);
  return id;
}
