"use client";

import { Lock } from "lucide-react";
import { grade } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Degree, Subject } from "@/lib/types";
import { useOpen } from "@/components/workspace/use-open";
import { periodLabel, degreeYears, sortSubjects } from "./plan";
import { subjectState, type SubjectState } from "./subject-state";
import { useSubjectMenu } from "./subject-menu";

function StatusText({ state }: { state: SubjectState }) {
  switch (state.kind) {
    case "aprobada": {
      const n = state.finalGrade;
      const shown = n === undefined ? "" : grade(n, Number.isInteger(n) ? 0 : 2);
      return <span className="text-mint">{t("Aprobada {grade}", { grade: shown })}</span>;
    }
    case "habilitada":
      return <span className="text-primary-soft/70">{t("Habilitada")}</span>;
    case "cursando":
      return <span className="text-primary-soft">{t("Cursando")}</span>;
    case "regular":
      return <span className="text-muted">{t("Regular")}</span>;
    case "bloqueada":
      return (
        <span className="flex items-center justify-end gap-1 text-faint">
          <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("Bloqueada")}
        </span>
      );
  }
}

// Plan de una carrera como tabla densa por año y cuatrimestre.
export function PlanTable({
  degree,
  subjects,
  all,
  onEdit,
  onDelete,
}: {
  degree: Degree;
  subjects: Subject[];
  all: Subject[];
  onEdit: (subject: Subject) => void;
  onDelete: (subject: Subject) => void;
}) {
  const open = useOpen();
  const { show, menu } = useSubjectMenu({ onEdit, onDelete });
  const years = degreeYears(degree, subjects);

  const periods: { year: number; semester: 1 | 2 }[] = [];
  for (let year = 1; year <= years; year++) periods.push({ year, semester: 1 }, { year, semester: 2 });

  return (
    <div className="flex flex-col">
      {periods.map(({ year, semester }) => {
        const list = sortSubjects(subjects.filter((s) => s.year === year && s.semester === semester));
        if (list.length === 0) return null;
        return (
          <section key={`${year}-${semester}`} className="flex flex-col">
            <h3 className="section-label px-2 pb-1 pt-3">{periodLabel(year, semester)}</h3>
            {list.map((s) => {
              const state = subjectState(s, all);
              return (
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
                  <span className="t-small min-w-0 max-w-[40%] truncate text-faint">
                    {state.kind === "bloqueada" ? state.missing.join(", ") : ""}
                  </span>
                  <span className="t-small w-28 flex-none text-right">
                    <StatusText state={state} />
                  </span>
                </div>
              );
            })}
          </section>
        );
      })}
      {menu}
    </div>
  );
}
