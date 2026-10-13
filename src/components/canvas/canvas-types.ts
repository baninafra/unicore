"use client";

import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { CanvasDoc } from "@/lib/types";

// Tipos del lienzo. Los nodos de React Flow se guardan tal cual en `CanvasDoc.data`.

export type CanvasNodeType = "texto" | "nota" | "archivo" | "pdf" | "web" | "grupo";

export type CardColor = "" | "rojo" | "ambar" | "verde" | "cian" | "violeta" | "rosa";

// Un solo objeto para todos los tipos: cada tarjeta usa sólo los campos que necesita.
export type CanvasNodeData = {
  color?: CardColor;
  text?: string; // texto (markdown simple)
  noteId?: string; // nota
  documentId?: string; // pdf (id de SubjectDocument)
  fileRef?: string; // archivo: "idb://<id>"
  fileName?: string; // pdf y archivo
  mime?: string; // archivo
  url?: string; // web
  title?: string; // web
  name?: string; // grupo
};

export type CanvasNode = Node<CanvasNodeData, CanvasNodeType>;
export type CanvasEdge = Edge;

export const CARD_COLORS: { key: CardColor; label: string; bg: string; border: string }[] = [
  { key: "", label: "Sin color", bg: "", border: "" },
  { key: "rojo", label: "Rojo", bg: "rgba(251,113,133,0.16)", border: "rgba(251,113,133,0.55)" },
  { key: "ambar", label: "Ámbar", bg: "rgba(251,191,36,0.16)", border: "rgba(251,191,36,0.55)" },
  { key: "verde", label: "Verde", bg: "rgba(125,211,192,0.16)", border: "rgba(125,211,192,0.55)" },
  { key: "cian", label: "Cian", bg: "rgba(103,232,249,0.14)", border: "rgba(103,232,249,0.5)" },
  { key: "violeta", label: "Violeta", bg: "rgba(129,140,248,0.18)", border: "rgba(129,140,248,0.6)" },
  { key: "rosa", label: "Rosa", bg: "rgba(244,114,182,0.16)", border: "rgba(244,114,182,0.55)" },
];

export function cardColorStyle(color: CardColor | undefined): React.CSSProperties {
  const c = CARD_COLORS.find((x) => x.key === color);
  if (!c || !c.bg) return {};
  return { background: c.bg, borderColor: c.border };
}

// Tamaños por defecto al crear cada tarjeta.
export const DEFAULT_SIZE: Record<CanvasNodeType, { width: number; height: number }> = {
  texto: { width: 240, height: 140 },
  nota: { width: 260, height: 160 },
  archivo: { width: 240, height: 180 },
  pdf: { width: 240, height: 120 },
  web: { width: 260, height: 120 },
  grupo: { width: 360, height: 240 },
};

// Los grupos tienen que ir antes que sus hijos para que React Flow los dibuje debajo.
export function sortNodes(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes.filter((n) => n.type === "grupo"), ...nodes.filter((n) => n.type !== "grupo")];
}

// Posición absoluta de un nodo (los hijos guardan posición relativa a su grupo).
export function absolutePosition(node: CanvasNode, byId: Map<string, CanvasNode>) {
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  if (!parent) return { ...node.position };
  return { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y };
}

// Lee lo guardado y descarta lo que no sirve.
export function readCanvas(doc: CanvasDoc): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes = (doc.data?.nodes ?? []).filter(
    (n): n is CanvasNode =>
      !!n && typeof n === "object" && typeof (n as CanvasNode).id === "string" && !!(n as CanvasNode).position,
  );
  const edges = (doc.data?.edges ?? []).filter(
    (e): e is CanvasEdge => !!e && typeof e === "object" && typeof (e as CanvasEdge).source === "string",
  );
  return { nodes: sortNodes(nodes), edges };
}

// Solo guardamos lo que hace falta para reconstruir el lienzo (sin estado de selección ni medidas).
export function serializeNodes(nodes: CanvasNode[]) {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
    ...(n.width ? { width: n.width } : {}),
    ...(n.height ? { height: n.height } : {}),
    ...(n.parentId ? { parentId: n.parentId } : {}),
  }));
}

export function serializeEdges(edges: CanvasEdge[]) {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: typeof e.label === "string" ? e.label : undefined,
  }));
}

// Estilo de las flechas nuevas: gris neutro (funciona igual en tema claro y oscuro).
export const EDGE_STYLE = {
  style: { stroke: "#8b8b97", strokeWidth: 1.5 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#8b8b97", width: 16, height: 16 },
  labelStyle: { fill: "var(--text-muted)", fontSize: 12 },
  labelBgStyle: { fill: "var(--surface)" },
  labelBgPadding: [6, 3] as [number, number],
  labelBgBorderRadius: 4,
};
