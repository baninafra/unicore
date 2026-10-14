"use client";

// Árbol del explorador: carpetas especiales, carreras → años → materias → unidades → notas, lienzos y PDFs.
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, CalendarDays, Folder, GraduationCap, Lightbulb, NotebookPen, Shapes, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Bookmark, type CanvasDoc, type Degree, type Note, type Subject, type SubjectDocument } from "@/lib/types";
import { sameView, type ViewState } from "@/lib/workspace";

export type SortMode = "nombre" | "modificacion" | "creacion";

export interface ExplorerData {
  degrees: Degree[];
  subjects: Subject[];
  notes: Note[];
  documents: SubjectDocument[];
  canvases: CanvasDoc[];
}

export type NodeItem =
  | { kind: "folder"; folder: string }
  | { kind: "degree"; id: string }
  | { kind: "year"; degreeId: string; year: number }
  | { kind: "subject"; id: string }
  | { kind: "unit"; subjectId: string; unit: number }
  | { kind: "note"; id: string; subjectId: string }
  | { kind: "canvas"; id: string; subjectId: string }
  | { kind: "pdf"; id: string };

export interface TreeNode {
  key: string;
  label: string;
  icon?: LucideIcon;
  view?: ViewState;
  children?: TreeNode[];
  item: NodeItem;
  drag?: { kind: "note" | "canvas"; id: string };
  // Destino al soltar algo arrastrado
  drop?: { subjectId: string; unit?: number };
}

export function useExplorerData(): ExplorerData | undefined {
  return useLiveQuery(async () => {
    const [degrees, subjects, notes, documents, canvases] = await Promise.all([
      db.degrees.toArray(),
      db.subjects.toArray(),
      db.notes.toArray(),
      db.documents.toArray(),
      db.canvases.toArray(),
    ]);
    return {
      degrees: degrees.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      subjects,
      notes,
      documents,
      canvases,
    };
  }, []);
}

export function useBookmarkSet(): Set<string> | undefined {
  const list = useLiveQuery(() => db.bookmarks.toArray(), []);
  if (!list) return undefined;
  return new Set(list.map((b: Bookmark) => `${b.kind}:${b.targetId}`));
}

function sortItems<T extends { createdAt: string; updatedAt?: string }>(items: T[], name: (t: T) => string, mode: SortMode): T[] {
  return [...items].sort((a, b) => {
    if (mode === "modificacion") return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);
    if (mode === "creacion") return b.createdAt.localeCompare(a.createdAt);
    return name(a).localeCompare(name(b), "es", { numeric: true, sensitivity: "base" });
  });
}

function noteNode(n: Note): TreeNode {
  return {
    key: `n:${n.id}`,
    label: n.title || "Sin título",
    icon: NotebookPen,
    view: { type: "nota", id: n.id },
    item: { kind: "note", id: n.id, subjectId: n.subjectId },
    drag: { kind: "note", id: n.id },
  };
}

function canvasNode(c: CanvasDoc, subjectId: string): TreeNode {
  return {
    key: `c:${c.id}`,
    label: c.name || "Sin título",
    icon: Shapes,
    view: { type: "canvas", id: c.id },
    item: { kind: "canvas", id: c.id, subjectId },
    drag: { kind: "canvas", id: c.id },
  };
}

function group<T>(list: T[], keyOf: (t: T) => string | undefined): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of list) {
    const k = keyOf(item);
    if (!k) continue;
    (out[k] ??= []).push(item);
  }
  return out;
}

export function buildTree(data: ExplorerData, degreeFilter: string, sort: SortMode): TreeNode[] {
  const subjectIds = new Set(data.subjects.map((s) => s.id));

  // Carpetas especiales
  const daily = data.notes
    .filter((n) => n.subjectId === DAILY_FOLDER)
    .sort((a, b) => (b.dailyDate ?? "").localeCompare(a.dailyDate ?? ""));
  const isLoose = (sid: string | undefined) => !sid || sid === LOOSE_FOLDER || (!subjectIds.has(sid) && sid !== DAILY_FOLDER && sid !== TEMPLATES_FOLDER && sid !== IDEAS_FOLDER);
  const looseNotes = sortItems(
    data.notes.filter((n) => isLoose(n.subjectId)),
    (n) => n.title,
    sort,
  );
  const looseCanvases = sortItems(
    data.canvases.filter((c) => isLoose(c.subjectId)),
    (c) => c.name,
    sort,
  );

  const folders: TreeNode[] = [
    {
      key: "f:diario",
      label: "Diario",
      icon: CalendarDays,
      item: { kind: "folder", folder: DAILY_FOLDER },
      children: daily.map(noteNode),
    },
    {
      key: "f:notas",
      label: "Notas",
      icon: Folder,
      item: { kind: "folder", folder: LOOSE_FOLDER },
      drop: { subjectId: LOOSE_FOLDER },
      children: [...looseNotes.map(noteNode), ...looseCanvases.map((c) => canvasNode(c, LOOSE_FOLDER))],
    },
    {
      key: "f:ideas",
      label: "Ideas",
      icon: Lightbulb,
      view: { type: "ideas" },
      item: { kind: "folder", folder: IDEAS_FOLDER },
      drop: { subjectId: IDEAS_FOLDER },
      children: sortItems(
        data.notes.filter((n) => n.subjectId === IDEAS_FOLDER),
        (n) => n.title,
        sort,
      ).map(noteNode),
    },
  ];

  // Materias con su contenido
  const notesBy = group(data.notes, (n) => (subjectIds.has(n.subjectId) ? n.subjectId : undefined));
  const canvasesBy = group(data.canvases, (c) => (c.subjectId && subjectIds.has(c.subjectId) ? c.subjectId : undefined));

  const subjectNode = (s: Subject): TreeNode => {
    const notes = sortItems(notesBy[s.id] ?? [], (n) => n.title, sort);
    const canvases = sortItems(canvasesBy[s.id] ?? [], (c) => c.name, sort);
    // La bibliografía (PDF) se ve en la materia, no en el árbol.
    const units = [...new Set(notes.map((n) => n.unitNumber))].sort((a, b) => a - b);
    const children: TreeNode[] =
      units.length > 1
        ? [
            ...units.map((u): TreeNode => ({
              key: `u:${s.id}:${u}`,
              label: `Unidad ${u}`,
              item: { kind: "unit", subjectId: s.id, unit: u },
              drop: { subjectId: s.id, unit: u },
              children: notes.filter((n) => n.unitNumber === u).map(noteNode),
            })),
            ...canvases.map((c) => canvasNode(c, s.id)),
          ]
        : [...notes.map(noteNode), ...canvases.map((c) => canvasNode(c, s.id))];
    return {
      key: `s:${s.id}`,
      label: s.name,
      icon: BookOpen,
      view: { type: "materia", id: s.id },
      item: { kind: "subject", id: s.id },
      drop: { subjectId: s.id },
      children,
    };
  };

  const degrees = data.degrees
    .filter((d) => degreeFilter === "all" || d.id === degreeFilter)
    .map((d): TreeNode => {
      const subjects = data.subjects.filter((s) => s.degreeId === d.id);
      const years = [...new Set(subjects.map((s) => s.year))].sort((a, b) => a - b);
      return {
        key: `d:${d.id}`,
        label: d.name,
        icon: GraduationCap,
        item: { kind: "degree", id: d.id },
        children: years.map((y): TreeNode => ({
          key: `y:${d.id}:${y}`,
          label: `${y}.º año`,
          item: { kind: "year", degreeId: d.id, year: y },
          children: subjects
            .filter((s) => s.year === y)
            .sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, "es"))
            .map(subjectNode),
        })),
      };
    });

  return [...folders, ...degrees];
}

// Claves de todos los nodos que tienen hijos (para colapsar todo).
export function allKeys(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.children?.length) {
        out.push(n.key);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

// Claves de los antecesores del nodo que muestra `view` (para desplegar el camino hasta la nota activa).
export function ancestorsOf(nodes: TreeNode[], view: ViewState): string[] | undefined {
  const walk = (list: TreeNode[], path: string[]): string[] | undefined => {
    for (const n of list) {
      if (n.view && sameView(n.view, view)) return path;
      if (n.children?.length) {
        const found = walk(n.children, [...path, n.key]);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(nodes, []);
}

// Carpetas que arrancan desplegadas (el resto, cerradas).
export function defaultOpen(key: string): boolean {
  return key.startsWith("d:") || key.startsWith("y:") || key.startsWith("f:");
}
