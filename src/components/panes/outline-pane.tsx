"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { t } from "@/lib/i18n";
import { normalizeText } from "@/lib/ai/rag";
import { headingsOf } from "@/lib/panes/note-data";
import { useActiveNoteId, useNote } from "@/lib/panes/hooks";
import { FIELD_CLASS, PaneBlank, PaneEmpty } from "./pane-ui";

// Esquema de la nota activa. Clic en un encabezado: el editor de esa nota va a ese bloque.
export function OutlinePane() {
  const noteId = useActiveNoteId();
  const note = useNote(noteId);
  const [query, setQuery] = useState("");

  const headings = useMemo(() => (note ? headingsOf(note.content) : []), [note]);
  const needle = normalizeText(query).trim();
  const shown = needle ? headings.filter((h) => normalizeText(h.text).includes(needle)) : headings;

  if (!note) return <PaneBlank>{t("Abrí una nota para ver su esquema")}</PaneBlank>;

  const goTo = (blockId: string) => {
    window.dispatchEvent(new CustomEvent("uc:goto-block", { detail: { noteId: note.id, blockId } }));
  };

  return (
    <div className="space-y-2 p-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("Buscar encabezado")}
        aria-label={t("Buscar encabezado")}
        className={FIELD_CLASS}
      />
      {shown.length === 0 ? (
        <PaneEmpty>{headings.length === 0 ? t("Sin encabezados") : t("Sin resultados")}</PaneEmpty>
      ) : (
        <div>
          {shown.map((h) => (
            <button
              key={h.id}
              type="button"
              title={h.text}
              onClick={() => goTo(h.id)}
              className="row w-full min-w-0 text-left"
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
            >
              <span className={clsx("truncate text-[length:calc(13px*var(--ui-scale,1))]", h.level <= 2 ? "text-text" : "text-muted")}>{h.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
