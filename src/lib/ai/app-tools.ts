"use client";

// Herramientas de la IA para lo que no son notas ni tareas: renombrar y mover cualquier cosa del explorador,
// abrir archivos y el escáner, y manejar el calendario propio (eventos con repetición y recordatorios, bloques
// de estudio para las tareas).

import * as chrono from "chrono-node";
import { addDays, addMinutes, startOfDay } from "date-fns";
import { db } from "../db";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, EVENT_CATEGORY_LABEL, type CalEvent, type EventCategory } from "../types";
import { moveItem, renameItem } from "../nav/actions";
import { defaultCalendarId, deleteOccurrence, occurrences, planTask, saveEvent, updateOccurrence } from "../calendars/events";
import type { ApiTool } from "./server";
import type { ToolContext, ToolResult } from "./tools";

type Args = Record<string, unknown>;

const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const json = (v: unknown) => JSON.stringify(v);
const fail = (msg: string): ToolResult => ({ ok: false, content: json({ error: msg }), label: msg });
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
const noExt = (s: string) => s.replace(/[.][a-z0-9]+$/i, "");

const CATEGORIES = Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[];
const REPEAT: Record<string, string> = {
  diario: "FREQ=DAILY",
  "lunes a viernes": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  semanal: "FREQ=WEEKLY",
  mensual: "FREQ=MONTHLY",
  anual: "FREQ=YEARLY",
};
const DAY_CODE: Record<string, string> = { lunes: "MO", martes: "TU", miercoles: "WE", jueves: "TH", viernes: "FR", sabado: "SA", domingo: "SU" };

export const APP_TOOL_DEFS: ApiTool[] = [
  {
    type: "function",
    function: {
      name: "renombrar",
      description: "Le cambia el nombre a una nota, lienzo, archivo (Word, Excel, PowerPoint, PDF, geometría) o materia.",
      parameters: obj({ tipo: { type: "string", enum: ["nota", "lienzo", "archivo", "materia"] }, id: S("Id o nombre actual"), nombre: S("Nombre nuevo") }, ["id", "nombre"]),
    },
  },
  {
    type: "function",
    function: {
      name: "mover",
      description: "Mueve notas, lienzos o archivos a otra materia o carpeta (Notas, Diario, Ideas, Plantillas).",
      parameters: obj(
        {
          elementos: { type: "array", description: "Ids o nombres de lo que hay que mover", items: { type: "string" } },
          carpeta: S("Materia o carpeta de destino"),
        },
        ["elementos", "carpeta"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "abrir_archivo",
      description: "Abre en pantalla un archivo de Word, Excel, PowerPoint, PDF o geometría, o el escáner de documentos.",
      parameters: obj({ archivo: S("Nombre o id del archivo, o 'escaner' para abrir el escáner (con fotos subidas)") }, ["archivo"]),
    },
  },
  {
    type: "function",
    function: {
      name: "listar_eventos",
      description: "Lista los eventos del calendario (propios y suscritos) y las tareas con fecha entre dos fechas. Sirve para ver la agenda o encontrar un evento antes de editarlo o borrarlo.",
      parameters: obj({ desde: S("Fecha de inicio (ej. 'hoy', '2026-10-20'); por defecto hoy"), hasta: S("Fecha de fin; por defecto 7 días después"), texto: S("Filtrar por título (opcional)") }),
    },
  },
  {
    type: "function",
    function: {
      name: "crear_evento",
      description: "Crea un evento en el calendario propio: clases, turnos, reuniones, horarios de estudio. Puede repetirse y tener recordatorio.",
      parameters: obj(
        {
          titulo: S("Título"),
          inicio: S("Fecha y hora de inicio, ej. 'jueves 18:00' o '2026-10-22T18:00'"),
          fin: S("Fecha y hora de fin (opcional; por defecto dura 1 hora)"),
          todo_el_dia: { type: "boolean", description: "Si dura el día entero" },
          lugar: S("Lugar o link (opcional)"),
          categoria: { type: "string", enum: CATEGORIES.map((c) => EVENT_CATEGORY_LABEL[c].toLowerCase()) },
          repetir: { type: "string", enum: ["no", "diario", "lunes a viernes", "semanal", "mensual", "anual"] },
          dias: S("Con repetir=semanal: días separados por coma, ej. 'lunes, miércoles'"),
          hasta_fecha: S("Hasta cuándo se repite (opcional)"),
          recordatorio_min: { type: "number", description: "Minutos antes para avisar (opcional)" },
          materia: S("Materia relacionada (opcional)"),
          descripcion: S("Descripción (opcional)"),
        },
        ["titulo", "inicio"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "editar_evento",
      description: "Cambia un evento propio (horario, título, lugar…). Si se repite, el cambio va para toda la serie salvo que pidas 'solo esta'.",
      parameters: obj(
        {
          evento: S("Id del evento (de listar_eventos) o su título"),
          fecha: S("Con 'solo_esta': qué repetición cambiar"),
          solo_esta: { type: "boolean" },
          titulo: S("Título nuevo"),
          inicio: S("Inicio nuevo"),
          fin: S("Fin nuevo"),
          lugar: S("Lugar nuevo"),
        },
        ["evento"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "eliminar_evento",
      description: "Borra un evento propio del calendario (pide confirmación). Si se repite, borra toda la serie salvo 'solo_esta'.",
      parameters: obj({ evento: S("Id o título"), fecha: S("Con solo_esta: qué repetición"), solo_esta: { type: "boolean" } }, ["evento"]),
    },
  },
  {
    type: "function",
    function: {
      name: "planificar_tarea",
      description: "Reserva un bloque en el calendario para trabajar en una tarea (queda vinculado a la tarea; no cambia la fecha de entrega).",
      parameters: obj({ tarea: S("Id o título de la tarea"), inicio: S("Cuándo (opcional; si no, antes de que venza)"), minutos: { type: "number", description: "Duración (por defecto 60)" } }, ["tarea"]),
    },
  },
];

function parseWhen(text: string | undefined, ref = new Date()): { date: Date; hasTime: boolean } | null {
  if (!text) return null;
  const iso = text.match(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/);
  if (iso) {
    const d = new Date(iso[1] ? text : `${text}T00:00`);
    if (!isNaN(d.getTime())) return { date: d, hasTime: !!iso[1] };
  }
  const r = chrono.es.parse(text, ref, { forwardDate: true })[0] ?? chrono.parse(text, ref, { forwardDate: true })[0];
  return r ? { date: r.start.date(), hasTime: r.start.isCertain("hour") } : null;
}

async function folderId(name: string): Promise<string | null> {
  const f = fold(name);
  const special: Record<string, string> = { notas: LOOSE_FOLDER, sueltas: LOOSE_FOLDER, diario: DAILY_FOLDER, ideas: IDEAS_FOLDER, plantillas: TEMPLATES_FOLDER };
  if (special[f]) return special[f];
  const subjects = await db.subjects.toArray();
  return (subjects.find((s) => s.id === name) ?? subjects.find((s) => fold(s.name) === f) ?? subjects.find((s) => fold(s.name).includes(f) || (s.code && fold(s.code) === f)))?.id ?? null;
}

type Found = { kind: "note" | "canvas" | "file" | "subject"; id: string; name: string };

// Encuentra algo del explorador por id o por nombre (notas, lienzos, archivos y, si se pide, materias).
async function findThing(q: string, tipo?: string): Promise<Found | null> {
  const f = fold(q);
  const want = (t: string) => !tipo || tipo === t;
  if (want("nota")) {
    const n = (await db.notes.get(q)) ?? (await db.notes.toArray()).find((x) => fold(x.title || "Sin título") === f);
    if (n) return { kind: "note", id: n.id, name: n.title };
  }
  if (want("archivo")) {
    const all = await db.officeDocs.toArray();
    const d = (await db.officeDocs.get(q)) ?? all.find((x) => fold(x.name) === f) ?? all.find((x) => fold(noExt(x.name)) === f) ?? all.find((x) => fold(x.name).includes(f));
    if (d) return { kind: "file", id: d.id, name: d.name };
  }
  if (want("lienzo")) {
    const c = (await db.canvases.get(q)) ?? (await db.canvases.toArray()).find((x) => fold(x.name || "Sin título") === f);
    if (c) return { kind: "canvas", id: c.id, name: c.name };
  }
  if (tipo === "materia") {
    const s = (await db.subjects.get(q)) ?? (await db.subjects.toArray()).find((x) => fold(x.name) === f || fold(x.name).includes(f));
    if (s) return { kind: "subject", id: s.id, name: s.name };
  }
  // Sin coincidencia exacta de nota: probamos que el nombre la contenga.
  if (want("nota")) {
    const n = (await db.notes.toArray()).find((x) => fold(x.title).includes(f) && f.length > 3);
    if (n) return { kind: "note", id: n.id, name: n.title };
  }
  return null;
}

async function findEvent(q: string): Promise<CalEvent | null> {
  const byId = await db.events.get(q);
  if (byId) return byId;
  const f = fold(q);
  const all = await db.events.toArray();
  return all.find((e) => fold(e.title) === f) ?? all.find((e) => fold(e.title).includes(f)) ?? null;
}

// La repetición de un evento más cercana a una fecha (o la próxima desde hoy).
function pickOccurrence(ev: CalEvent, near?: Date): Date {
  if (!ev.rrule) return new Date(ev.start);
  const from = near ? startOfDay(near) : startOfDay(new Date());
  return occurrences(ev, from, addDays(from, near ? 1 : 400))[0] ?? new Date(ev.start);
}

export async function runAppTool(name: string, a: Args, ctx: ToolContext): Promise<ToolResult | null> {
  switch (name) {
    case "renombrar": {
      const q = str(a.id);
      const nombre = str(a.nombre);
      if (!q || !nombre) return fail("Falta qué renombrar o el nombre nuevo.");
      const t = await findThing(q, str(a.tipo));
      if (!t) return fail(`No encontré «${q}».`);
      await renameItem(t.kind, t.id, nombre);
      return { ok: true, content: json({ id: t.id }), label: `Renombré «${t.name}» a «${nombre}»` };
    }

    case "mover": {
      const list = Array.isArray(a.elementos) ? a.elementos.map(String) : str(a.elementos) ? [String(a.elementos)] : [];
      const dest = str(a.carpeta);
      if (!list.length || !dest) return fail("Falta qué mover o a dónde.");
      const target = await folderId(dest);
      if (!target) return fail(`No encontré la carpeta o materia «${dest}».`);
      const moved: string[] = [];
      for (const q of list) {
        const t = await findThing(q);
        if (!t || t.kind === "subject") continue;
        await moveItem(t.kind, t.id, { subjectId: target });
        moved.push(t.name);
      }
      if (!moved.length) return fail("No encontré nada de eso para mover.");
      return { ok: true, content: json({ movidos: moved }), label: `Moví ${moved.length === 1 ? `«${moved[0]}»` : `${moved.length} elementos`} a ${dest}` };
    }

    case "abrir_archivo": {
      const q = str(a.archivo);
      if (!q) return fail("Falta el archivo.");
      if (/^esc[aá]ner|escanear/.test(fold(q))) {
        const { openScanner } = await import("@/components/scanner/scanner-app");
        openScanner();
        return { ok: true, content: "{}", label: "Abrí el escáner" };
      }
      const t = await findThing(q, "archivo");
      if (!t) return fail(`No encontré el archivo «${q}». Usá listar_archivos.`);
      ctx.openView({ type: "editor", id: t.id });
      return { ok: true, content: json({ id: t.id }), label: `Abrí «${t.name}»` };
    }

    case "listar_eventos": {
      const from = startOfDay(parseWhen(str(a.desde))?.date ?? new Date());
      const to = parseWhen(str(a.hasta), from)?.date ?? addDays(from, 7);
      const end = addDays(startOfDay(to), 1);
      const f = str(a.texto) ? fold(String(a.texto)) : "";
      const [cals, events, external, tasks] = await Promise.all([
        db.calendars.toArray(),
        db.events.toArray(),
        db.calendarEvents.where("start").between(from.toISOString(), end.toISOString()).toArray(),
        db.tasks.filter((t) => !!t.dueDate && t.status !== "DONE" && t.status !== "INBOX_EMAIL").toArray(),
      ]);
      const calName = new Map(cals.map((c) => [c.id, c.name]));
      const out: Record<string, unknown>[] = [];
      for (const ev of events)
        for (const s of occurrences(ev, from, end))
          out.push({ id: ev.id, tipo: "evento", titulo: ev.title, inicio: s.toISOString(), fin: new Date(s.getTime() + new Date(ev.end).getTime() - new Date(ev.start).getTime()).toISOString(), todo_el_dia: ev.allDay, lugar: ev.location, se_repite: !!ev.rrule, calendario: calName.get(ev.calendarId) });
      for (const e of external) out.push({ tipo: "evento suscrito (sólo lectura)", titulo: e.title, inicio: e.start, fin: e.end, todo_el_dia: e.allDay, lugar: e.location, calendario: calName.get(e.calendarId) });
      for (const t of tasks) if (t.dueDate! >= from.toISOString() && t.dueDate! < end.toISOString()) out.push({ id: t.id, tipo: "tarea", titulo: t.title, vence: t.dueDate });
      const filtered = out.filter((x) => !f || fold(String(x.titulo)).includes(f)).sort((x, y) => String(x.inicio ?? x.vence).localeCompare(String(y.inicio ?? y.vence)));
      return { ok: true, content: json(filtered.slice(0, 80)), label: "Revisé el calendario" };
    }

    case "crear_evento": {
      const title = str(a.titulo);
      const when = parseWhen(str(a.inicio));
      if (!title || !when) return fail("Falta el título o no entendí cuándo empieza.");
      const allDay = a.todo_el_dia === true || !when.hasTime;
      const start = allDay ? startOfDay(when.date) : when.date;
      let end = parseWhen(str(a.fin), start)?.date;
      if (allDay) end = addDays(startOfDay(end ?? start), 1);
      else if (!end || end <= start) end = addMinutes(start, 60);
      let rrule = REPEAT[fold(String(a.repetir ?? ""))];
      if (rrule === "FREQ=WEEKLY" && str(a.dias)) {
        const codes = fold(String(a.dias))
          .split(/[,y ]+/)
          .map((d) => DAY_CODE[d])
          .filter(Boolean);
        if (codes.length) rrule += `;BYDAY=${codes.join(",")}`;
      }
      const until = parseWhen(str(a.hasta_fecha), start)?.date;
      if (rrule && until) rrule += `;UNTIL=${new Date(until.setHours(23, 59, 59)).toISOString().replace(/[-:]/g, "").replace(/[.]\d{3}/, "")}`;
      const cat = CATEGORIES.find((c) => fold(EVENT_CATEGORY_LABEL[c]) === fold(String(a.categoria ?? "")));
      const subjectId = str(a.materia) ? ((await folderId(String(a.materia))) ?? undefined) : undefined;
      const id = await saveEvent({
        calendarId: await defaultCalendarId(),
        title,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        location: str(a.lugar),
        description: str(a.descripcion),
        category: cat,
        rrule,
        reminders: typeof a.recordatorio_min === "number" ? [a.recordatorio_min] : allDay ? undefined : [15],
        subjectId: subjectId && !subjectId.startsWith("__") ? subjectId : undefined,
      });
      return { ok: true, content: json({ id, inicio: start.toISOString(), se_repite: !!rrule }), label: `Agendé «${title}»` };
    }

    case "editar_evento": {
      const ev = await findEvent(String(a.evento ?? ""));
      if (!ev) return fail("No encontré el evento. Usá listar_eventos.");
      const occ = pickOccurrence(ev, parseWhen(str(a.fecha))?.date);
      const changes: Partial<CalEvent> = {};
      if (str(a.titulo)) changes.title = String(a.titulo);
      if (str(a.lugar)) changes.location = String(a.lugar);
      const length = new Date(ev.end).getTime() - new Date(ev.start).getTime();
      const start = parseWhen(str(a.inicio), occ);
      if (start) {
        const s = start.hasTime ? start.date : new Date(new Date(start.date).setHours(occ.getHours(), occ.getMinutes(), 0, 0));
        changes.start = s.toISOString();
        changes.end = new Date(s.getTime() + length).toISOString();
      }
      const end = parseWhen(str(a.fin), start?.date ?? occ);
      if (end) {
        changes.start ??= occ.toISOString();
        changes.end = end.date.toISOString();
      }
      if (!Object.keys(changes).length) return fail("No dijiste qué cambiar.");
      await updateOccurrence(ev, occ, changes, ev.rrule && a.solo_esta ? "one" : "all");
      return { ok: true, content: "{}", label: `Cambié «${ev.title}»` };
    }

    case "eliminar_evento": {
      const ev = await findEvent(String(a.evento ?? ""));
      if (!ev) return fail("No encontré el evento. Usá listar_eventos.");
      const one = !!ev.rrule && !!a.solo_esta;
      const yes = await ctx.confirm(`¿Borrar «${ev.title}»${ev.rrule ? (one ? " (sólo esa vez)" : " (todas las repeticiones)") : ""}?`, "");
      if (!yes) return { ok: false, content: json({ cancelado: true }), label: "No borré nada" };
      await deleteOccurrence(ev, pickOccurrence(ev, parseWhen(str(a.fecha))?.date), one ? "one" : "all");
      return { ok: true, content: "{}", label: `Borré «${ev.title}»` };
    }

    case "planificar_tarea": {
      const q = String(a.tarea ?? "");
      const all = await db.tasks.toArray();
      const task = all.find((t) => t.id === q) ?? all.find((t) => fold(t.title) === fold(q)) ?? all.find((t) => fold(t.title).includes(fold(q)));
      if (!task) return fail("No encontré la tarea. Usá listar_tareas.");
      const when = parseWhen(str(a.inicio));
      const minutes = typeof a.minutos === "number" && a.minutos > 0 ? a.minutos : 60;
      const id = await planTask(task, when?.date, minutes);
      const ev = await db.events.get(id);
      return { ok: true, content: json({ id, inicio: ev?.start }), label: `Reservé tiempo para «${task.title}»` };
    }
  }
  return null;
}
