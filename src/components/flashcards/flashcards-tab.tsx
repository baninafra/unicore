"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/lib/db";
import { shortDate } from "@/lib/format";
import type { Flashcard } from "@/lib/types";
import { FlashcardFormModal } from "./flashcard-form-modal";

// Estados de FSRS (ts-fsrs): New, Learning, Review, Relearning
const STATE_LABEL = ["Nueva", "Aprendiendo", "Repaso", "Reaprendiendo"];

export function FlashcardsTab({ subjectId }: { subjectId: string }) {
  const cards = useLiveQuery(() => db.flashcards.where("subjectId").equals(subjectId).toArray(), [subjectId]);
  const sorted = useMemo(() => [...(cards ?? [])].sort((a, b) => a.due.localeCompare(b.due)), [cards]);
  const [form, setForm] = useState<{ card?: Flashcard } | null>(null);
  const [deleting, setDeleting] = useState<Flashcard | null>(null);

  const remove = async () => {
    if (!deleting) return;
    await db.flashcards.delete(deleting.id);
    setDeleting(null);
  };

  if (cards === undefined) return <div className="t-small text-muted">Cargando flashcards…</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-small num text-muted">{sorted.length === 1 ? "1 tarjeta" : `${sorted.length} tarjetas`}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" onClick={() => setForm({})}>
            <Plus />
            Nueva flashcard
          </button>
          {sorted.length > 0 && (
            <Link href={`/repaso?materia=${subjectId}`} className="btn btn-sm">
              Repasar ahora
            </Link>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Todavía no hay flashcards"
          text="Generalas desde un apunte con IA o creá una a mano."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {sorted.map((card) => (
            <li key={card.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="t-h3 truncate">{card.front}</div>
                <div className="t-small line-clamp-2 text-muted">{card.back}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="badge">{STATE_LABEL[card.state] ?? "Nueva"}</span>
                <span className="t-small num text-faint">Repaso {shortDate(card.due)}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label="Editar flashcard"
                onClick={() => setForm({ card })}
              >
                <Pencil />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label="Eliminar flashcard"
                onClick={() => setDeleting(card)}
              >
                <Trash2 />
              </button>
            </li>
          ))}
        </ul>
      )}

      {form && <FlashcardFormModal subjectId={subjectId} card={form.card} onClose={() => setForm(null)} />}

      <ConfirmDialog
        open={!!deleting}
        title="Eliminar flashcard"
        text={deleting ? `¿Eliminar "${deleting.front}"? Se pierde también su historial de repaso.` : ""}
        confirmLabel="Eliminar"
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
