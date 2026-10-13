"use client";

import { useState } from "react";
import { ClipboardPaste, Inbox } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { MailItem } from "@/components/mails/mail-item";
import { PasteMailDialog } from "@/components/mails/paste-mail-dialog";
import { useAllSubjects, useTasks } from "@/lib/hooks";

export function MailsView() {
  const tasks = useTasks();
  const subjects = useAllSubjects();
  const [pasting, setPasting] = useState(false);

  const inbox = tasks
    .filter((t) => t.status === "INBOX_EMAIL")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-h1">Mails</h1>
          <p className="t-small text-muted">Lo que llegó de la facultad, esperando que lo revises.</p>
        </div>
        <button className="btn" onClick={() => setPasting(true)}>
          <ClipboardPaste strokeWidth={1.75} />
          Pegar mail
        </button>
      </header>

      {inbox.length === 0 ? (
        <EmptyState icon={Inbox} title="No hay mails nuevos" text="Cuando pegues un mail de la facultad, aparece acá para revisarlo." />
      ) : (
        <ul className="flex flex-col gap-3">
          {inbox.map((task) => (
            <li key={task.id}>
              <MailItem task={task} subjects={subjects} />
            </li>
          ))}
        </ul>
      )}

      <p className="t-small text-faint">Pronto vas a poder conectar tu Gmail para que los mails lleguen solos.</p>

      {pasting && <PasteMailDialog onClose={() => setPasting(false)} />}
    </div>
  );
}
