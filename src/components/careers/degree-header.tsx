"use client";

import { EllipsisVertical, Pencil, Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { grade } from "@/lib/format";
import type { Degree, Subject } from "@/lib/types";
import { useContextMenu } from "@/components/ui/menu";
import { degreeProgress } from "./plan";

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
  const { open, menu } = useContextMenu();
  // La barra es blurple por defecto; la carrera cian usa el token --cyan.
  const barStyle: CSSProperties | undefined = degree.color === "cyan" ? { background: "var(--cyan)" } : undefined;

  const items = [
    { label: "Editar carrera", icon: Pencil, onSelect: onEdit },
    { label: "Agregar materia", icon: Plus, onSelect: onAddSubject },
    { type: "separator" as const },
    { label: "Eliminar carrera", icon: Trash2, onSelect: onDelete, danger: true },
  ];

  return (
    <div className="flex flex-col gap-2" onContextMenu={(e) => open(e, items)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="t-h3 min-w-0 truncate font-semibold">{degree.name}</h2>
        <span className="tag">{degree.shortName}</span>
        <span className="t-small num ml-auto flex-none text-faint">
          {grade(p.average)} · {p.approved}/{p.total} aprobadas · {p.regular} regular
        </span>
        <button type="button" className="icon-btn" onClick={onAddSubject} aria-label="Agregar materia" title="Agregar materia">
          <Plus strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={(e) => open(e, items)}
          aria-label={`Opciones de ${degree.name}`}
          title="Opciones"
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
