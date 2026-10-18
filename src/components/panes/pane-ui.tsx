"use client";

// Piezas comunes de los paneles de la barra derecha.

import { useState, type MouseEvent, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { useOpen } from "@/components/workspace/use-open";
import { useWorkspace, type OpenMode, type ViewState } from "@/lib/workspace";
import { noteTitle } from "@/lib/panes/note-data";
import type { Note } from "@/lib/types";

export const FIELD_CLASS =
  "h-7 w-full rounded-md border border-border bg-surface-raised px-2 text-[length:calc(13px*var(--ui-scale,1))] text-text outline-none placeholder:text-faint hover:border-border-strong focus:border-primary";

// Todos los paneles de la barra derecha usan el mismo margen: 8 px del contenedor + 8 px de cada fila = 16 px.
export function PaneEmpty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-2 t-small text-faint">{children}</p>;
}

// Panel sin nada que mostrar (por ejemplo, sin nota abierta): el mensaje va centrado.
export function PaneBlank({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[200px] items-center justify-center p-6 text-center t-small text-faint">{children}</div>;
}

export function PaneSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="py-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-full items-center gap-1.5 rounded-sm px-2 text-left hover:bg-surface-raised"
      >
        <ChevronRight className={clsx("h-3.5 w-3.5 flex-none text-faint transition-transform", open && "rotate-90")} strokeWidth={1.75} />
        <span className="section-label px-0! flex-1">{title}</span>
        <span className="num text-[length:calc(12px*var(--ui-scale,1))] text-faint">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// Fila de nota: título y, si hay, una línea de detalle (fragmento o materia).
export function NoteRow({
  note,
  detail,
  onOpen,
  onMenu,
}: {
  note: Note;
  detail?: string;
  onOpen: (e: MouseEvent) => void;
  onMenu: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onMenu}
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left hover:bg-surface-raised"
    >
      <span className="w-full truncate text-[length:calc(13px*var(--ui-scale,1))] text-text">{noteTitle(note)}</span>
      {detail && <span className="w-full truncate text-[length:calc(12px*var(--ui-scale,1))] text-faint">{detail}</span>}
    </button>
  );
}

// Menú contextual estándar para abrir una vista de cualquier fila.
export function viewMenuItems(view: ViewState, openView: (v: ViewState, mode?: OpenMode) => void): MenuItem[] {
  return [
    { label: "Abrir", onSelect: () => openView(view) },
    { label: "Abrir en pestaña nueva", onSelect: () => openView(view, "tab") },
    { label: "Abrir en panel dividido", onSelect: () => openView(view, "split") },
  ];
}

// Acciones de una fila de nota: abrir (con modificadores) y menú contextual.
export function useNoteActions() {
  const { openView } = useWorkspace();
  const open = useOpen();
  const ctx = useContextMenu();
  return {
    openNote: (id: string, e: MouseEvent) => open({ type: "nota", id }, e),
    noteMenu: (id: string, e: MouseEvent) => ctx.open(e, viewMenuItems({ type: "nota", id }, openView)),
    menu: ctx.menu,
  };
}
