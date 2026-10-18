"use client";

import { useMemo } from "react";
import { mentionLine, mentionsPhrase } from "@/lib/panes/note-data";
import { useActiveNoteId, useAllNotes, useNote } from "@/lib/panes/hooks";
import type { Note } from "@/lib/types";
import { NoteRow, PaneBlank, PaneEmpty, PaneSection, useNoteActions } from "./pane-ui";

interface Hit {
  note: Note;
  line?: string;
}

// Menciones de la nota activa: quién la enlaza y quién la nombra sin enlazarla.
export function BacklinksPane() {
  const noteId = useActiveNoteId();
  const note = useNote(noteId);
  const notes = useAllNotes();
  const actions = useNoteActions();

  const { linked, unlinked } = useMemo(() => {
    const linked: Hit[] = [];
    const unlinked: Hit[] = [];
    if (!note) return { linked, unlinked };
    const names = [note.title, ...(note.aliases ?? [])].map((s) => s.trim()).filter(Boolean);
    for (const other of notes) {
      if (other.id === note.id) continue;
      const text = other.plainTextCache ?? "";
      const lineFor = () => {
        for (const name of names) {
          const line = mentionLine(text, name);
          if (line) return line;
        }
        return undefined;
      };
      if (other.links?.includes(note.id)) {
        linked.push({ note: other, line: lineFor() });
      } else if (names.some((name) => mentionsPhrase(text, name))) {
        unlinked.push({ note: other, line: lineFor() });
      }
    }
    const byTitle = (a: Hit, b: Hit) => a.note.title.localeCompare(b.note.title, "es");
    return { linked: linked.sort(byTitle), unlinked: unlinked.sort(byTitle) };
  }, [note, notes]);

  if (!note) return <PaneBlank>Abrí una nota para ver quién la menciona</PaneBlank>;

  return (
    <div className="p-2">
      <PaneSection title="Enlazadas" count={linked.length}>
        {linked.length === 0 && <PaneEmpty>Sin menciones</PaneEmpty>}
        {linked.map((h) => (
          <NoteRow
            key={h.note.id}
            note={h.note}
            detail={h.line}
            onOpen={(e) => actions.openNote(h.note.id, e)}
            onMenu={(e) => actions.noteMenu(h.note.id, e)}
          />
        ))}
      </PaneSection>
      <PaneSection title="Sin enlazar" count={unlinked.length}>
        {unlinked.length === 0 && <PaneEmpty>Sin menciones</PaneEmpty>}
        {unlinked.map((h) => (
          <NoteRow
            key={h.note.id}
            note={h.note}
            detail={h.line}
            onOpen={(e) => actions.openNote(h.note.id, e)}
            onMenu={(e) => actions.noteMenu(h.note.id, e)}
          />
        ))}
      </PaneSection>
      {actions.menu}
    </div>
  );
}
