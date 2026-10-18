"use client";

// Búsqueda de texto completo sobre notas, PDFs, lienzos y tareas.
// Operadores: "frase exacta", -excluir, tag:#etiqueta, materia:nombre, archivo:título, OR.

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { DAILY_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Task } from "@/lib/types";
import { foldText } from "./fold";
import { t, intlLocale } from "@/lib/i18n";

export type SearchKind = "note" | "document" | "canvas" | "task";
export type SortMode = "relevancia" | "nombre" | "modificacion";
export interface Mark {
  from: number;
  to: number;
}
export interface Fragment {
  text: string; // texto original (sin plegar)
  marks: Mark[]; // coincidencias dentro de `text`
  lead: boolean;
  trail: boolean;
}

interface Folded {
  title: string;
  body: string;
  hay: string; // título + alias + cuerpo, para decidir si coincide
  titleCi: string;
  subjectCi: string;
  tags: string[];
}

export interface SearchDoc {
  key: string;
  kind: SearchKind;
  id: string;
  title: string;
  aliases: string[];
  body: string;
  subjectName: string;
  subjectId?: string;
  unit?: number;
  tags: string[];
  updatedAt: string;
  task?: Task;
  cache?: { cs?: Folded; ci?: Folded };
}

export interface SearchHit {
  doc: SearchDoc;
  count: number;
  titleMarks: Mark[];
  fragments: Fragment[];
}

type TermKind = "texto" | "tag" | "materia" | "archivo";
interface Term {
  kind: TermKind;
  value: string;
  neg: boolean;
}
export interface ParsedQuery {
  clauses: Term[][];
  positives: string[];
}

interface Occurrence {
  at: number;
  len: number;
}

const MAX_FRAGMENTS = 3;
const BEFORE = 40;
const AFTER = 90;

export function parseQuery(raw: string, cs = false): ParsedQuery {
  const src = raw.trim();
  const groups: Term[][] = [[]];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    let neg = false;
    if (src[i] === "-" && i + 1 < src.length && !/\s/.test(src[i + 1])) {
      neg = true;
      i++;
    }
    let token: string;
    let quoted = false;
    if (src[i] === '"') {
      const end = src.indexOf('"', i + 1);
      token = end < 0 ? src.slice(i + 1) : src.slice(i + 1, end);
      i = end < 0 ? src.length : end + 1;
      quoted = true;
    } else {
      let j = i;
      while (j < src.length && !/\s/.test(src[j])) j++;
      token = src.slice(i, j);
      i = j;
    }
    if (!quoted && token === "OR") {
      groups.push([]);
      continue;
    }
    const current = groups[groups.length - 1];
    const filter = quoted ? null : /^(tag|materia|archivo):(.*)$/i.exec(token);
    if (filter) {
      const key = filter[1].toLowerCase();
      const value = foldText(filter[2].replace(/^#/, "").trim());
      if (value) {
        const kind: TermKind = key === "tag" ? "tag" : key === "materia" ? "materia" : "archivo";
        current.push({ kind, value, neg });
      }
      continue;
    }
    const value = foldText(token, cs).replace(/\s+/g, " ").trim();
    if (value) current.push({ kind: "texto", value, neg });
  }
  const clauses = groups.filter((g) => g.length > 0);
  const positives = [...new Set(clauses.flat().filter((t) => t.kind === "texto" && !t.neg).map((t) => t.value))];
  return { clauses, positives };
}

function foldedFor(doc: SearchDoc, cs: boolean): Folded {
  const slot = cs ? "cs" : "ci";
  if (!doc.cache) doc.cache = {};
  const cached = doc.cache[slot];
  if (cached) return cached;
  const title = foldText(doc.title, cs);
  const body = foldText(doc.body, cs);
  const aliases = foldText(doc.aliases.join(" "), cs);
  const folded: Folded = {
    title,
    body,
    hay: `${title} ${aliases}\n${body}`,
    titleCi: cs ? foldText(doc.title) : title,
    subjectCi: foldText(doc.subjectName),
    tags: doc.tags.map((t) => foldText(t)),
  };
  doc.cache[slot] = folded;
  return folded;
}

function holds(t: Term, f: Folded): boolean {
  let found: boolean;
  if (t.kind === "tag") found = f.tags.some((x) => x === t.value || x.startsWith(`${t.value}/`));
  else if (t.kind === "materia") found = f.subjectCi.includes(t.value);
  else if (t.kind === "archivo") found = f.titleCi.includes(t.value);
  else found = f.hay.includes(t.value);
  return t.neg ? !found : found;
}

function occurrences(text: string, terms: string[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const term of terms) {
    let i = text.indexOf(term);
    while (i >= 0) {
      out.push({ at: i, len: term.length });
      i = text.indexOf(term, i + term.length);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function fragmentsFor(original: string, folded: string, occ: Occurrence[]): Fragment[] {
  const windows: { from: number; to: number }[] = [];
  for (const o of occ) {
    const from = Math.max(0, o.at - BEFORE);
    const to = Math.min(folded.length, o.at + o.len + AFTER);
    const last = windows[windows.length - 1];
    if (last && from <= last.to) {
      last.to = Math.max(last.to, to);
      continue;
    }
    if (windows.length === MAX_FRAGMENTS) break;
    windows.push({ from, to });
  }
  return windows.map(({ from, to }) => ({
    text: original.slice(from, to),
    marks: occ
      .filter((o) => o.at >= from && o.at + o.len <= to)
      .map((o) => ({ from: o.at - from, to: o.at + o.len - from })),
    lead: from > 0,
    trail: to < folded.length,
  }));
}

export function runSearch(docs: SearchDoc[], q: ParsedQuery, cs: boolean, sort: SortMode): SearchHit[] {
  if (!q.clauses.length) return [];
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const f = foldedFor(doc, cs);
    if (!q.clauses.some((clause) => clause.every((t) => holds(t, f)))) continue;
    const inTitle = occurrences(f.title, q.positives);
    const inBody = occurrences(f.body, q.positives);
    hits.push({
      doc,
      count: inTitle.length + inBody.length,
      titleMarks: inTitle.map((o) => ({ from: o.at, to: o.at + o.len })),
      fragments: fragmentsFor(doc.body, f.body, inBody),
    });
  }
  return hits.sort((a, b) => {
    if (sort === "nombre") return a.doc.title.localeCompare(b.doc.title, intlLocale(), { sensitivity: "base", numeric: true });
    if (sort === "modificacion") return b.doc.updatedAt.localeCompare(a.doc.updatedAt);
    return b.count - a.count || a.doc.title.localeCompare(b.doc.title, intlLocale());
  });
}

// Documentos de búsqueda a partir de la base. Se recalculan cuando cambia algo.
export function useSearchDocs(): SearchDoc[] | undefined {
  return useLiveQuery(async () => {
    const [notes, documents, canvases, tasks, subjects] = await Promise.all([
      db.notes.toArray(),
      db.documents.toArray(),
      db.canvases.toArray(),
      db.tasks.toArray(),
      db.subjects.toArray(),
    ]);
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const folderName: Record<string, string> = {
      [DAILY_FOLDER]: t("Diario"),
      [LOOSE_FOLDER]: t("Notas"),
      [TEMPLATES_FOLDER]: t("Plantillas"),
    };
    const docs: SearchDoc[] = [];
    for (const n of notes) {
      docs.push({
        key: `n-${n.id}`,
        kind: "note",
        id: n.id,
        title: n.title || t("Sin título"),
        aliases: n.aliases ?? [],
        body: n.plainTextCache ?? "",
        subjectId: n.subjectId,
        subjectName: subjectName.get(n.subjectId) ?? folderName[n.subjectId] ?? t("Notas"),
        unit: n.unitNumber,
        tags: n.tags ?? [],
        updatedAt: n.updatedAt,
      });
    }
    for (const d of documents) {
      docs.push({
        key: `d-${d.id}`,
        kind: "document",
        id: d.id,
        title: d.fileName,
        aliases: [],
        body: d.extractedText ?? "",
        subjectId: d.subjectId,
        subjectName: subjectName.get(d.subjectId) ?? t("Sin materia"),
        unit: d.unitNumber,
        tags: [],
        updatedAt: d.createdAt,
      });
    }
    for (const c of canvases) {
      docs.push({
        key: `c-${c.id}`,
        kind: "canvas",
        id: c.id,
        title: c.name || t("Sin título"),
        aliases: [],
        body: "",
        subjectId: c.subjectId,
        subjectName: (c.subjectId && subjectName.get(c.subjectId)) || t("Notas"),
        tags: [],
        updatedAt: c.updatedAt,
      });
    }
    for (const task of tasks) {
      docs.push({
        key: `t-${task.id}`,
        kind: "task",
        id: task.id,
        title: task.title,
        aliases: [],
        body: task.description ?? "",
        subjectId: task.subjectId,
        subjectName: (task.subjectId && subjectName.get(task.subjectId)) || t("Sin materia"),
        tags: [],
        updatedAt: task.createdAt,
        task,
      });
    }
    return docs;
  }, []);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Resultados para una consulta (con debounce de 150 ms).
export function useSearch(query: string, cs: boolean, sort: SortMode): SearchHit[] {
  const docs = useSearchDocs();
  const q = useDebounced(query, 150);
  return useMemo(() => (docs ? runSearch(docs, parseQuery(q, cs), cs, sort) : []), [docs, q, cs, sort]);
}
