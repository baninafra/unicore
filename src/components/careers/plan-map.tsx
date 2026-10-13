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
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useMemo, type CSSProperties } from "react";
import { degreeBadgeClass } from "@/lib/format";
import type { Degree, Subject } from "@/lib/types";
import { isRequirementMet, periodIndex, sortSubjects } from "./plan";
import { SubjectCardBody, subjectCardClass, subjectCardStyle, subjectState, type SubjectState } from "./subject-card";

// Layout: columnas por cuatrimestre, filas por orden dentro de la columna.
const NODE_W = 220;
const NODE_H = 152;
const COL_STEP = NODE_W + 64;
const ROW_STEP = NODE_H + 20;
const LABEL_H = 56;
const BLOCK_GAP = 72;

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

function SubjectNode({ data }: NodeProps<SubjectFlowNode>) {
  return (
    <div className={subjectCardClass(data.state)} style={{ ...subjectCardStyle(data.state), width: NODE_W, height: NODE_H }}>
      <Handle type="target" position={Position.Left} isConnectable={false} style={HIDDEN_HANDLE} />
      <SubjectCardBody subject={data.subject} state={data.state} href={`/materias/${data.subject.id}`} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={HIDDEN_HANDLE} />
    </div>
  );
}

function DegreeLabelNode({ data }: NodeProps<LabelFlowNode>) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className={degreeBadgeClass(data.degree)}>{data.degree.shortName}</span>
      <span className="t-h3">{data.degree.name}</span>
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
export function PlanMap({ degrees, subjects }: { degrees: Degree[]; subjects: Subject[] }) {
  const { nodes, edges } = useMemo(() => buildGraph(degrees, subjects), [degrees, subjects]);

  return (
    <div className="h-[560px] w-full overflow-hidden rounded-lg border border-border" style={THEME}>
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
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
