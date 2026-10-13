"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { degreeBadgeClass, grade } from "@/lib/format";
import type { Degree, Subject } from "@/lib/types";
import { ActionsMenu } from "./actions-menu";
import { degreeProgress } from "./plan";

// Tarjeta de avance de una carrera: promedio, aprobadas y regulares.
export function ProgressStat({
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
  // La barra es blurple por defecto; la carrera cian usa el token --cyan.
  const barStyle: CSSProperties | undefined = degree.color === "cyan" ? { background: "var(--cyan)" } : undefined;

  return (
    <article className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className={degreeBadgeClass(degree)}>{degree.shortName}</span>
          <h2 className="t-h2 min-w-0 break-words">{degree.name}</h2>
        </div>
        <ActionsMenu
          label={`Opciones de ${degree.name}`}
          items={[
            { label: "Editar carrera", icon: Pencil, onSelect: onEdit },
            { label: "Eliminar carrera", icon: Trash2, onSelect: onDelete, danger: true },
          ]}
        />
      </div>
      {degree.institution && <p className="t-small text-muted">{degree.institution}</p>}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="t-label">Promedio</div>
          <div className="t-timer num">{grade(p.average)}</div>
        </div>
        <p className="t-small num">
          <span className="font-medium">{p.approved}</span>
          <span className="text-muted">/{p.total}</span> aprobadas
        </p>
      </div>

      <div className="progress mt-3">
        <i style={{ width: `${Math.round(p.ratio * 100)}%`, ...barStyle }} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="t-small text-muted">Regulares: {p.regular}</span>
        <button type="button" className="btn btn-sm" onClick={onAddSubject}>
          <Plus strokeWidth={1.75} />
          Agregar materia
        </button>
      </div>
    </article>
  );
}
