import { Award, BookOpen, CheckSquare, FileText, Flame, MessagesSquare, type LucideIcon } from "lucide-react";
import type { Task, TaskPriority, TaskStatus, TaskType } from "@/lib/types";

export const TASK_TYPE_ICON: Record<TaskType, LucideIcon> = {
  PARCIAL: Flame,
  FINAL: Award,
  TP: FileText,
  FORO: MessagesSquare,
  LECTURA: BookOpen,
  TAREA: CheckSquare,
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  INBOX_EMAIL: "En el inbox",
  TODO: "Por hacer",
  IN_PROGRESS: "En curso",
  DONE: "Hecho",
};

// Hora por defecto cuando una tarea tiene fecha pero no hora.
export const END_OF_DAY = "23:59";

// Fin del día local en ISO: sirve para "esta tarea vence ese día".
export function endOfDayIso(day: Date) {
  const d = new Date(day);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

// Orden por fecha: primero las que vencen antes, las que no tienen fecha al final.
export function byDueDate(a: Task, b: Task) {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
}

// Quita las claves con undefined para que Dexie no guarde campos vacíos.
export function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
