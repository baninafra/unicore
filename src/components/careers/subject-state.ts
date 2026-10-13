import { isSubjectEnabled, missingCorrelatives } from "@/lib/format";
import type { Subject } from "@/lib/types";

// Estado visible de una materia dentro del plan.
export type SubjectState =
  | { kind: "aprobada"; finalGrade?: number }
  | { kind: "habilitada" }
  | { kind: "cursando" }
  | { kind: "regular" }
  | { kind: "bloqueada"; missing: string[] };

export function subjectState(subject: Subject, all: Subject[]): SubjectState {
  if (subject.status === "APROBADA") return { kind: "aprobada", finalGrade: subject.finalGrade };
  if (subject.status === "CURSANDO") return { kind: "cursando" };
  if (subject.status === "REGULAR") return { kind: "regular" };
  if (isSubjectEnabled(subject, all)) return { kind: "habilitada" };
  return { kind: "bloqueada", missing: missingCorrelatives(subject, all).map((s) => s.name) };
}
