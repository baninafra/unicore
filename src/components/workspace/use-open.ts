"use client";

import { useCallback } from "react";
import { useWorkspace, type OpenMode, type ViewState } from "@/lib/workspace";

// Abre una vista respetando los modificadores como en Obsidian:
// clic = misma pestaña · Ctrl+clic o clic del medio = pestaña nueva · Ctrl+Alt+clic = panel dividido.
export function modeFromEvent(e?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; button?: number }): OpenMode {
  if (!e) return "current";
  if ((e.ctrlKey || e.metaKey) && e.altKey) return "split";
  if (e.ctrlKey || e.metaKey || e.button === 1) return "tab";
  return "current";
}

export function useOpen() {
  const { openView } = useWorkspace();
  return useCallback(
    (view: ViewState, e?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; button?: number }) =>
      openView(view, modeFromEvent(e)),
    [openView],
  );
}
