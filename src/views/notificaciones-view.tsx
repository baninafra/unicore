"use client";

// Notificaciones: lo vencido, lo de hoy y mañana, parciales de la semana y el repaso pendiente.

import clsx from "clsx";
import { Bell, Check, X } from "lucide-react";
import { db } from "@/lib/db";
import { useAppState } from "@/lib/app-state";
import { useWorkspace } from "@/lib/workspace";
import { t } from "@/lib/i18n";
import { dismiss, LEVEL_LABEL, useNotifications, type Notif, type NotifLevel } from "@/lib/notifications";

const LEVEL_BADGE: Record<NotifLevel, string> = {
  vencida: "badge-rose",
  hoy: "badge-amber",
  manana: "badge-primary",
  semana: "badge-cyan",
  repaso: "badge-mint",
};

export function NotificacionesView() {
  const { items } = useNotifications();
  const { openTaskDialog } = useAppState();
  const { openView } = useWorkspace();
  const groups = (["vencida", "hoy", "manana", "semana", "repaso"] as NotifLevel[])
    .map((l) => ({ level: l, list: items.filter((i) => i.level === l) }))
    .filter((g) => g.list.length);

  const openItem = (n: Notif) => {
    if (n.task) openTaskDialog(n.task);
    else if (n.level === "repaso") openView({ type: "repaso" });
  };

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 py-6">
      <header className="flex items-center gap-3">
        <Bell className="h-5 w-5 text-primary-soft" strokeWidth={1.75} />
        <h1 className="t-h1 mr-auto">{t("Notificaciones")}</h1>
        {items.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => dismiss(items.map((i) => i.id))}>
            {t("Descartar todas")}
          </button>
        )}
      </header>

      {groups.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-faint">
          <Bell className="h-12 w-12 opacity-40" strokeWidth={1.25} />
          <p className="t-body">{t("Estás al día. No hay nada pendiente para los próximos días.")}</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.level} className="flex flex-col gap-1.5">
          <p className="section-label">{LEVEL_LABEL[g.level]}</p>
          {g.list.map((n) => (
            <div key={n.id} className="card flex items-center gap-3 px-3 py-2.5">
              <span className={clsx("badge", LEVEL_BADGE[n.level])}>{LEVEL_LABEL[n.level]}</span>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openItem(n)}>
                <p className="t-body truncate text-text">{n.title}</p>
                <p className="t-small truncate text-muted">{n.detail}</p>
              </button>
              {n.task && (
                <button
                  type="button"
                  className="icon-btn"
                  title={t("Marcar como hecha")}
                  aria-label={t("Marcar «{title}» como hecha", { title: n.title })}
                  onClick={() => void db.tasks.update(n.task!.id, { status: "DONE" })}
                >
                  <Check strokeWidth={1.75} />
                </button>
              )}
              <button type="button" className="icon-btn" title={t("Descartar")} aria-label={t("Descartar")} onClick={() => dismiss([n.id])}>
                <X strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
