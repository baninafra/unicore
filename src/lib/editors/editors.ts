"use client";

// Editores incrustados: documento (Word), planilla (Excel), presentación (PowerPoint), PDF y geometría (GeoGebra).
// Cada uno es una app WebAssembly en public/editors/<tipo>/ que corre en un iframe y habla con
// UniCore por postMessage (ver editor-view.tsx). Acá viven los archivos y el registro de editores
// abiertos, que usan la vista y las herramientas de la IA.

import { db, newId, nowIso, saveFile } from "../db";
import type { OfficeDoc, OfficeKind } from "../types";
import { toast } from "../undo";

export interface EditorKindInfo {
  label: string; // "Documento"
  newLabel: string; // "Nuevo documento"
  ext: string; // formato propio al guardar
  accepts: string[]; // extensiones que el editor abre y guarda como el mismo archivo
  path: string; // carpeta en public/
  saveCommand: string; // comando del editor que guarda (para el guardado automático)
}

export const EDITOR_KINDS: Record<OfficeKind, EditorKindInfo> = {
  doc: { label: "Documento", newLabel: "Nuevo documento", ext: "docx", accepts: ["docx", "odt", "rtf"], path: "/editors/doc/", saveCommand: "file.save" },
  sheet: { label: "Planilla", newLabel: "Nueva planilla", ext: "xlsx", accepts: ["xlsx", "xlsm", "xls", "ods", "csv", "tsv"], path: "/editors/sheet/", saveCommand: "file.save" },
  deck: { label: "Presentación", newLabel: "Nueva presentación", ext: "pptx", accepts: ["pptx", "odp"], path: "/editors/deck/", saveCommand: "file.save" },
  pdf: { label: "PDF", newLabel: "Nuevo PDF", ext: "pdf", accepts: ["pdf"], path: "/editors/pdf/", saveCommand: "file.save" },
  geo: { label: "Geometría", newLabel: "Nueva construcción", ext: "ggb", accepts: ["ggb"], path: "/editors/geo/", saveCommand: "file.save" },
};

export const OFFICE_KINDS = Object.keys(EDITOR_KINDS) as OfficeKind[];

const extOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

// Qué editor abre este archivo (o null si ninguno).
export function officeKindOf(name: string): OfficeKind | null {
  const ext = extOf(name);
  return OFFICE_KINDS.find((k) => EDITOR_KINDS[k].accepts.includes(ext)) ?? null;
}

// Si guardar con este nombre reemplaza el archivo (o es una exportación aparte, como un PDF de una planilla).
export function isNativeSave(kind: OfficeKind, name: string): boolean {
  return EDITOR_KINDS[kind].accepts.includes(extOf(name));
}

export async function createOfficeDoc(opts: { kind: OfficeKind; subjectId: string; name?: string; file?: File | Blob }): Promise<string> {
  const id = newId();
  const now = nowIso();
  const info = EDITOR_KINDS[opts.kind];
  let name = opts.name?.trim() || (opts.file instanceof File ? opts.file.name : "Sin título");
  if (!officeKindOf(name)) name = `${name}.${info.ext}`;
  const fileId = opts.file ? (await saveFile(opts.file, name)).slice(6) : undefined;
  await db.officeDocs.add({ id, subjectId: opts.subjectId, name, kind: opts.kind, fileId, updatedAt: now, createdAt: now });
  return id;
}

// Guarda lo que mandó el editor como el contenido nuevo del archivo.
export async function saveOfficeBytes(id: string, saved: string, bytes: ArrayBuffer): Promise<void> {
  const doc = await db.officeDocs.get(id);
  if (!doc) return;
  // El nombre lo maneja UniCore (el editor a veces manda "Book1"); sólo cambia la extensión si guardó en otro formato.
  const ext = extOf(saved) || extOf(doc.name);
  const name = `${doc.name.replace(/\.[a-z0-9]+$/i, "")}.${ext}`;
  const blob = new Blob([bytes]);
  const now = nowIso();
  await db.transaction("rw", db.files, db.officeDocs, async () => {
    if (doc.fileId && (await db.files.get(doc.fileId))) {
      await db.files.update(doc.fileId, { blob, size: blob.size, name });
      await db.officeDocs.update(id, { name, updatedAt: now });
    } else {
      const fileId = newId();
      await db.files.add({ id: fileId, name, type: "", size: blob.size, blob, createdAt: now });
      await db.officeDocs.update(id, { name, fileId, updatedAt: now });
    }
  });
}

export async function officeBytes(doc: OfficeDoc): Promise<ArrayBuffer | null> {
  if (!doc.fileId) return null;
  const file = await db.files.get(doc.fileId);
  return file ? file.blob.arrayBuffer() : null;
}

// Copia del archivo en Descargas (para mandarlo o abrirlo con otro programa).
export async function downloadOfficeDoc(id: string): Promise<void> {
  const doc = await db.officeDocs.get(id);
  const bytes = doc ? await officeBytes(doc) : null;
  if (!doc || !bytes) {
    toast("Ese archivo todavía está vacío: guardalo primero desde el editor.", { tone: "error" });
    return;
  }
  const { saveBlob } = await import("../export/save");
  await saveBlob(doc.name, new Blob([bytes]));
}

export async function renameOfficeDoc(id: string, name: string): Promise<void> {
  const doc = await db.officeDocs.get(id);
  const clean = name.trim();
  if (!doc || !clean) return;
  // La extensión se conserva: es la que dice con qué editor se abre.
  const ext = extOf(doc.name) || EDITOR_KINDS[doc.kind].ext;
  const next = extOf(clean) === ext ? clean : `${clean.replace(/\.[a-z0-9]+$/i, "")}.${ext}`;
  await db.officeDocs.update(id, { name: next });
}

export async function deleteOfficeDoc(id: string): Promise<void> {
  await db.transaction("rw", db.officeDocs, db.files, async () => {
    const doc = await db.officeDocs.get(id);
    if (doc?.fileId) await db.files.delete(doc.fileId);
    await db.officeDocs.delete(id);
  });
}

// ---------- Editores abiertos ----------

export interface EditorCommandInfo {
  id: string;
  label?: string;
  description?: string;
  params?: unknown;
}

export interface LiveEditor {
  docId: string;
  kind: OfficeKind;
  ready: boolean;
  dirty: boolean;
  lastActive: number;
  command: (command: string, params?: unknown) => Promise<unknown>;
}

const live = new Map<string, LiveEditor>();

export function registerEditor(ed: LiveEditor): () => void {
  live.set(ed.docId, ed);
  return () => {
    if (live.get(ed.docId) === ed) live.delete(ed.docId);
  };
}

export function touchEditor(docId: string) {
  const ed = live.get(docId);
  if (ed) ed.lastActive = Date.now();
}

// El editor listo usado más recientemente (o el de ese archivo).
export function liveEditor(docId?: string): LiveEditor | undefined {
  if (docId) return live.get(docId);
  return [...live.values()].filter((e) => e.ready).sort((a, b) => b.lastActive - a.lastActive)[0];
}

// Espera a que el editor de un archivo recién abierto esté listo.
export async function waitForEditor(docId: string, ms = 30000): Promise<LiveEditor | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const ed = live.get(docId);
    if (ed?.ready) return ed;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}
