"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import clsx from "clsx";
import { ArrowDownUp, Bookmark, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, Copy, ExternalLink, FilePlus, FolderInput, Pencil, Shapes, Trash2, CalendarDays, ListPlus } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { taskFromNote } from "@/lib/tasks/class-tasks";
import { db } from "@/lib/db";
import { useWorkspace, sameView, type ViewState } from "@/lib/workspace";
import { useOpen } from "@/components/workspace/use-open";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { PromptModal } from "@/components/ui/prompt-modal";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { DAILY_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type BookmarkKind, type Degree } from "@/lib/types";
import {
  addCanvas,
  addNote,
  deleteCanvas,
  deleteNote,
  duplicateNote,
  moveItem,
  newCanvasForView,
  newNoteForView,
  openDailyNote,
  renameItem,
  runSafe,
  toggleBookmark,
  type ModifierEvent,
} from "@/lib/nav/actions";
import { MoveDialog } from "./move-dialog";
import { SubjectDialog } from "@/components/careers/subject-dialog";
import { DegreeDialog } from "@/components/careers/degree-dialog";
import { deleteDegreeCascade } from "@/components/careers/actions";
import { deleteWithUndo } from "@/lib/undo";
import { type ExportTarget } from "@/lib/export/export-pdf";
import { exportMenuItem } from "@/components/export/export-menu";
import { allKeys, ancestorsOf, buildTree, defaultOpen, useBookmarkSet, useExplorerData, type SortMode, type TreeNode } from "./tree";

const LS_OPEN = "uc-explorer-open";
const LS_SORT = "uc-explorer-sort";
const DRAG_MIME = "application/x-unicore-item";

type Payload = { kind: "note" | "canvas"; id: string };
type Target = { subjectId: string; unit?: number };

type Dialog =
  | { type: "rename"; kind: "note" | "canvas" | "subject"; id: string; value: string }
  | { type: "move"; kind: "note" | "canvas"; id: string }
  | { type: "delete"; kind: "note" | "canvas"; id: string; title: string };

const SORT_LABEL: Record<SortMode, string> = { nombre: "Nombre", modificacion: "Modificación", creacion: "Creación" };

interface Ctx {
  activeView: ViewState;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  open: (view: ViewState, e?: ModifierEvent) => void;
  dropKey: string | null;
  setDropKey: (key: string | null) => void;
  onDrop: (payload: Payload, target: Target) => void;
  onContext: (e: MouseEvent, node: TreeNode) => void;
}

const safe = runSafe;

// Árbol del explorador (barra izquierda). Clic abre, Ctrl+clic pestaña nueva, Ctrl+Alt+clic dividir.
export function FileExplorer() {
  const { activeView, openView } = useWorkspace();
  const { degreeFilter, openTaskDialog } = useAppState();
  const open = useOpen();
  const data = useExplorerData();
  const bookmarks = useBookmarkSet();
  const menu = useContextMenu();
  const [sort, setSort] = useState<SortMode>("nombre");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [career, setCareer] = useState<{ type: "subject"; degreeId: string; year?: number } | { type: "degree"; degree: Degree } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  const tree = useMemo(() => (data ? buildTree(data, degreeFilter, sort) : []), [data, degreeFilter, sort]);
  const treeRef = useRef(tree);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  // Preferencias guardadas (orden y carpetas abiertas)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_OPEN);
      if (raw) setOpenMap(JSON.parse(raw) as Record<string, boolean>);
      const savedSort = localStorage.getItem(LS_SORT);
      if (savedSort === "nombre" || savedSort === "modificacion" || savedSort === "creacion") setSort(savedSort);
    } catch {}
  }, []);

  const hasData = data !== undefined;
  const viewKey = JSON.stringify(activeView);
  // Al cambiar de vista, despliega el camino hasta el elemento activo (sin cerrar nada más).
  useEffect(() => {
    const keys = ancestorsOf(treeRef.current, JSON.parse(viewKey) as ViewState);
    if (!keys?.length) return;
    setOpenMap((prev) => {
      if (keys.every((k) => prev[k] === true)) return prev;
      const next = { ...prev };
      for (const k of keys) next[k] = true;
      try {
        localStorage.setItem(LS_OPEN, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [viewKey, hasData]);

  const saveOpen = (next: Record<string, boolean>) => {
    try {
      localStorage.setItem(LS_OPEN, JSON.stringify(next));
    } catch {}
    return next;
  };
  const isOpen = (key: string) => openMap[key] ?? defaultOpen(key);
  const toggle = (key: string) => setOpenMap((prev) => saveOpen({ ...prev, [key]: !(prev[key] ?? defaultOpen(key)) }));
  // Abre o cierra una carpeta con todo lo que tiene adentro.
  const setOpenUnder = (node: TreeNode, open: boolean) =>
    setOpenMap((prev) => saveOpen({ ...prev, ...Object.fromEntries(allKeys([node]).map((k) => [k, open])) }));
  const collapseAll = () => setOpenMap(saveOpen(Object.fromEntries(allKeys(tree).map((k) => [k, false]))));

  const changeSort = (mode: SortMode) => {
    setSort(mode);
    try {
      localStorage.setItem(LS_SORT, mode);
    } catch {}
  };

  // Soltar sobre la misma carpeta (y unidad) no hace nada.
  const moveTo = (payload: Payload, target: Target) => {
    safe(async () => {
      if (payload.kind === "note") {
        const note = await db.notes.get(payload.id);
        if (!note) return;
        if (note.subjectId === target.subjectId && (target.unit === undefined || note.unitNumber === target.unit)) return;
      }
      await moveItem(payload.kind, payload.id, target);
    });
  };

  const ctx: Ctx = {
    activeView,
    isOpen,
    toggle,
    open,
    dropKey,
    setDropKey,
    onDrop: moveTo,
    onContext: (e, node) => {
      const items = menuFor(node);
      if (items.length) menu.open(e, items);
    },
  };

  function menuFor(node: TreeNode): MenuItem[] {
    const bm = (kind: BookmarkKind, id: string) => ({
      label: bookmarks?.has(`${kind}:${id}`) ? "Quitar marcador" : "Agregar a marcadores",
      icon: Bookmark,
      onSelect: () => safe(() => toggleBookmark(kind, id, node.label)),
    });
    const openTab = (view: ViewState): MenuItem => ({ label: "Abrir en pestaña nueva", icon: ExternalLink, onSelect: () => open(view, { ctrlKey: true }) });
    const openSplit = (view: ViewState): MenuItem => ({ label: "Abrir a la derecha", icon: Columns2, onSelect: () => open(view, { ctrlKey: true, altKey: true }) });
    const rename = (kind: "note" | "canvas" | "subject", id: string, value: string): MenuItem => ({
      label: kind === "subject" ? "Renombrar materia" : "Renombrar",
      icon: Pencil,
      onSelect: () => setDialog({ type: "rename", kind, id, value }),
    });
    const remove = (kind: "note" | "canvas", id: string): MenuItem => ({
      label: "Eliminar",
      icon: Trash2,
      danger: true,
      onSelect: () => setDialog({ type: "delete", kind, id, title: node.label }),
    });
    const sep: MenuItem = { type: "separator" };
    const pdf = (target: ExportTarget): MenuItem[] => [exportMenuItem(target)];
    const item = node.item;

    switch (item.kind) {
      case "folder":
        if (item.folder === DAILY_FOLDER)
          return [
            { label: "Nota del día", icon: CalendarDays, onSelect: () => safe(async () => openView({ type: "nota", id: await openDailyNote(new Date()) })) },
            sep,
            ...pdf({ kind: "folder", folder: DAILY_FOLDER }),
          ];
        if (item.folder === TEMPLATES_FOLDER)
          return [
            { label: "Ver plantillas", icon: FilePlus, onSelect: () => openView({ type: "plantillas" }) },
            { label: "Nueva plantilla", icon: FilePlus, onSelect: () => safe(async () => openView({ type: "nota", id: await addNote(TEMPLATES_FOLDER) })) },
          ];
        return [
          { label: "Nueva nota", icon: FilePlus, onSelect: () => safe(async () => openView({ type: "nota", id: await addNote(LOOSE_FOLDER) })) },
          { label: "Nuevo lienzo", icon: Shapes, onSelect: () => safe(async () => openView({ type: "canvas", id: await addCanvas(LOOSE_FOLDER) })) },
          sep,
          ...pdf({ kind: "folder", folder: LOOSE_FOLDER }),
        ];
      case "subject":
        return [
          { label: "Nueva nota", icon: FilePlus, onSelect: () => safe(async () => openView({ type: "nota", id: await addNote(item.id) })) },
          { label: "Nuevo lienzo", icon: Shapes, onSelect: () => safe(async () => openView({ type: "canvas", id: await addCanvas(item.id) })) },
          sep,
          ...(node.view ? [{ label: "Abrir materia", onSelect: () => open(node.view!) }] : []),
          rename("subject", item.id, node.label),
          ...pdf({ kind: "subject", id: item.id }),
          sep,
          bm("subject", item.id),
        ];
      case "unit":
        return [
          {
            label: "Nueva nota en esta unidad",
            icon: FilePlus,
            onSelect: () => safe(async () => openView({ type: "nota", id: await addNote(item.subjectId, { unitNumber: item.unit }) })),
          },
        ];
      case "note":
        return [
          openTab(node.view!),
          openSplit(node.view!),
          sep,
          rename("note", item.id, node.label),
          { label: "Duplicar", icon: Copy, onSelect: () => safe(() => duplicateNote(item.id)) },
          {
            label: "Crear tarea desde esta nota",
            icon: ListPlus,
            onSelect: () =>
              safe(async () => {
                const n = await db.notes.get(item.id);
                if (n) openTaskDialog(await taskFromNote(n));
              }),
          },
          { label: "Mover a", icon: FolderInput, onSelect: () => setDialog({ type: "move", kind: "note", id: item.id }) },
          bm("note", item.id),
          ...pdf({ kind: "note", id: item.id }),
          sep,
          remove("note", item.id),
        ];
      case "canvas":
        return [
          openTab(node.view!),
          openSplit(node.view!),
          sep,
          rename("canvas", item.id, node.label),
          { label: "Mover a", icon: FolderInput, onSelect: () => setDialog({ type: "move", kind: "canvas", id: item.id }) },
          bm("canvas", item.id),
          sep,
          remove("canvas", item.id),
        ];
      case "pdf":
        return [openTab(node.view!), sep, bm("document", item.id)];
      case "degree": {
        const degree = data?.degrees.find((d) => d.id === item.id);
        return [
          { label: "Nueva materia", icon: FilePlus, onSelect: () => setCareer({ type: "subject", degreeId: item.id }) },
          { label: "Nueva tarea de esta carrera", icon: ListPlus, onSelect: () => openTaskDialog({ degreeId: item.id }) },
          { label: "Ver plan de estudios", icon: ExternalLink, onSelect: () => openView({ type: "carreras" }) },
          sep,
          { label: "Expandir todo", icon: ChevronsUpDown, onSelect: () => setOpenUnder(node, true) },
          { label: "Colapsar todo", icon: ChevronsDownUp, onSelect: () => setOpenUnder(node, false) },
          sep,
          { label: "Editar carrera", icon: Pencil, onSelect: () => degree && setCareer({ type: "degree", degree }) },
          ...pdf({ kind: "degree", id: item.id }),
          sep,
          {
            label: "Eliminar carrera",
            icon: Trash2,
            danger: true,
            onSelect: () => safe(() => deleteWithUndo(`Se eliminó «${node.label}»`, () => deleteDegreeCascade(item.id))),
          },
        ];
      }
      case "year":
        return [
          { label: `Nueva materia en ${node.label}`, icon: FilePlus, onSelect: () => setCareer({ type: "subject", degreeId: item.degreeId, year: item.year }) },
          { label: "Nueva tarea de esta carrera", icon: ListPlus, onSelect: () => openTaskDialog({ degreeId: item.degreeId }) },
          sep,
          { label: "Expandir todo", icon: ChevronsUpDown, onSelect: () => setOpenUnder(node, true) },
          { label: "Colapsar todo", icon: ChevronsDownUp, onSelect: () => setOpenUnder(node, false) },
        ];
      default:
        return [];
    }
  }

  const headerNewNote = () => safe(async () => openView({ type: "nota", id: await newNoteForView(activeView) }));
  const headerNewCanvas = () => safe(async () => openView({ type: "canvas", id: await newCanvasForView(activeView) }));
  const sortMenu: MenuItem[] = (Object.keys(SORT_LABEL) as SortMode[]).map((mode) => ({
    label: SORT_LABEL[mode],
    icon: sort === mode ? Check : undefined,
    onSelect: () => changeSort(mode),
  }));

  const renameTitle = dialog?.type === "rename" ? (dialog.kind === "subject" ? "Renombrar materia" : dialog.kind === "canvas" ? "Renombrar lienzo" : "Renombrar nota") : "";
  const deleteTitle = dialog?.type === "delete" ? dialog.title : "";

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex h-9 flex-none items-center justify-end gap-0.5 bg-bg px-2">
        <button type="button" className="icon-btn" aria-label="Nueva nota" title="Nueva nota" onClick={headerNewNote}>
          <FilePlus strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn" aria-label="Nuevo lienzo" title="Nuevo lienzo" onClick={headerNewCanvas}>
          <Shapes strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Ordenar"
          title="Ordenar"
          onClick={(e) => menu.open(e, sortMenu)}
        >
          <ArrowDownUp strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn" aria-label="Colapsar todo" title="Colapsar todo" onClick={collapseAll}>
          <ChevronsDownUp strokeWidth={1.75} />
        </button>
      </div>

      <div role="tree" className="px-1 pb-4">
        <Rows nodes={tree} ctx={ctx} />
      </div>

      <PromptModal
        open={dialog?.type === "rename"}
        title={renameTitle}
        initial={dialog?.type === "rename" ? dialog.value : ""}
        confirmLabel="Renombrar"
        onConfirm={(value) => {
          if (dialog?.type === "rename") safe(() => renameItem(dialog.kind, dialog.id, value));
        }}
        onClose={() => setDialog(null)}
      />
      <MoveDialog
        open={dialog?.type === "move"}
        title="Mover a"
        subjects={data?.subjects ?? []}
        degrees={data?.degrees ?? []}
        onPick={(subjectId) => {
          if (dialog?.type === "move") safe(() => moveItem(dialog.kind, dialog.id, { subjectId }));
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.type === "delete"}
        title="Eliminar"
        text={`¿Eliminar "${deleteTitle}"? No se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (dialog?.type === "delete") safe(() => (dialog.kind === "note" ? deleteNote(dialog.id) : deleteCanvas(dialog.id)));
          setDialog(null);
        }}
        onClose={() => setDialog(null)}
      />
      {career?.type === "subject" && data && (
        <SubjectDialog
          degrees={data.degrees}
          allSubjects={data.subjects}
          defaultDegreeId={career.degreeId}
          defaultYear={career.year}
          onClose={() => setCareer(null)}
        />
      )}
      {career?.type === "degree" && <DegreeDialog degree={career.degree} onClose={() => setCareer(null)} />}
      {menu.menu}
    </div>
  );
}

function Rows({ nodes, ctx }: { nodes: TreeNode[]; ctx: Ctx }) {
  return (
    <>
      {nodes.map((node) => (
        <Row key={node.key} node={node} ctx={ctx} />
      ))}
    </>
  );
}

function Row({ node, ctx }: { node: TreeNode; ctx: Ctx }) {
  const expandable = !!node.children?.length;
  const expanded = expandable && ctx.isOpen(node.key);
  const active = !!node.view && sameView(node.view, ctx.activeView);
  const isLevel = !node.view; // carpetas, carreras, años y unidades
  const Icon = node.icon;
  const dropping = !!node.drop && ctx.dropKey === node.key;

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={expandable ? expanded : undefined}
        aria-selected={active}
        aria-current={active ? "page" : undefined}
        draggable={!!node.drag}
        className={clsx("row select-none", isLevel && "font-medium text-text", dropping && "bg-primary-tint text-text")}
        onClick={(e) => (node.view ? ctx.open(node.view, e) : ctx.toggle(node.key))}
        onAuxClick={(e) => {
          if (e.button === 1 && node.view) {
            e.preventDefault();
            ctx.open(node.view, { button: 1 });
          }
        }}
        onContextMenu={(e) => ctx.onContext(e, node)}
        onDragStart={(e: DragEvent<HTMLDivElement>) => {
          if (!node.drag) return;
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(node.drag));
          e.dataTransfer.setData("text/plain", node.label);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          if (!node.drop || !Array.from(e.dataTransfer.types).includes(DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (ctx.dropKey !== node.key) ctx.setDropKey(node.key);
        }}
        onDragLeave={() => {
          if (ctx.dropKey === node.key) ctx.setDropKey(null);
        }}
        onDrop={(e: DragEvent<HTMLDivElement>) => {
          if (!node.drop) return;
          e.preventDefault();
          ctx.setDropKey(null);
          const raw = e.dataTransfer.getData(DRAG_MIME);
          if (raw) ctx.onDrop(JSON.parse(raw) as Payload, node.drop);
        }}
      >
        <span
          className="flex h-4 w-4 flex-none items-center justify-center text-faint"
          onClick={(e) => {
            if (!expandable) return;
            e.stopPropagation();
            ctx.toggle(node.key);
          }}
        >
          {expandable && (expanded ? <ChevronDown strokeWidth={1.75} /> : <ChevronRight strokeWidth={1.75} />)}
        </span>
        {Icon && <Icon strokeWidth={1.75} />}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </div>
      {expanded && node.children && (
        <div role="group" className="ml-[7px] border-l border-border pl-1">
          <Rows nodes={node.children} ctx={ctx} />
        </div>
      )}
    </>
  );
}
