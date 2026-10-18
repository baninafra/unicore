"use client";

// Propiedades tipo frontmatter de las notas (note.properties).

import type { Note } from "@/lib/types";
import { intlLocale } from "@/lib/i18n";

export type PropValue = string | number | boolean | string[];
export type PropKind = "texto" | "número" | "casilla" | "lista" | "fecha" | "mixto";

export interface PropSummary {
  key: string;
  count: number;
  kind: PropKind;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;

export function isEmptyValue(v: PropValue | undefined | null): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

// Número si el valor es numérico (acepta coma decimal en texto).
export function numberOf(v: PropValue | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && NUMBER_RE.test(v.trim())) return Number(v.trim().replace(",", "."));
  return undefined;
}

// Textos de un valor, para mostrar y para comparar.
export function textsOf(v: PropValue | undefined): string[] {
  if (isEmptyValue(v)) return [];
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "boolean") return [v ? "sí" : "no"];
  return [String(v)];
}

export function displayText(v: PropValue | undefined): string {
  return textsOf(v).join(", ");
}

export function kindOf(v: PropValue): PropKind {
  if (typeof v === "boolean") return "casilla";
  if (typeof v === "number") return "número";
  if (Array.isArray(v)) return "lista";
  if (DATE_RE.test(v)) return "fecha";
  if (NUMBER_RE.test(v.trim())) return "número";
  return "texto";
}

// Claves de propiedades usadas en todas las notas, con cuántas la usan y su tipo inferido.
export function summarizeProps(notes: Note[]): PropSummary[] {
  const acc = new Map<string, { count: number; kinds: Set<PropKind> }>();
  for (const note of notes) {
    for (const [key, value] of Object.entries(note.properties ?? {})) {
      if (isEmptyValue(value)) continue;
      const entry = acc.get(key) ?? { count: 0, kinds: new Set<PropKind>() };
      entry.count++;
      entry.kinds.add(kindOf(value));
      acc.set(key, entry);
    }
  }
  return [...acc.entries()]
    .map(([key, e]) => ({
      key,
      count: e.count,
      kind: e.kinds.size === 1 ? (Array.from(e.kinds)[0] as PropKind) : "mixto",
    }))
    .sort((a, b) => a.key.localeCompare(b.key, intlLocale()));
}
