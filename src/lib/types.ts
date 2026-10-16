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

// Cronograma de la materia: qué se ve cada día, y las fechas de parciales, entregas y finales.
export type ScheduleKind = "CLASE" | "PARCIAL" | "ENTREGA" | "FINAL" | "FERIADO" | "OTRO";

export interface ScheduleEntry {
  id: string;
  date: string; // "2026-10-14" (día local)
  title: string; // tema o actividad
  kind: ScheduleKind;
  done?: boolean;
}

export const SCHEDULE_KIND_LABEL: Record<ScheduleKind, string> = {
  CLASE: "Clase",
  PARCIAL: "Parcial",
  ENTREGA: "Entrega",
  FINAL: "Final",
  FERIADO: "Feriado",
  OTRO: "Otro",
};

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
  schedule?: ScheduleEntry[]; // cronograma de la materia
  createdAt: string;
}

export type TaskType = "PARCIAL" | "FINAL" | "TP" | "FORO" | "LECTURA" | "TAREA";
export type TaskStatus = "INBOX_EMAIL" | "TODO" | "IN_PROGRESS" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";

export interface Task {
  id: string;
  degreeId?: string;
  subjectId?: string;
  noteId?: string; // clase o nota enlazada
  title: string;
  description?: string; // texto plano (búsqueda, IA, vistas previas)
  content?: unknown[]; // detalle completo en bloques (imágenes, listas, tablas…)
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

// Carpetas especiales (no son materias). Una nota con subjectId = DAILY_FOLDER es una nota diaria.
export const DAILY_FOLDER = "__diario";
export const TEMPLATES_FOLDER = "__plantillas";
export const LOOSE_FOLDER = "__notas"; // notas sueltas, sin materia
export const IDEAS_FOLDER = "__ideas"; // ideas (vista estilo Keep)

export interface Note {
  id: string;
  subjectId: string; // id de materia o una carpeta especial
  title: string;
  unitNumber: number;
  content: unknown[]; // bloques de BlockNote
  plainTextCache: string;
  // Estilo Obsidian (se recalculan al guardar el apunte)
  properties?: Record<string, string | number | boolean | string[]>; // propiedades tipo frontmatter
  aliases?: string[];
  tags?: string[]; // sin "#", en minúsculas
  links?: string[]; // ids de notas a las que enlaza con [[...]]
  dailyDate?: string; // "2026-10-13" si es nota diaria
  parentId?: string; // subnota: id de la nota que la contiene (hasta dos niveles)
  updatedAt: string;
  createdAt: string;
}

// Lienzo (Canvas): tarjetas de texto, notas, archivos y enlaces en un tablero libre.
export interface CanvasDoc {
  id: string;
  name: string;
  subjectId?: string;
  data: { nodes: unknown[]; edges: unknown[]; viewport?: { x: number; y: number; zoom: number } };
  updatedAt: string;
  createdAt: string;
}

// Recuperación de archivos: copias de una nota cada tanto.
export interface NoteSnapshot {
  id: string;
  noteId: string;
  title: string;
  content: unknown[];
  plainText: string;
  createdAt: string;
}

export type BookmarkKind = "note" | "subject" | "canvas" | "search" | "document";

export interface Bookmark {
  id: string;
  kind: BookmarkKind;
  targetId: string; // id del destino, o el texto de búsqueda
  title: string;
  order: number;
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
  usedOcr?: boolean;
  highlights?: PdfHighlight[]; // resaltados hechos en el lector (estilo Logseq)
  createdAt: string;
}

export interface PdfHighlight {
  id: string;
  page: number;
  text: string;
  color: "amarillo" | "verde" | "azul" | "rosa";
  rects: { x: number; y: number; w: number; h: number }[]; // relativos a la página (0 a 1)
  note?: string;
  createdAt: string;
}

// Archivos que se editan con los editores incrustados (Word, Excel, PowerPoint, PDF, geometría).
export type OfficeKind = "doc" | "sheet" | "deck" | "pdf" | "geo";

export interface OfficeDoc {
  id: string;
  subjectId: string; // materia o carpeta especial, como las notas
  name: string; // "Informe.docx", con extensión
  kind: OfficeKind;
  fileId?: string; // contenido guardado en `files`; sin él, el editor arranca vacío
  textCache?: string; // texto del archivo para buscar y para la IA (se actualiza al guardar)
  updatedAt: string;
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

// Calendarios externos (Google Calendar, Outlook, iCloud, el campus…) conectados por enlace iCal o archivo .ics.
export type CalendarColor = "primary" | "cyan" | "mint" | "amber" | "rose";

export interface CalendarSource {
  id: string;
  name: string;
  local?: boolean; // calendario propio (sus eventos se editan en UniCore); sin esto, es una suscripción iCal
  url?: string; // enlace iCal (https o webcal)
  ics?: string; // texto del archivo .ics cuando se importó un archivo
  color: CalendarColor;
  enabled: boolean; // visible en el calendario
  lastSync?: string;
  error?: string;
  eventCount?: number;
  createdAt: string;
}

// Copia local de los eventos de un calendario externo. Se vuelve a generar al sincronizar.
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string; // ISO
  end?: string; // ISO (en eventos de día completo es exclusivo)
  allDay: boolean;
  location?: string;
  description?: string;
}

// Eventos propios, estilo Thunderbird: viven en un calendario local, se pueden repetir, tener recordatorios
// y estar vinculados a una tarea (por ejemplo, el bloque de estudio para un parcial) o a una materia.
export type EventCategory = "CLASE" | "ESTUDIO" | "EXAMEN" | "ENTREGA" | "REUNION" | "PERSONAL" | "OTRO";
export type EventStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

export interface CalEvent {
  id: string;
  calendarId: string; // calendario local (CalendarSource con local = true)
  title: string;
  start: string; // ISO
  end: string; // ISO (en eventos de día completo es exclusivo: el día siguiente a las 00:00)
  allDay: boolean;
  location?: string;
  description?: string;
  category?: EventCategory;
  status?: EventStatus;
  rrule?: string; // regla de repetición iCalendar, ej. "FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261201T000000Z"
  exdates?: string[]; // inicios (ISO) de repeticiones borradas
  reminders?: number[]; // minutos antes del inicio
  subjectId?: string;
  taskId?: string; // tarea vinculada
  noteId?: string;
  createdAt: string;
  updatedAt: string;
}

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  CLASE: "Clase",
  ESTUDIO: "Estudio",
  EXAMEN: "Examen",
  ENTREGA: "Entrega",
  REUNION: "Reunión",
  PERSONAL: "Personal",
  OTRO: "Otro",
};

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
