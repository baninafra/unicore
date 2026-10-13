"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { DAILY_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Note, type Subject, type SubjectDocument } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { CARD_COLORS, type CardColor } from "./canvas-types";

const NO_NOTES: Note[] = [];
const NO_SUBJECTS: Subject[] = [];
const NO_DOCS: SubjectDocument[] = [];
const MAX_ROWS = 200;

export type PickedItem = { kind: "nota"; id: string; name: string } | { kind: "pdf"; id: string; name: string };

// Elegir una nota (o un PDF) para poner en el lienzo.
export function ItemPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: PickedItem) => void;
}) {
  const [query, setQuery] = useState("");
  const notes = useLiveQuery(() => db.notes.toArray(), [], NO_NOTES) ?? NO_NOTES;
  const docs = useLiveQuery(() => db.documents.toArray(), [], NO_DOCS) ?? NO_DOCS;
  const subjects = useLiveQuery(() => db.subjects.toArray(), [], NO_SUBJECTS) ?? NO_SUBJECTS;

  const subjectName = useMemo(() => {
    const map: Record<string, string> = { [DAILY_FOLDER]: "Diario", [LOOSE_FOLDER]: "Notas sueltas" };
    for (const s of subjects) map[s.id] = s.name;
    return map;
  }, [subjects]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const q = query.trim().toLocaleLowerCase("es");
  const filteredNotes = useMemo(
    () =>
      notes
        .filter((n) => n.subjectId !== TEMPLATES_FOLDER)
        .filter((n) => !q || (n.title || "").toLocaleLowerCase("es").includes(q))
        .sort((a, b) => (a.title || "").localeCompare(b.title || "", "es"))
        .slice(0, MAX_ROWS),
    [notes, q],
  );
  const filteredDocs = useMemo(
    () =>
      docs
        .filter((d) => !q || d.fileName.toLocaleLowerCase("es").includes(q))
        .sort((a, b) => a.fileName.localeCompare(b.fileName, "es"))
        .slice(0, MAX_ROWS),
    [docs, q],
  );

  const pick = (item: PickedItem) => {
    onPick(item);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Agregar al lienzo" width={480}>
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          className="input h-8"
          placeholder="Buscar nota o PDF"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex max-h-[360px] flex-col overflow-y-auto">
          {filteredNotes.length > 0 && <div className="section-label pt-1">Notas</div>}
          {filteredNotes.map((n) => (
            <button key={n.id} type="button" className="row w-full text-left" onClick={() => pick({ kind: "nota", id: n.id, name: n.title || "Sin título" })}>
              <span className="flex-1 truncate">{n.title?.trim() || "Sin título"}</span>
              <span className="truncate text-[12px] text-faint">{subjectName[n.subjectId] ?? ""}</span>
            </button>
          ))}
          {filteredDocs.length > 0 && <div className="section-label pt-2">PDF</div>}
          {filteredDocs.map((d) => (
            <button key={d.id} type="button" className="row w-full text-left" onClick={() => pick({ kind: "pdf", id: d.id, name: d.fileName })}>
              <span className="flex-1 truncate">{d.fileName}</span>
              <span className="truncate text-[12px] text-faint">{subjectName[d.subjectId] ?? ""}</span>
            </button>
          ))}
          {filteredNotes.length === 0 && filteredDocs.length === 0 && (
            <div className="px-2 py-3 t-small text-faint">Sin resultados</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Muestrario de colores de una tarjeta. Se cierra con Esc o clic afuera.
export function ColorPopover({
  x,
  y,
  value,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  value: CardColor | undefined;
  onPick: (color: CardColor) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] flex gap-1.5 rounded-md border border-border bg-surface p-1.5 shadow-pop"
      style={{ left: x, top: y }}
    >
      {CARD_COLORS.map((c) => (
        <button
          key={c.key || "none"}
          type="button"
          role="menuitem"
          title={c.label}
          aria-label={c.label}
          onClick={() => {
            onPick(c.key);
            onClose();
          }}
          className={clsx("h-5 w-5 rounded-sm border", c.key === (value ?? "") && "ring-2 ring-primary")}
          style={{ background: c.bg || "var(--surface-raised)", borderColor: c.border || "var(--border-strong)" }}
        />
      ))}
    </div>,
    document.body,
  );
}
