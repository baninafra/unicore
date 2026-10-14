"use client";

import { BookOpen, Pencil, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { SUBJECT_STATUS_LABEL, type Subject, type SubjectStatus } from "@/lib/types";
import { useContextMenu } from "@/components/ui/menu";
import { exportMenuItem } from "@/components/export/export-menu";
import { useWorkspace } from "@/lib/workspace";

const STATUSES: SubjectStatus[] = ["PENDIENTE", "CURSANDO", "REGULAR", "APROBADA"];

// Menú contextual de una materia: abrir, editar, cambiar estado y eliminar.
export function useSubjectMenu({ onEdit, onDelete }: { onEdit: (s: Subject) => void; onDelete: (s: Subject) => void }) {
  const { openView } = useWorkspace();
  const { open, menu } = useContextMenu();

  function show(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, subject: Subject) {
    const view = { type: "materia" as const, id: subject.id };
    open(e, [
      { label: "Abrir", icon: BookOpen, onSelect: () => openView(view) },
      { label: "Abrir en pestaña nueva", onSelect: () => openView(view, "tab") },
      { label: "Editar", icon: Pencil, onSelect: () => onEdit(subject) },
      exportMenuItem({ kind: "subject", id: subject.id }),
      { type: "separator" },
      ...STATUSES.map((st) => ({
        label: `Estado: ${SUBJECT_STATUS_LABEL[st]}`,
        disabled: subject.status === st,
        onSelect: () => void db.subjects.update(subject.id, { status: st }),
      })),
      { type: "separator" },
      { label: "Eliminar", icon: Trash2, danger: true, onSelect: () => onDelete(subject) },
    ]);
  }

  return { show, menu };
}
