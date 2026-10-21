"use client";

import { openFolderDialog } from "./folder-dialog";
import { newSubmenu, type NewMenuOpts } from "@/components/ui/new-menu";
import { renameFolder, useFolderNames } from "@/lib/folder-names";
import { addIdea } from "@/views/ideas-view";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import { ArrowDownUp, Bookmark, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, Copy, Download, ExternalLink, FilePlus, FolderInput, Pencil, Trash2, CalendarDays, ListPlus, GraduationCap, FolderKanban, FolderPlus, Palette } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { t } from "@/lib/i18n";
import { useProfiles } from "@/lib/profiles";
import { taskFromNote } from "@/lib/tasks/class-tasks";
import { db } from "@/lib/db";
import { useWorkspace, sameView, type ViewState } from "@/lib/workspace";
import { useOpen } from "@/components/workspace/use-open";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { PromptModal } from "@/components/ui/prompt-modal";
import { ConfirmDialog } from "@/components/notes/confirm-dialog";
import { DAILY_FOLDER, IDEAS_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type BookmarkKind, type Degree } from "@/lib/types";
import {
  addNote,
  deleteCanvas,
  deleteNote,
  duplicateNote,
  moveItem,
  moveSubject,
  newNoteForView,
  openDailyNote,
  renameItem,
  runSafe,
  toggleBookmark,
  type ModifierEvent,
} from "@/lib/nav/actions";
import { MoveDialog } from "./move-dialog";
import { createSubnote, nestNote } from "@/lib/notes/subnotes";
import { toast } from "@/lib/undo";
import { deleteOfficeDoc, downloadOfficeDoc } from "@/lib/editors/editors";
import { SubjectDialog } from "@/components/careers/subject-dialog";
import { DegreeDialog } from "@/components/careers/degree-dialog";
import { deleteDegreeCascade, deleteSubjectCascade } from "@/components/careers/actions";
import { deleteWithUndo } from "@/lib/undo";
import { type ExportTarget } from "@/lib/export/export-pdf";
import { exportMenuItem } from "@/components/export/export-menu";
import { allKeys, ancestorsOf, buildTree, defaultOpen, useBookmarkSet, useExplorerData, type SortMode, type TreeNode } from "./tree";

const LS_OPEN = "uc-explorer-open";
const LS_SORT = "uc-explorer-sort";
// Arrastrar notas, lienzos y archivos a otra carpeta o materia, y materias o carpetas a otro espacio o año. Con pointer events (el arrastre
// nativo del navegador no es confiable dentro de la app de escritorio): arranca al mantener
// apretado o al mover el mouse con el botón apretado. Quedarse encima de una carpeta cerrada la abre.
function startDrag(
  e: ReactPointerEvent,
  node: TreeNode,
  h: { findDrop: (key: string, p: Payload) => Target | undefined; setDropKey: (k: string | null) => void; moveTo: (p: Payload, t: Target) => void; toggle: (key: string) => void },
) {
  if (e.button !== 0 || !node.drag) return;
  const payload = node.drag;
  const startX = e.clientX;
  const startY = e.clientY;
  let active = false;
  let ghost: HTMLDivElement | null = null;
  let overKey: string | null = null;
  let expandKey: string | null = null;
  let expandTimer: number | undefined;

  const start = () => {
    window.clearTimeout(holdTimer);
    if (active) return;
    active = true;
    window.getSelection()?.removeAllRanges();
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    ghost = document.createElement("div");
    ghost.textContent = node.label;
    ghost.className = "pointer-events-none fixed z-[1000] max-w-[240px] truncate rounded-md border border-border bg-surface-raised px-2 py-1 text-[length:calc(13px*var(--ui-scale,1))] text-text shadow-lg";
    document.body.appendChild(ghost);
  };
  const holdTimer = window.setTimeout(start, 300);

  const onMove = (ev: PointerEvent) => {
    if (!active) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 5) return;
      start();
    }
    ev.preventDefault();
    if (ghost) {
      ghost.style.left = `${ev.clientX + 12}px`;
      ghost.style.top = `${ev.clientY + 8}px`;
    }
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const dropEl = el?.closest<HTMLElement>("[data-drop]");
    const k = dropEl?.dataset.drop;
    const key = k && k !== `n:${payload.id}` && k !== `s:${payload.id}` && h.findDrop(k, payload) ? k : null;
    if (key !== overKey) {
      overKey = key;
      h.setDropKey(key);
    }
    const exp = el?.closest<HTMLElement>("[data-expand]")?.dataset.expand ?? null;
    if (exp !== expandKey) {
      expandKey = exp;
      window.clearTimeout(expandTimer);
      if (exp) expandTimer = window.setTimeout(() => h.toggle(exp), 600);
    }
  };
  const onUp = () => {
    if (active) {
      const target = overKey ? h.findDrop(overKey, payload) : undefined;
      if (target) h.moveTo(payload, target);
      // El clic que llega al soltar no tiene que abrir la nota.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 50);
    }
    cleanup();
  };
  const cleanup = () => {
    window.clearTimeout(holdTimer);
    window.clearTimeout(expandTimer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", cleanup);
    if (active) {
      ghost?.remove();
      h.setDropKey(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", cleanup);
}

type Payload = { kind: "note" | "canvas" | "file" | "subject"; id: string };
type Target = { subjectId: string; unit?: number; parentId?: string } | { place: { degreeId: string; year?: number; parentId?: string } };

type Dialog =
  | { type: "rename"; kind: "note" | "canvas" | "subject" | "file" | "folder"; id: string; value: string }
  | { type: "move"; kind: "note" | "canvas" | "file"; id: string }
  | { type: "delete"; kind: "note" | "canvas" | "file"; id: string; title: string };

const SORT_LABEL: Record<SortMode, string> = { nombre: t("Nombre"), modificacion: t("Modificación"), creacion: t("Creación") };

interface Ctx {
  activeView: ViewState;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  open: (view: ViewState, e?: ModifierEvent) => void;
  dropKey: string | null;
  setDropKey: (key: string | null) => void;
  onDrop: (payload: Payload, target: Target) => void;
  startDrag: (e: ReactPointerEvent, node: TreeNode) => void;
  onContext: (e: MouseEvent, node: TreeNode) => void;
}

const safe = runSafe;

// Árbol del explorador (barra izquierda). Clic abre, Ctrl+clic pestaña nueva, Ctrl+Alt+clic dividir.
export function FileExplorer() {
  const { activeView, openView } = useWorkspace();
  const { degreeFilter, openTaskDialog } = useAppState();
  const { inScope, termsFor, termsForSubject, singleSpace, activeProfile, terms } = useProfiles();
  const open = useOpen();
  const data = useExplorerData();
  const bookmarks = useBookmarkSet();
  const menu = useContextMenu();
  const [sort, setSort] = useState<SortMode>("nombre");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [career, setCareer] = useState<{ type: "subject"; degreeId: string; year?: number } | { type: "degree"; degree: Degree } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  const namesVersion = useFolderNames();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- namesVersion: los nombres de las carpetas fijas
  const tree = useMemo(() => (data ? buildTree(data, degreeFilter, sort, inScope, singleSpace?.id) : []), [data, degreeFilter, sort, inScope, singleSpace?.id, namesVersion]);
  const dropTargets = useMemo(() => {
    const map = new Map<string, TreeNode>();
    const walk = (nodes: TreeNode[]) => nodes.forEach((n) => ((n.drop || n.place) && map.set(n.key, n), n.children && walk(n.children)));
    walk(tree);
    return map;
  }, [tree]);
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
      if ("place" in target) {
        if (payload.kind === "subject" && !(await moveSubject(payload.id, target.place)))
          toast(t("No se puede mover una carpeta adentro de sí misma."), { tone: "error" });
        return;
      }
      if (payload.kind === "subject") return;
      if (payload.kind === "note") {
        const note = await db.notes.get(payload.id);
        if (!note) return;
        // Soltar una nota sobre otra la vuelve su subnota.
        if (target.parentId) {
          if (target.parentId === note.parentId) return;
          try {
            await nestNote(note.id, target.parentId);
          } catch (err) {
            toast(err instanceof Error ? err.message : t("No se pudo mover."), { tone: "error" });
          }
          return;
        }
        if (!note.parentId && note.subjectId === target.subjectId && (target.unit === undefined || note.unitNumber === target.unit)) return;
      } else if (target.parentId) return;
      else if (target.subjectId === DAILY_FOLDER || target.subjectId === IDEAS_FOLDER) {
        toast(t("En esa carpeta sólo van notas."), { tone: "error" });
        return;
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
    startDrag: (e, node) => startDrag(e, node, { findDrop: (key, p) => {
        const n = dropTargets.get(key);
        if (p.kind === "subject") return n?.place ? { place: n.place } : undefined;
        return n?.drop;
      }, setDropKey, moveTo, toggle }),
    onContext: (e, node) => {
      const items = menuFor(node);
      if (items.length) menu.open(e, items);
    },
  };

  function menuFor(node: TreeNode): MenuItem[] {
    const bm = (kind: BookmarkKind, id: string) => ({
      label: bookmarks?.has(`${kind}:${id}`) ? t("Quitar marcador") : t("Agregar a marcadores"),
      icon: Bookmark,
      onSelect: () => safe(() => toggleBookmark(kind, id, node.label)),
    });
    const openTab = (view: ViewState): MenuItem => ({ label: t("Abrir en pestaña nueva"), icon: ExternalLink, onSelect: () => open(view, { ctrlKey: true }) });
    const openSplit = (view: ViewState): MenuItem => ({ label: t("Abrir a la derecha"), icon: Columns2, onSelect: () => open(view, { ctrlKey: true, altKey: true }) });
    const rename = (kind: "note" | "canvas" | "subject" | "file", id: string, value: string): MenuItem => ({
      label: kind === "subject" ? t("Renombrar {nombre}", { nombre: data?.subjects.find((x) => x.id === id)?.folder ? t("carpeta") : termsForSubject(id).item.one }) : t("Renombrar"),
      icon: Pencil,
      onSelect: () => setDialog({ type: "rename", kind, id, value }),
    });
    const remove = (kind: "note" | "canvas" | "file", id: string): MenuItem => ({
      label: t("Eliminar"),
      icon: Trash2,
      danger: true,
      onSelect: () => setDialog({ type: "delete", kind, id, title: node.label }),
    });
    const sep: MenuItem = { type: "separator" };
    const pdf = (target: ExportTarget): MenuItem[] => [exportMenuItem(target)];
    const item = node.item;
    const nuevo = (o: Partial<NewMenuOpts> = {}) => newSubmenu({ open: (v) => openView(v), openTask: (d) => openTaskDialog(d), subjectId: LOOSE_FOLDER, ...o });

    switch (item.kind) {
      case "folder": {
        const renameFolderItem: MenuItem = {
          label: t("Renombrar"),
          icon: Pencil,
          onSelect: () => setDialog({ type: "rename", kind: "folder", id: item.folder, value: node.label }),
        };
        if (item.folder === DAILY_FOLDER)
          return [
            { label: t("Nota del día"), icon: CalendarDays, onSelect: () => safe(async () => openView({ type: "nota", id: await openDailyNote(new Date()) })) },
            nuevo({ subjectId: LOOSE_FOLDER }),
            renameFolderItem,
            sep,
            ...pdf({ kind: "folder", folder: DAILY_FOLDER }),
          ];
        if (item.folder === IDEAS_FOLDER)
          return [
            { label: t("Nueva idea"), icon: FilePlus, onSelect: () => safe(async () => openView({ type: "nota", id: await addIdea("") })) },
            nuevo({ subjectId: LOOSE_FOLDER }),
            { label: t("Ver ideas"), icon: ExternalLink, onSelect: () => openView({ type: "ideas" }) },
            renameFolderItem,
          ];
        if (item.folder === TEMPLATES_FOLDER)
          return [
            { label: t("Ver plantillas"), icon: FilePlus, onSelect: () => openView({ type: "plantillas" }) },
            { label: t("Nueva plantilla"), icon: FilePlus, onSelect: () => safe(async () => openView({ type: "nota", id: await addNote(TEMPLATES_FOLDER) })) },
          ];
        return [
          nuevo({ subjectId: LOOSE_FOLDER }),
          renameFolderItem,
          sep,
          ...pdf({ kind: "folder", folder: LOOSE_FOLDER }),
        ];
      }
      case "subject": {
        const subject = data?.subjects.find((x) => x.id === item.id);
        const kindName = subject?.folder ? t("carpeta") : termsForSubject(item.id).item.one;
        return [
          nuevo({ subjectId: item.id, degreeId: subject?.degreeId }),
          sep,
          ...(node.view ? [{ label: t("Abrir"), onSelect: () => open(node.view!) }] : []),
          rename("subject", item.id, node.label),
          {
            label: t("Cambiar nombre e ícono"),
            icon: Palette,
            onSelect: () => {
              const subject = data?.subjects.find((x) => x.id === item.id);
              if (subject) openFolderDialog({ subject });
            },
          },
          ...(subject?.parentId || (subject?.folder && data?.degrees.some((d) => d.id === subject.degreeId))
            ? [
                subject.folder
                  ? { label: t("Mover al primer nivel"), icon: FolderInput, onSelect: () => safe(async () => void (await moveSubject(item.id, { degreeId: "" }))) }
                  : { label: t("Sacar de la carpeta"), icon: FolderInput, onSelect: () => safe(async () => void (await moveSubject(item.id, { degreeId: subject.degreeId }))) },
              ]
            : []),
          ...pdf({ kind: "subject", id: item.id }),
          sep,
          bm("subject", item.id),
          sep,
          {
            label: t("Eliminar {what}", { what: kindName }),
            icon: Trash2,
            danger: true,
            onSelect: () => safe(() => deleteWithUndo(t("Se eliminó «{nombre}»", { nombre: node.label }), () => deleteSubjectCascade(item.id))),
          },
        ];
      }
      case "unit":
        return [nuevo({ subjectId: item.subjectId, unitNumber: item.unit })];
      case "note":
        return [
          openTab(node.view!),
          openSplit(node.view!),
          nuevo({ subjectId: item.subjectId }),
          sep,
          rename("note", item.id, node.label),
          {
            label: t("Nueva subnota"),
            icon: FilePlus,
            onSelect: () =>
              safe(async () => {
                try {
                  const id = await createSubnote(item.id);
                  setOpenMap((prev) => saveOpen({ ...prev, [node.key]: true }));
                  openView({ type: "nota", id });
                } catch (err) {
                  toast(err instanceof Error ? err.message : t("No se pudo crear."), { tone: "error" });
                }
              }),
          },
          { label: t("Duplicar"), icon: Copy, onSelect: () => safe(() => duplicateNote(item.id)) },
          {
            label: t("Crear tarea desde esta nota"),
            icon: ListPlus,
            onSelect: () =>
              safe(async () => {
                const n = await db.notes.get(item.id);
                if (n) openTaskDialog(await taskFromNote(n));
              }),
          },
          { label: t("Mover a"), icon: FolderInput, onSelect: () => setDialog({ type: "move", kind: "note", id: item.id }) },
          bm("note", item.id),
          ...pdf({ kind: "note", id: item.id }),
          sep,
          remove("note", item.id),
        ];
      case "canvas":
        return [
          openTab(node.view!),
          openSplit(node.view!),
          nuevo({ subjectId: item.subjectId }),
          sep,
          rename("canvas", item.id, node.label),
          { label: t("Mover a"), icon: FolderInput, onSelect: () => setDialog({ type: "move", kind: "canvas", id: item.id }) },
          bm("canvas", item.id),
          sep,
          remove("canvas", item.id),
        ];
      case "file":
        return [
          openTab(node.view!),
          openSplit(node.view!),
          nuevo({ subjectId: item.subjectId }),
          sep,
          rename("file", item.id, node.label),
          { label: t("Mover a"), icon: FolderInput, onSelect: () => setDialog({ type: "move", kind: "file", id: item.id }) },
          { label: t("Descargar copia"), icon: Download, onSelect: () => safe(() => downloadOfficeDoc(item.id)) },
          sep,
          remove("file", item.id),
        ];
      case "pdf":
        return [openTab(node.view!), sep, bm("document", item.id)];
      case "degree": {
        const degree = data?.degrees.find((d) => d.id === item.id);
        const term = termsFor(item.id);
        return [
          nuevo({
            taskDefaults: { degreeId: item.id },
            degreeId: item.id,
            extra: [
              {
                label: term.item.one.charAt(0).toUpperCase() + term.item.one.slice(1),
                icon: term.study ? GraduationCap : FolderKanban,
                onSelect: () => (term.study ? setCareer({ type: "subject", degreeId: item.id }) : openFolderDialog({ degreeId: item.id, item: true })),
              },
            ],
          }),
          { label: term.study ? t("Ver plan de estudios") : t("Ver {items}", { items: term.item.many }), icon: ExternalLink, onSelect: () => openView({ type: "carreras" }) },
          sep,
          { label: t("Expandir todo"), icon: ChevronsUpDown, onSelect: () => setOpenUnder(node, true) },
          { label: t("Colapsar todo"), icon: ChevronsDownUp, onSelect: () => setOpenUnder(node, false) },
          sep,
          { label: t("Editar {espacio}", { espacio: term.space.one }), icon: Pencil, onSelect: () => degree && setCareer({ type: "degree", degree }) },
          ...pdf({ kind: "degree", id: item.id }),
          sep,
          {
            label: t("Eliminar {espacio}", { espacio: term.space.one }),
            icon: Trash2,
            danger: true,
            onSelect: () => safe(() => deleteWithUndo(t("Se eliminó «{nombre}»", { nombre: node.label }), () => deleteDegreeCascade(item.id))),
          },
        ];
      }
      case "year":
        return [
          nuevo({
            taskDefaults: { degreeId: item.degreeId },
            degreeId: item.degreeId,
            extra: [{ label: t("Materia en {año}", { año: node.label }), icon: GraduationCap, onSelect: () => setCareer({ type: "subject", degreeId: item.degreeId, year: item.year }) }],
          }),
          sep,
          { label: t("Expandir todo"), icon: ChevronsUpDown, onSelect: () => setOpenUnder(node, true) },
          { label: t("Colapsar todo"), icon: ChevronsDownUp, onSelect: () => setOpenUnder(node, false) },
        ];
      default:
        return [];
    }
  }

  const headerNewNote = () => safe(async () => openView({ type: "nota", id: await newNoteForView(activeView) }));
  const sortMenu: MenuItem[] = (Object.keys(SORT_LABEL) as SortMode[]).map((mode) => ({
    label: SORT_LABEL[mode],
    icon: sort === mode ? Check : undefined,
    onSelect: () => changeSort(mode),
  }));

  const nuevoItem = terms.item.f ? t("Nueva {item}", { item: terms.item.one }) : t("Nuevo {item}", { item: terms.item.one });
  const renameTitle = dialog?.type === "rename" ? (dialog.kind === "subject" ? t("Renombrar {nombre}", { nombre: termsForSubject(dialog.id).item.one }) : dialog.kind === "canvas" ? t("Renombrar lienzo") : dialog.kind === "file" ? t("Renombrar archivo") : dialog.kind === "folder" ? t("Renombrar carpeta") : t("Renombrar nota")) : "";
  const deleteTitle = dialog?.type === "delete" ? dialog.title : "";

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex h-9 flex-none items-center gap-0.5 bg-bg pl-3 pr-2">
        <span className="section-label mr-auto truncate px-0">{activeProfile?.name ?? t("Archivos")}</span>
        <button type="button" className="icon-btn" aria-label={t("Nueva carpeta")} title={t("Nueva carpeta")} onClick={() => openFolderDialog({ root: true })}>
          <FolderPlus strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t("Ordenar")}
          title={t("Ordenar")}
          onClick={(e) => menu.open(e, sortMenu)}
        >
          <ArrowDownUp strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn" aria-label={t("Colapsar todo")} title={t("Colapsar todo")} onClick={collapseAll}>
          <ChevronsDownUp strokeWidth={1.75} />
        </button>
      </div>

      <div role="tree" className="px-1 pb-4">
        <Rows nodes={tree} ctx={ctx} />
      </div>
      {hasData && tree.every((n) => !n.children?.length && !n.view) && (
        <div className="mx-3 mt-2 flex flex-col gap-2 rounded-lg border border-dashed border-border p-4 text-center">
          <p className="t-small text-faint">{t("Todavía no hay nada acá.")}</p>
          {singleSpace && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => openFolderDialog({ degreeId: singleSpace.id, item: true })}>
              <FolderKanban strokeWidth={1.75} />
              {nuevoItem}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => openFolderDialog({ root: true })}>
            <FolderPlus strokeWidth={1.75} />
            {t("Nueva carpeta")}
          </button>
          <button type="button" className="btn btn-sm" onClick={headerNewNote}>
            <FilePlus strokeWidth={1.75} />
            {t("Nueva nota")}
          </button>
        </div>
      )}

      <PromptModal
        open={dialog?.type === "rename"}
        title={renameTitle}
        initial={dialog?.type === "rename" ? dialog.value : ""}
        confirmLabel={t("Renombrar")}
        onConfirm={(value) => {
          if (dialog?.type !== "rename") return;
          if (dialog.kind === "folder") renameFolder(dialog.id, value);
          else {
            const kind = dialog.kind;
            safe(() => renameItem(kind, dialog.id, value));
          }
        }}
        onClose={() => setDialog(null)}
      />
      <MoveDialog
        open={dialog?.type === "move"}
        title={t("Mover a")}
        subjects={data?.subjects ?? []}
        degrees={data?.degrees ?? []}
        onPick={(subjectId) => {
          if (dialog?.type === "move") safe(() => moveItem(dialog.kind, dialog.id, { subjectId }));
        }}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog?.type === "delete"}
        title={t("Eliminar")}
        text={t("¿Eliminar \"{nombre}\"? No se puede deshacer.", { nombre: deleteTitle })}
        confirmLabel={t("Eliminar")}
        onConfirm={() => {
          if (dialog?.type === "delete") safe(() => (dialog.kind === "note" ? deleteNote(dialog.id) : dialog.kind === "file" ? deleteOfficeDoc(dialog.id) : deleteCanvas(dialog.id)));
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
  // El lugar de la flecha sólo se reserva si alguno de los hermanos se puede expandir.
  const slot = nodes.some((n) => !!n.children?.length);
  return (
    <>
      {nodes.map((node) => (
        <Row key={node.key} node={node} ctx={ctx} slot={slot} />
      ))}
    </>
  );
}

function Row({ node, ctx, slot }: { node: TreeNode; ctx: Ctx; slot: boolean }) {
  const expandable = !!node.children?.length;
  const expanded = expandable && ctx.isOpen(node.key);
  const active = !!node.view && sameView(node.view, ctx.activeView);
  const isLevel = !node.view; // carpetas, carreras, años y unidades
  const Icon = node.icon;
  const dropping = ctx.dropKey === node.key;

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={expandable ? expanded : undefined}
        aria-selected={active}
        aria-current={active ? "page" : undefined}
        data-drop={node.drop || node.place ? node.key : undefined}
        data-expand={expandable && !expanded ? node.key : undefined}
        className={clsx("row select-none", isLevel && "text-text", dropping && "bg-primary-tint text-text")}
        onClick={(e) => (node.view ? ctx.open(node.view, e) : ctx.toggle(node.key))}
        onAuxClick={(e) => {
          if (e.button === 1 && node.view) {
            e.preventDefault();
            ctx.open(node.view, { button: 1 });
          }
        }}
        onContextMenu={(e) => ctx.onContext(e, node)}
        onPointerDown={(e) => node.drag && ctx.startDrag(e, node)}
      >
        {slot && <span
          className="flex h-4 w-4 flex-none items-center justify-center text-faint"
          onClick={(e) => {
            if (!expandable) return;
            e.stopPropagation();
            ctx.toggle(node.key);
          }}
        >
          {expandable && (expanded ? <ChevronDown strokeWidth={1.75} /> : <ChevronRight strokeWidth={1.75} />)}
        </span>}
        {Icon && <Icon strokeWidth={1.75} />}
        <span className="min-w-0 flex-1 truncate" title={node.label}>{node.label}</span>
      </div>
      {expanded && node.children && (
        <div role="group" className="ml-[14.5px] border-l border-border">
          <Rows nodes={node.children} ctx={ctx} />
        </div>
      )}
    </>
  );
}
