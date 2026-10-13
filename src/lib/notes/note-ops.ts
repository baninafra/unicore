// Operaciones sobre notas que tocan varias tablas: guardar con índice, copias de recuperación,
// combinar, mover y borrar. Todo lo que cambia contenido pasa por saveNoteContent.

import { db, newId, nowIso } from "@/lib/db";
import { syncInlineCards } from "./cards";
import { indexNote, mapWikilinks, normalizeTag, type BlockLike } from "./index-note";
import { DAILY_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Note, type NoteSnapshot } from "@/lib/types";

export const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
export const MAX_SNAPSHOTS = 50;

// Guarda el contenido de una nota: texto, enlaces, etiquetas, tarjetas y copia de recuperación.
export async function saveNoteContent(noteId: string, blocks: unknown[]): Promise<void> {
  const note = await db.notes.get(noteId);
  if (!note) return;
  const index = indexNote(blocks as BlockLike[]);
  const manual = Array.isArray(note.properties?.tags) ? (note.properties?.tags as string[]).map(normalizeTag) : [];
  const tags = [...new Set([...index.tags, ...manual])];
  await db.notes.update(noteId, {
    content: blocks,
    plainTextCache: index.plainText,
    links: index.links,
    tags,
    updatedAt: nowIso(),
  });
  await syncInlineCards(note, blocks as BlockLike[]);
  await snapshotNote({ id: noteId, title: note.title, content: blocks, plainTextCache: index.plainText }, false);
  window.dispatchEvent(new CustomEvent("uc:note-saved", { detail: { noteId } }));
}

// Guarda una copia si pasaron más de 5 minutos desde la última (o siempre si force). Máximo 50 por nota.
export async function snapshotNote(
  note: { id: string; title: string; content: unknown[]; plainTextCache: string },
  force: boolean,
): Promise<void> {
  const snaps = await db.snapshots.where("noteId").equals(note.id).toArray();
  const last = snaps.reduce<string | undefined>((m, s) => (!m || s.createdAt > m ? s.createdAt : m), undefined);
  if (!force && last && Date.now() - Date.parse(last) < SNAPSHOT_EVERY_MS) return;
  const created: NoteSnapshot = {
    id: newId(),
    noteId: note.id,
    title: note.title,
    content: note.content,
    plainText: note.plainTextCache,
    createdAt: nowIso(),
  };
  await db.snapshots.add(created);
  const all = [...snaps, created].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const excess = all.slice(MAX_SNAPSHOTS).map((s) => s.id);
  if (excess.length) await db.snapshots.bulkDelete(excess);
}

// Combina la nota `sourceId` al final de `targetId`: reescribe los enlaces, borra la origen y reubica sus tarjetas.
export async function combineNotes(sourceId: string, targetId: string): Promise<void> {
  const source = await db.notes.get(sourceId);
  const target = await db.notes.get(targetId);
  if (!source || !target || sourceId === targetId) return;
  const merged = [...(target.content as BlockLike[]), ...(source.content as BlockLike[])];
  const mergedIndex = indexNote(merged);

  await db.transaction("rw", [db.notes, db.snapshots, db.flashcards], async () => {
    const linking = await db.notes.where("links").equals(sourceId).toArray();
    for (const n of linking) {
      if (n.id === sourceId || n.id === targetId) continue;
      const content = mapWikilinks(n.content as BlockLike[], sourceId, targetId);
      const idx = indexNote(content);
      await db.notes.update(n.id, { content, plainTextCache: idx.plainText, links: idx.links, updatedAt: nowIso() });
    }
    await db.notes.update(targetId, {
      content: mapWikilinks(merged, sourceId, targetId),
      plainTextCache: mergedIndex.plainText,
      links: mergedIndex.links,
      tags: [...new Set([...mergedIndex.tags, ...(target.tags ?? [])])],
      updatedAt: nowIso(),
    });
    await db.notes.delete(sourceId);
    await db.snapshots.where("noteId").equals(sourceId).delete();
    await db.flashcards
      .where("noteId")
      .equals(sourceId)
      .filter((c) => c.id.startsWith(`${sourceId}-`))
      .delete();
  });
  const updated = await db.notes.get(targetId);
  if (updated) await syncInlineCards(updated, updated.content as BlockLike[]);
}

export async function moveNote(noteId: string, subjectId: string): Promise<void> {
  await db.transaction("rw", [db.notes, db.flashcards], async () => {
    await db.notes.update(noteId, { subjectId, updatedAt: nowIso() });
    await db.flashcards.where("noteId").equals(noteId).modify({ subjectId });
  });
}

export async function deleteNote(noteId: string): Promise<void> {
  await db.transaction("rw", [db.notes, db.snapshots, db.flashcards, db.bookmarks], async () => {
    await db.notes.delete(noteId);
    await db.snapshots.where("noteId").equals(noteId).delete();
    await db.flashcards
      .where("noteId")
      .equals(noteId)
      .filter((c) => c.id.startsWith(`${noteId}-`))
      .delete();
    await db.bookmarks.where("targetId").equals(noteId).filter((b) => b.kind === "note").delete();
  });
}

// Nombre legible de la carpeta o materia de una nota (para migas y selectores).
export function noteLocationLabel(note: Pick<Note, "subjectId">): string {
  if (note.subjectId === DAILY_FOLDER) return "Diario";
  if (note.subjectId === LOOSE_FOLDER) return "Notas";
  if (note.subjectId === TEMPLATES_FOLDER) return "Plantillas";
  return "";
}
