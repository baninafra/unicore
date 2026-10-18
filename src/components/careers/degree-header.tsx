"use client";

import { EllipsisVertical, Pencil, Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { grade } from "@/lib/format";
import type { Degree, Subject } from "@/lib/types";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { exportMenuItem } from "@/components/export/export-menu";
import { degreeProgress } from "./plan";
import { kindOf, PROFILES } from "@/lib/profiles";
import { t } from "@/lib/i18n";

// Encabezado de una carrera: nombre, sigla, promedio y avance en una línea, con barra de 2 px.
export function DegreeHeader({
  degree,
  subjects,
  onEdit,
  onDelete,
  onAddSubject,
}: {
  degree: Degree;
  subjects: Subject[];
  onEdit: () => void;
  onDelete: () => void;
  onAddSubject: () => void;
}) {
  const p = degreeProgress(subjects);
  const prof = PROFILES[kindOf(degree)];
  const add = t("Agregar {item}", { item: prof.item.one });
  const active = subjects.filter((s) => s.status === "CURSANDO").length;
  const stats = prof.study
    ? t("{avg} · {approved}/{total} {approvedLabel}s · {regular} {regularLabel}", {
        avg: grade(p.average),
        approved: p.approved,
        total: p.total,
        approvedLabel: prof.statuses.APROBADA.toLowerCase(),
        regular: p.regular,
        regularLabel: prof.statuses.REGULAR.toLowerCase(),
      })
    : t("{active} {activeLabel} · {approved}/{total} {approvedLabel}s", {
        active,
        activeLabel: prof.statuses.CURSANDO.toLowerCase(),
        approved: p.approved,
        total: p.total,
        approvedLabel: prof.statuses.APROBADA.toLowerCase(),
      });
  const { open, menu } = useContextMenu();
  // La barra es blurple por defecto; la carrera cian usa el token --cyan.
  const barStyle: CSSProperties | undefined = degree.color === "cyan" ? { background: "var(--cyan)" } : undefined;

  // Trabajo, proyectos y personal: el espacio es el perfil (se renombra o borra desde Ajustes → Perfiles).
  const items: MenuItem[] = prof.study
    ? [
        { label: t("Editar {space}", { space: prof.space.one }), icon: Pencil, onSelect: onEdit },
        { label: add, icon: Plus, onSelect: onAddSubject },
        exportMenuItem({ kind: "degree", id: degree.id }),
        { type: "separator" },
        { label: t("Eliminar {space}", { space: prof.space.one }), icon: Trash2, onSelect: onDelete, danger: true },
      ]
    : [{ label: add, icon: Plus, onSelect: onAddSubject }, exportMenuItem({ kind: "degree", id: degree.id })];

  return (
    <div className="flex flex-col gap-2" onContextMenu={(e) => open(e, items)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="t-h3 min-w-0 truncate font-semibold">{degree.name}</h2>
        {prof.study && <span className="tag">{degree.shortName}</span>}
        {degree.kind && degree.kind !== "universidad" && <prof.icon className="h-4 w-4 flex-none text-faint" strokeWidth={1.75} aria-label={prof.label} />}
        <span className="t-small num ml-auto flex-none text-faint">{stats}</span>
        <button type="button" className="icon-btn" onClick={onAddSubject} aria-label={add} title={add}>
          <Plus strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={(e) => open(e, items)}
          aria-label={t("Opciones de {name}", { name: degree.name })}
          title={t("Opciones")}
        >
          <EllipsisVertical strokeWidth={1.75} />
        </button>
      </div>
      <div className="progress" style={{ height: 2 }}>
        <i style={{ width: `${Math.round(p.ratio * 100)}%`, ...barStyle }} />
      </div>
      {menu}
    </div>
  );
}
