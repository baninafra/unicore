"use client";

import { FileDown } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { exportToPdf, type ExportTarget } from "@/lib/export/export-pdf";
import { DAILY_FOLDER, LOOSE_FOLDER } from "@/lib/types";
import { useRegisterCommands, useWorkspace, type Command } from "@/lib/workspace";

// Comandos de exportación a PDF según la vista activa (y siempre los de carreras y carpetas).
export function ExportCommands() {
  const { activeView } = useWorkspace();
  const degrees = useLiveQuery(() => db.degrees.toArray(), []) ?? [];
  const activeNote = useLiveQuery(
    async () => (activeView.type === "nota" ? await db.notes.get(activeView.id) : undefined),
    [JSON.stringify(activeView)],
  );

  const run = (t: ExportTarget) => () => void exportToPdf(t).catch((e) => console.error("[UniCore] exportar PDF", e));

  const cmds: Command[] = [];
  if (activeView.type === "nota") {
    cmds.push({ id: "exportar:nota", name: "Exportar nota a PDF", icon: FileDown, run: run({ kind: "note", id: activeView.id }) });
    if (activeNote && !activeNote.subjectId.startsWith("__")) {
      cmds.push({ id: "exportar:materia-de-nota", name: "Exportar materia de esta nota a PDF", icon: FileDown, run: run({ kind: "subject", id: activeNote.subjectId }) });
    }
  }
  if (activeView.type === "materia") {
    cmds.push({ id: "exportar:materia", name: "Exportar materia a PDF", icon: FileDown, run: run({ kind: "subject", id: activeView.id }) });
  }
  for (const d of degrees) {
    cmds.push({ id: `exportar:carrera:${d.id}`, name: `Exportar carrera a PDF: ${d.name}`, icon: FileDown, run: run({ kind: "degree", id: d.id }) });
  }
  cmds.push({ id: "exportar:diario", name: "Exportar Diario a PDF", icon: FileDown, run: run({ kind: "folder", folder: DAILY_FOLDER }) });
  cmds.push({ id: "exportar:notas", name: "Exportar Notas sueltas a PDF", icon: FileDown, run: run({ kind: "folder", folder: LOOSE_FOLDER }) });

  useRegisterCommands("exportar", cmds);
  return null;
}
