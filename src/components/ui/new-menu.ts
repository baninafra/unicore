"use client";

// Submenú "Nuevo" (nota, nota del día, idea, tarea, lienzo, archivos de Office…) igual en todos
// los clics derechos. `subjectId` es la carpeta donde se crea; sin él, la de la vista activa.

import { CalendarDays, FilePlus, FileText, FolderPlus, Lightbulb, ListPlus, Plus, Shapes } from "lucide-react";
import { openFolderDialog } from "@/components/explorer/folder-dialog";
import { db } from "@/lib/db";
import type { MenuItem } from "./menu";
import { addCanvas, addNote, folderForView, openDailyNote, runSafe } from "@/lib/nav/actions";
import { createOfficeDoc } from "@/lib/editors/editors";
import { pickFolder } from "@/components/shell/folder-picker";
import { addIdea } from "@/views/ideas-view";
import type { ViewState } from "@/lib/workspace";
import { LOOSE_FOLDER, type Task } from "@/lib/types";
import { t } from "@/lib/i18n";

export interface NewMenuOpts {
  open: (view: ViewState) => void;
  openTask: (defaults?: Partial<Task>) => void;
  activeView?: ViewState;
  subjectId?: string;
  unitNumber?: number;
  taskDefaults?: Partial<Task>;
  degreeId?: string; // espacio donde va una carpeta nueva (sin él, el del perfil activo)
  extra?: MenuItem[]; // opciones propias del lugar (p. ej. "Materia" en una carrera)
}

export function newSubmenu(o: NewMenuOpts): MenuItem {
  const folder = async () => o.subjectId ?? (o.activeView ? await folderForView(o.activeView) : LOOSE_FOLDER);
  const go = (fn: () => Promise<ViewState>) => () => runSafe(async () => o.open(await fn()));
  return {
    label: t("Nuevo"),
    icon: Plus,
    submenu: [
      {
        label: t("Carpeta"),
        icon: FolderPlus,
        // Dentro de una materia o carpeta, la nueva va al mismo espacio.
        onSelect: () =>
          void (o.subjectId && !o.degreeId ? db.subjects.get(o.subjectId) : Promise.resolve(undefined)).then((s) =>
            openFolderDialog({ degreeId: o.degreeId ?? s?.degreeId }),
          ),
      },
      { label: t("Nota"), icon: FilePlus, onSelect: go(async () => ({ type: "nota", id: await addNote(await folder(), o.unitNumber ? { unitNumber: o.unitNumber } : undefined) })) },
      { label: t("Nota del día"), icon: CalendarDays, onSelect: go(async () => ({ type: "nota", id: await openDailyNote(new Date()) })) },
      { label: t("Idea"), icon: Lightbulb, onSelect: go(async () => ({ type: "nota", id: await addIdea("") })) },
      { label: t("Tarea"), icon: ListPlus, onSelect: () => o.openTask(o.taskDefaults ?? (o.subjectId ? { subjectId: o.subjectId } : undefined)) },
      { label: t("Lienzo"), icon: Shapes, onSelect: go(async () => ({ type: "canvas", id: await addCanvas(await folder()) })) },
      { type: "separator" },
      ...(
        [
          ["doc", t("Documento de Word")],
          ["sheet", t("Planilla de Excel")],
          ["deck", t("Presentación")],
          ["geo", t("Construcción de geometría")],
        ] as const
      ).map(([kind, label]) => ({
        label,
        icon: FileText,
        // Sin una carpeta clara (clic derecho en un espacio vacío), se pregunta dónde guardarlo.
        onSelect: () =>
          runSafe(async () => {
            const what = kind === "deck" ? t("la presentación") : kind === "geo" ? t("la construcción") : t("el {what}", { what: label.split(" ")[0].toLowerCase() });
            const subjectId = o.subjectId ?? (await pickFolder(t("¿Dónde guardo {what}?", { what })));
            if (subjectId) o.open({ type: "editor", id: await createOfficeDoc({ kind, subjectId }) });
          }),
      })),
      ...(o.extra?.length ? [{ type: "separator" } as MenuItem, ...o.extra] : []),
    ],
  };
}
