"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/modal";
import { parseEmail } from "@/lib/email-parse";
import { db, newId, nowIso } from "@/lib/db";
import { useAllSubjects } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { stripUndefined } from "@/components/tasks/task-meta";
import { t } from "@/lib/i18n";

// Carga a mano un mail de la facultad. Se monta sólo cuando está abierto (state limpio cada vez).
export function PasteMailDialog({ onClose }: { onClose: () => void }) {
  const subjects = useAllSubjects();
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && !subject.trim()) {
      setError(t("Pegá el texto del mail para poder cargarlo."));
      return;
    }
    const parsed = parseEmail({ from, subject, body, subjects });
    const task = stripUndefined({
      id: newId(),
      title: parsed.title,
      type: parsed.type,
      status: "INBOX_EMAIL",
      priority: "MEDIUM",
      source: "EMAIL_AUTO",
      dueDate: parsed.dueDate,
      degreeId: parsed.degreeId,
      subjectId: parsed.subjectId,
      rawEmailFrom: from.trim() || undefined,
      rawEmailBody: body.trim() || undefined,
      createdAt: nowIso(),
    }) as Task;
    try {
      await db.tasks.add(task);
      onClose();
    } catch {
      setError(t("No pudimos guardar el mail. Probá de nuevo."));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("Pegar mail")}
      width={560}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button className="btn btn-primary" type="submit" form="paste-mail-form">
            {t("Cargar mail")}
          </button>
        </>
      }
    >
      <form id="paste-mail-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>{t("Remitente")}</span>
          <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="catedra.algebra@..." />
        </label>
        <label className="field">
          <span>{t("Asunto")}</span>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("Cambio de fecha del parcial")} />
        </label>
        <label className="field">
          <span>{t("Cuerpo del mail")}</span>
          <textarea
            className={`input ${error ? "input-error" : ""}`}
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("Pegá acá el texto del mail")}
          />
        </label>
        {error && <p className="t-small text-rose">{error}</p>}
      </form>
    </Modal>
  );
}
