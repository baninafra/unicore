// Modelos de datos. Espejan supabase/schema.sql para poder migrar más adelante.

export type DegreeColor = "primary" | "cyan";

export interface Degree {
  id: string;
  name: string; // "Tecnicatura en Administración"
  shortName: string; // "ADMIN"
  institution?: string;
  color: DegreeColor;
  totalYears: number;
  createdAt: string;
}

export type SubjectStatus = "PENDIENTE" | "CURSANDO" | "REGULAR" | "APROBADA";

export interface Subject {
  id: string;
  degreeId: string;
  name: string;
  code?: string;
  year: number;
  semester: 1 | 2;
  status: SubjectStatus;
  finalGrade?: number;
  correlatives: string[]; // ids de materias que tienen que estar REGULAR o APROBADA
  professorEmail?: string;
  campusUrl?: string;
  driveUrl?: string;
  createdAt: string;
}

export type TaskType = "PARCIAL" | "FINAL" | "TP" | "FORO" | "LECTURA" | "TAREA";
export type TaskStatus = "INBOX_EMAIL" | "TODO" | "IN_PROGRESS" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export interface Task {
  id: string;
  degreeId?: string;
  subjectId?: string;
  title: string;
  description?: string;
  aiSummary?: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string; // ISO
  source: "MANUAL" | "EMAIL_AUTO";
  rawEmailBody?: string;
  rawEmailFrom?: string;
  createdAt: string;
}

export interface Note {
  id: string;
  subjectId: string;
  title: string;
  unitNumber: number;
  content: unknown[]; // bloques de BlockNote
  plainTextCache: string;
  updatedAt: string;
  createdAt: string;
}

// Bibliografía: texto extraído de PDFs (también sirve de contexto para la IA)
export interface SubjectDocument {
  id: string;
  subjectId: string;
  unitNumber: number;
  fileName: string;
  extractedText: string;
  pageCount: number;
  fileId?: string; // archivo original guardado en `files`
  createdAt: string;
}

// Archivos binarios (fotos de apuntes, PDFs originales)
export interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

export interface Flashcard {
  id: string;
  subjectId: string;
  noteId?: string;
  front: string;
  back: string;
  // Campos FSRS (ts-fsrs Card)
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview?: string;
  createdAt: string;
}

export interface StudySession {
  id: string;
  subjectId?: string;
  durationMinutes: number;
  completedAt: string;
}

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  PARCIAL: "Parcial",
  FINAL: "Final",
  TP: "TP",
  FORO: "Foro",
  LECTURA: "Lectura",
  TAREA: "Tarea",
};

export const SUBJECT_STATUS_LABEL: Record<SubjectStatus, string> = {
  PENDIENTE: "Pendiente",
  CURSANDO: "Cursando",
  REGULAR: "Regular",
  APROBADA: "Aprobada",
};
