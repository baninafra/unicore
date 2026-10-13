"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useMemo, type CSSProperties } from "react";
import { degreeBadgeClass } from "@/lib/format";
import type { Degree, Subject } from "@/lib/types";
import { useOpen } from "@/components/workspace/use-open";
import { isRequirementMet, periodIndex, sortSubjects } from "./plan";
import { subjectState, type SubjectState } from "./subject-state";
import { useSubjectMenu } from "./subject-menu";

// Layout: columnas por cuatrimestre, filas por orden dentro de la columna.
const NODE_W = 200;
const NODE_H = 56;
const COL_STEP = NODE_W + 56;
const ROW_STEP = NODE_H + 12;
const LABEL_H = 48;
const BLOCK_GAP = 56;

const HIDDEN_HANDLE: CSSProperties = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };

// Colores de React Flow con los tokens de UniCore (sin el look blanco por defecto).
const THEME = {
  "--xy-background-color-default": "var(--bg)",
  "--xy-background-pattern-dots-color-default": "var(--border-strong)",
  "--xy-controls-button-background-color-default": "var(--surface)",
  "--xy-controls-button-background-color-hover-default": "var(--surface-raised)",
  "--xy-controls-button-color-default": "var(--text-muted)",
  "--xy-controls-button-color-hover-default": "var(--text)",
  "--xy-controls-button-border-color-default": "var(--border)",
  "--xy-controls-box-shadow-default": "none",
  "--xy-handle-background-color-default": "transparent",
  "--xy-handle-border-color-default": "transparent",
} as CSSProperties;

type SubjectFlowNode = Node<{ subject: Subject; state: SubjectState }, "subject">;
type LabelFlowNode = Node<{ degree: Degree }, "label">;
type FlowNode = SubjectFlowNode | LabelFlowNode;

function stateText(state: SubjectState) {
  switch (state.kind) {
    case "aprobada":
      return "Aprobada";
    case "habilitada":
      return "Habilitada";
    case "cursando":
      return "Cursando";
    case "regular":
      return "Regular";
    case "bloqueada":
      return "Bloqueada";
  }
}

function SubjectNode({ data }: NodeProps<SubjectFlowNode>) {
  const blocked = data.state.kind === "bloqueada";
  return (
    <div
      className="flex flex-col justify-center gap-0.5 rounded-md border bg-surface px-2.5"
      style={{
        width: NODE_W,
        height: NODE_H,
        borderColor: data.state.kind === "habilitada" ? "var(--primary)" : "var(--border)",
        borderStyle: blocked ? "dashed" : "solid",
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={HIDDEN_HANDLE} />
      <span className="t-small truncate text-text">{data.subject.name}</span>
      <span className="t-small text-faint">{stateText(data.state)}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} style={HIDDEN_HANDLE} />
    </div>
  );
}

function DegreeLabelNode({ data }: NodeProps<LabelFlowNode>) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className={degreeBadgeClass(data.degree)}>{data.degree.shortName}</span>
      <span className="t-small text-muted">{data.degree.name}</span>
    </div>
  );
}

// Definido afuera del componente: React Flow necesita una referencia estable.
const nodeTypes: NodeTypes = { subject: SubjectNode, label: DegreeLabelNode };

function buildGraph(degrees: Degree[], subjects: Subject[]) {
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  const byId = new Map(subjects.map((s) => [s.id, s]));
  let blockY = 0;

  for (const degree of degrees) {
    const list = sortSubjects(subjects.filter((s) => s.degreeId === degree.id));
    const rowsInColumn = new Map<number, number>();
    let maxRows = 0;

    nodes.push({
      id: `label-${degree.id}`,
      type: "label",
      position: { x: 0, y: blockY },
      data: { degree },
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    });

    for (const s of list) {
      const col = periodIndex(s.year, s.semester);
      const row = rowsInColumn.get(col) ?? 0;
      rowsInColumn.set(col, row + 1);
      maxRows = Math.max(maxRows, row + 1);

      nodes.push({
        id: s.id,
        type: "subject",
        position: { x: col * COL_STEP, y: blockY + LABEL_H + row * ROW_STEP },
        data: { subject: s, state: subjectState(s, subjects) },
        draggable: false,
        connectable: false,
      });

      for (const correlativeId of s.correlatives) {
        const requirement = byId.get(correlativeId);
        if (!requirement || requirement.degreeId !== degree.id) continue;
        const met = isRequirementMet(requirement);
        edges.push({
          id: `${correlativeId}->${s.id}`,
          source: correlativeId,
          target: s.id,
          type: "smoothstep",
          selectable: false,
          style: {
            stroke: met ? "var(--primary)" : "var(--border-strong)",
            strokeWidth: 1.5,
            strokeDasharray: met ? undefined : "6 4",
          },
        });
      }
    }

    blockY += LABEL_H + maxRows * ROW_STEP + BLOCK_GAP;
  }

  return { nodes, edges };
}

// Mapa de correlativas de las carreras visibles. Carga con next/dynamic (ssr: false).
export function PlanMap({
  degrees,
  subjects,
  onEdit,
  onDelete,
}: {
  degrees: Degree[];
  subjects: Subject[];
  onEdit: (subject: Subject) => void;
  onDelete: (subject: Subject) => void;
}) {
  const { nodes, edges } = useMemo(() => buildGraph(degrees, subjects), [degrees, subjects]);
  const open = useOpen();
  const { show, menu } = useSubjectMenu({ onEdit, onDelete });

  const onNodeClick: NodeMouseHandler<FlowNode> = (e, node) => {
    if (node.type === "subject") open({ type: "materia", id: node.id }, e);
  };

  return (
    <div className="h-[560px] w-full overflow-hidden rounded-md border border-border" style={THEME}>
      <ReactFlow<FlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={onNodeClick}
        onNodeContextMenu={(e, node) => {
          if (node.type === "subject") show(e, node.data.subject);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {menu}
    </div>
  );
}
