"use client";

import { useState } from "react";
import { Check, Sparkles, Trash2 } from "lucide-react";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { analyzeEmail } from "@/lib/ai/prompts";
import { db } from "@/lib/db";
import { relativeDays, shortDate } from "@/lib/format";
import type { Subject, Task } from "@/lib/types";
import { useContextMenu } from "@/components/ui/menu";

// Un mail de la bandeja (status INBOX_EMAIL). Dos líneas: remitente y asunto, y debajo el resumen de la IA.
// Las acciones aparecen al pasar el mouse (y también con clic derecho).
export function MailItem({ task, subjects }: { task: Task; subjects: Subject[] }) {
  const ai = useLocalAI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { open, menu } = useContextMenu();

  const subject = subjects.find((s) => s.id === task.subjectId);

  async function analyze() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await analyzeEmail(ai, {
        from: task.rawEmailFrom,
        subject: task.title,
        body: task.rawEmailBody ?? task.description ?? "",
        subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
      });
      // Sólo guardamos lo que la IA devolvió; lo que falte queda como estaba.
      const patch: Partial<Task> = {};
      if (result.summary) patch.aiSummary = result.summary;
      if (result.dueDate) patch.dueDate = result.dueDate;
      if (result.type) patch.type = result.type;
      const matched = result.subjectId ? subjects.find((s) => s.id === result.subjectId) : undefined;
      if (matched) {
        patch.subjectId = matched.id;
        patch.degreeId = matched.degreeId;
      }
      await db.tasks.update(task.id, patch);
    } catch {
      setError("No pudimos analizar este mail. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const discard = () => void db.tasks.delete(task.id);
  const addToKanban = () => void db.tasks.update(task.id, { status: "TODO" });

  const detail = error ?? (busy ? ai.progressText || "Analizando…" : task.aiSummary);

  return (
    <div
      className="group flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-surface-raised"
      onContextMenu={(e) =>
        open(e, [
          { label: "Analizar con IA", icon: Sparkles, onSelect: () => void analyze(), disabled: busy },
          { label: "Agregar al kanban", icon: Check, onSelect: addToKanban },
          { type: "separator" },
          { label: "Descartar", icon: Trash2, onSelect: discard, danger: true },
        ])
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="t-small max-w-[180px] flex-none truncate text-muted">{task.rawEmailFrom ?? "Remitente desconocido"}</span>
        <span className="t-small min-w-0 flex-1 truncate text-text">{task.title}</span>
        {task.dueDate && (
          <span className="t-small num flex-none text-faint group-hover:hidden">{shortDate(task.dueDate)}</span>
        )}
        <span className="flex flex-none items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" className="icon-btn" onClick={() => void analyze()} disabled={busy} aria-label="Analizar con IA" title="Analizar con IA">
            <Sparkles strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" onClick={addToKanban} aria-label="Agregar al kanban" title="Agregar al kanban">
            <Check strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" onClick={discard} aria-label="Descartar" title="Descartar">
            <Trash2 strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <div className={`t-small truncate ${error ? "text-rose" : "text-faint"}`}>
        {detail || subject?.name || (task.dueDate ? `Vence ${relativeDays(task.dueDate)}` : "Sin analizar")}
      </div>
      {menu}
    </div>
  );
}
