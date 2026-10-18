"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { useOpen } from "@/components/workspace/use-open";
import { db } from "@/lib/db";
import type { Note } from "@/lib/types";
import { createNote } from "./note-utils";
import type { NoteBlockEditor } from "./note-schema";

const PREVIEW_DELAY_MS = 300;
const PREVIEW_LINES = 12;

// Enlace [[nota]] dentro del editor. Clic abre la nota; pasar el mouse muestra una vista previa.
export function WikilinkChip({ noteId, title, alias }: { noteId: string; title: string; alias: string }) {
  const open = useOpen();
  const target = useLiveQuery(() => (noteId ? db.notes.get(noteId) : undefined), [noteId]);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const exists = !!target;
  const label = alias || target?.title || title || "Sin título";

  const onEnter = (e: MouseEvent<HTMLSpanElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchor(rect), PREVIEW_DELAY_MS);
  };
  const onLeave = () => {
    clearTimeout(timer.current);
    setAnchor(null);
  };
  const onClick = (e: MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setAnchor(null);
    // Si la nota no existe, buscamos el texto del enlace en vez de crear algo sin avisar.
    open(exists ? { type: "nota", id: noteId } : { type: "busqueda", query: title }, e);
  };

  return (
    <>
      <span
        className={exists ? "wikilink" : "wikilink-unresolved"}
        role="link"
        onClick={onClick}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {label}
      </span>
      {anchor && target && <WikilinkPreview note={target} rect={anchor} />}
    </>
  );
}

function WikilinkPreview({ note, rect }: { note: Note; rect: DOMRect }) {
  const lines = note.plainTextCache.split("\n").slice(0, PREVIEW_LINES).join("\n");
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 336));
  const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
  return createPortal(
    <div
      className="pointer-events-none fixed z-[55] w-80 rounded-md border border-border bg-surface p-3 shadow-pop"
      style={{ left, top }}
    >
      <div className="text-[length:calc(13px*var(--ui-scale,1))] font-semibold text-text">{note.title}</div>
      {lines && <div className="mt-1.5 whitespace-pre-wrap text-[length:calc(12px*var(--ui-scale,1))] leading-relaxed text-muted">{lines}</div>}
    </div>,
    document.body,
  );
}

// Reemplaza el "[[" que dejó el menú por un enlace real (el menú ya borró la consulta).
export function insertWikilink(editor: NoteBlockEditor, noteId: string, title: string, alias = "") {
  editor.transact((tr) => {
    const { from } = tr.selection;
    if (from >= 2 && tr.doc.textBetween(from - 2, from) === "[[") tr.delete(from - 2, from);
  });
  editor.insertInlineContent([
    { type: "wikilink", props: { noteId, title, alias } },
    { type: "text", text: " ", styles: {} },
  ]);
}

// Opciones del menú "[[": notas por título o alias, y "Crear nota" si no existe.
export async function wikilinkMenuItems(
  editor: NoteBlockEditor,
  ctx: { noteId: string; subjectId: string; unitNumber: number },
  query: string,
): Promise<DefaultReactSuggestionItem[]> {
  const q = query.trim().toLowerCase();
  const all = await db.notes.toArray();
  const found = all
    .filter(
      (n) =>
        n.id !== ctx.noteId &&
        (!q || n.title.toLowerCase().includes(q) || (n.aliases ?? []).some((a) => a.toLowerCase().includes(q))),
    )
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 8);

  const items: DefaultReactSuggestionItem[] = found.map((n) => ({
    title: n.title || "Sin título",
    onItemClick: () => insertWikilink(editor, n.id, n.title),
  }));

  const name = query.trim();
  if (name && !all.some((n) => n.title.toLowerCase() === name.toLowerCase())) {
    items.push({
      title: `Crear nota «${name}»`,
      subtext: "Nota nueva",
      onItemClick: () => {
        void createNote({ subjectId: ctx.subjectId, title: name, unitNumber: ctx.unitNumber }).then((id) =>
          insertWikilink(editor, id, name),
        );
      },
    });
  }
  return items;
}
