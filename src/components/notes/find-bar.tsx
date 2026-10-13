"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

// Busca en el texto visible del editor. Resalta con la CSS Custom Highlight API si está disponible;
// si no, sólo selecciona la coincidencia actual. Reemplazar usa insertText para que el editor registre el cambio.

const HL_ALL = "uc-find";
const HL_CURRENT = "uc-find-current";

type HighlightRegistry = { set: (k: string, v: unknown) => void; delete: (k: string) => void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function highlightApi(): { registry: HighlightRegistry; Ctor: HighlightCtor } | null {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  return css?.highlights && Ctor ? { registry: css.highlights, Ctor } : null;
}

function collectRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent ?? "").toLowerCase();
    let i = text.indexOf(needle);
    while (i !== -1) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + needle.length);
      out.push(r);
      i = text.indexOf(needle, i + needle.length);
    }
    node = walker.nextNode();
  }
  return out;
}

function paint(ranges: Range[], current: number) {
  const api = highlightApi();
  if (!api) return;
  if (!ranges.length) {
    api.registry.delete(HL_ALL);
    api.registry.delete(HL_CURRENT);
    return;
  }
  api.registry.set(HL_ALL, new api.Ctor(...ranges));
  api.registry.set(HL_CURRENT, new api.Ctor(ranges[current]));
}

function selectRange(range: Range) {
  const host = range.startContainer.parentElement?.closest<HTMLElement>('[contenteditable="true"]');
  host?.focus();
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  range.startContainer.parentElement?.scrollIntoView({ block: "center" });
}

export function FindBar({
  rootRef,
  replace,
  onClose,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  replace: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [current, setCurrent] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const [showReplace, setShowReplace] = useState(replace);

  useEffect(() => {
    findInput.current?.focus();
    findInput.current?.select();
  }, [replace]);

  useEffect(() => {
    setShowReplace(replace);
  }, [replace]);

  const refresh = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = collectRanges(root, query);
    setRanges(next);
    setCurrent((c) => (next.length ? Math.min(c, next.length - 1) : 0));
  }, [query, rootRef]);

  // Recalcula al cambiar la búsqueda y cuando el texto del editor cambia.
  useEffect(() => {
    refresh();
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [refresh, rootRef]);

  useEffect(() => {
    paint(ranges, current);
    if (ranges[current]) ranges[current].startContainer.parentElement?.scrollIntoView({ block: "center" });
  }, [ranges, current]);

  useEffect(() => () => paint([], 0), []);

  const step = (dir: 1 | -1) => {
    if (!ranges.length) return;
    setCurrent((c) => (c + dir + ranges.length) % ranges.length);
  };

  const replaceOne = () => {
    const r = ranges[current];
    if (!r) return;
    selectRange(r);
    document.execCommand("insertText", false, replacement);
    requestAnimationFrame(refresh);
  };

  const replaceAll = () => {
    // De atrás hacia adelante para que las coincidencias anteriores sigan en su lugar.
    const list = [...ranges].reverse();
    for (const r of list) {
      if (!r.startContainer.isConnected) continue;
      selectRange(r);
      document.execCommand("insertText", false, replacement);
    }
    requestAnimationFrame(refresh);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, isReplaceField: boolean) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "Enter") {
      e.preventDefault();
      if (isReplaceField) replaceOne();
      else step(e.shiftKey ? -1 : 1);
    }
  };

  const counter = !query ? "" : ranges.length ? `${current + 1} de ${ranges.length}` : "Sin resultados";

  return (
    <div className="sticky top-0 z-20 -mx-1 mb-2 flex flex-col gap-1.5 rounded-md border border-border bg-surface p-2 shadow-pop">
      <div className="flex items-center gap-1.5">
        <button type="button" className="icon-btn" onClick={() => setShowReplace((v) => !v)} aria-label="Mostrar reemplazo">
          {showReplace ? <ChevronDown /> : <ChevronRight />}
        </button>
        <input
          ref={findInput}
          className="input h-7 min-w-0 flex-1 text-[13px]"
          placeholder="Buscar en la nota"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => onKey(e, false)}
        />
        <span className="t-small num whitespace-nowrap text-faint">{counter}</span>
        <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Anterior" disabled={!ranges.length}>
          <ChevronDown className="rotate-180" />
        </button>
        <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Siguiente" disabled={!ranges.length}>
          <ChevronDown />
        </button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar búsqueda">
          <X />
        </button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1.5 pl-7">
          <input
            className="input h-7 min-w-0 flex-1 text-[13px]"
            placeholder="Reemplazar con"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => onKey(e, true)}
          />
          <button type="button" className="btn btn-sm" onClick={replaceOne} disabled={!ranges.length}>
            Reemplazar
          </button>
          <button type="button" className="btn btn-sm" onClick={replaceAll} disabled={!ranges.length}>
            Reemplazar todo
          </button>
        </div>
      )}
    </div>
  );
}
