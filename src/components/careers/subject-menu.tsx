"use client";

import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import type { Subject, SubjectStatus } from "@/lib/types";
import { useProfiles } from "@/lib/profiles";
import { useContextMenu } from "@/components/ui/menu";
import { exportMenuItem } from "@/components/export/export-menu";
import { useWorkspace } from "@/lib/workspace";
import { t } from "@/lib/i18n";

const STATUSES: SubjectStatus[] = ["PENDIENTE", "CURSANDO", "REGULAR", "APROBADA"];

// Menú contextual de una materia: abrir, editar, cambiar estado y eliminar.
export function useSubjectMenu({ onEdit, onDelete }: { onEdit: (s: Subject) => void; onDelete: (s: Subject) => void }) {
  const { openView } = useWorkspace();
  const { open, menu } = useContextMenu();
  const { termsFor } = useProfiles();

  function show(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, subject: Subject) {
    const view = { type: "materia" as const, id: subject.id };
    const labels = termsFor(subject.degreeId).statuses;
    open(e, [
      { label: t("Abrir"), icon: BookOpen, onSelect: () => openView(view) },
      { label: t("Abrir en pestaña nueva"), onSelect: () => openView(view, "tab") },
      { label: t("Editar"), icon: Pencil, onSelect: () => onEdit(subject) },
      exportMenuItem({ kind: "subject", id: subject.id }),
      { type: "separator" },
      ...STATUSES.map((st) => ({
        label: t("Estado: {estado}", { estado: labels[st] }),
        disabled: subject.status === st,
        onSelect: () => void db.subjects.update(subject.id, { status: st }),
      })),
      { type: "separator" },
      { label: t("Eliminar"), icon: Trash2, danger: true, onSelect: () => onDelete(subject) },
    ]);
  }

  return { show, menu };
}
