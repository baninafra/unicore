"use client";

// Motor de la vista Base: filtros, orden y agrupación sobre las notas, y la configuración guardada.

import { t, intlLocale } from "@/lib/i18n";
import { normalizeText } from "@/lib/ai/rag";
import type { Note } from "@/lib/types";
import { folderLabel, noteTitle } from "./note-data";
import { displayText, isEmptyValue, numberOf, textsOf, type PropValue } from "./props";

export type FilterOp = "es" | "contiene" | "existe" | "no existe" | ">" | "<";
export const FILTER_OPS: FilterOp[] = ["es", "contiene", "existe", "no existe", ">", "<"];
export const NO_VALUE_OPS: FilterOp[] = ["existe", "no existe"];

// Campos fijos. Cualquier otro campo es el nombre de una propiedad.
export const FIXED_FIELDS: { key: string; label: string }[] = [
  { key: "title", label: t("Título") },
  { key: "subject", label: t("Materia") },
  { key: "tags", label: t("Etiquetas") },
  { key: "updated", label: t("Modificación") },
];
const FIXED_KEYS = FIXED_FIELDS.map((f) => f.key);

export function isFixedField(field: string): boolean {
  return FIXED_KEYS.includes(field);
}

export interface BaseFilter {
  field: string;
  op: FilterOp;
  value: string;
}

export interface BaseConfig {
  columns: string[]; // propiedades visibles como columna
  filters: BaseFilter[];
  sortField: string;
  sortDir: "asc" | "desc";
  groupBy: string; // "" = sin agrupar, "subject" o nombre de propiedad
}

export const DEFAULT_BASE_CONFIG: BaseConfig = {
  columns: [],
  filters: [],
  sortField: "updated",
  sortDir: "desc",
  groupBy: "",
};

const LS_CONFIG = "uc-base-config";
const LS_PENDING = "uc-base-pendiente";
export const BASE_FILTER_EVENT = "uc:base-filter";

export function loadBaseConfig(): BaseConfig {
  try {
    const raw = localStorage.getItem(LS_CONFIG);
    if (!raw) return DEFAULT_BASE_CONFIG;
    const saved = JSON.parse(raw) as Partial<BaseConfig>;
    return {
      ...DEFAULT_BASE_CONFIG,
      ...saved,
      columns: Array.isArray(saved.columns) ? saved.columns : [],
      filters: Array.isArray(saved.filters) ? saved.filters : [],
    };
  } catch {
    return DEFAULT_BASE_CONFIG;
  }
}

export function saveBaseConfig(config: BaseConfig) {
  try {
    localStorage.setItem(LS_CONFIG, JSON.stringify(config));
  } catch {}
}

// Pide a la base un filtro (lo usa el panel Propiedades). Se guarda por si la base todavía no está
// montada, y además se avisa con un evento para la base que ya está abierta.
export function queueBaseFilter(filter: BaseFilter) {
  try {
    localStorage.setItem(LS_PENDING, JSON.stringify(filter));
  } catch {}
  window.dispatchEvent(new CustomEvent<BaseFilter>(BASE_FILTER_EVENT, { detail: filter }));
}

// Lee y borra el filtro pendiente. Lo llama la base al montarse y al recibir el evento.
export function takePendingBaseFilter(): BaseFilter | undefined {
  try {
    const raw = localStorage.getItem(LS_PENDING);
    if (!raw) return undefined;
    localStorage.removeItem(LS_PENDING);
    const filter = JSON.parse(raw) as BaseFilter;
    return typeof filter.field === "string" ? filter : undefined;
  } catch {
    return undefined;
  }
}

export function fieldValue(note: Note, field: string, subjectName: string): PropValue | undefined {
  switch (field) {
    case "title":
      return noteTitle(note);
    case "subject":
      return subjectName;
    case "tags":
      return note.tags ?? [];
    case "updated":
      return note.updatedAt;
    default:
      return note.properties?.[field];
  }
}

export function matchesFilter(raw: PropValue | undefined, f: BaseFilter): boolean {
  const empty = isEmptyValue(raw);
  if (f.op === "existe") return !empty;
  if (f.op === "no existe") return empty;
  if (empty) return false;

  const target = normalizeText(f.value).trim();
  if (f.op === "es") return textsOf(raw).some((t) => normalizeText(t).trim() === target);
  if (f.op === "contiene") return textsOf(raw).some((t) => normalizeText(t).includes(target));

  // ">" y "<": números si se puede; si no, texto (las fechas ISO se comparan bien como texto).
  if (f.value.trim() === "") return true;
  const want = Number(f.value.trim().replace(",", "."));
  const have = numberOf(raw);
  if (have !== undefined && Number.isFinite(want)) return f.op === ">" ? have > want : have < want;
  const text = textsOf(raw)[0] ?? "";
  return f.op === ">" ? text > f.value.trim() : text < f.value.trim();
}

// Vacíos al final, en cualquier orden.
function compareValues(a: PropValue | undefined, b: PropValue | undefined, dir: "asc" | "desc"): number {
  const ea = isEmptyValue(a);
  const eb = isEmptyValue(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = numberOf(a);
  const nb = numberOf(b);
  const c =
    na !== undefined && nb !== undefined
      ? na - nb
      : displayText(a).localeCompare(displayText(b), intlLocale(), { numeric: true, sensitivity: "base" });
  return dir === "asc" ? c : -c;
}

export interface BaseGroup {
  label: string; // "" si no hay agrupación
  rows: Note[];
}

export function runBaseQuery(
  notes: Note[],
  config: BaseConfig,
  subjects: Record<string, { name: string } | undefined>,
): BaseGroup[] {
  const subjectOf = (n: Note) => folderLabel(n.subjectId, subjects);
  const rows = notes
    .filter((n) => config.filters.every((f) => matchesFilter(fieldValue(n, f.field, subjectOf(n)), f)))
    .sort((a, b) =>
      compareValues(
        fieldValue(a, config.sortField, subjectOf(a)),
        fieldValue(b, config.sortField, subjectOf(b)),
        config.sortDir,
      ),
    );

  if (!config.groupBy) return [{ label: "", rows }];

  const groups = new Map<string, Note[]>();
  for (const note of rows) {
    const label =
      config.groupBy === "subject"
        ? subjectOf(note)
        : displayText(fieldValue(note, config.groupBy, subjectOf(note))) || t("Sin valor");
    groups.set(label, [...(groups.get(label) ?? []), note]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === t("Sin valor")) return 1;
      if (b === t("Sin valor")) return -1;
      return a.localeCompare(b, intlLocale());
    })
    .map(([label, groupRows]) => ({ label, rows: groupRows }));
}
