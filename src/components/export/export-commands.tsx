"use client";

import { FileDown, Sheet } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { type ExportTarget } from "@/lib/export/export-pdf";
import { exportAgendaXlsx, exportAs, FORMAT_LABEL, type ExportFormat } from "@/lib/export/export-formats";
import { toast } from "@/lib/undo";
import { DAILY_FOLDER, LOOSE_FOLDER } from "@/lib/types";
import { useRegisterCommands, useWorkspace, type Command } from "@/lib/workspace";

const FORMATS: ExportFormat[] = ["pdf", "docx", "xlsx", "md", "html"];

// Comandos de exportación (PDF, Word, Excel, Markdown, web) según la vista activa
// y siempre los de carreras, carpetas y la agenda.
export function ExportCommands() {
  const { activeView } = useWorkspace();
  const degrees = useLiveQuery(() => db.degrees.toArray(), []) ?? [];
  const activeNote = useLiveQuery(
    async () => (activeView.type === "nota" ? await db.notes.get(activeView.id) : undefined),
    [JSON.stringify(activeView)],
  );

  const run = (f: ExportFormat, t: ExportTarget) => () =>
    void exportAs(f, t).catch((e) => {
      console.error("[UniCore] exportar", e);
      toast("No pudimos exportar. Probá de nuevo.", { tone: "error" });
    });

  const cmds: Command[] = [];
  const add = (id: string, what: string, t: ExportTarget) => {
    for (const f of FORMATS) cmds.push({ id: `exportar:${f}:${id}`, name: `Exportar ${what} a ${FORMAT_LABEL[f]}`, icon: FileDown, run: run(f, t) });
  };
  if (activeView.type === "nota") {
    add("nota", "nota", { kind: "note", id: activeView.id });
    if (activeNote && !activeNote.subjectId.startsWith("__")) add("materia-de-nota", "materia de esta nota", { kind: "subject", id: activeNote.subjectId });
  }
  if (activeView.type === "materia") add("materia", "materia", { kind: "subject", id: activeView.id });
  for (const d of degrees) add(`carrera:${d.id}`, `carrera ${d.name}`, { kind: "degree", id: d.id });
  add("diario", "Diario", { kind: "folder", folder: DAILY_FOLDER });
  add("notas", "Notas sueltas", { kind: "folder", folder: LOOSE_FOLDER });
  cmds.push({
    id: "exportar:agenda",
    name: "Exportar agenda y plan de estudios a Excel",
    icon: Sheet,
    run: () => void exportAgendaXlsx().catch(() => toast("No pudimos exportar. Probá de nuevo.", { tone: "error" })),
  });

  useRegisterCommands("exportar", cmds);
  return null;
}
