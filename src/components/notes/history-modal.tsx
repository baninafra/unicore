"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Modal } from "@/components/ui/modal";
import { shortDateTime } from "@/lib/format";
import { db } from "@/lib/db";
import type { NoteSnapshot } from "@/lib/types";

// Copias de recuperación de una nota: lista de fechas a la izquierda, texto a la derecha.
export function HistoryModal({
  noteId,
  onClose,
  onRestore,
}: {
  noteId: string;
  onClose: () => void;
  onRestore: (snapshot: NoteSnapshot) => void;
}) {
  const snaps = useLiveQuery(() => db.snapshots.where("noteId").equals(noteId).toArray(), [noteId]);
  const sorted = useMemo(() => [...(snaps ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [snaps]);
  const [picked, setPicked] = useState<string>();
  const selected = sorted.find((s) => s.id === picked) ?? sorted[0];

  return (
    <Modal
      open
      onClose={onClose}
      title="Historial de versiones"
      width={860}
      footer={
        selected && (
          <button type="button" className="btn btn-primary" onClick={() => onRestore(selected)}>
            Restaurar
          </button>
        )
      }
    >
      {snaps === undefined ? null : !sorted.length ? (
        <p className="t-small text-faint">Sin versiones todavía.</p>
      ) : (
        <div className="flex min-h-[320px] gap-4">
          <div className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto">
            {sorted.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === selected?.id}
                className={clsx("row w-full text-left", s.id === selected?.id && "bg-surface-raised text-text")}
                onClick={() => setPicked(s.id)}
              >
                <span className="num">{shortDateTime(s.createdAt)}</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            {selected && (
              <>
                <div className="t-h3 mb-2">{selected.title}</div>
                <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted">
                  {selected.plainText || "Vacía"}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
