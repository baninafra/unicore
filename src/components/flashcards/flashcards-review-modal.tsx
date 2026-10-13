"use client";

import clsx from "clsx";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { db } from "@/lib/db";
import type { FlashcardDraft } from "@/lib/ai/prompts";
import { newFlashcardRecord } from "./fsrs-card";

interface Row extends FlashcardDraft {
  keep: boolean;
}

// Revisión de las tarjetas que propuso la IA: se pueden editar, descartar y después guardar.
export function FlashcardsReviewModal({
  drafts,
  subjectId,
  noteId,
  onClose,
  onSaved,
}: {
  drafts: FlashcardDraft[];
  subjectId: string;
  noteId?: string;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => drafts.map((d) => ({ ...d, keep: true })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const valid = rows.filter((r) => r.keep && r.front.trim() && r.back.trim());
  const count = valid.length;

  const update = (index: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!count) return;
    setSaving(true);
    try {
      const now = new Date();
      const cards = valid.map((r) =>
        newFlashcardRecord({ subjectId, noteId, front: r.front.trim(), back: r.back.trim() }, now),
      );
      await db.flashcards.bulkAdd(cards);
      onSaved(cards.length);
    } catch {
      setError("No pudimos guardar las flashcards. Probá de nuevo.");
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Revisá las flashcards"
      width={640}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Descartar
          </button>
          <button type="button" className="btn btn-primary" disabled={!count || saving} onClick={() => void save()}>
            {count === 1 ? "Guardar 1 tarjeta" : `Guardar ${count} tarjetas`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {rows.map((row, i) => (
          <div
            key={i}
            className={clsx("flex gap-3 rounded-md border border-border p-3", !row.keep && "opacity-60")}
          >
            <input
              type="checkbox"
              className="mt-2 h-4 w-4 shrink-0 accent-primary"
              checked={row.keep}
              onChange={(e) => update(i, { keep: e.target.checked })}
              aria-label={`Incluir la tarjeta ${i + 1}`}
            />
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
              <label className="field">
                <span>Frente</span>
                <textarea
                  className="input"
                  rows={2}
                  value={row.front}
                  disabled={!row.keep}
                  onChange={(e) => update(i, { front: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Dorso</span>
                <textarea
                  className="input"
                  rows={2}
                  value={row.back}
                  disabled={!row.keep}
                  onChange={(e) => update(i, { back: e.target.value })}
                />
              </label>
            </div>
          </div>
        ))}
        {error && <p className="t-small text-rose">{error}</p>}
      </div>
    </Modal>
  );
}
