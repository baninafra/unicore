"use client";

import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { MailItem } from "@/components/mails/mail-item";
import type { Subject, Task } from "@/lib/types";

// Panel de Inicio con los últimos mails que llegaron (máximo 3).
export function MailPanel({ tasks, subjects }: { tasks: Task[]; subjects: Subject[] }) {
  const inbox = tasks
    .filter((t) => t.status === "INBOX_EMAIL")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = inbox.slice(0, 3);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between px-1">
        <h2 className="t-h2 flex items-center gap-2">
          Mails nuevos
          {inbox.length > 0 && <span className="badge badge-amber">{inbox.length}</span>}
        </h2>
      </header>

      {latest.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <Inbox className="h-6 w-6 text-faint" strokeWidth={1.75} />
          <p className="t-h3">No hay mails nuevos</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {latest.map((task) => (
            <MailItem key={task.id} task={task} subjects={subjects} />
          ))}
        </div>
      )}

      <Link href="/mails" className="t-small flex items-center justify-end gap-1.5 px-1 font-medium text-primary-soft hover:underline">
        Ver todos
        <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
      </Link>
    </section>
  );
}
