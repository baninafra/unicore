"use client";

import type { Degree, Subject } from "@/lib/types";
import { SubjectCard } from "./subject-card";
import { degreeYears, periodLabel, sortSubjects } from "./plan";

// Grilla del plan: una columna por cuatrimestre (1.º año · 1C, 1.º año · 2C, ...).
export function PlanGrid({
  degree,
  subjects,
  all,
  onEdit,
}: {
  degree: Degree;
  subjects: Subject[];
  all: Subject[];
  onEdit: (subject: Subject) => void;
}) {
  const years = degreeYears(degree, subjects);
  const periods: { year: number; semester: 1 | 2 }[] = [];
  for (let year = 1; year <= years; year++) {
    periods.push({ year, semester: 1 }, { year, semester: 2 });
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {periods.map(({ year, semester }) => {
          const list = sortSubjects(subjects.filter((s) => s.year === year && s.semester === semester));
          return (
            <section key={`${year}-${semester}`} className="flex w-[220px] flex-none flex-col gap-2" aria-label={periodLabel(year, semester)}>
              <h3 className="t-label px-1">{periodLabel(year, semester)}</h3>
              {list.length === 0 ? (
                <p className="t-small px-1 text-faint">Sin materias</p>
              ) : (
                list.map((s) => <SubjectCard key={s.id} subject={s} all={all} onEdit={() => onEdit(s)} />)
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
