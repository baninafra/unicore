"use client";

import { t } from "@/lib/i18n";
import { MailItem } from "@/components/mails/mail-item";
import type { Subject, Task } from "@/lib/types";

const SHOWN = 6;

// Mails sin confirmar, en Inicio. Las mismas filas que en la bandeja.
export function MailPanel({ tasks, subjects, onOpenAll }: { tasks: Task[]; subjects: Subject[]; onOpenAll: (e: React.MouseEvent) => void }) {
  const inbox = tasks
    .filter((t) => t.status === "INBOX_EMAIL")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="flex flex-col gap-0.5">
      <h2 className="section-label mb-1 flex items-center justify-between pr-1">
        <span>{t("Mails")}</span>
        {inbox.length > 0 && <span className="num">{inbox.length}</span>}
      </h2>

      {inbox.length === 0 ? (
        <p className="t-small px-2 py-1 text-faint">{t("Sin mails")}</p>
      ) : (
        inbox.slice(0, SHOWN).map((task) => <MailItem key={task.id} task={task} subjects={subjects} />)
      )}

      {inbox.length > SHOWN && (
        <button type="button" className="row justify-start text-primary-soft" onClick={onOpenAll}>
          {t("Ver todos ({n})", { n: inbox.length })}
        </button>
      )}
    </section>
  );
}
