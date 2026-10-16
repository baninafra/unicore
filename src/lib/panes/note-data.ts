"use client";

// Lectura de notas para los paneles de la barra derecha (esquema, enlaces, menciones).
// Trabaja sobre los bloques de BlockNote y sobre los campos que guarda el editor
// (plainTextCache, links, tags, aliases).

import { folderName } from "@/lib/folder-names";
import { normalizeText } from "@/lib/ai/rag";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Note } from "@/lib/types";

type Obj = Record<string, unknown>;

export interface HeadingItem {
  id: string;
  level: number;
  text: string;
}

export interface WikiRef {
  noteId: string; // vacío si el enlace nunca se resolvió
  text: string;
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object";

// Texto de un arreglo de nodos inline (texto, enlaces, wikilinks).
export function inlineText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((node) => {
      if (!isObj(node)) return "";
      if (typeof node.text === "string") return node.text;
      return inlineText(node.content);
    })
    .join("");
}

// Recorre bloques en orden de documento (cada bloque antes que sus hijos).
function walkBlocks(blocks: unknown[], visit: (block: Obj) => void) {
  for (const block of blocks) {
    if (!isObj(block)) continue;
    visit(block);
    if (Array.isArray(block.children)) walkBlocks(block.children, visit);
  }
}

function walkInline(items: unknown, visit: (node: Obj) => void) {
  if (!Array.isArray(items)) return;
  for (const node of items) {
    if (!isObj(node)) continue;
    visit(node);
    walkInline(node.content, visit);
  }
}

export function noteTitle(note: Pick<Note, "title">): string {
  return note.title.trim() || "Sin título";
}

export function headingsOf(blocks: unknown[]): HeadingItem[] {
  const out: HeadingItem[] = [];
  walkBlocks(blocks, (block) => {
    if (block.type !== "heading") return;
    const props = isObj(block.props) ? block.props : {};
    const level = typeof props.level === "number" ? props.level : 1;
    const text = inlineText(block.content).trim();
    if (text) out.push({ id: String(block.id), level, text });
  });
  return out;
}

// Wikilinks [[...]] del contenido. El editor los guarda como nodo inline "wikilink"
// con props.noteId (vacío o inexistente = sin resolver).
export function wikilinksOf(blocks: unknown[]): WikiRef[] {
  const out: WikiRef[] = [];
  walkBlocks(blocks, (block) =>
    walkInline(block.content, (node) => {
      if (node.type !== "wikilink") return;
      const props = isObj(node.props) ? node.props : {};
      const noteId =
        typeof props.noteId === "string" ? props.noteId : typeof node.noteId === "string" ? node.noteId : "";
      const text = [props.title, props.text, inlineText(node.content), node.text].find(
        (v): v is string => typeof v === "string" && v.trim() !== "",
      );
      out.push({ noteId, text: (text ?? "").trim() });
    }),
  );
  return out;
}

// Línea del texto de la nota que menciona `needle`. Sirve de fragmento en Menciones.
export function mentionLine(text: string, needle: string): string | undefined {
  const target = normalizeText(needle).trim();
  if (!target) return undefined;
  for (const line of text.split("\n")) {
    if (!normalizeText(line).includes(target)) continue;
    const clean = line.replace(/\s+/g, " ").trim();
    return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean;
  }
  return undefined;
}

// La frase aparece como palabra completa (no dentro de otra palabra). Frases de menos de 3 letras no cuentan.
export function mentionsPhrase(text: string, phrase: string): boolean {
  const target = normalizeText(phrase).trim();
  if (target.length < 3) return false;
  const hay = normalizeText(text);
  let at = hay.indexOf(target);
  while (at !== -1) {
    const before = hay[at - 1] ?? " ";
    const after = hay[at + target.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    at = hay.indexOf(target, at + 1);
  }
  return false;
}

// Nombre de las carpetas especiales; undefined si el id es el de una materia.
export function specialFolderName(subjectId: string): string | undefined {
  if (subjectId === DAILY_FOLDER || subjectId === IDEAS_FOLDER) return folderName(subjectId);
  if (subjectId === LOOSE_FOLDER) return "Notas sueltas";
  if (subjectId === TEMPLATES_FOLDER) return "Plantillas";
  return undefined;
}

export function folderLabel(subjectId: string, subjects: Record<string, { name: string } | undefined>): string {
  return specialFolderName(subjectId) ?? subjects[subjectId]?.name ?? "Sin materia";
}
