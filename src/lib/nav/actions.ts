// Acciones de navegación compartidas por el explorador, la paleta, los marcadores y los comandos.
import { addDays, format, parseISO } from "date-fns";
import { db, newId, nowIso } from "@/lib/db";
import { dateLocale, intlLocale, t } from "@/lib/i18n";
import { createNote, plainTextOf } from "@/components/notes/note-utils";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type BookmarkKind, type Note } from "@/lib/types";
import type { ViewState } from "@/lib/workspace";
import { foldText } from "./fold";
import { detachAndCarry, liftChildren } from "@/lib/notes/subnotes";
import { createOfficeDoc, renameOfficeDoc } from "@/lib/editors/editors";
import type { OfficeKind } from "@/lib/types";

// Modificadores de un clic o de una tecla (Ctrl = pestaña nueva, Ctrl+Alt = dividir).
export interface ModifierEvent {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  button?: number;
}

// Ejecuta una acción async desde un clic o un comando sin dejar errores en silencio.
export function runSafe(fn: () => Promise<unknown>): void {
  fn().catch((err: unknown) => console.error(err));
}

export const FOLDER_NAME: Record<string, string> = {
  [DAILY_FOLDER]: t("Diario"),
  [LOOSE_FOLDER]: t("Notas"),
  [IDEAS_FOLDER]: t("Ideas"),
  [TEMPLATES_FOLDER]: t("Plantillas"),
};

export function isSpecialFolder(id: string) {
  return id === DAILY_FOLDER || id === TEMPLATES_FOLDER || id === LOOSE_FOLDER || id === IDEAS_FOLDER;
}

// ---------- Texto y plantillas ----------

const PLACEHOLDER = /\{\{\s*(fecha|hora|titulo)\s*\}\}/gi;

function cloneValue(value: unknown, vars?: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => cloneValue(v, vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k !== "id") out[k] = cloneValue(v, vars); // sin ids: BlockNote genera nuevos
    }
    return out;
  }
  if (typeof value === "string" && vars) {
    return value.replace(PLACEHOLDER, (_m, key: string) => vars[key.toLowerCase()] ?? "");
  }
  return value;
}

// Copia bloques de BlockNote sin ids y, si se pasan variables, reemplaza {{fecha}}, {{hora}} y {{titulo}}.
export function cloneBlocks(blocks: unknown[], vars?: Record<string, string>): Record<string, unknown>[] {
  return blocks.map((b) => cloneValue(b, vars) as Record<string, unknown>);
}

function textOf(blocks: unknown[]): string {
  return plainTextOf(blocks as Parameters<typeof plainTextOf>[0]);
}

export function templateVars(now: Date, title: string): Record<string, string> {
  return {
    fecha: format(now, t("d 'de' MMMM 'de' yyyy"), { locale: dateLocale() }),
    hora: format(now, "HH:mm"),
    titulo: title,
  };
}

export async function listTemplates(): Promise<Note[]> {
  const list = await db.notes.where("subjectId").equals(TEMPLATES_FOLDER).toArray();
  return list.sort((a, b) => a.title.localeCompare(b.title, intlLocale()));
}

async function findTemplate(name: string): Promise<Note | undefined> {
  const want = foldText(name);
  return (await listTemplates()).find((t) => foldText(t.title) === want);
}

// Inserta bloques en el apunte activo (lo escucha el editor de la nota).
export function insertBlocks(blocks: Record<string, unknown>[]) {
  window.dispatchEvent(new CustomEvent("uc:insert-blocks", { detail: { blocks } }));
}

// Después de abrir una nota, el editor tiene que estar montado para resaltar el bloque.
export function gotoBlock(noteId: string, blockId: string) {
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("uc:goto-block", { detail: { noteId, blockId } }));
  }, 300);
}

// ---------- Carpetas y creación ----------

// Carpeta donde cae algo nuevo según la vista activa (la materia; si no hay, Notas).
export async function folderForView(view: ViewState): Promise<string> {
  let subjectId: string | undefined;
  if (view.type === "materia") subjectId = view.id;
  else if (view.type === "nota") subjectId = (await db.notes.get(view.id))?.subjectId;
  else if (view.type === "canvas") subjectId = (await db.canvases.get(view.id))?.subjectId;
  else if (view.type === "pdf") subjectId = (await db.documents.get(view.id))?.subjectId;
  else if (view.type === "editor") subjectId = (await db.officeDocs.get(view.id))?.subjectId;
  if (!subjectId || isSpecialFolder(subjectId)) return LOOSE_FOLDER;
  return (await db.subjects.get(subjectId)) ? subjectId : LOOSE_FOLDER;
}

export async function addNote(
  subjectId: string,
  opts: { title?: string; unitNumber?: number; dailyDate?: string; content?: unknown[]; plainTextCache?: string } = {},
): Promise<string> {
  const id = await createNote({
    subjectId,
    title: opts.title ?? t("Sin título"),
    unitNumber: opts.unitNumber ?? 1,
    content: opts.content,
    plainTextCache: opts.plainTextCache,
  });
  if (opts.dailyDate) await db.notes.update(id, { dailyDate: opts.dailyDate });
  return id;
}

export async function addCanvas(subjectId: string): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.canvases.add({ id, name: t("Sin título"), subjectId, data: { nodes: [], edges: [] }, updatedAt: now, createdAt: now });
  return id;
}

export async function newNoteForView(view: ViewState): Promise<string> {
  return addNote(await folderForView(view));
}

export async function newCanvasForView(view: ViewState): Promise<string> {
  return addCanvas(await folderForView(view));
}

// Documento, planilla o presentación vacíos, en la carpeta de la vista activa.
export async function newOfficeForView(kind: OfficeKind, view: ViewState): Promise<string> {
  return createOfficeDoc({ kind, subjectId: await folderForView(view) });
}

// ---------- Notas diarias ----------

export function dayKey(day: Date): string {
  return format(day, "yyyy-MM-dd");
}

export function dailyTitle(day: Date): string {
  return format(day, t("d 'de' MMMM 'de' yyyy"), { locale: dateLocale() });
}

// Abre la nota del día o la crea (con la plantilla "Diario" si existe).
export async function openDailyNote(day: Date): Promise<string> {
  const key = dayKey(day);
  const sameDay = await db.notes.where("dailyDate").equals(key).toArray();
  const existing = sameDay.find((n) => n.subjectId === DAILY_FOLDER);
  if (existing) return existing.id;
  const title = dailyTitle(day);
  const tpl = await findTemplate("Diario");
  const content = tpl ? cloneBlocks(tpl.content, templateVars(day, title)) : [];
  return addNote(DAILY_FOLDER, {
    title,
    dailyDate: key,
    content,
    plainTextCache: tpl ? textOf(content) : "",
  });
}

// Fecha de la nota diaria activa, o hoy si la vista no es una nota diaria.
export async function dailyBaseDate(view: ViewState): Promise<Date> {
  if (view.type === "nota") {
    const note = await db.notes.get(view.id);
    if (note?.dailyDate) {
      const parsed = parseISO(note.dailyDate);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return new Date();
}

export function shiftDays(day: Date, delta: number): Date {
  return addDays(day, delta);
}

// ---------- Notas, lienzos y materias ----------

export async function renameItem(kind: "note" | "canvas" | "subject" | "file", id: string, name: string): Promise<void> {
  const title = name.trim();
  if (!title) return;
  if (kind === "file") return renameOfficeDoc(id, title);
  if (kind === "note") await db.notes.update(id, { title });
  else if (kind === "canvas") await db.canvases.update(id, { name: title });
  else await db.subjects.update(id, { name: title });
  await db.bookmarks.where("targetId").equals(id).and((b) => b.kind === kind).modify({ title });
}

export async function duplicateNote(id: string): Promise<string | undefined> {
  const source = await db.notes.get(id);
  if (!source) return undefined;
  const now = nowIso();
  const copy: Note = {
    ...source,
    id: newId(),
    title: t("{title} (copia)", { title: source.title }),
    subjectId: source.subjectId === DAILY_FOLDER ? LOOSE_FOLDER : source.subjectId,
    content: cloneBlocks(source.content),
    createdAt: now,
    updatedAt: now,
  };
  delete copy.dailyDate;
  await db.notes.add(copy);
  return copy.id;
}

// Mueve una nota a otra carpeta (materia o especial). Una nota fuera de Diario deja de ser diaria.
export async function moveNote(id: string, subjectId: string, unitNumber?: number): Promise<void> {
  await db.transaction("rw", db.notes, async () => {
    const note = await db.notes.get(id);
    if (!note) return;
    const next: Note = { ...note, subjectId, unitNumber: unitNumber ?? note.unitNumber };
    delete next.dailyDate;
    await db.notes.put(next);
  });
  await detachAndCarry(id, subjectId, unitNumber);
}

export async function moveCanvas(id: string, subjectId: string): Promise<void> {
  await db.canvases.update(id, { subjectId });
}

// Mueve una nota o un lienzo. Los lienzos no van a Plantillas.
export async function moveItem(kind: "note" | "canvas" | "file", id: string, target: { subjectId: string; unit?: number }): Promise<void> {
  if (kind === "note") await moveNote(id, target.subjectId, target.unit);
  else if (kind === "file") {
    if (target.subjectId !== TEMPLATES_FOLDER) await db.officeDocs.update(id, { subjectId: target.subjectId });
  }
  else if (target.subjectId !== TEMPLATES_FOLDER) await moveCanvas(id, target.subjectId);
}

// Mueve una materia o carpeta a otro espacio (y año), o adentro de otra carpeta (`parentId`).
// Sus tareas y subcarpetas pasan con ella; si cambia de espacio, se sueltan las correlativas,
// que sólo tienen sentido dentro de la misma carrera. Devuelve false si no se pudo (dentro de sí misma).
export async function moveSubject(id: string, place: { degreeId: string; year?: number; parentId?: string }): Promise<boolean> {
  return db.transaction("rw", db.subjects, db.tasks, async () => {
    const s = await db.subjects.get(id);
    if (!s) return false;
    let target = { degreeId: place.degreeId, year: place.year, parentId: undefined as string | undefined };
    if (place.parentId) {
      const parent = await db.subjects.get(place.parentId);
      if (!parent) return false;
      // Una carpeta (o cualquier cosa soltada sobre una carpeta) queda adentro; una materia soltada
      // sobre otra materia queda a su lado.
      if (s.folder || parent.folder) target = { degreeId: parent.degreeId, year: undefined, parentId: parent.id };
      else target = { degreeId: parent.degreeId, year: parent.year, parentId: parent.parentId };
      // No se puede meter una carpeta dentro de sí misma ni de una de sus subcarpetas.
      for (let p: typeof parent | undefined = target.parentId ? await db.subjects.get(target.parentId) : undefined, n = 0; p && n < 20; n++) {
        if (p.id === id) return false;
        p = p.parentId ? await db.subjects.get(p.parentId) : undefined;
      }
    }
    const year = s.folder ? s.year : (target.year ?? s.year);
    if (s.degreeId === target.degreeId && s.year === year && (s.parentId ?? undefined) === target.parentId) return true;
    const changes: Partial<typeof s> = { degreeId: target.degreeId, year, parentId: target.parentId };
    if (s.degreeId !== target.degreeId) {
      changes.correlatives = [];
      const old = await db.subjects.where("degreeId").equals(s.degreeId).toArray();
      for (const o of old)
        if (o.correlatives?.includes(id)) await db.subjects.update(o.id, { correlatives: o.correlatives.filter((c) => c !== id) });
      // Lo que cuelga de ella cambia de espacio también.
      const ids = [id];
      for (let i = 0; i < ids.length; i++) ids.push(...(await db.subjects.filter((x) => x.parentId === ids[i]).primaryKeys()));
      for (const sub of ids.slice(1)) await db.subjects.update(sub, { degreeId: target.degreeId });
      await db.tasks.where("subjectId").anyOf(ids).modify({ degreeId: target.degreeId });
    }
    await db.subjects.update(id, changes);
    return true;
  });
}

export async function deleteNote(id: string): Promise<void> {
  await liftChildren(id);
  await db.transaction("rw", db.notes, db.snapshots, db.bookmarks, async () => {
    await db.notes.delete(id);
    await db.snapshots.where("noteId").equals(id).delete();
    await db.bookmarks.where("targetId").equals(id).and((b) => b.kind === "note").delete();
  });
}

export async function deleteCanvas(id: string): Promise<void> {
  await db.transaction("rw", db.canvases, db.bookmarks, async () => {
    await db.canvases.delete(id);
    await db.bookmarks.where("targetId").equals(id).and((b) => b.kind === "canvas").delete();
  });
}

export async function randomNoteId(): Promise<string | undefined> {
  const notes = (await db.notes.toArray()).filter((n) => n.subjectId !== TEMPLATES_FOLDER);
  if (!notes.length) return undefined;
  return notes[Math.floor(Math.random() * notes.length)].id;
}

// ---------- Marcadores ----------

export async function bookmarkTargetFor(
  view: ViewState,
): Promise<{ kind: BookmarkKind; targetId: string; title: string } | undefined> {
  switch (view.type) {
    case "nota": {
      const n = await db.notes.get(view.id);
      return n ? { kind: "note", targetId: n.id, title: n.title || t("Sin título") } : undefined;
    }
    case "materia": {
      const s = await db.subjects.get(view.id);
      return s ? { kind: "subject", targetId: s.id, title: s.name } : undefined;
    }
    case "canvas": {
      const c = await db.canvases.get(view.id);
      return c ? { kind: "canvas", targetId: c.id, title: c.name || t("Sin título") } : undefined;
    }
    case "pdf": {
      const d = await db.documents.get(view.id);
      return d ? { kind: "document", targetId: d.id, title: d.fileName } : undefined;
    }
    case "busqueda":
      return view.query ? { kind: "search", targetId: view.query, title: t("Buscar: {query}", { query: view.query }) } : undefined;
    default:
      return undefined;
  }
}

// Agrega o quita un marcador. Devuelve true si quedó marcado.
export async function toggleBookmark(kind: BookmarkKind, targetId: string, title: string): Promise<boolean> {
  const found = await db.bookmarks.where("targetId").equals(targetId).and((b) => b.kind === kind).first();
  if (found) {
    await db.bookmarks.delete(found.id);
    return false;
  }
  const last = await db.bookmarks.orderBy("order").last();
  await db.bookmarks.add({
    id: newId(),
    kind,
    targetId,
    title,
    order: (last?.order ?? 0) + 1,
    createdAt: nowIso(),
  });
  return true;
}

// Vista que abre un marcador.
export function viewForBookmark(kind: BookmarkKind, targetId: string): ViewState {
  switch (kind) {
    case "note":
      return { type: "nota", id: targetId };
    case "subject":
      return { type: "materia", id: targetId };
    case "canvas":
      return { type: "canvas", id: targetId };
    case "document":
      return { type: "pdf", id: targetId };
    case "search":
      return { type: "busqueda", query: targetId };
  }
}
