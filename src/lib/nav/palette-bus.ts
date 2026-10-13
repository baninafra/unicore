// Eventos para abrir la paleta (comandos, selector o una lista) y enfocar la búsqueda desde cualquier parte.
import type { ModifierEvent } from "./actions";

export type PaletteMode = "commands" | "quick" | "list";

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  match?: string; // texto extra para buscar (alias)
  run: (e?: ModifierEvent) => void;
}

export interface PaletteOpen {
  mode: PaletteMode;
  title?: string;
  items?: PaletteItem[];
}

const PALETTE_EVENT = "uc:palette";
export const FOCUS_SEARCH_EVENT = "uc:focus-search";

export function openPalette(detail: PaletteOpen) {
  window.dispatchEvent(new CustomEvent<PaletteOpen>(PALETTE_EVENT, { detail }));
}

export function onPaletteOpen(fn: (detail: PaletteOpen) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<PaletteOpen>).detail);
  window.addEventListener(PALETTE_EVENT, handler);
  return () => window.removeEventListener(PALETTE_EVENT, handler);
}

// "Mod+Shift+P" → "Ctrl+Shift+P"
export function formatHotkey(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => {
      const p = part.toLowerCase();
      if (p === "mod" || p === "ctrl") return "Ctrl";
      if (p === "shift") return "Shift";
      if (p === "alt") return "Alt";
      if (p === "arrowleft") return "←";
      if (p === "arrowright") return "→";
      if (p.length === 1) return p.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}
