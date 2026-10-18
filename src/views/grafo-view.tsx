"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUpRight, BookOpen, FileText, GitFork, Search } from "lucide-react";
import { db } from "@/lib/db";
import type { Note, Subject } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { modeFromEvent } from "@/components/workspace/use-open";
import {
  buildGraph,
  DEFAULT_GRAPH_OPTIONS,
  type GraphForces,
  type GraphNode,
  type GraphOptions,
} from "@/components/graph/graph-model";
import { GraphCanvas, type MenuEvent, type OpenModifiers } from "@/components/graph/graph-canvas";
import { GraphOptionsPanel } from "@/components/graph/graph-options";

const STORE_KEY = "uc-grafo-opciones";
const NO_NOTES: Note[] = [];
const NO_SUBJECTS: Subject[] = [];

// Las opciones se recuerdan en este navegador (no son datos de la app). La búsqueda no se guarda.
function loadOptions(): GraphOptions {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_GRAPH_OPTIONS;
    const saved = JSON.parse(raw) as Partial<GraphOptions>;
    return {
      ...DEFAULT_GRAPH_OPTIONS,
      ...saved,
      query: "",
      forces: { ...DEFAULT_GRAPH_OPTIONS.forces, ...saved.forces },
    };
  } catch {
    return DEFAULT_GRAPH_OPTIONS;
  }
}

function saveOptions(opts: GraphOptions) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...opts, query: "" }));
  } catch {}
}

// Grafo de notas. Sin noteId es el grafo global; con noteId es el grafo local de esa nota.
export function GrafoView({ noteId }: { noteId?: string }) {
  const { openView } = useWorkspace();
  const notes = useLiveQuery(() => db.notes.toArray(), [], NO_NOTES) ?? NO_NOTES;
  const subjects = useLiveQuery(() => db.subjects.toArray(), [], NO_SUBJECTS) ?? NO_SUBJECTS;
  const centerNote = useLiveQuery(() => (noteId ? db.notes.get(noteId) : undefined), [noteId]);

  const [opts, setOpts] = useState<GraphOptions>(loadOptions);
  useEffect(() => saveOptions(opts), [opts]);

  const graph = useMemo(() => buildGraph(notes, subjects, opts, noteId), [notes, subjects, opts, noteId]);

  const patch = useCallback((p: Partial<GraphOptions>) => setOpts((o) => ({ ...o, ...p })), []);
  const patchForces = useCallback(
    (p: Partial<GraphForces>) => setOpts((o) => ({ ...o, forces: { ...o.forces, ...p } })),
    [],
  );
  const resetForces = useCallback(() => setOpts((o) => ({ ...o, forces: DEFAULT_GRAPH_OPTIONS.forces })), []);

  const { open: openMenu, menu } = useContextMenu();

  const onOpen = useCallback(
    (node: GraphNode, mods: OpenModifiers) => {
      const mode = modeFromEvent(mods);
      if (node.kind === "nota" && node.noteId) openView({ type: "nota", id: node.noteId }, mode);
      else if (node.kind === "etiqueta" && node.tag) openView({ type: "busqueda", query: `#${node.tag}` }, mode);
      else if (node.kind === "materia" && node.subjectId && subjects.some((s) => s.id === node.subjectId))
        openView({ type: "materia", id: node.subjectId }, mode);
    },
    [openView, subjects],
  );

  const onMenu = useCallback(
    (node: GraphNode, e: MenuEvent) => {
      const items: MenuItem[] = [];
      if (node.kind === "nota" && node.noteId) {
        const id = node.noteId;
        items.push(
          { label: "Abrir nota", icon: FileText, onSelect: () => openView({ type: "nota", id }) },
          { label: "Abrir en pestaña nueva", icon: ArrowUpRight, onSelect: () => openView({ type: "nota", id }, "tab") },
          { label: "Ver grafo local", icon: GitFork, onSelect: () => openView({ type: "grafo", noteId: id }) },
        );
      } else if (node.kind === "etiqueta" && node.tag) {
        const query = `#${node.tag}`;
        items.push({ label: "Buscar etiqueta", icon: Search, onSelect: () => openView({ type: "busqueda", query }) });
      } else if (node.kind === "materia" && node.subjectId && subjects.some((s) => s.id === node.subjectId)) {
        const id = node.subjectId;
        items.push({ label: "Abrir materia", icon: BookOpen, onSelect: () => openView({ type: "materia", id }) });
      }
      if (items.length) openMenu(e, items);
    },
    [openView, openMenu, subjects],
  );

  return (
    <div className="relative h-full min-h-0 w-full bg-surface">
      {noteId && (
        <div className="absolute left-3 top-3 z-10 flex max-w-[60%] items-center gap-2">
          <button type="button" className="btn btn-sm" onClick={() => openView({ type: "grafo" })}>
            Grafo global
          </button>
          <span className="truncate text-[length:calc(13px*var(--ui-scale,1))] text-muted">{centerNote?.title?.trim() || ""}</span>
        </div>
      )}

      {graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center t-small text-faint">Sin resultados</div>
      )}

      <GraphCanvas
        key={noteId ?? "global"}
        graph={graph}
        forces={opts.forces}
        colorBySubject={opts.colorBySubject}
        activeId={noteId}
        onOpen={onOpen}
        onMenu={onMenu}
      />

      <GraphOptionsPanel
        opts={opts}
        local={!!noteId}
        groups={graph.groups}
        onChange={patch}
        onForces={patchForces}
        onReset={resetForces}
      />
      {menu}
    </div>
  );
}
