"use client";

import { useMemo } from "react";
import { t } from "@/lib/i18n";
import { useSubjectMap } from "@/lib/hooks";
import { folderLabel, wikilinksOf } from "@/lib/panes/note-data";
import { useActiveNoteId, useAllNotes, useNote } from "@/lib/panes/hooks";
import type { Note } from "@/lib/types";
import { NoteRow, PaneBlank, PaneEmpty, PaneSection, useNoteActions } from "./pane-ui";

// Enlaces salientes de la nota activa: notas a las que enlaza y wikilinks sin resolver.
export function OutgoingPane() {
  const noteId = useActiveNoteId();
  const note = useNote(noteId);
  const notes = useAllNotes();
  const subjects = useSubjectMap();
  const actions = useNoteActions();

  const { resolved, unresolved } = useMemo(() => {
    if (!note) return { resolved: [] as Note[], unresolved: [] as string[] };
    const byId = new Map(notes.map((n) => [n.id, n]));
    const resolved = (note.links ?? [])
      .map((id) => byId.get(id))
      .filter((n): n is Note => !!n && n.id !== note.id);

    const seen = new Set<string>();
    const unresolved: string[] = [];
    for (const ref of wikilinksOf(note.content)) {
      if (ref.noteId && byId.has(ref.noteId)) continue;
      const key = ref.text.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unresolved.push(ref.text);
    }
    return { resolved, unresolved };
  }, [note, notes]);

  if (!note) return <PaneBlank>{t("Abrí una nota para ver sus enlaces")}</PaneBlank>;

  return (
    <div className="p-2">
      <PaneSection title={t("Enlaces")} count={resolved.length}>
        {resolved.length === 0 && <PaneEmpty>{t("Sin enlaces salientes")}</PaneEmpty>}
        {resolved.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            detail={folderLabel(n.subjectId, subjects)}
            onOpen={(e) => actions.openNote(n.id, e)}
            onMenu={(e) => actions.noteMenu(n.id, e)}
          />
        ))}
      </PaneSection>
      <PaneSection title={t("Sin resolver")} count={unresolved.length}>
        {unresolved.length === 0 && <PaneEmpty>{t("Sin enlaces sin resolver")}</PaneEmpty>}
        {unresolved.map((text) => (
          <p key={text} className="truncate px-2 py-1.5 text-[length:calc(13px*var(--ui-scale,1))] wikilink-unresolved">
            [[{text}]]
          </p>
        ))}
      </PaneSection>
      {actions.menu}
    </div>
  );
}
