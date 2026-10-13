"use client";

import { FileText, Frame, Globe, ImagePlus, Plus } from "lucide-react";

// Barra flotante abajo al centro con las acciones para agregar tarjetas.
export function CanvasToolbar({
  onText,
  onNote,
  onImage,
  onWeb,
  onGroup,
}: {
  onText: () => void;
  onNote: () => void;
  onImage: () => void;
  onWeb: () => void;
  onGroup: () => void;
}) {
  const items = [
    { label: "Agregar tarjeta", icon: Plus, onClick: onText },
    { label: "Agregar nota o PDF", icon: FileText, onClick: onNote },
    { label: "Agregar imagen", icon: ImagePlus, onClick: onImage },
    { label: "Agregar web", icon: Globe, onClick: onWeb },
    { label: "Agregar grupo", icon: Frame, onClick: onGroup },
  ];
  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border bg-surface p-1 shadow-pop">
      {items.map((it) => (
        <button key={it.label} type="button" className="icon-btn" aria-label={it.label} title={it.label} onClick={it.onClick}>
          <it.icon strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}
