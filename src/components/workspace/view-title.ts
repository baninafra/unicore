"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { ViewState } from "@/lib/workspace";

const STATIC_TITLES: Partial<Record<ViewState["type"], string>> = {
  inicio: "Inicio",
  calendario: "Calendario",
  mails: "Mails",
  repaso: "Repaso",
  carreras: "Mis carreras",
  busqueda: "Búsqueda",
  base: "Base de notas",
  ajustes: "Ajustes",
  vacia: "Nueva pestaña",
};

// Título de una pestaña (lee nombres de la base cuando hace falta).
export function useViewTitle(view: ViewState): string {
  const dynamic = useLiveQuery(async () => {
    switch (view.type) {
      case "materia":
        return (await db.subjects.get(view.id))?.name;
      case "nota":
      case "slides":
        return (await db.notes.get(view.id))?.title || "Sin título";
      case "pdf":
        return (await db.documents.get(view.id))?.fileName;
      case "canvas":
        return (await db.canvases.get(view.id))?.name;
      case "grafo":
        return view.noteId ? `Grafo de ${(await db.notes.get(view.noteId))?.title ?? "nota"}` : "Grafo";
      default:
        return undefined;
    }
  }, [JSON.stringify(view)]);

  if (view.type === "web") {
    try {
      return new URL(view.url).hostname;
    } catch {
      return "Web";
    }
  }
  if (view.type === "busqueda" && view.query) return `Buscar: ${view.query}`;
  return dynamic ?? STATIC_TITLES[view.type] ?? "…";
}
