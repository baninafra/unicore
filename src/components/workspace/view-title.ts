"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { t } from "@/lib/i18n";
import { db } from "@/lib/db";
import { folderName, useFolderNames } from "@/lib/folder-names";
import { IDEAS_FOLDER } from "@/lib/types";
import type { ViewState } from "@/lib/workspace";
import { useProfilesMaybe } from "@/lib/profiles";

const STATIC_TITLES: Partial<Record<ViewState["type"], string>> = {
  inicio: t("Inicio"),
  calendario: t("Calendario"),
  mails: t("Mails"),
  repaso: t("Repaso"),
  carreras: t("Mis carreras"),
  busqueda: t("Búsqueda"),
  base: t("Base de notas"),
  ideas: t("Ideas"),
  plantillas: t("Plantillas"),
  notificaciones: t("Notificaciones"),
  ajustes: t("Ajustes"),
  vacia: t("Nueva pestaña"),
};

// Título de una pestaña (lee nombres de la base cuando hace falta).
export function useViewTitle(view: ViewState): string {
  useFolderNames();
  const profiles = useProfilesMaybe();
  const dynamic = useLiveQuery(async () => {
    switch (view.type) {
      case "materia":
        return (await db.subjects.get(view.id))?.name;
      case "nota":
      case "slides":
        return (await db.notes.get(view.id))?.title || t("Sin título");
      case "pdf":
        return (await db.documents.get(view.id))?.fileName;
      case "canvas":
        return (await db.canvases.get(view.id))?.name;
      case "editor":
        return (await db.officeDocs.get(view.id))?.name;
      case "grafo":
        return view.noteId ? t("Grafo de {title}", { title: (await db.notes.get(view.noteId))?.title ?? t("nota") }) : t("Grafo");
      default:
        return undefined;
    }
  }, [JSON.stringify(view)]);

  if (view.type === "carreras" && profiles) return profiles.terms.spacesView;
  if (view.type === "ideas") return folderName(IDEAS_FOLDER) ?? t("Ideas");
  if (view.type === "web") {
    try {
      return new URL(view.url).hostname;
    } catch {
      return "Web";
    }
  }
  if (view.type === "busqueda" && view.query) return t("Buscar: {query}", { query: view.query });
  return dynamic ?? STATIC_TITLES[view.type] ?? "…";
}
