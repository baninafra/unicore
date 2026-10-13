"use client";

import { useState } from "react";
import { BookOpen, Calendar, Check, Sparkles, Trash2 } from "lucide-react";
import { useLocalAI } from "@/lib/ai/use-local-ai";
import { analyzeEmail } from "@/lib/ai/prompts";
import { db } from "@/lib/db";
import { relativeDays, shortDateTime } from "@/lib/format";
import type { Subject, Task } from "@/lib/types";

// Un mail que llegó a la bandeja de entrada (status INBOX_EMAIL).
// Se usa en la página Mails y en el panel de Inicio, con las mismas acciones.
export function MailItem({ task, subjects }: { task: Task; subjects: Subject[] }) {
  const ai = useLocalAI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

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

  async function discard() {
    await db.tasks.delete(task.id);
  }

  async function addToKanban() {
    await db.tasks.update(task.id, { status: "TODO" });
  }

  return (
    <article className="flex flex-col gap-2.5 rounded-md border border-border bg-surface p-3">
      <div className="t-small truncate text-muted">{task.rawEmailFrom ?? "Remitente desconocido"}</div>
      <div className="t-h3">{task.title}</div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {subject && (
          <span className="badge">
            <BookOpen strokeWidth={1.75} />
            {subject.name}
          </span>
        )}
        {task.dueDate && (
          <span className="t-small num flex items-center gap-1.5 text-muted">
            <Calendar className="h-4 w-4 flex-none" strokeWidth={1.75} />
            {shortDateTime(task.dueDate)} · {relativeDays(task.dueDate)}
          </span>
        )}
      </div>

      {task.aiSummary && (
        <p className="t-small flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 flex-none text-primary-soft" strokeWidth={1.75} />
          <span>{task.aiSummary}</span>
        </p>
      )}

      {error && <p className="t-small text-rose">{error}</p>}
      {busy && <p className="t-small text-faint">{ai.progressText || "Analizando el mail…"}</p>}

      <div className="flex flex-wrap gap-2 pt-1">
        <button className="btn btn-ai btn-sm" onClick={analyze} disabled={busy}>
          <Sparkles strokeWidth={1.75} />
          Analizar mail
        </button>
        <button className="btn btn-sm" onClick={addToKanban}>
          <Check strokeWidth={1.75} />
          Agregar al kanban
        </button>
        <button className="btn btn-ghost btn-sm" onClick={discard}>
          <Trash2 strokeWidth={1.75} />
          Descartar
        </button>
      </div>
    </article>
  );
}
