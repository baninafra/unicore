import { differenceInCalendarDays, format, isValid } from "date-fns";
import { es } from "date-fns/locale";
import type { Degree, Subject, TaskType } from "./types";

// "vie 17/10"
export function shortDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!isValid(d)) return "";
  return format(d, "EEE d/M", { locale: es });
}

// "vie 17/10 · 23:59"
export function shortDateTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!isValid(d)) return "";
  return format(d, "EEE d/M · HH:mm", { locale: es });
}

// "hoy", "mañana", "en 3 días", "vencido hace 2 días"
export function relativeDays(iso?: string) {
  if (!iso) return "";
  const diff = differenceInCalendarDays(new Date(iso), new Date());
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  if (diff > 1) return `en ${diff} días`;
  if (diff === -1) return "vencido ayer";
  return `vencido hace ${-diff} días`;
}

export function daysUntil(iso?: string) {
  if (!iso) return Infinity;
  return differenceInCalendarDays(new Date(iso), new Date());
}

// Parcial o final a menos de una semana, o cualquier cosa vencida → rojo
export function isUrgent(type: TaskType, iso?: string) {
  const d = daysUntil(iso);
  if (d < 0) return true;
  return (type === "PARCIAL" || type === "FINAL") && d <= 7;
}

// 8,42
export function grade(n?: number, digits = 2) {
  if (n === undefined || Number.isNaN(n)) return "–";
  return n.toLocaleString("es-AR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function degreeBadgeClass(degree?: Pick<Degree, "color">) {
  return degree?.color === "cyan" ? "badge badge-cyan" : "badge badge-primary";
}

export const TASK_TYPE_BADGE: Record<TaskType, string> = {
  PARCIAL: "badge badge-rose",
  FINAL: "badge badge-rose",
  TP: "badge badge-amber",
  FORO: "badge badge-amber",
  LECTURA: "badge",
  TAREA: "badge",
};

// Una materia se puede cursar si todas sus correlativas están REGULAR o APROBADA.
export function isSubjectEnabled(subject: Subject, all: Subject[]) {
  if (subject.status !== "PENDIENTE") return false;
  return subject.correlatives.every((id) => {
    const c = all.find((x) => x.id === id);
    return c && (c.status === "REGULAR" || c.status === "APROBADA");
  });
}

export function missingCorrelatives(subject: Subject, all: Subject[]) {
  return subject.correlatives
    .map((id) => all.find((x) => x.id === id))
    .filter((c): c is Subject => !!c && c.status !== "REGULAR" && c.status !== "APROBADA");
}

export function average(subjects: Subject[]) {
  const grades = subjects.filter((s) => s.status === "APROBADA" && s.finalGrade !== undefined).map((s) => s.finalGrade!);
  if (!grades.length) return undefined;
  return grades.reduce((a, b) => a + b, 0) / grades.length;
}
