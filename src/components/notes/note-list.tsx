"use client";

import clsx from "clsx";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { FilePlus, Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { db } from "@/lib/db";
import type { Note } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { createNote } from "./note-utils";
import { t } from "@/lib/i18n";

// Lista de apuntes de la materia, agrupada por unidad (notes ya viene ordenada).
export function NoteList({
  subjectId,
  notes,
  selectedId,
  onSelect,
}: {
  subjectId: string;
  notes: Note[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Note | null>(null);

  const groups = useMemo(() => {
    const map = new Map<number, Note[]>();
    for (const n of notes) map.set(n.unitNumber, [...(map.get(n.unitNumber) ?? []), n]);
    return [...map.entries()];
  }, [notes]);

  const selectedNote = notes.find((n) => n.id === selectedId);
  const lastUnit = notes.length ? notes[notes.length - 1].unitNumber : 1;
  const defaultUnit = selectedNote?.unitNumber ?? lastUnit;

  const remove = async () => {
    if (!deleting) return;
    await db.notes.delete(deleting.id);
    setDeleting(null);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-2">
      <button type="button" className="btn btn-sm w-full" onClick={() => setCreating(true)}>
        <FilePlus />
        {t("Nuevo apunte")}
      </button>

      {notes.length === 0 && (
        <p className="t-small px-2 py-3 text-muted">{t("Todavía no hay apuntes en esta materia.")}</p>
      )}

      {groups.map(([unit, items]) => (
        <section key={unit} className="flex flex-col gap-0.5">
          <h3 className="t-label px-2 pt-3 pb-1">{t("Unidad {unit}", { unit })}</h3>
          <ul className="flex flex-col gap-0.5">
            {items.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                active={note.id === selectedId}
                onSelect={() => onSelect(note.id)}
                onDelete={() => setDeleting(note)}
              />
            ))}
          </ul>
        </section>
      ))}

      {creating && (
        <NewNoteModal
          subjectId={subjectId}
          defaultUnit={defaultUnit}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onSelect(id);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t("Eliminar apunte")}
        text={
          deleting
            ? t("¿Eliminar \"{title}\"? Se borra el texto del apunte. Las flashcards que se generaron desde él se mantienen. Esta acción no se puede deshacer.", { title: deleting.title })
            : ""
        }
        confirmLabel={t("Eliminar apunte")}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function NoteRow({
  note,
  active,
  onSelect,
  onDelete,
}: {
  note: Note;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.title);
  // Evita guardar dos veces cuando Enter y el blur ocurren juntos.
  const finished = useRef(false);

  const startEdit = () => {
    finished.current = false;
    setDraft(note.title);
    setEditing(true);
  };

  const commit = async () => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const title = draft.trim() || t("Sin título");
    if (title !== note.title) await db.notes.update(note.id, { title });
  };

  const cancel = () => {
    finished.current = true;
    setEditing(false);
  };

  return (
    <li className="flex items-center gap-1">
      {editing ? (
        <input
          className="input min-w-0 flex-1"
          value={draft}
          autoFocus
          aria-label={t("Título del apunte")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") cancel();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={startEdit}
          aria-current={active ? "true" : undefined}
          className={clsx(
            "min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left t-small",
            active ? "bg-primary-tint text-primary-soft" : "text-text hover:bg-surface-raised",
          )}
        >
          {note.title}
        </button>
      )}
      {!editing && (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            aria-label={t("Renombrar apunte")}
            onClick={startEdit}
          >
            <Pencil />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            aria-label={t("Eliminar apunte")}
            onClick={onDelete}
          >
            <Trash2 />
          </button>
        </>
      )}
    </li>
  );
}

function NewNoteModal({
  subjectId,
  defaultUnit,
  onClose,
  onCreated,
}: {
  subjectId: string;
  defaultUnit: number;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [unit, setUnit] = useState(String(defaultUnit));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const unitNumber = Math.max(1, Math.floor(Number(unit) || 1));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const id = await createNote({ subjectId, title, unitNumber });
      onCreated(id);
    } catch {
      setError(t("No pudimos crear el apunte. Probá de nuevo."));
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Nuevo apunte")}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button type="submit" form="new-note-form" className="btn btn-primary" disabled={saving}>
            {t("Crear apunte")}
          </button>
        </>
      }
    >
      <form id="new-note-form" onSubmit={submit} className="flex flex-col gap-4">
        <label className="field">
          <span>{t("Título")}</span>
          <input
            className="input"
            value={title}
            autoFocus
            placeholder={t("Ej: Clase 3, Derivadas")}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t("Unidad")}</span>
          <input
            type="number"
            min={1}
            className="input num"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
        </label>
        <p className="t-small text-muted">{t("Si la unidad todavía no existe, se crea sola.")}</p>
        {error && <p className="t-small text-rose">{error}</p>}
      </form>
    </Modal>
  );
}
