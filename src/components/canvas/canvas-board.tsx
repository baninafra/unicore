"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import { BookOpen, ExternalLink, FileText, Frame, Globe, ImagePlus, Link, Pencil, Plus, Trash2 } from "lucide-react";
import { db, newId, nowIso, resolveFileUrl, saveFile } from "@/lib/db";
import type { CanvasDoc } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { PromptModal } from "@/components/ui/prompt-modal";
import { importFileAsNote } from "@/lib/import/import-file";
import { toast } from "@/lib/undo";
import { t } from "@/lib/i18n";
import { LOOSE_FOLDER } from "@/lib/types";
import { CanvasActionsCtx, canvasNodeTypes, type CanvasActions } from "./canvas-nodes";
import { CanvasToolbar } from "./canvas-toolbar";
import { ColorPopover, ItemPicker, type PickedItem } from "./canvas-pickers";
import {
  absolutePosition,
  DEFAULT_SIZE,
  EDGE_STYLE,
  readCanvas,
  serializeEdges,
  serializeNodes,
  sortNodes,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
  type CardColor,
} from "./canvas-types";

type Prompt =
  | { kind: "arista"; id: string; initial: string }
  | { kind: "url"; id: string; initial: string }
  | { kind: "titulo"; id: string; initial: string }
  | { kind: "nueva-web"; at?: { x: number; y: number } }
  | { kind: "renombrar"; initial: string };

type MenuPos = { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void };

const size = (n: CanvasNode) => ({ w: n.width ?? n.measured?.width ?? 200, h: n.height ?? n.measured?.height ?? 120 });

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function normalizeUrl(raw: string) {
  const v = raw.trim();
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// Si la tarjeta quedó dentro de un grupo, la hace hija de ese grupo; si salió, la saca.
function adoptNode(list: CanvasNode[], id: string): CanvasNode[] {
  const byId = new Map(list.map((n) => [n.id, n]));
  const cur = byId.get(id);
  if (!cur || cur.type === "grupo") return list;

  const abs = absolutePosition(cur, byId);
  const { w, h } = size(cur);
  const cx = abs.x + w / 2;
  const cy = abs.y + h / 2;
  const target = list.find((g) => {
    if (g.type !== "grupo" || g.id === cur.id) return false;
    const gs = size(g);
    return cx >= g.position.x && cx <= g.position.x + gs.w && cy >= g.position.y && cy <= g.position.y + gs.h;
  });
  if ((target?.id ?? undefined) === cur.parentId) return list;

  const next: CanvasNode = {
    ...cur,
    position: target ? { x: abs.x - target.position.x, y: abs.y - target.position.y } : abs,
  };
  if (target) next.parentId = target.id;
  else delete next.parentId;
  return list.map((n) => (n.id === id ? next : n));
}

function Board({ doc }: { doc: CanvasDoc }) {
  const rf = useReactFlow<CanvasNode, CanvasEdge>();
  const { openView } = useWorkspace();
  const { open: openMenu, menu } = useContextMenu();
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [init] = useState(() => readCanvas(doc));
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(init.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(init.edges);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [colorAt, setColorAt] = useState<{ id: string; x: number; y: number; value: CardColor | undefined } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [imageAt, setImageAt] = useState<{ x: number; y: number } | undefined>(undefined);

  // ----- autoguardado (con debounce) -----
  const viewport = useRef<Viewport>(doc.data?.viewport ?? { x: 0, y: 0, zoom: 1 });
  const stateRef = useRef({ nodes, edges });
  const timer = useRef<number | undefined>(undefined);
  const signature = (ns: CanvasNode[], es: CanvasEdge[]) => JSON.stringify([serializeNodes(ns), serializeEdges(es)]);
  const [baseSig] = useState(() => signature(init.nodes, init.edges));
  const lastSig = useRef(baseSig);

  useEffect(() => {
    stateRef.current = { nodes, edges };
  });

  const save = useCallback(async () => {
    const { nodes: ns, edges: es } = stateRef.current;
    await db.canvases.update(doc.id, {
      data: { nodes: serializeNodes(ns), edges: serializeEdges(es), viewport: viewport.current },
      updatedAt: nowIso(),
    });
  }, [doc.id]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      void save();
    }, 400);
  }, [save]);

  // Solo guardamos si cambió algo que importa (no por selección ni por medidas).
  useEffect(() => {
    const sig = signature(nodes, edges);
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    scheduleSave();
  }, [nodes, edges, scheduleSave]);

  // Al salir de la vista, guardamos lo pendiente.
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        void save();
      }
    },
    [save],
  );

  // ----- helpers de datos -----
  const patchNode = useCallback(
    (id: string, patch: Partial<CanvasNodeData>) =>
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [setNodes],
  );

  const actions = useMemo<CanvasActions>(
    () => ({ editingId, setEditingId, patchNode }),
    [editingId, patchNode],
  );

  const addNode = useCallback(
    (type: CanvasNodeType, position: { x: number; y: number }, data: CanvasNodeData = {}) => {
      const id = newId();
      const node: CanvasNode = { id, type, position, data, ...DEFAULT_SIZE[type] };
      setNodes((ns) => adoptNode(sortNodes([...ns, node]), id));
      return id;
    },
    [setNodes],
  );

  // Posición en pantalla -> lienzo (centrada en el punto, con el tamaño del nodo).
  const placeAt = useCallback(
    (type: CanvasNodeType, clientX?: number, clientY?: number) => {
      const r = wrapRef.current?.getBoundingClientRect();
      const sx = clientX ?? (r ? r.left + r.width / 2 : 300);
      const sy = clientY ?? (r ? r.top + r.height / 2 : 300);
      const p = rf.screenToFlowPosition({ x: sx, y: sy });
      const s = DEFAULT_SIZE[type];
      return { x: p.x - s.width / 2, y: p.y - s.height / 2 };
    },
    [rf],
  );

  const addAt = useCallback(
    (type: CanvasNodeType, clientX?: number, clientY?: number, data?: CanvasNodeData) =>
      addNode(type, placeAt(type, clientX, clientY), data),
    [addNode, placeAt],
  );

  // ----- conexiones y aristas -----
  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, id: newId(), ...EDGE_STYLE }, es)),
    [setEdges],
  );

  const onNodeDragStop = useCallback((_: unknown, node: CanvasNode) => setNodes((ns) => adoptNode(ns, node.id)), [setNodes]);

  // Si se borra un grupo, sus tarjetas pasan a quedar sueltas en la misma posición.
  const onNodesDelete = useCallback(
    (deleted: CanvasNode[]) => {
      const gone = new Map(deleted.filter((n) => n.type === "grupo").map((g) => [g.id, g.position]));
      if (!gone.size) return;
      setNodes((ns) =>
        ns.map((n) => {
          const p = n.parentId ? gone.get(n.parentId) : undefined;
          if (!p) return n;
          const next: CanvasNode = { ...n, position: { x: p.x + n.position.x, y: p.y + n.position.y } };
          delete next.parentId;
          return next;
        }),
      );
    },
    [setNodes],
  );

  // ----- menús -----
  const onNodeContextMenu = useCallback(
    (e: MenuPos, node: CanvasNode) => {
      const id = node.id;
      const items: MenuItem[] = [];
      if (node.type === "nota" && node.data.noteId) {
        const noteId = node.data.noteId;
        items.push({ label: t("Abrir nota"), icon: FileText, onSelect: () => openView({ type: "nota", id: noteId }) });
      }
      if (node.type === "pdf" && node.data.documentId) {
        const documentId = node.data.documentId;
        items.push({ label: t("Abrir PDF"), icon: BookOpen, onSelect: () => openView({ type: "pdf", id: documentId }) });
      }
      if (node.type === "web" && node.data.url) {
        const url = node.data.url;
        items.push(
          { label: t("Abrir web"), icon: Globe, onSelect: () => openView({ type: "web", url }) },
          { label: t("Cambiar dirección"), icon: Link, onSelect: () => setPrompt({ kind: "url", id, initial: url }) },
          {
            label: t("Cambiar título"),
            icon: Pencil,
            onSelect: () => setPrompt({ kind: "titulo", id, initial: node.data.title ?? hostOf(url) }),
          },
        );
      }
      if (node.type === "archivo" && node.data.fileRef) {
        const ref = node.data.fileRef;
        items.push({
          label: t("Abrir archivo"),
          icon: ExternalLink,
          onSelect: () => void resolveFileUrl(ref).then((u) => window.open(u, "_blank")),
        });
      }
      if (node.type === "texto") items.push({ label: t("Editar texto"), icon: Pencil, onSelect: () => setEditingId(id) });
      if (node.type === "grupo") items.push({ label: t("Cambiar nombre"), icon: Pencil, onSelect: () => setEditingId(id) });
      if (node.type !== "grupo") {
        items.push({
          label: t("Color"),
          icon: Frame,
          onSelect: () => setColorAt({ id, x: e.clientX, y: e.clientY, value: node.data.color }),
        });
      }
      if (items.length) items.push({ type: "separator" });
      items.push({
        label: t("Eliminar"),
        icon: Trash2,
        danger: true,
        hint: t("Supr"),
        onSelect: () => void rf.deleteElements({ nodes: [node] }),
      });
      openMenu(e, items);
    },
    [openMenu, openView, rf],
  );

  const onEdgeContextMenu = useCallback(
    (e: MenuPos, edge: CanvasEdge) => {
      const label = typeof edge.label === "string" ? edge.label : "";
      const items: MenuItem[] = [
        { label: t("Editar etiqueta"), icon: Pencil, onSelect: () => setPrompt({ kind: "arista", id: edge.id, initial: label }) },
      ];
      if (label) {
        items.push({
          label: t("Quitar etiqueta"),
          onSelect: () => setEdges((es) => es.map((x) => (x.id === edge.id ? { ...x, label: undefined } : x))),
        });
      }
      items.push(
        { type: "separator" },
        {
          label: t("Eliminar"),
          icon: Trash2,
          danger: true,
          onSelect: () => setEdges((es) => es.filter((x) => x.id !== edge.id)),
        },
      );
      openMenu(e, items);
    },
    [openMenu, setEdges],
  );

  const onPaneContextMenu = useCallback(
    (e: MenuPos) => {
      openMenu(e, [
        { label: t("Tarjeta de texto"), icon: Plus, onSelect: () => addAt("texto", e.clientX, e.clientY) },
        { label: t("Agregar nota o PDF"), icon: FileText, onSelect: () => setPicker(true) },
        {
          label: t("Imagen"),
          icon: ImagePlus,
          onSelect: () => {
            setImageAt({ x: e.clientX, y: e.clientY });
            fileRef.current?.click();
          },
        },
        { label: t("Web"), icon: Globe, onSelect: () => setPrompt({ kind: "nueva-web", at: { x: e.clientX, y: e.clientY } }) },
        { label: t("Grupo"), icon: Frame, onSelect: () => addAt("grupo", e.clientX, e.clientY) },
        { type: "separator" },
        { label: t("Renombrar lienzo"), icon: Pencil, onSelect: () => setPrompt({ kind: "renombrar", initial: doc.name }) },
      ]);
    },
    [addAt, doc.name, openMenu],
  );

  // Doble clic en el fondo: tarjeta de texto en edición.
  const onPaneClick = useCallback(
    (e: ReactMouseEvent) => {
      if (e.detail !== 2) return;
      const id = addAt("texto", e.clientX, e.clientY);
      setEditingId(id);
    },
    [addAt],
  );

  // ----- barra flotante -----
  const onPicked = (item: PickedItem) => {
    if (item.kind === "nota") addAt("nota", undefined, undefined, { noteId: item.id });
    else addAt("pdf", undefined, undefined, { documentId: item.id, fileName: item.name });
  };

  // Soltar o pegar archivos en el lienzo: imágenes quedan como tarjeta libre; PDF, Excel, etc. se vuelven notas.
  const addFilesAt = useCallback(
    async (files: File[], clientX?: number, clientY?: number) => {
      let dx = 0;
      for (const file of files) {
        const x = clientX !== undefined ? clientX + dx : undefined;
        if (file.type.startsWith("image/")) {
          const ref = await saveFile(file);
          addAt("archivo", x, clientY, { fileRef: ref, fileName: file.name || t("imagen"), mime: file.type });
        } else {
          try {
            const noteId = await importFileAsNote(file, doc.subjectId ?? LOOSE_FOLDER);
            addAt("nota", x, clientY, { noteId });
          } catch (err) {
            toast(err instanceof Error ? err.message : t("No pudimos importar el archivo."), { tone: "error" });
          }
        }
        dx += 40;
      }
    },
    [addAt, doc.subjectId],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable='true']")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      void addFilesAt(files, r.left + r.width / 2, r.top + r.height / 2);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFilesAt]);

  const onImageChosen = async (file: File | undefined) => {
    if (!file) return;
    const ref = await saveFile(file);
    addAt("archivo", imageAt?.x, imageAt?.y, { fileRef: ref, fileName: file.name, mime: file.type });
    setImageAt(undefined);
  };

  const confirmPrompt = (value: string) => {
    const p = prompt;
    if (!p) return;
    if (p.kind === "arista") setEdges((es) => es.map((x) => (x.id === p.id ? { ...x, label: value } : x)));
    if (p.kind === "url") patchNode(p.id, { url: normalizeUrl(value) });
    if (p.kind === "titulo") patchNode(p.id, { title: value });
    if (p.kind === "nueva-web") addAt("web", p.at?.x, p.at?.y, { url: normalizeUrl(value), title: hostOf(normalizeUrl(value)) });
    if (p.kind === "renombrar") void db.canvases.update(doc.id, { name: value.trim() || t("Lienzo sin título") });
  };

  const promptConfig = (() => {
    switch (prompt?.kind) {
      case "arista":
        return { title: t("Etiqueta de la flecha"), initial: prompt.initial, placeholder: t("Ej: depende de"), confirm: t("Guardar") };
      case "url":
        return { title: t("Dirección de la web"), initial: prompt.initial, placeholder: "https://", confirm: t("Guardar") };
      case "titulo":
        return { title: t("Título de la web"), initial: prompt.initial, placeholder: t("Título"), confirm: t("Guardar") };
      case "nueva-web":
        return { title: t("Agregar web"), initial: "", placeholder: "https://", confirm: t("Agregar") };
      case "renombrar":
        return { title: t("Nombre del lienzo"), initial: prompt.initial, placeholder: t("Lienzo sin título"), confirm: t("Guardar") };
      default:
        return null;
    }
  })();

  return (
    <CanvasActionsCtx.Provider value={actions}>
      <div
        ref={wrapRef}
        className="uc-canvas relative h-full w-full"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = [...e.dataTransfer.files];
          if (!files.length) return;
          e.preventDefault();
          void addFilesAt(files, e.clientX, e.clientY);
        }}
      >
        <ReactFlow<CanvasNode, CanvasEdge>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={canvasNodeTypes}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={["Delete"]}
          defaultViewport={viewport.current}
          onMoveEnd={(_, vp) => {
            viewport.current = vp;
            scheduleSave();
          }}
          minZoom={0.1}
          maxZoom={3}
          zoomOnDoubleClick={false}
          onNodeDragStop={onNodeDragStop}
          onNodesDelete={onNodesDelete}
          onNodeContextMenu={(e, node) => onNodeContextMenu(e, node)}
          onEdgeContextMenu={(e, edge) => onEdgeContextMenu(e, edge)}
          onEdgeDoubleClick={(_, edge) =>
            setPrompt({ kind: "arista", id: edge.id, initial: typeof edge.label === "string" ? edge.label : "" })
          }
          onPaneContextMenu={(e) => onPaneContextMenu(e)}
          onPaneClick={onPaneClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#3c3c48" />
        </ReactFlow>

        <CanvasToolbar
          onText={() => addAt("texto")}
          onNote={() => setPicker(true)}
          onImage={() => {
            setImageAt(undefined);
            fileRef.current?.click();
          }}
          onWeb={() => setPrompt({ kind: "nueva-web" })}
          onGroup={() => addAt("grupo")}
        />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void onImageChosen(file);
          }}
        />

        <ItemPicker open={picker} onClose={() => setPicker(false)} onPick={onPicked} />

        {colorAt && (
          <ColorPopover
            x={colorAt.x}
            y={colorAt.y}
            value={colorAt.value}
            onPick={(color) => patchNode(colorAt.id, { color })}
            onClose={() => setColorAt(null)}
          />
        )}

        {promptConfig && (
          <PromptModal
            open
            title={promptConfig.title}
            initial={promptConfig.initial}
            placeholder={promptConfig.placeholder}
            confirmLabel={promptConfig.confirm}
            onConfirm={confirmPrompt}
            onClose={() => setPrompt(null)}
          />
        )}

        {menu}
      </div>
    </CanvasActionsCtx.Provider>
  );
}

// Tablero del lienzo: React Flow dentro de su propio proveedor.
export function CanvasBoard({ doc }: { doc: CanvasDoc }) {
  return (
    <ReactFlowProvider>
      <Board doc={doc} />
    </ReactFlowProvider>
  );
}

