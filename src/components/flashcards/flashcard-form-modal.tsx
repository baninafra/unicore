"use client";

import clsx from "clsx";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { db } from "@/lib/db";
import type { Flashcard } from "@/lib/types";
import { t } from "@/lib/i18n";
import { newFlashcardRecord } from "./fsrs-card";

// Alta (sin `card`) o edición de una flashcard a mano.
export function FlashcardFormModal({
  subjectId,
  card,
  onClose,
}: {
  subjectId: string;
  card?: Flashcard;
  onClose: () => void;
}) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) {
      setError(t("Completá el frente y el dorso."));
      return;
    }
    setSaving(true);
    try {
      if (card) await db.flashcards.update(card.id, { front: f, back: b });
      else await db.flashcards.add(newFlashcardRecord({ subjectId, front: f, back: b }));
      onClose();
    } catch {
      setError(t("No pudimos guardar la flashcard. Probá de nuevo."));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={card ? t("Editar flashcard") : t("Nueva flashcard")}
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {card ? t("Guardar cambios") : t("Crear flashcard")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="field">
          <span>{t("Frente")}</span>
          <textarea
            className={clsx("input", error && !front.trim() && "input-error")}
            rows={3}
            value={front}
            onChange={(e) => setFront(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t("Dorso")}</span>
          <textarea
            className={clsx("input", error && !back.trim() && "input-error")}
            rows={3}
            value={back}
            onChange={(e) => setBack(e.target.value)}
          />
        </label>
        {error && <p className="t-small text-rose">{error}</p>}
      </div>
    </Modal>
  );
}
