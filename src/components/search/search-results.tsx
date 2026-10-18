"use client";

import { useCallback } from "react";
import { CheckSquare, FileText, NotebookPen, Shapes, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { useAppState } from "@/lib/app-state";
import { useOpen } from "@/components/workspace/use-open";
import { plainTextOf } from "@/components/notes/note-utils";
import { foldText } from "@/lib/nav/fold";
import { gotoBlock, type ModifierEvent } from "@/lib/nav/actions";
import { type Fragment, type Mark, type SearchHit, type SortMode } from "@/lib/nav/search";
import { Select } from "@/components/ui/select";

const KIND_ICON: Record<SearchHit["doc"]["kind"], LucideIcon> = {
  note: NotebookPen,
  document: FileText,
  canvas: Shapes,
  task: CheckSquare,
};

// Une coincidencias que se pisan para pintar cada parte una sola vez.
function mergeMarks(marks: Mark[]): Mark[] {
  const sorted = [...marks].sort((a, b) => a.from - b.from);
  const out: Mark[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m.from <= last.to) last.to = Math.max(last.to, m.to);
    else out.push({ ...m });
  }
  return out;
}

export function Highlighted({ text, marks }: { text: string; marks: Mark[] }) {
  // Los saltos de línea pasan a espacio: el largo no cambia, así las marcas siguen valiendo.
  const clean = text.replace(/\s/g, " ");
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of mergeMarks(marks)) {
    if (m.from > pos) parts.push(clean.slice(pos, m.from));
    parts.push(
      <mark key={m.from} className="bg-primary-tint text-text">
        {clean.slice(m.from, m.to)}
      </mark>,
    );
    pos = m.to;
  }
  if (pos < clean.length) parts.push(clean.slice(pos));
  return <>{parts}</>;
}

export function SortSelect({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  return (
    <Select className="input" aria-label="Ordenar resultados" value={value} onChange={(e) => onChange(e.target.value as SortMode)}>
      <option value="relevancia">Más coincidencias</option>
      <option value="nombre">Nombre</option>
      <option value="modificacion">Modificación</option>
    </Select>
  );
}

type BlockRef = { id?: string; content?: unknown; children?: BlockRef[] };

// Bloque de BlockNote que contiene el texto (busca primero en el nivel de arriba, después dentro).
function findBlockId(blocks: BlockRef[], needle: string): string | undefined {
  for (const b of blocks) {
    const own = plainTextOf([{ content: b.content }]);
    if (own && foldText(own).includes(needle)) return b.id;
    const inner = b.children ? findBlockId(b.children, needle) : undefined;
    if (inner) return inner;
  }
  return undefined;
}

// Abre un resultado: notas (y el bloque del fragmento si se puede), PDFs, lienzos o tareas.
export function useOpenHit() {
  const open = useOpen();
  const { openTaskDialog } = useAppState();
  return useCallback(
    (hit: SearchHit, fragment?: Fragment, e?: ModifierEvent) => {
      const doc = hit.doc;
      if (doc.kind === "task") {
        if (doc.task) openTaskDialog(doc.task);
        return;
      }
      if (doc.kind === "document") return open({ type: "pdf", id: doc.id }, e);
      if (doc.kind === "canvas") return open({ type: "canvas", id: doc.id }, e);
      open({ type: "nota", id: doc.id }, e);
      const mark = fragment?.marks[0];
      if (!fragment || !mark) return;
      const needle = foldText(fragment.text.slice(mark.from, mark.to));
      if (!needle) return;
      void db.notes.get(doc.id).then((note) => {
        const blockId = note ? findBlockId(note.content as BlockRef[], needle) : undefined;
        if (blockId) gotoBlock(doc.id, blockId);
      });
    },
    [open, openTaskDialog],
  );
}

// Lista de resultados agrupada por archivo: título con coincidencias, materia y fragmentos.
export function SearchResults({
  hits,
  query,
  onOpen,
}: {
  hits: SearchHit[];
  query: string;
  onOpen: (hit: SearchHit, fragment?: Fragment, e?: ModifierEvent) => void;
}) {
  if (!hits.length) {
    return query.trim() ? <p className="px-2 py-3 text-[length:calc(13px*var(--ui-scale,1))] text-faint">Sin resultados</p> : null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {hits.map((hit) => {
        const Icon = KIND_ICON[hit.doc.kind];
        const meta = [hit.doc.subjectName, hit.doc.unit !== undefined ? `Unidad ${hit.doc.unit}` : ""].filter(Boolean).join(" · ");
        return (
          <div key={hit.doc.key} className="flex flex-col">
            <button type="button" className="row w-full text-left" onClick={(e) => onOpen(hit, undefined, e)}>
              <Icon strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-text">
                <Highlighted text={hit.doc.title} marks={hit.titleMarks} />
              </span>
              {hit.count > 0 && <span className="num shrink-0 text-[length:calc(12px*var(--ui-scale,1))] text-faint">{hit.count}</span>}
            </button>
            {meta && <div className="truncate pl-7 text-[length:calc(12px*var(--ui-scale,1))] text-faint">{meta}</div>}
            {hit.fragments.map((f, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => onOpen(hit, f, e)}
                className="mb-0.5 ml-7 mr-1 rounded-sm px-1.5 py-1 text-left text-[length:calc(12px*var(--ui-scale,1))] leading-snug text-muted hover:bg-surface-raised hover:text-text"
              >
                {f.lead && "… "}
                <Highlighted text={f.text} marks={f.marks} />
                {f.trail && " …"}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
