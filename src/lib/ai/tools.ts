"use client";

// Las "manos" de la IA: herramientas que puede llamar para leer y cambiar cosas en UniCore.
// Cada una devuelve un texto corto (JSON) que vuelve al modelo. Lo que borra pide confirmación.

import * as chrono from "chrono-node";
import { db, newId, nowIso } from "../db";
import type { Degree, Subject, SubjectStatus, Task, TaskPriority, TaskStatus, TaskType } from "../types";
import { LOOSE_FOLDER, SUBJECT_STATUS_LABEL, TASK_TYPE_LABEL } from "../types";
import { createNote } from "@/components/notes/note-utils";
import { deleteDegreeCascade, deleteSubjectCascade, saveDegree, saveSubject } from "@/components/careers/actions";
import { newFlashcardRecord } from "@/components/flashcards/fsrs-card";
import { deleteNote, deleteCanvas } from "../nav/actions";
import { saveNoteContent } from "../notes/note-ops";
import { markdownToBlocks } from "../notes/md-blocks";
import { deleteWithUndo } from "../undo";
import type { ViewState } from "../workspace";
import type { ApiTool } from "./server";
import { readPage, webSearch } from "./web";

export interface ToolContext {
  confirm: (title: string, detail: string) => Promise<boolean>;
  openView: (view: ViewState) => void;
}

export interface ToolResult {
  content: string; // vuelve al modelo
  label: string; // se muestra en el chat ("Creé la tarea …")
  ok: boolean;
}

// ---------- Ayudas ----------

export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parecido entre palabras: "informatico" ~ "informatica", "admin" ~ "administracion".
function wordsMatch(q: string, target: string): number {
  const qs = norm(q).split(" ").filter((w) => w.length > 1 && !["de", "la", "el", "y", "en", "a", "del", "los", "las"].includes(w));
  const ts = norm(target).split(" ");
  if (!qs.length) return 0;
  let hits = 0;
  for (const w of qs) {
    const stem = w.slice(0, Math.max(4, Math.min(w.length - 1, 7)));
    if (ts.some((t) => t === w || t.startsWith(stem) || (t.length >= 4 && w.startsWith(t)))) hits++;
  }
  return hits / qs.length;
}

type Resolved = { subject?: Subject; degree?: Degree; error?: string };

// Busca una materia (o carrera) por nombre aproximado, código o id.
async function resolvePlace(query: string | undefined): Promise<Resolved> {
  if (!query?.trim()) return {};
  const q = query.trim();
  const [subjects, degrees] = await Promise.all([db.subjects.toArray(), db.degrees.toArray()]);
  const byId = subjects.find((s) => s.id === q);
  if (byId) return { subject: byId, degree: degrees.find((d) => d.id === byId.degreeId) };
  const degById = degrees.find((d) => d.id === q);
  if (degById) return { degree: degById };

  const nq = norm(q);
  const exact = subjects.filter((s) => norm(s.name) === nq || (s.code && norm(s.code) === nq));
  if (exact.length === 1) return { subject: exact[0], degree: degrees.find((d) => d.id === exact[0].degreeId) };
  // "admin" o "sistemas": la sigla o el nombre exacto de una carrera gana sobre un parecido con una materia.
  const degExact = degrees.find((d) => norm(d.shortName) === nq || norm(d.name) === nq);
  if (degExact) return { degree: degExact };

  const scored = subjects
    .map((s) => ({ s, score: Math.max(wordsMatch(q, s.name), norm(s.name).includes(nq) ? 1 : 0) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  // Preferimos las que se están cursando si hay empate.
  const top = scored.filter((x) => x.score === scored[0]?.score);
  const cursando = top.filter((x) => x.s.status === "CURSANDO");
  const pick = top.length === 1 ? top[0] : cursando.length === 1 ? cursando[0] : undefined;
  if (pick) return { subject: pick.s, degree: degrees.find((d) => d.id === pick.s.degreeId) };

  const deg = degrees.find((d) => norm(d.shortName) === nq || norm(d.name) === nq || wordsMatch(q, d.name) >= 0.99 || wordsMatch(q, d.shortName) >= 0.99);
  if (deg && !top.length) return { degree: deg };

  if (top.length > 1) {
    return { error: `"${q}" coincide con varias materias: ${top.map((x) => x.s.name).join(", ")}. Preguntale al usuario cuál.` };
  }
  return {
    error: `No encontré una materia ni carrera llamada "${q}". Materias: ${subjects.map((s) => s.name).join(", ") || "(ninguna)"}. Carreras: ${degrees.map((d) => `${d.name} (${d.shortName})`).join(", ") || "(ninguna)"}.`,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2026-10-16", "16/10", "16/10/2026" o "el jueves" → Date local. `hora` "18:30".
function parseFecha(fecha: unknown, hora?: unknown, defHour = 23, defMin = 59): Date | undefined {
  if (typeof fecha !== "string" || !fecha.trim()) return undefined;
  const f = fecha.trim();
  let d: Date | undefined;
  let m = f.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : defHour, m[5] ? +m[5] : defMin);
  else if ((m = f.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/))) {
    const now = new Date();
    let y = m[3] ? +m[3] : now.getFullYear();
    if (y < 100) y += 2000;
    d = new Date(y, +m[2] - 1, +m[1], defHour, defMin);
    if (!m[3] && d.getTime() < now.getTime() - 30 * 86400000) d.setFullYear(y + 1);
  } else {
    const parsed = chrono.es.parseDate(f, new Date(), { forwardDate: true }) ?? chrono.parseDate(f, new Date(), { forwardDate: true });
    if (parsed) {
      d = parsed;
      if (!/\d{1,2}[:h]\d{0,2}/.test(f)) d.setHours(defHour, defMin, 0, 0);
    }
  }
  if (!d || isNaN(d.getTime())) return undefined;
  if (typeof hora === "string") {
    const hm = hora.match(/(\d{1,2})(?::|h|\.)?(\d{2})?/);
    if (hm) d.setHours(+hm[1], hm[2] ? +hm[2] : 0, 0, 0);
  }
  return d;
}

const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export function fmtDate(d: Date, withTime = true) {
  const base = `${WEEKDAY[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
}

const TASK_TYPES = Object.keys(TASK_TYPE_LABEL) as TaskType[];
function taskType(v: unknown): TaskType {
  const s = typeof v === "string" ? norm(v).toUpperCase() : "";
  if (TASK_TYPES.includes(s as TaskType)) return s as TaskType;
  if (/PARCIAL|EXAMEN|EVALUACION|RECUPERATORIO/.test(s)) return "PARCIAL";
  if (/FINAL/.test(s)) return "FINAL";
  if (/TP|PRACTICO|TRABAJO/.test(s)) return "TP";
  if (/FORO/.test(s)) return "FORO";
  if (/LECTURA|LEER/.test(s)) return "LECTURA";
  return "TAREA";
}
function priority(v: unknown): TaskPriority {
  const s = typeof v === "string" ? norm(v) : "";
  return /alta|high|urgente/.test(s) ? "HIGH" : /baja|low/.test(s) ? "LOW" : "MEDIUM";
}
function taskStatus(v: unknown): TaskStatus | undefined {
  const s = typeof v === "string" ? norm(v) : "";
  if (/hech|termin|complet|done|lista/.test(s)) return "DONE";
  if (/curso|progreso|haciendo/.test(s)) return "IN_PROGRESS";
  if (/pendiente|por hacer|todo/.test(s)) return "TODO";
  return undefined;
}
function subjectStatus(v: unknown): SubjectStatus | undefined {
  const s = typeof v === "string" ? norm(v).toUpperCase() : "";
  return (["PENDIENTE", "CURSANDO", "REGULAR", "APROBADA"] as SubjectStatus[]).find((x) => s.startsWith(x.slice(0, 5)));
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const json = (v: unknown) => JSON.stringify(v);
const fail = (msg: string, label = msg): ToolResult => ({ ok: false, content: json({ error: msg }), label });

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function taskSummary(t: Task, subjects: Map<string, Subject>) {
  return clean({
    id: t.id,
    titulo: t.title,
    tipo: TASK_TYPE_LABEL[t.type],
    materia: t.subjectId ? subjects.get(t.subjectId)?.name : undefined,
    fecha: t.dueDate ? fmtDate(new Date(t.dueDate)) : undefined,
    estado: t.status === "DONE" ? "hecha" : t.status === "IN_PROGRESS" ? "en curso" : "pendiente",
    descripcion: t.description?.slice(0, 200),
  });
}

// ---------- Definiciones (lo que ve el modelo) ----------

const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

export const TOOL_DEFS: ApiTool[] = [
  {
    type: "function",
    function: {
      name: "listar_materias",
      description: "Lista las carreras y materias del usuario con su estado, año y cuatrimestre.",
      parameters: obj({}),
    },
  },
  {
    type: "function",
    function: {
      name: "listar_tareas",
      description: "Lista tareas, parciales, finales y entregas. Sirve para ver la agenda o buscar el id de una tarea.",
      parameters: obj({
        desde: S("Fecha inicial YYYY-MM-DD (opcional)"),
        hasta: S("Fecha final YYYY-MM-DD (opcional)"),
        materia: S("Nombre de la materia (opcional)"),
        texto: S("Palabras a buscar en el título (opcional)"),
        incluir_hechas: { type: "boolean", description: "Incluir las ya hechas (por defecto no)" },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_tarea",
      description:
        "Crea una tarea, entrega, TP, parcial, final, foro o lectura en la agenda. Antes de llamarla, si falta qué hay que hacer o la fecha, preguntale al usuario; si dice que no sabe, creala igual con lo que haya.",
      parameters: obj(
        {
          titulo: S("Qué hay que hacer, corto. Ej: 'TP 2: normalización'"),
          tipo: { type: "string", enum: ["TAREA", "TP", "PARCIAL", "FINAL", "FORO", "LECTURA"] },
          materia: S("Nombre de la materia o sigla de la carrera, como lo dijo el usuario"),
          fecha: S("Fecha de entrega YYYY-MM-DD"),
          hora: S("Hora HH:MM (opcional; si no se sabe, se usa 23:59)"),
          descripcion: S("Detalles, consignas, links (opcional)"),
          prioridad: { type: "string", enum: ["baja", "media", "alta"] },
          clase: S("Clase a la que se enlaza: su fecha YYYY-MM-DD o parte del título (opcional)"),
        },
        ["titulo"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "editar_tarea",
      description: "Cambia datos de una tarea existente (también marcarla como hecha). Pedí el id con listar_tareas.",
      parameters: obj(
        {
          id: S("Id de la tarea"),
          titulo: S("Nuevo título"),
          tipo: { type: "string", enum: ["TAREA", "TP", "PARCIAL", "FINAL", "FORO", "LECTURA"] },
          materia: S("Nueva materia"),
          fecha: S("Nueva fecha YYYY-MM-DD"),
          hora: S("Nueva hora HH:MM"),
          descripcion: S("Nueva descripción"),
          estado: { type: "string", enum: ["pendiente", "en curso", "hecha"] },
          prioridad: { type: "string", enum: ["baja", "media", "alta"] },
        },
        ["id"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "eliminar",
      description:
        "Elimina una tarea, nota, materia, carrera, lienzo o flashcard. La app le pide confirmación al usuario con un botón; no hace falta que preguntes antes por texto.",
      parameters: obj(
        {
          tipo: { type: "string", enum: ["tarea", "nota", "materia", "carrera", "lienzo", "flashcard"] },
          id: S("Id del elemento (buscalo antes con las herramientas de listar)"),
        },
        ["tipo", "id"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_carrera",
      description: "Crea una carrera nueva.",
      parameters: obj(
        {
          nombre: S("Nombre completo"),
          sigla: S("Nombre corto, ej. ADMIN"),
          institucion: S("Universidad o instituto (opcional)"),
          anios: { type: "integer", description: "Duración en años" },
        },
        ["nombre", "sigla"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_materia",
      description: "Crea una materia dentro de una carrera.",
      parameters: obj(
        {
          nombre: S("Nombre de la materia"),
          carrera: S("Nombre o sigla de la carrera"),
          anio: { type: "integer", description: "Año de la carrera (1, 2, …)" },
          cuatrimestre: { type: "integer", enum: [1, 2] },
          estado: { type: "string", enum: ["pendiente", "cursando", "regular", "aprobada"] },
          codigo: S("Código (opcional)"),
          profesor_email: S("Mail del profesor (opcional)"),
        },
        ["nombre", "carrera"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "editar_materia",
      description: "Cambia datos de una materia: estado, nota final, año, cuatrimestre, mail del profe o links.",
      parameters: obj(
        {
          materia: S("Nombre o id de la materia"),
          nombre: S("Nuevo nombre"),
          estado: { type: "string", enum: ["pendiente", "cursando", "regular", "aprobada"] },
          nota_final: { type: "number" },
          anio: { type: "integer" },
          cuatrimestre: { type: "integer", enum: [1, 2] },
          profesor_email: S(""),
          campus_url: S(""),
        },
        ["materia"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_notas",
      description: "Busca en los apuntes del usuario por texto. Devuelve id, título, materia y un fragmento.",
      parameters: obj({ texto: S("Qué buscar"), materia: S("Limitar a una materia (opcional)") }, ["texto"]),
    },
  },
  {
    type: "function",
    function: {
      name: "leer_nota",
      description: "Lee el texto completo de una nota por id.",
      parameters: obj({ id: S("Id de la nota") }, ["id"]),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_nota",
      description: "Crea un apunte nuevo con contenido en Markdown (títulos, listas, tablas, negritas) y lo abre.",
      parameters: obj(
        {
          titulo: S("Título"),
          materia: S("Materia donde guardarla (opcional; si no, va a notas sueltas)"),
          contenido: S("Contenido en Markdown"),
          unidad: { type: "integer", description: "Número de unidad (opcional)" },
        },
        ["titulo", "contenido"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_idea",
      description: "Guarda una idea en el tablero de Ideas (estilo Keep). Para ideas sueltas, proyectos, cosas para investigar o listas rápidas.",
      parameters: obj(
        {
          titulo: S("Título corto"),
          texto: S("Contenido en Markdown (opcional)"),
          lista: { type: "array", items: { type: "string" }, description: "Si es una lista con casillas, los elementos (opcional)" },
          color: { type: "string", enum: ["", "rojo", "naranja", "amarillo", "verde", "turquesa", "celeste", "violeta", "rosa", "gris"] },
        },
        ["titulo"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "agregar_a_nota",
      description: "Agrega contenido en Markdown al final de una nota existente.",
      parameters: obj({ id: S("Id de la nota"), contenido: S("Markdown a agregar") }, ["id", "contenido"]),
    },
  },
  {
    type: "function",
    function: {
      name: "cargar_cronograma",
      description:
        "Carga el cronograma de una materia: crea una nota por cada clase (con fecha y temas) y agenda parciales, recuperatorios, finales, TPs y entregas como tareas. Usala cuando el usuario pase un cronograma o programa.",
      parameters: obj(
        {
          materia: S("Materia del cronograma"),
          clases: {
            type: "array",
            items: obj(
              {
                fecha: S("YYYY-MM-DD"),
                titulo: S("Tema principal de la clase"),
                temas: S("Temas, lecturas o actividades (opcional)"),
                unidad: { type: "integer" },
              },
              ["fecha", "titulo"],
            ),
          },
          evaluaciones: {
            type: "array",
            items: obj(
              {
                tipo: { type: "string", enum: ["PARCIAL", "FINAL", "TP", "FORO", "LECTURA", "TAREA"] },
                titulo: S("Ej: 'Primer parcial', 'Recuperatorio', 'Entrega TP 1'"),
                fecha: S("YYYY-MM-DD"),
                hora: S("HH:MM (opcional)"),
                descripcion: S("Temas que entran, modalidad (opcional)"),
              },
              ["tipo", "titulo", "fecha"],
            ),
          },
        },
        ["materia"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "hacer_cuestionario",
      description:
        "Arma un cuestionario de opción múltiple para estudiar: se guarda dentro de la materia (enlazado a la clase y/o al parcial) y se abre como página para responder. Escribí vos las preguntas basándote en el material (si hace falta, primero leé la clase o los apuntes con buscar_notas / leer_nota). Hacé preguntas que hagan pensar, no sólo de memoria. Si no sabés de qué materia es, preguntá.",
      parameters: obj(
        {
          titulo: S("Tema del cuestionario"),
          materia: S("Materia donde se guarda"),
          clase: S("Clase de la que sale: fecha YYYY-MM-DD o parte del título (opcional)"),
          parcial: S("Para qué parcial o final es, ej. 'Primer parcial' (opcional)"),
          preguntas: {
            type: "array",
            items: obj(
              {
                pregunta: S("Enunciado"),
                opciones: { type: "array", items: { type: "string" }, description: "4 opciones" },
                correcta: { type: "integer", description: "Índice de la opción correcta (0 a 3)" },
                explicacion: S("Por qué es la correcta, en una o dos frases"),
              },
              ["pregunta", "opciones", "correcta"],
            ),
          },
        },
        ["preguntas"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_flashcards",
      description: "Crea tarjetas de repaso (pregunta/respuesta) en una materia.",
      parameters: obj(
        {
          materia: S("Materia"),
          tarjetas: { type: "array", items: obj({ frente: S("Pregunta"), dorso: S("Respuesta") }, ["frente", "dorso"]) },
        },
        ["materia", "tarjetas"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_web",
      description:
        "Busca en internet. Usala para datos actuales (noticias, fechas, precios, versiones) o cosas que no sabés con seguridad. Devuelve títulos, links y fragmentos.",
      parameters: obj({ consulta: S("Qué buscar") }, ["consulta"]),
    },
  },
  {
    type: "function",
    function: {
      name: "leer_pagina",
      description: "Abre una página web y devuelve su texto, para leer en detalle un resultado de buscar_web.",
      parameters: obj({ url: S("Dirección completa") }, ["url"]),
    },
  },
  {
    type: "function",
    function: {
      name: "abrir",
      description: "Abre en pantalla una nota, materia, el calendario, el inicio o el repaso.",
      parameters: obj(
        {
          que: { type: "string", enum: ["nota", "materia", "calendario", "inicio", "repaso", "carreras"] },
          id: S("Id o nombre (para nota o materia)"),
        },
        ["que"],
      ),
    },
  },
];

// ---------- Ejecución ----------

type Args = Record<string, unknown>;

// Busca una clase (nota) de la materia por fecha o por parte del título.
async function findClassNote(subjectId: string, q: string): Promise<string | undefined> {
  const notes = await db.notes.where("subjectId").equals(subjectId).toArray();
  const d = parseFecha(q, undefined, 0, 0);
  const key = d ? dateKey(d) : undefined;
  const byDate = key ? notes.find((n) => n.properties?.fecha === key) : undefined;
  if (byDate) return byDate.id;
  return notes.find((n) => norm(n.title).includes(norm(q)) || wordsMatch(q, n.title) >= 0.75)?.id;
}

async function createTask(a: Args, extra: Partial<Task> = {}): Promise<{ task?: Task; error?: string }> {
  const title = str(a.titulo);
  if (!title) return { error: "Falta el título de la tarea." };
  const place = await resolvePlace(str(a.materia));
  if (place.error) return { error: place.error };
  const due = parseFecha(a.fecha, a.hora);
  if (str(a.fecha) && !due) return { error: `No entendí la fecha "${a.fecha}". Usá YYYY-MM-DD.` };
  const task: Task = clean({
    id: newId(),
    title,
    type: taskType(a.tipo ?? title),
    status: "TODO" as TaskStatus,
    priority: priority(a.prioridad),
    subjectId: place.subject?.id,
    degreeId: place.subject?.degreeId ?? place.degree?.id,
    dueDate: due?.toISOString(),
    description: str(a.descripcion),
    source: "MANUAL" as const,
    createdAt: nowIso(),
    noteId: place.subject && str(a.clase) ? await findClassNote(place.subject.id, String(a.clase)) : undefined,
    ...extra,
  });
  await db.tasks.add(task);
  return { task };
}

export async function runTool(name: string, a: Args, ctx: ToolContext): Promise<ToolResult> {
  switch (name) {
    case "listar_materias": {
      const [degrees, subjects] = await Promise.all([db.degrees.toArray(), db.subjects.toArray()]);
      const out = degrees.map((d) => ({
        carrera: d.name,
        sigla: d.shortName,
        id: d.id,
        materias: subjects
          .filter((s) => s.degreeId === d.id)
          .sort((x, y) => x.year - y.year || x.semester - y.semester)
          .map((s) => clean({ id: s.id, nombre: s.name, anio: s.year, cuatri: s.semester, estado: SUBJECT_STATUS_LABEL[s.status], nota: s.finalGrade })),
      }));
      return { ok: true, content: json(out), label: "Revisé tus materias" };
    }

    case "listar_tareas": {
      const subjects = new Map((await db.subjects.toArray()).map((s) => [s.id, s]));
      const place = await resolvePlace(str(a.materia));
      const from = parseFecha(a.desde, undefined, 0, 0);
      const to = parseFecha(a.hasta, undefined, 23, 59);
      const text = str(a.texto) ? norm(String(a.texto)) : "";
      let tasks = await db.tasks.toArray();
      tasks = tasks.filter(
        (t) =>
          (a.incluir_hechas || t.status !== "DONE") &&
          (!place.subject || t.subjectId === place.subject.id) &&
          (!place.degree || place.subject || t.degreeId === place.degree.id) &&
          (!from || (t.dueDate && new Date(t.dueDate) >= from)) &&
          (!to || (t.dueDate && new Date(t.dueDate) <= to)) &&
          (!text || norm(t.title).includes(text) || wordsMatch(text, t.title) >= 0.5),
      );
      tasks.sort((x, y) => (x.dueDate ?? "9").localeCompare(y.dueDate ?? "9"));
      return { ok: true, content: json(tasks.slice(0, 60).map((t) => taskSummary(t, subjects))), label: "Revisé tu agenda" };
    }

    case "crear_tarea": {
      const { task, error } = await createTask(a);
      if (error || !task) return fail(error ?? "No se pudo crear", "No pude crear la tarea");
      const subj = task.subjectId ? (await db.subjects.get(task.subjectId))?.name : undefined;
      return {
        ok: true,
        content: json({ creada: true, id: task.id, materia: subj, fecha: task.dueDate ? fmtDate(new Date(task.dueDate)) : "sin fecha" }),
        label: `Creé la tarea «${task.title}»${task.dueDate ? ` para el ${fmtDate(new Date(task.dueDate), false)}` : ""}`,
      };
    }

    case "editar_tarea": {
      const t = await db.tasks.get(String(a.id ?? ""));
      if (!t) return fail("No existe una tarea con ese id. Buscala con listar_tareas.", "No encontré la tarea");
      const patch: Partial<Task> = {};
      if (str(a.titulo)) patch.title = str(a.titulo);
      if (str(a.tipo)) patch.type = taskType(a.tipo);
      if (str(a.descripcion)) patch.description = str(a.descripcion);
      if (str(a.prioridad)) patch.priority = priority(a.prioridad);
      const st = taskStatus(a.estado);
      if (st) patch.status = st;
      if (str(a.fecha) || str(a.hora)) {
        const base = str(a.fecha) ?? (t.dueDate ? dateKey(new Date(t.dueDate)) : undefined);
        const due = parseFecha(base, a.hora ?? (t.dueDate && !str(a.fecha) ? undefined : undefined));
        if (!due) return fail(`No entendí la fecha "${a.fecha}".`);
        patch.dueDate = due.toISOString();
      }
      if (str(a.materia)) {
        const place = await resolvePlace(str(a.materia));
        if (place.error) return fail(place.error);
        patch.subjectId = place.subject?.id;
        patch.degreeId = place.subject?.degreeId ?? place.degree?.id;
      }
      await db.tasks.update(t.id, patch);
      return { ok: true, content: json({ actualizada: true }), label: st === "DONE" ? `Marqué «${t.title}» como hecha` : `Actualicé «${patch.title ?? t.title}»` };
    }

    case "eliminar": {
      const id = String(a.id ?? "");
      const tipo = String(a.tipo ?? "");
      let title: string | undefined;
      let run: (() => Promise<unknown>) | undefined;
      if (tipo === "tarea") {
        const t = await db.tasks.get(id);
        title = t?.title;
        run = () => db.tasks.delete(id);
      } else if (tipo === "nota") {
        const n = await db.notes.get(id);
        title = n?.title;
        run = () => deleteNote(id);
      } else if (tipo === "materia") {
        const s = await db.subjects.get(id);
        title = s?.name;
        run = () => deleteSubjectCascade(id);
      } else if (tipo === "carrera") {
        const d = await db.degrees.get(id);
        title = d?.name;
        run = () => deleteDegreeCascade(id);
      } else if (tipo === "lienzo") {
        const c = await db.canvases.get(id);
        title = c?.name;
        run = () => deleteCanvas(id);
      } else if (tipo === "flashcard") {
        const f = await db.flashcards.get(id);
        title = f?.front;
        run = () => db.flashcards.delete(id);
      }
      if (!title || !run) return fail(`No existe ${tipo} con ese id. Buscalo primero.`, "No encontré qué eliminar");
      const extra = tipo === "materia" ? " Se borran también sus tareas, apuntes, PDFs y flashcards." : tipo === "carrera" ? " Se borran también todas sus materias y lo que tengan adentro." : "";
      const yes = await ctx.confirm(`¿Eliminar ${tipo} «${title}»?`, extra.trim());
      if (!yes) return { ok: false, content: json({ cancelado: true, motivo: "El usuario no confirmó. No lo borres." }), label: `No eliminé «${title}»` };
      await deleteWithUndo(`Se eliminó ${tipo} «${title}»`, run);
      return { ok: true, content: json({ eliminado: true }), label: `Eliminé ${tipo} «${title}»` };
    }

    case "crear_carrera": {
      const name = str(a.nombre);
      if (!name) return fail("Falta el nombre.");
      const count = await db.degrees.count();
      const id = await saveDegree({
        name,
        shortName: (str(a.sigla) ?? name.split(" ").map((w) => w[0]).join("")).toUpperCase().slice(0, 10),
        institution: str(a.institucion),
        color: count % 2 === 0 ? "primary" : "cyan",
        totalYears: Number(a.anios) || 3,
      });
      return { ok: true, content: json({ id }), label: `Creé la carrera «${name}»` };
    }

    case "crear_materia": {
      const name = str(a.nombre);
      if (!name) return fail("Falta el nombre.");
      const place = await resolvePlace(str(a.carrera));
      let degreeId = place.degree?.id;
      if (!degreeId) {
        const degrees = await db.degrees.toArray();
        if (degrees.length === 1) degreeId = degrees[0].id;
        else return fail(`¿En qué carrera? Opciones: ${degrees.map((d) => d.shortName).join(", ")}`);
      }
      const id = await saveSubject({
        degreeId,
        name,
        year: Number(a.anio) || 1,
        semester: Number(a.cuatrimestre) === 2 ? 2 : 1,
        status: subjectStatus(a.estado) ?? "CURSANDO",
        correlatives: [],
        professorEmail: str(a.profesor_email),
      });
      if (str(a.codigo)) await db.subjects.update(id, { code: str(a.codigo) });
      return { ok: true, content: json({ id }), label: `Creé la materia «${name}»` };
    }

    case "editar_materia": {
      const place = await resolvePlace(str(a.materia));
      if (!place.subject) return fail(place.error ?? "No encontré la materia.");
      const patch: Partial<Subject> = clean({
        name: str(a.nombre),
        status: subjectStatus(a.estado),
        finalGrade: typeof a.nota_final === "number" ? a.nota_final : undefined,
        year: typeof a.anio === "number" ? a.anio : undefined,
        semester: a.cuatrimestre === 1 || a.cuatrimestre === 2 ? (a.cuatrimestre as 1 | 2) : undefined,
        professorEmail: str(a.profesor_email),
        campusUrl: str(a.campus_url),
      });
      await db.subjects.update(place.subject.id, patch);
      return { ok: true, content: json({ actualizada: true }), label: `Actualicé «${patch.name ?? place.subject.name}»` };
    }

    case "buscar_notas": {
      const q = norm(String(a.texto ?? ""));
      const place = await resolvePlace(str(a.materia));
      const subjects = new Map((await db.subjects.toArray()).map((s) => [s.id, s.name]));
      const words = q.split(" ").filter((w) => w.length > 2);
      const notes = (await db.notes.toArray())
        .filter((n) => !place.subject || n.subjectId === place.subject.id)
        .map((n) => {
          const hay = norm(`${n.title} ${n.plainTextCache}`);
          const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0) + (norm(n.title).includes(q) ? 3 : 0);
          const at = Math.max(0, n.plainTextCache.toLowerCase().indexOf(words[0] ?? ""));
          return { n, score, snip: n.plainTextCache.slice(Math.max(0, at - 80), at + 220) };
        })
        .filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, 10);
      return {
        ok: true,
        content: json(notes.map(({ n, snip }) => ({ id: n.id, titulo: n.title, materia: subjects.get(n.subjectId) ?? "suelta", fragmento: snip }))),
        label: "Busqué en tus apuntes",
      };
    }

    case "leer_nota": {
      const n = await db.notes.get(String(a.id ?? ""));
      if (!n) return fail("No existe esa nota.");
      return { ok: true, content: json({ titulo: n.title, texto: n.plainTextCache.slice(0, 12000) }), label: `Leí «${n.title}»` };
    }

    case "crear_nota": {
      const title = str(a.titulo) ?? "Sin título";
      const place = await resolvePlace(str(a.materia));
      if (place.error && str(a.materia)) return fail(place.error);
      const id = await createNote({
        subjectId: place.subject?.id ?? LOOSE_FOLDER,
        title,
        unitNumber: Number(a.unidad) || 1,
        content: markdownToBlocks(String(a.contenido ?? "")),
      });
      ctx.openView({ type: "nota", id });
      return { ok: true, content: json({ id }), label: `Creé la nota «${title}»` };
    }

    case "crear_idea": {
      const { addIdea } = await import("@/views/ideas-view");
      const lista = Array.isArray(a.lista) ? (a.lista as unknown[]).map(String).filter(Boolean) : [];
      const title = str(a.titulo) ?? "Idea";
      await addIdea(title, { body: lista.length ? lista.join("\n") : String(a.texto ?? ""), checklist: lista.length > 0, color: str(a.color) });
      return { ok: true, content: json({ creada: true }), label: `Guardé la idea «${title}»` };
    }

    case "agregar_a_nota": {
      const n = await db.notes.get(String(a.id ?? ""));
      if (!n) return fail("No existe esa nota.");
      await saveNoteContent(n.id, [...(n.content as unknown[]), ...markdownToBlocks(String(a.contenido ?? ""))]);
      return { ok: true, content: json({ ok: true }), label: `Agregué contenido a «${n.title}»` };
    }

    case "cargar_cronograma": {
      const place = await resolvePlace(str(a.materia));
      if (!place.subject) return fail(place.error ?? "Decime de qué materia es el cronograma.", "Falta la materia");
      const subject = place.subject;
      const clases = Array.isArray(a.clases) ? (a.clases as Args[]) : [];
      const evals = Array.isArray(a.evaluaciones) ? (a.evaluaciones as Args[]) : [];
      const existing = await db.notes.where("subjectId").equals(subject.id).toArray();
      let notes = 0;
      let tasks = 0;
      const sorted = clases
        .map((c) => ({ c, d: parseFecha(c.fecha, undefined, 8, 0) }))
        .filter((x) => x.d)
        .sort((x, y) => x.d!.getTime() - y.d!.getTime());
      for (let i = 0; i < sorted.length; i++) {
        const { c, d } = sorted[i];
        const title = `Clase ${i + 1} · ${pad(d!.getDate())}/${pad(d!.getMonth() + 1)} · ${str(c.titulo) ?? "Clase"}`;
        if (existing.some((n) => n.title === title)) continue;
        const md = [`**Fecha:** ${fmtDate(d!, false)}`, str(c.temas) ? `\n## Temas\n${String(c.temas)}` : "", "\n## Apuntes de la clase\n"].join("\n");
        const id = await createNote({
          subjectId: subject.id,
          title,
          unitNumber: Number(c.unidad) || 1,
          content: markdownToBlocks(md),
        });
        await db.notes.update(id, { properties: { fecha: dateKey(d!), tipo: "clase" } });
        notes++;
      }
      const allTasks = await db.tasks.where("subjectId").equals(subject.id).toArray();
      for (const e of evals) {
        const due = parseFecha(e.fecha, e.hora);
        const title = str(e.titulo);
        if (!title) continue;
        if (allTasks.some((t) => norm(t.title) === norm(title) && t.dueDate && due && dateKey(new Date(t.dueDate)) === dateKey(due))) continue;
        const r = await createTask({ ...e, materia: subject.id });
        if (r.task) {
          tasks++;
          allTasks.push(r.task);
        }
      }
      // Respaldo: clases que en realidad son evaluaciones o entregas y el modelo no agendó.
      for (const { c, d } of sorted) {
        const text = `${str(c.titulo) ?? ""} ${str(c.temas) ?? ""}`;
        if (!/parcial|recuperatorio|final|examen|coloquio|entrega|\btp\b|trabajo pr[aá]ctico/i.test(text)) continue;
        if (allTasks.some((t) => t.dueDate && dateKey(new Date(t.dueDate)) === dateKey(d!))) continue;
        const hour = text.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs|h\b|horas)/i);
        const r = await createTask({
          titulo: str(c.titulo),
          tipo: text,
          materia: subject.id,
          fecha: dateKey(d!),
          hora: hour ? `${hour[1]}:${hour[2] ?? "00"}` : undefined,
          descripcion: str(c.temas),
        });
        if (r.task) {
          tasks++;
          allTasks.push(r.task);
        }
      }
      return {
        ok: true,
        content: json({ clases_creadas: notes, evaluaciones_agendadas: tasks, materia: subject.name }),
        label: `Cargué el cronograma de ${subject.name}: ${notes} clases y ${tasks} evaluaciones/entregas`,
      };
    }

    case "hacer_cuestionario": {
      const questions = (Array.isArray(a.preguntas) ? (a.preguntas as Args[]) : [])
        .map((q) => {
          const options = (Array.isArray(q.opciones) ? q.opciones : []).map(String).filter(Boolean).slice(0, 6);
          const answerIndex = Math.min(Math.max(0, Number(q.correcta) || 0), options.length - 1);
          return { question: String(q.pregunta ?? "").trim(), options, answerIndex, explanation: String(q.explicacion ?? "").trim() };
        })
        .filter((q) => q.question && q.options.length >= 2);
      if (!questions.length) return fail("No llegaron preguntas válidas.");
      const place = await resolvePlace(str(a.materia));
      if (str(a.materia) && place.error) return fail(place.error);
      const subjectId = place.subject?.id;
      const claseId = subjectId && str(a.clase) ? await findClassNote(subjectId, String(a.clase)) : undefined;
      let parcial: Task | undefined;
      if (subjectId && str(a.parcial)) {
        const { examsOf } = await import("../quiz/quiz-store");
        const exams = await examsOf(subjectId);
        const q = String(a.parcial);
        parcial = exams.find((t) => norm(t.title).includes(norm(q)) || wordsMatch(q, t.title) >= 0.6) ?? (/(primer|1)/i.test(q) ? exams.find((t) => t.type === "PARCIAL") : undefined);
      }
      const { saveQuiz } = await import("../quiz/quiz-store");
      const title = `Cuestionario · ${str(a.titulo) ?? parcial?.title ?? "Repaso"}`;
      const id = await saveQuiz({ subjectId, title, questions, claseId, parcialId: parcial?.id, parcial: parcial?.title ?? str(a.parcial), tema: str(a.titulo) });
      ctx.openView({ type: "nota", id });
      return {
        ok: true,
        content: json({ guardado: true, abierto: true, preguntas: questions.length, nota: "Ya está abierto como página para responder. No repitas las preguntas ni las respuestas en el chat." }),
        label: `Armé «${title}» (${questions.length} preguntas)${place.subject ? ` en ${place.subject.name}` : ""}`,
      };
    }

    case "crear_flashcards": {
      const place = await resolvePlace(str(a.materia));
      if (!place.subject) return fail(place.error ?? "¿De qué materia?");
      const cards = (Array.isArray(a.tarjetas) ? (a.tarjetas as Args[]) : [])
        .map((c) => ({ front: str(c.frente), back: str(c.dorso) }))
        .filter((c): c is { front: string; back: string } => !!c.front && !!c.back);
      if (!cards.length) return fail("No llegaron tarjetas.");
      await db.flashcards.bulkAdd(cards.map((c) => newFlashcardRecord({ subjectId: place.subject!.id, ...c })));
      return { ok: true, content: json({ creadas: cards.length }), label: `Creé ${cards.length} flashcards en ${place.subject.name}` };
    }

    case "buscar_web": {
      const q = str(a.consulta);
      if (!q) return fail("Falta qué buscar.");
      try {
        const results = await webSearch(q);
        return { ok: true, content: json(results), label: `Busqué en internet: «${q}»` };
      } catch (err) {
        return fail(err instanceof Error ? err.message : "No se pudo buscar.", "No pude buscar en internet");
      }
    }

    case "leer_pagina": {
      const url = str(a.url);
      if (!url) return fail("Falta la URL.");
      try {
        const page = await readPage(url);
        return { ok: true, content: json(page), label: `Leí ${new URL(url).hostname}` };
      } catch (err) {
        return fail(err instanceof Error ? err.message : "No se pudo abrir.", "No pude abrir la página");
      }
    }

    case "abrir": {
      const que = String(a.que ?? "");
      if (que === "nota") {
        let n = await db.notes.get(String(a.id ?? ""));
        if (!n && str(a.id)) n = (await db.notes.toArray()).find((x) => wordsMatch(String(a.id), x.title) >= 0.8);
        if (!n) return fail("No encontré la nota.");
        ctx.openView({ type: "nota", id: n.id });
        return { ok: true, content: "{}", label: `Abrí «${n.title}»` };
      }
      if (que === "materia") {
        const place = await resolvePlace(str(a.id));
        if (!place.subject) return fail(place.error ?? "No encontré la materia.");
        ctx.openView({ type: "materia", id: place.subject.id });
        return { ok: true, content: "{}", label: `Abrí ${place.subject.name}` };
      }
      if (que === "calendario" || que === "inicio" || que === "repaso" || que === "carreras") {
        ctx.openView({ type: que } as ViewState);
        return { ok: true, content: "{}", label: `Abrí ${que}` };
      }
      return fail("No sé abrir eso.");
    }
  }
  return fail(`No existe la herramienta ${name}.`);
}

// Resumen de la situación para el sistema: fecha, días que vienen y materias.
export async function situationText(): Promise<string> {
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return `${i === 0 ? "hoy " : i === 1 ? "mañana " : ""}${fmtDate(d, false)} (${dateKey(d)})`;
  });
  const [degrees, subjects] = await Promise.all([db.degrees.toArray(), db.subjects.toArray()]);
  const lines = degrees.map(
    (d) =>
      `- ${d.name} (${d.shortName}): ` +
      (subjects
        .filter((s) => s.degreeId === d.id && (s.status === "CURSANDO" || s.status === "REGULAR"))
        .map((s) => s.name)
        .join(", ") || "sin materias en curso"),
  );
  return [
    `Fecha y hora actual: ${fmtDate(now)} (zona horaria del usuario). El año actual es ${now.getFullYear()}.`,
    `Próximos días: ${days.join("; ")}.`,
    `Carreras y materias en curso:\n${lines.join("\n") || "(todavía no cargó carreras)"}`,
  ].join("\n");
}
