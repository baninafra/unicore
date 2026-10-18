"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import { blockOwnText, type BlockLike } from "@/lib/notes/index-note";
import { db } from "@/lib/db";
import { useWorkspace } from "@/lib/workspace";

interface Line {
  kind: "h1" | "h2" | "h3" | "p" | "li" | "sep";
  text: string;
}

// Aplana los bloques en líneas con su tipo (los hijos van después de su bloque).
function flatten(blocks: BlockLike[]): Line[] {
  const out: Line[] = [];
  for (const b of blocks) {
    const text = blockOwnText(b);
    if (b.type === "heading") {
      const level = Number(b.props?.level ?? 1);
      if (text) out.push({ kind: level <= 1 ? "h1" : level === 2 ? "h2" : "h3", text });
    } else if (text === "---" && b.type === "paragraph") {
      out.push({ kind: "sep", text: "" });
    } else if (text) {
      out.push({ kind: b.type?.includes("ListItem") ? "li" : "p", text });
    }
    if (b.children?.length) out.push(...flatten(b.children));
  }
  return out;
}

// Diapositivas: separadas por "---" si hay; si no, cada título de nivel 1 o 2 abre una nueva.
export function buildSlides(blocks: BlockLike[]): Line[][] {
  const lines = flatten(blocks);
  const hasSeparators = lines.some((l) => l.kind === "sep");
  const slides: Line[][] = [];
  let current: Line[] = [];
  const push = () => {
    if (current.length) slides.push(current);
    current = [];
  };
  for (const line of lines) {
    if (line.kind === "sep") {
      push();
      continue;
    }
    const startsNew = !hasSeparators && (line.kind === "h1" || line.kind === "h2");
    if (startsNew) push();
    current.push(line);
  }
  push();
  return slides;
}

const SIZE: Record<Line["kind"], string> = {
  h1: "text-[56px] font-semibold leading-tight text-text",
  h2: "text-[42px] font-semibold leading-snug text-text",
  h3: "text-[32px] font-semibold text-muted",
  p: "text-[28px] leading-relaxed text-text",
  li: "text-[28px] leading-relaxed text-text",
  sep: "",
};

// Presentación de una nota a pantalla completa dentro de la pestaña.
export function SlidesView({ id }: { id: string }) {
  const note = useLiveQuery(async () => (await db.notes.get(id)) ?? null, [id]);
  const slides = useMemo(() => (note ? buildSlides((note.content ?? []) as BlockLike[]) : []), [note]);
  const [index, setIndex] = useState(0);
  const { openView } = useWorkspace();
  const last = Math.max(0, slides.length - 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") openView({ type: "nota", id });
      else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) setIndex((i) => Math.min(last, i + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(last);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, last, openView]);

  if (note === undefined) return <div className="p-6 t-small text-faint">Cargando…</div>;
  if (note === null) return <div className="p-6 t-small text-faint">Esta nota ya no existe.</div>;
  if (!slides.length) {
    return <div className="p-6 t-small text-faint">La nota no tiene contenido.</div>;
  }

  const current = slides[Math.min(index, last)];

  return (
    <div className="relative flex h-full min-h-[70vh] w-full flex-col bg-bg text-text">
      <button
        type="button"
        className="icon-btn absolute right-3 top-3"
        aria-label="Salir de la presentación"
        onClick={() => openView({ type: "nota", id })}
      >
        <X />
      </button>

      <div className="flex flex-1 items-center justify-center px-16 py-12">
        <div className="flex w-full max-w-[960px] flex-col gap-5 text-center">
          {current.map((line, i) =>
            line.kind === "li" ? (
              <div key={i} className={SIZE.li}>
                <span className="mr-3 text-muted">•</span>
                {line.text}
              </div>
            ) : (
              <div key={i} className={SIZE[line.kind]}>
                {line.text}
              </div>
            ),
          )}
        </div>
      </div>

      <div className="num pb-4 text-center text-[length:calc(13px*var(--ui-scale,1))] text-faint">
        {Math.min(index, last) + 1} / {slides.length}
      </div>
    </div>
  );
}
