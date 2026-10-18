"use client";

import { Check, Pencil, Undo2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import type { Task } from "@/lib/types";
import { useContextMenu } from "@/components/ui/menu";

// Menú contextual de una tarea (clic derecho en filas y tarjetas).
export function useTaskMenu() {
  const { openTaskDialog } = useAppState();
  const { open, menu } = useContextMenu();

  function show(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, task: Task) {
    const done = task.status === "DONE";
    open(e, [
      { label: t("Editar tarea"), icon: Pencil, onSelect: () => openTaskDialog(task) },
      done
        ? { label: t("Reabrir"), icon: Undo2, onSelect: () => void db.tasks.update(task.id, { status: "TODO" }) }
        : { label: t("Marcar como hecha"), icon: Check, onSelect: () => void db.tasks.update(task.id, { status: "DONE" }) },
    ]);
  }

  return { show, menu };
}
