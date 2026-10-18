import { average } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Degree, Subject } from "@/lib/types";

// Posición lineal de un cuatrimestre: 1.º año 1C = 0, 1.º año 2C = 1, 2.º año 1C = 2, ...
export function periodIndex(year: number, semester: 1 | 2) {
  return (year - 1) * 2 + (semester - 1);
}

// "1.º año · 1C"
export function periodLabel(year: number, semester: 1 | 2) {
  return t("{year}.º año · {semester}C", { year, semester });
}

// Orden de cuatrimestre y, dentro del mismo, orden de carga.
export function sortSubjects(list: Subject[]) {
  return [...list].sort(
    (a, b) => periodIndex(a.year, a.semester) - periodIndex(b.year, b.semester) || a.createdAt.localeCompare(b.createdAt),
  );
}

// Años a mostrar: el total de la carrera, o el año más alto que ya tenga materias.
export function degreeYears(degree: Degree, subjects: Subject[]) {
  return Math.max(degree.totalYears, ...subjects.map((s) => s.year), 1);
}

export function degreeProgress(subjects: Subject[]) {
  const approved = subjects.filter((s) => s.status === "APROBADA").length;
  return {
    total: subjects.length,
    approved,
    regular: subjects.filter((s) => s.status === "REGULAR").length,
    average: average(subjects),
    ratio: subjects.length ? approved / subjects.length : 0,
  };
}

// Una correlativa cuenta como cumplida si está REGULAR o APROBADA (misma regla que isSubjectEnabled).
export function isRequirementMet(subject?: Subject) {
  return subject?.status === "REGULAR" || subject?.status === "APROBADA";
}
