"use client";

// Submenú "Nuevo" (nota, nota del día, idea, tarea, lienzo, archivos de Office…) igual en todos
// los clics derechos. `subjectId` es la carpeta donde se crea; sin él, la de la vista activa.

import { CalendarDays, FilePlus, FileText, Lightbulb, ListPlus, Plus, Shapes } from "lucide-react";
import type { MenuItem } from "./menu";
import { addCanvas, addNote, folderForView, openDailyNote, runSafe } from "@/lib/nav/actions";
import { createOfficeDoc } from "@/lib/editors/editors";
import { pickFolder } from "@/components/shell/folder-picker";
import { addIdea } from "@/views/ideas-view";
import type { ViewState } from "@/lib/workspace";
import { LOOSE_FOLDER, type Task } from "@/lib/types";

export interface NewMenuOpts {
  open: (view: ViewState) => void;
  openTask: (defaults?: Partial<Task>) => void;
  activeView?: ViewState;
  subjectId?: string;
  unitNumber?: number;
  taskDefaults?: Partial<Task>;
  extra?: MenuItem[]; // opciones propias del lugar (p. ej. "Materia" en una carrera)
}

export function newSubmenu(o: NewMenuOpts): MenuItem {
  const folder = async () => o.subjectId ?? (o.activeView ? await folderForView(o.activeView) : LOOSE_FOLDER);
  const go = (fn: () => Promise<ViewState>) => () => runSafe(async () => o.open(await fn()));
  return {
    label: "Nuevo",
    icon: Plus,
    submenu: [
      { label: "Nota", icon: FilePlus, onSelect: go(async () => ({ type: "nota", id: await addNote(await folder(), o.unitNumber ? { unitNumber: o.unitNumber } : undefined) })) },
      { label: "Nota del día", icon: CalendarDays, onSelect: go(async () => ({ type: "nota", id: await openDailyNote(new Date()) })) },
      { label: "Idea", icon: Lightbulb, onSelect: go(async () => ({ type: "nota", id: await addIdea("") })) },
      { label: "Tarea", icon: ListPlus, onSelect: () => o.openTask(o.taskDefaults ?? (o.subjectId ? { subjectId: o.subjectId } : undefined)) },
      { label: "Lienzo", icon: Shapes, onSelect: go(async () => ({ type: "canvas", id: await addCanvas(await folder()) })) },
      { type: "separator" },
      ...(
        [
          ["doc", "Documento de Word"],
          ["sheet", "Planilla de Excel"],
          ["deck", "Presentación"],
          ["geo", "Construcción de geometría"],
        ] as const
      ).map(([kind, label]) => ({
        label,
        icon: FileText,
        // Sin una carpeta clara (clic derecho en un espacio vacío), se pregunta dónde guardarlo.
        onSelect: () =>
          runSafe(async () => {
            const what = kind === "deck" ? "la presentación" : kind === "geo" ? "la construcción" : `el ${label.split(" ")[0].toLowerCase()}`;
            const subjectId = o.subjectId ?? (await pickFolder(`¿Dónde guardo ${what}?`));
            if (subjectId) o.open({ type: "editor", id: await createOfficeDoc({ kind, subjectId }) });
          }),
      })),
      ...(o.extra?.length ? [{ type: "separator" } as MenuItem, ...o.extra] : []),
    ],
  };
}
