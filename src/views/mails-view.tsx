"use client";

import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { MailItem } from "@/components/mails/mail-item";
import { PasteMailDialog } from "@/components/mails/paste-mail-dialog";
import { useAllSubjects, useTasks } from "@/lib/hooks";

// Bandeja de mails sin confirmar: lista densa, acciones al pasar el mouse.
export function MailsView() {
  const tasks = useTasks();
  const subjects = useAllSubjects();
  const [pasting, setPasting] = useState(false);

  const inbox = tasks
    .filter((t) => t.status === "INBOX_EMAIL")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="view-wide mx-auto flex max-w-[960px] flex-col gap-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="t-small text-faint">{inbox.length > 0 ? `${inbox.length} sin confirmar` : ""}</span>
        <button type="button" className="icon-btn" onClick={() => setPasting(true)} aria-label="Pegar mail" title="Pegar mail">
          <ClipboardPaste strokeWidth={1.75} />
        </button>
      </div>

      {inbox.length === 0 ? (
        <p className="t-small px-2 py-6 text-faint">Sin mails</p>
      ) : (
        inbox.map((task) => <MailItem key={task.id} task={task} subjects={subjects} />)
      )}

      {pasting && <PasteMailDialog onClose={() => setPasting(false)} />}
    </div>
  );
}
