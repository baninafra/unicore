"use client";

import { createPortal } from "react-dom";
import clsx from "clsx";
import type { PdfHighlight } from "@/lib/types";
import { HL_COLORS, HL_ORDER } from "./pdf-engine";

interface Props {
  x: number;
  y: number;
  below?: boolean; // si no hay lugar arriba de la selección, el menú va debajo
  onColor: (color: PdfHighlight["color"]) => void;
  onCopy: () => void;
  onNote: () => void;
}

// Mini menú que aparece al seleccionar texto: colores de resaltado, cita y nota.
// Los clics no le quitan la selección al texto (mousedown se cancela).
export function PdfSelectionMenu({ x, y, below, onColor, onCopy, onNote }: Props) {
  return createPortal(
    <div
      role="toolbar"
      aria-label="Resaltar selección"
      className={clsx(
        "fixed z-[60] flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-pop",
        !below && "-translate-y-full",
      )}
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {HL_ORDER.map((c) => (
        <button
          key={c}
          type="button"
          title={HL_COLORS[c].label}
          aria-label={`Resaltar en ${HL_COLORS[c].label.toLowerCase()}`}
          onClick={() => onColor(c)}
          className="h-5 w-5 rounded-sm border border-black/10"
          style={{ background: HL_COLORS[c].solid }}
        />
      ))}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      <button type="button" className="btn btn-sm btn-ghost" onClick={onCopy}>
        Copiar como cita
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={onNote}>
        Agregar nota
      </button>
    </div>,
    document.body,
  );
}
