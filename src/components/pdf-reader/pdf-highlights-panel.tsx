"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { PdfHighlight } from "@/lib/types";
import { HL_COLORS } from "./pdf-engine";
import { t } from "@/lib/i18n";

interface Props {
  highlights: PdfHighlight[];
  onGoTo: (page: number) => void;
  onNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  editId: string | null;
  onEditDone: () => void;
}

// Panel lateral con los resaltados agrupados por página. Clic salta a la página; se puede editar la nota y borrar.
export function PdfHighlightsPanel({ highlights, onGoTo, onNote, onDelete, editId, onEditDone }: Props) {
  const sorted = [...highlights].sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
  const groups: { page: number; items: PdfHighlight[] }[] = [];
  for (const h of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.page === h.page) last.items.push(h);
    else groups.push({ page: h.page, items: [h] });
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="section-label">{t("Resaltados · {n}", { n: highlights.length })}</div>
      {groups.length === 0 && <div className="px-2 py-2 t-small text-faint">{t("Sin resaltados")}</div>}
      {groups.map((g) => (
        <div key={g.page} className="flex flex-col">
          <button type="button" className="row h-6 justify-start text-[length:calc(12px*var(--ui-scale,1))] text-faint" onClick={() => onGoTo(g.page)}>
            {t("Página {page}", { page: g.page })}
          </button>
          {g.items.map((h) => (
            <HighlightItem
              key={h.id}
              highlight={h}
              editing={editId === h.id}
              onGoTo={() => onGoTo(h.page)}
              onNote={(note) => onNote(h.id, note)}
              onDelete={() => onDelete(h.id)}
              onEditDone={onEditDone}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function HighlightItem({
  highlight: h,
  editing,
  onGoTo,
  onNote,
  onDelete,
  onEditDone,
}: {
  highlight: PdfHighlight;
  editing: boolean;
  onGoTo: () => void;
  onNote: (note: string) => void;
  onDelete: () => void;
  onEditDone: () => void;
}) {
  const [draft, setDraft] = useState(h.note ?? "");
  const [editingNow, setEditingNow] = useState(false);
  const discard = useRef(false);
  const showEditor = editing || editingNow;

  const finish = (save: boolean) => {
    if (save && draft.trim() !== (h.note ?? "").trim()) onNote(draft.trim());
    setEditingNow(false);
    onEditDone();
  };

  return (
    <div className="group flex flex-col gap-1 border-l-2 py-1.5 pl-2" style={{ borderLeftColor: HL_COLORS[h.color].solid }}>
      <button type="button" className="line-clamp-3 text-left text-[length:calc(13px*var(--ui-scale,1))] leading-snug text-text" onClick={onGoTo} title={t("Ir a la página")}>
        {h.text}
      </button>

      {showEditor ? (
        <textarea
          autoFocus
          className="input min-h-[60px] text-[length:calc(12px*var(--ui-scale,1))]"
          value={draft}
          placeholder={t("Escribí una nota")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            finish(!discard.current);
            discard.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              discard.current = true;
              finish(false);
            }
          }}
        />
      ) : h.note ? (
        <p
          className="cursor-text whitespace-pre-line text-[length:calc(12px*var(--ui-scale,1))] leading-snug text-muted"
          onClick={() => {
            setDraft(h.note ?? "");
            setEditingNow(true);
          }}
        >
          {h.note}
        </p>
      ) : (
        <button
          type="button"
          className="self-start text-[length:calc(12px*var(--ui-scale,1))] text-faint hover:text-muted"
          onClick={() => {
            setDraft("");
            setEditingNow(true);
          }}
        >
          {t("Agregar nota")}
        </button>
      )}

      <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" className="icon-btn h-6 w-6" onClick={onDelete} aria-label={t("Borrar resaltado")} title={t("Borrar resaltado")}>
          <Trash2 strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
