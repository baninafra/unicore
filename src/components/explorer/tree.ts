"use client";

// Árbol del explorador: carpetas especiales, carreras → años → materias → unidades → notas, lienzos y PDFs.
import { iconFor } from "@/lib/folder-icons";
import { folderName } from "@/lib/folder-names";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, CalendarDays, DraftingCompass, FileSpreadsheet, FileText, FileType, Folder, FolderKanban, NotebookPen, Presentation, Shapes, type LucideIcon } from "lucide-react";
import { db } from "@/lib/db";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Bookmark, type CanvasDoc, type Degree, type Note, type OfficeDoc, type OfficeKind, type Subject, type SubjectDocument } from "@/lib/types";
import { sameView, type ViewState } from "@/lib/workspace";
import { kindOf, PROFILES, type ProfileDef } from "@/lib/profiles";
import { intlLocale, t } from "@/lib/i18n";

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
  drag?: { kind: "note" | "canvas" | "file" | "subject"; id: string };
  // Destino al soltar una nota, un lienzo o un archivo
  drop?: { subjectId: string; unit?: number; parentId?: string };
  // Destino al soltar una materia o carpeta: el espacio (y el año) donde queda, o la carpeta que la contiene
  place?: { degreeId: string; year?: number; parentId?: string };
  // Dónde queda una materia o carpeta soltada al lado (borde de arriba o de abajo de la fila)
  beside?: { degreeId: string; year?: number; parentId?: string };
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
    return name(a).localeCompare(name(b), intlLocale(), { numeric: true, sensitivity: "base" });
  });
}


function canvasNode(c: CanvasDoc, subjectId: string): TreeNode {
  return {
    key: `c:${c.id}`,
    label: c.name || t("Sin título"),
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
  // Carpetas dentro de otra carpeta (o materia): cuelgan de ella, no de su espacio.
  const nested = (s: Subject) => !!s.parentId && s.parentId !== s.id && subjectIds.has(s.parentId);
  const childFolders = group(data.subjects.filter(nested), (s) => s.parentId);
  const byName = (a: Subject, b: Subject) => a.name.localeCompare(b.name, intlLocale(), { numeric: true });

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
      label: n.title || t("Sin título"),
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
      label: folderName(DAILY_FOLDER) ?? t("Diario"),
      icon: CalendarDays,
      item: { kind: "folder", folder: DAILY_FOLDER },
      drop: { subjectId: DAILY_FOLDER },
      beside: { degreeId: "" },
      children: daily.map((n) => noteNode(n)),
    },
    {
      key: "f:notas",
      label: folderName(LOOSE_FOLDER) ?? t("Notas"),
      icon: Folder,
      item: { kind: "folder", folder: LOOSE_FOLDER },
      drop: { subjectId: LOOSE_FOLDER },
      beside: { degreeId: "" },
      children: [...looseNotes.map((n) => noteNode(n)), ...looseCanvases.map((c) => canvasNode(c, LOOSE_FOLDER)), ...looseFiles.map((f) => fileNode(f, LOOSE_FOLDER))],
    },
  ];

  // El Diario sólo aparece cuando ya hay notas del día (se abre desde la columna de íconos).
  const folders = allFolders.filter((f) => f.key !== "f:diario" || f.children?.length);

  // Materias con su contenido
  const notesBy = group(topLevel(data.notes), (n) => (subjectIds.has(n.subjectId) ? n.subjectId : undefined));
  const canvasesBy = group(data.canvases, (c) => (c.subjectId && subjectIds.has(c.subjectId) ? c.subjectId : undefined));
  const filesBy = group(data.officeDocs, (f) => (subjectIds.has(f.subjectId) ? f.subjectId : undefined));

  const subjectNode = (s: Subject, def: ProfileDef = PROFILES.universidad, depth = 0): TreeNode => {
    const subfolders = depth < 8 ? (childFolders[s.id] ?? []).sort(byName).map((c) => subjectNode(c, def, depth + 1)) : [];
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
    children.unshift(...subfolders);
    return {
      key: `s:${s.id}`,
      label: s.name,
      icon: iconFor(s.icon, s.folder ? Folder : def.study ? BookOpen : FolderKanban),
      view: { type: "materia", id: s.id },
      item: { kind: "subject", id: s.id },
      drag: { kind: "subject", id: s.id },
      drop: { subjectId: s.id },
      place: { degreeId: s.degreeId, parentId: s.id },
      beside: { degreeId: s.degreeId, year: s.folder || !def.study ? undefined : s.year, parentId: nested(s) ? s.parentId : undefined },
      children,
    };
  };

  const degrees = data.degrees
    .filter((d) => (degreeFilter === "all" || d.id === degreeFilter) && inScope(d.id))
    .map((d): TreeNode => {
      const def = PROFILES[kindOf(d)];
      const subjects = data.subjects.filter((s) => s.degreeId === d.id && !nested(s));
      const node = (s: Subject) => subjectNode(s, def);
      // Las carpetas libres van arriba (no tienen año ni cuatrimestre).
      const folderNodes = subjects.filter((s) => s.folder).sort((a, b) => a.name.localeCompare(b.name, intlLocale())).map(node);
      const years = [...new Set(subjects.filter((s) => !s.folder).map((s) => s.year))].sort((a, b) => a - b);
      // Trabajo, proyectos y personal no tienen años: van directo, ordenados por nombre.
      if (!def.study) {
        return {
          key: `d:${d.id}`,
          label: d.name,
          icon: def.spaceIcon,
          item: { kind: "degree", id: d.id },
          place: { degreeId: d.id },
          beside: { degreeId: "" },
          children: [...folderNodes, ...subjects.filter((s) => !s.folder).sort((a, b) => a.name.localeCompare(b.name, intlLocale())).map(node)],
        };
      }
      return {
        key: `d:${d.id}`,
        label: d.name,
        icon: def.spaceIcon,
        item: { kind: "degree", id: d.id },
        place: { degreeId: d.id },
        beside: { degreeId: "" },
        children: [...folderNodes, ...years.map((y): TreeNode => ({
          key: `y:${d.id}:${y}`,
          label: t("{año}.º año", { año: y }),
          item: { kind: "year", degreeId: d.id, year: y },
          place: { degreeId: d.id, year: y },
          beside: { degreeId: d.id },
          children: subjects
            .filter((s) => s.year === y && !s.folder)
            .sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, intlLocale()))
            .map(node),
        }))],
      };
    });

  // Carpetas de primer nivel (sin espacio), al lado de las carreras y espacios.
  const degreeIds = new Set(data.degrees.map((d) => d.id));
  const rootFolders = data.subjects
    .filter((s) => !nested(s) && !degreeIds.has(s.degreeId))
    .sort(byName)
    .map((s) => subjectNode(s));

  const flat = degrees.find((d) => d.key === `d:${flatId}`);
  if (flat) return [...(flat.children ?? []), ...folders, ...rootFolders, ...degrees.filter((d) => d !== flat)];
  return [...folders, ...rootFolders, ...degrees];
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
