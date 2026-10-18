"use client";

// Árbol del explorador: carpetas especiales, carreras → años → materias → unidades → notas, lienzos y PDFs.
import { folderName } from "@/lib/folder-names";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, CalendarDays, DraftingCompass, FileSpreadsheet, FileText, FileType, Folder, FolderKanban, NotebookPen, Presentation, Shapes, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Bookmark, type CanvasDoc, type Degree, type Note, type OfficeDoc, type OfficeKind, type Subject, type SubjectDocument } from "@/lib/types";
import { sameView, type ViewState } from "@/lib/workspace";
import { kindOf, PROFILES, type ProfileDef } from "@/lib/profiles";

export type SortMode = "nombre" | "modificacion" | "creacion";

export interface ExplorerData {
  degrees: Degree[];
  subjects: Subject[];
  notes: Note[];
  documents: SubjectDocument[];
  canvases: CanvasDoc[];
  officeDocs: OfficeDoc[];
}

export type NodeItem =
  | { kind: "folder"; folder: string }
  | { kind: "degree"; id: string }
  | { kind: "year"; degreeId: string; year: number }
  | { kind: "subject"; id: string }
  | { kind: "unit"; subjectId: string; unit: number }
  | { kind: "note"; id: string; subjectId: string }
  | { kind: "canvas"; id: string; subjectId: string }
  | { kind: "file"; id: string; subjectId: string }
  | { kind: "pdf"; id: string };

export interface TreeNode {
  key: string;
  label: string;
  icon?: LucideIcon;
  view?: ViewState;
  children?: TreeNode[];
  item: NodeItem;
  drag?: { kind: "note" | "canvas" | "file"; id: string };
  // Destino al soltar algo arrastrado
  drop?: { subjectId: string; unit?: number; parentId?: string };
}

export function useExplorerData(): ExplorerData | undefined {
  return useLiveQuery(async () => {
    const [degrees, subjects, notes, documents, canvases, officeDocs] = await Promise.all([
      db.degrees.toArray(),
      db.subjects.toArray(),
      db.notes.toArray(),
      db.documents.toArray(),
      db.canvases.toArray(),
      db.officeDocs.toArray(),
    ]);
    return {
      degrees: degrees.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      subjects,
      notes,
      documents,
      canvases,
      officeDocs,
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

const FILE_ICON: Record<OfficeKind, LucideIcon> = { doc: FileText, sheet: FileSpreadsheet, deck: Presentation, pdf: FileType, geo: DraftingCompass };

function fileNode(f: OfficeDoc, subjectId: string): TreeNode {
  return {
    key: `e:${f.id}`,
    label: f.name,
    icon: FILE_ICON[f.kind],
    view: { type: "editor", id: f.id },
    item: { kind: "file", id: f.id, subjectId },
    drag: { kind: "file", id: f.id },
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

// `flatId`: espacio único del perfil activo (trabajo, proyectos, personal); sus proyectos van al primer nivel.
export function buildTree(data: ExplorerData, degreeFilter: string, sort: SortMode, inScope: (degreeId?: string) => boolean = () => true, flatId?: string): TreeNode[] {
  const subjectIds = new Set(data.subjects.map((s) => s.id));

  // Subnotas: cuelgan de su nota madre (si la madre está en la misma carpeta).
  const noteById = new Map(data.notes.map((n) => [n.id, n]));
  const parentOf = (n: Note) => {
    const p = n.parentId ? noteById.get(n.parentId) : undefined;
    return p && p.subjectId === n.subjectId ? p : undefined;
  };
  const kidsBy = group(data.notes, (n) => parentOf(n)?.id);
  const topLevel = (list: Note[]) => list.filter((n) => !parentOf(n));
  const noteNode = (n: Note, depth = 0): TreeNode => {
    const kids = depth < 6 ? sortItems(kidsBy[n.id] ?? [], (k) => k.title, sort) : [];
    return {
      key: `n:${n.id}`,
      label: n.title || "Sin título",
      icon: NotebookPen,
      view: { type: "nota", id: n.id },
      item: { kind: "note", id: n.id, subjectId: n.subjectId },
      drag: { kind: "note", id: n.id },
      drop: { subjectId: n.subjectId, unit: n.unitNumber, parentId: n.id },
      children: kids.length ? kids.map((k) => noteNode(k, depth + 1)) : undefined,
    };
  };

  // Carpetas especiales
  const daily = topLevel(data.notes)
    .filter((n) => n.subjectId === DAILY_FOLDER)
    .sort((a, b) => (b.dailyDate ?? "").localeCompare(a.dailyDate ?? ""));
  const isLoose = (sid: string | undefined) => !sid || sid === LOOSE_FOLDER || (!subjectIds.has(sid) && sid !== DAILY_FOLDER && sid !== TEMPLATES_FOLDER && sid !== IDEAS_FOLDER);
  const looseNotes = sortItems(
    topLevel(data.notes).filter((n) => isLoose(n.subjectId)),
    (n) => n.title,
    sort,
  );
  const looseCanvases = sortItems(
    data.canvases.filter((c) => isLoose(c.subjectId)),
    (c) => c.name,
    sort,
  );

  const looseFiles = sortItems(
    data.officeDocs.filter((f) => isLoose(f.subjectId)),
    (f) => f.name,
    sort,
  );

  const allFolders: TreeNode[] = [
    {
      key: "f:diario",
      label: folderName(DAILY_FOLDER) ?? "Diario",
      icon: CalendarDays,
      item: { kind: "folder", folder: DAILY_FOLDER },
      drop: { subjectId: DAILY_FOLDER },
      children: daily.map((n) => noteNode(n)),
    },
    {
      key: "f:notas",
      label: folderName(LOOSE_FOLDER) ?? "Notas",
      icon: Folder,
      item: { kind: "folder", folder: LOOSE_FOLDER },
      drop: { subjectId: LOOSE_FOLDER },
      children: [...looseNotes.map((n) => noteNode(n)), ...looseCanvases.map((c) => canvasNode(c, LOOSE_FOLDER)), ...looseFiles.map((f) => fileNode(f, LOOSE_FOLDER))],
    },
  ];

  // El Diario sólo aparece cuando ya hay notas del día (se abre desde la columna de íconos).
  const folders = allFolders.filter((f) => f.key !== "f:diario" || f.children?.length);

  // Materias con su contenido
  const notesBy = group(topLevel(data.notes), (n) => (subjectIds.has(n.subjectId) ? n.subjectId : undefined));
  const canvasesBy = group(data.canvases, (c) => (c.subjectId && subjectIds.has(c.subjectId) ? c.subjectId : undefined));
  const filesBy = group(data.officeDocs, (f) => (subjectIds.has(f.subjectId) ? f.subjectId : undefined));

  const subjectNode = (s: Subject, def: ProfileDef = PROFILES.universidad): TreeNode => {
    const notes = sortItems(notesBy[s.id] ?? [], (n) => n.title, sort);
    const canvases = sortItems(canvasesBy[s.id] ?? [], (c) => c.name, sort);
    const files = sortItems(filesBy[s.id] ?? [], (f) => f.name, sort).map((f) => fileNode(f, s.id));
    // La bibliografía (PDF) se ve en la materia, no en el árbol.
    const units = [...new Set(notes.map((n) => n.unitNumber))].sort((a, b) => a - b);
    const children: TreeNode[] =
      units.length > 1
        ? [
            ...units.map((u): TreeNode => ({
              key: `u:${s.id}:${u}`,
              label: `${def.unit} ${u}`,
              item: { kind: "unit", subjectId: s.id, unit: u },
              drop: { subjectId: s.id, unit: u },
              children: notes.filter((n) => n.unitNumber === u).map((n) => noteNode(n)),
            })),
            ...canvases.map((c) => canvasNode(c, s.id)),
            ...files,
          ]
        : [...notes.map((n) => noteNode(n)), ...canvases.map((c) => canvasNode(c, s.id)), ...files];
    return {
      key: `s:${s.id}`,
      label: s.name,
      icon: def.study ? BookOpen : FolderKanban,
      view: { type: "materia", id: s.id },
      item: { kind: "subject", id: s.id },
      drop: { subjectId: s.id },
      children,
    };
  };

  const degrees = data.degrees
    .filter((d) => (degreeFilter === "all" || d.id === degreeFilter) && inScope(d.id))
    .map((d): TreeNode => {
      const def = PROFILES[kindOf(d)];
      const subjects = data.subjects.filter((s) => s.degreeId === d.id);
      const years = [...new Set(subjects.map((s) => s.year))].sort((a, b) => a - b);
      const node = (s: Subject) => subjectNode(s, def);
      // Trabajo, proyectos y personal no tienen años: van directo, ordenados por nombre.
      if (!def.study) {
        return {
          key: `d:${d.id}`,
          label: d.name,
          icon: def.spaceIcon,
          item: { kind: "degree", id: d.id },
          children: [...subjects].sort((a, b) => a.name.localeCompare(b.name, "es")).map(node),
        };
      }
      return {
        key: `d:${d.id}`,
        label: d.name,
        icon: def.spaceIcon,
        item: { kind: "degree", id: d.id },
        children: years.map((y): TreeNode => ({
          key: `y:${d.id}:${y}`,
          label: `${y}.º año`,
          item: { kind: "year", degreeId: d.id, year: y },
          children: subjects
            .filter((s) => s.year === y)
            .sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, "es"))
            .map(node),
        })),
      };
    });

  const flat = degrees.find((d) => d.key === `d:${flatId}`);
  if (flat) return [...(flat.children ?? []), ...folders, ...degrees.filter((d) => d !== flat)];
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
