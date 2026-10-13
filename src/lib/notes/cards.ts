// Tarjetas inline estilo Logseq: un bloque con "#tarjeta" y "pregunta :: respuesta" es una flashcard.
// Su id es `${noteId}-${blockId}`, así se actualiza sin duplicarse y se borra si el bloque desaparece.

import { db, nowIso } from "@/lib/db";
import { newCardFields } from "@/lib/fsrs";
import type { Flashcard } from "@/lib/types";
import { blockOwnText, type BlockLike } from "./index-note";

const CARD_TAG = /#tarjeta(?![\p{L}\p{N}_/-])/giu;

export interface InlineCard {
  blockId: string;
  front: string;
  back: string;
}

export function isCardText(text: string): boolean {
  return /#tarjeta(?![\p{L}\p{N}_/-])/iu.test(text) && text.includes("::");
}

// Separa "pregunta :: respuesta #tarjeta" en frente y dorso, sin la etiqueta.
export function parseCard(text: string): { front: string; back: string } | null {
  if (!isCardText(text)) return null;
  const clean = text.replace(CARD_TAG, "").replace(/\s+/g, " ").trim();
  const at = clean.indexOf("::");
  if (at === -1) return null;
  const front = clean.slice(0, at).trim();
  const back = clean.slice(at + 2).trim();
  return front && back ? { front, back } : null;
}

export function cardsInBlocks(blocks: BlockLike[]): InlineCard[] {
  const out: InlineCard[] = [];
  const visit = (list: BlockLike[]) => {
    for (const b of list) {
      const parsed = b.id ? parseCard(blockOwnText(b)) : null;
      if (b.id && parsed) out.push({ blockId: b.id, ...parsed });
      if (b.children?.length) visit(b.children);
    }
  };
  visit(blocks);
  return out;
}

// Crea, actualiza y borra las tarjetas inline de una nota según sus bloques actuales.
export async function syncInlineCards(note: { id: string; subjectId: string }, blocks: BlockLike[]): Promise<void> {
  const prefix = `${note.id}-`;
  const items = cardsInBlocks(blocks);
  const wanted = new Map(items.map((i) => [prefix + i.blockId, i]));
  const existing = (await db.flashcards.where("noteId").equals(note.id).toArray()).filter((c) => c.id.startsWith(prefix));
  const existingIds = new Set(existing.map((c) => c.id));

  const toDelete = existing.filter((c) => !wanted.has(c.id)).map((c) => c.id);
  const toUpdate = existing.flatMap((c) => {
    const w = wanted.get(c.id);
    return w && (w.front !== c.front || w.back !== c.back) ? [{ id: c.id, front: w.front, back: w.back }] : [];
  });
  const now = new Date();
  const toAdd: Flashcard[] = items
    .filter((i) => !existingIds.has(prefix + i.blockId))
    .map((i) => ({
      id: prefix + i.blockId,
      subjectId: note.subjectId,
      noteId: note.id,
      front: i.front,
      back: i.back,
      ...newCardFields(now),
      createdAt: nowIso(),
    }));

  if (!toDelete.length && !toUpdate.length && !toAdd.length) return;
  await db.transaction("rw", db.flashcards, async () => {
    if (toDelete.length) await db.flashcards.bulkDelete(toDelete);
    for (const u of toUpdate) await db.flashcards.update(u.id, { front: u.front, back: u.back });
    if (toAdd.length) await db.flashcards.bulkAdd(toAdd);
  });
}
