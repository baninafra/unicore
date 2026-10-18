"use client";

import clsx from "clsx";
import type { Degree, Subject, SubjectStatus } from "@/lib/types";
import { PROFILES, kindOf } from "@/lib/profiles";
import { useOpen } from "@/components/workspace/use-open";
import { useSubjectMenu } from "./subject-menu";

// Orden de los grupos: lo que está en curso primero.
const ORDER: SubjectStatus[] = ["CURSANDO", "PENDIENTE", "REGULAR", "APROBADA"];
const TONE: Record<SubjectStatus, string> = {
  CURSANDO: "text-primary-soft",
  PENDIENTE: "text-muted",
  REGULAR: "text-faint",
  APROBADA: "text-mint",
};

// Proyectos o áreas de un espacio que no se estudia (trabajo, proyectos, personal): agrupados por estado.
export function ItemList({
  degree,
  subjects,
  onEdit,
  onDelete,
}: {
  degree: Degree;
  subjects: Subject[];
  onEdit: (subject: Subject) => void;
  onDelete: (subject: Subject) => void;
}) {
  const open = useOpen();
  const { show, menu } = useSubjectMenu({ onEdit, onDelete });
  const terms = PROFILES[kindOf(degree)];

  if (subjects.length === 0) {
    return <p className="t-small px-2 py-3 text-faint">Sin {terms.item.many} todavía. Sumá {terms.item.f ? "la primera" : "el primero"} con el +.</p>;
  }

  return (
    <div className="flex flex-col">
      {ORDER.map((status) => {
        const list = subjects.filter((s) => s.status === status).sort((a, b) => a.name.localeCompare(b.name, "es"));
        if (list.length === 0) return null;
        return (
          <section key={status} className="flex flex-col">
            <h3 className="section-label px-2 pb-1 pt-3">{terms.statuses[status]}</h3>
            {list.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                className="row min-h-[30px] gap-4"
                onClick={(e) => open({ type: "materia", id: s.id }, e)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") open({ type: "materia", id: s.id });
                }}
                onContextMenu={(e) => show(e, s)}
              >
                <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
                <span className={clsx("t-small flex-none", TONE[status])}>{terms.statuses[status]}</span>
              </div>
            ))}
          </section>
        );
      })}
      {menu}
    </div>
  );
}
