"use client";

import { DAILY_FOLDER, LOOSE_FOLDER, TEMPLATES_FOLDER, type Note, type Subject } from "@/lib/types";
import { intlLocale, t } from "@/lib/i18n";

// Modelo del grafo de notas: nodos, aristas y grupos. Es puro (sin React ni Dexie).

export type GraphNodeKind = "nota" | "etiqueta" | "materia";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  degree: number;
  noteId?: string; // para nota
  tag?: string; // para etiqueta (sin "#")
  subjectId?: string; // para materia (puede ser una carpeta especial)
  group?: string; // clave del grupo de color (id de materia)
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphGroup {
  key: string;
  label: string;
  color: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GraphGroup[];
}

export interface GraphForces {
  repulsion: number; // 100 a 2000
  linkDistance: number; // 20 a 250
  gravity: number; // 0 a 0,2
}

export interface GraphOptions {
  query: string;
  showTags: boolean;
  showSubjects: boolean;
  showOrphans: boolean;
  colorBySubject: boolean;
  depth: number; // grafo local: 1 a 3
  forces: GraphForces;
}

export const DEFAULT_GRAPH_OPTIONS: GraphOptions = {
  query: "",
  showTags: false,
  showSubjects: false,
  showOrphans: true,
  colorBySubject: false,
  depth: 2,
  forces: { repulsion: 600, linkDistance: 90, gravity: 0.03 },
};

// Paleta suave para grupos (funciona sobre fondo claro y oscuro).
export const GROUP_PALETTE = ["#7dd3c0", "#fbbf24", "#fb7185", "#67e8f9", "#a5b4fc", "#f0abfc", "#86efac", "#fdba74"];

const SPECIAL_LABEL: Record<string, string> = {
  [DAILY_FOLDER]: t("Diario"),
  [LOOSE_FOLDER]: t("Notas sueltas"),
};

const norm = (s: string) => s.toLocaleLowerCase("es");

// Construye el grafo. Con `centerId` arma el grafo local: la nota y sus vecinos hasta `depth` saltos.
export function buildGraph(notes: Note[], subjects: Subject[], opts: GraphOptions, centerId?: string): GraphData {
  const visible = notes.filter((n) => n.subjectId !== TEMPLATES_FOLDER);
  const byId = new Map(visible.map((n) => [n.id, n]));
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

  // Adyacencia no dirigida entre notas (sólo enlaces a notas que existen).
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const n of visible) {
    for (const t of n.links ?? []) {
      if (t === n.id || !byId.has(t)) continue;
      link(n.id, t);
      link(t, n.id);
    }
  }
  const linkDegree = (id: string) => adj.get(id)?.size ?? 0;

  // Grafo local: BFS desde la nota central.
  let inScope: Set<string> | null = null;
  if (centerId && byId.has(centerId)) {
    inScope = new Set([centerId]);
    let frontier = [centerId];
    for (let d = 0; d < opts.depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adj.get(id) ?? []) {
          if (!inScope.has(nb)) {
            inScope.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
  }

  const q = norm(opts.query.trim());
  const candidates = visible.filter((n) => {
    if (inScope && !inScope.has(n.id)) return false;
    if (!opts.showOrphans && linkDegree(n.id) === 0 && n.id !== centerId) return false;
    if (q && !norm(n.title || "").includes(q)) return false;
    return true;
  });
  const keep = new Set(candidates.map((n) => n.id));

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (source: string, target: string) => {
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target });
  };

  for (const n of candidates) {
    nodes.set(n.id, {
      id: n.id,
      kind: "nota",
      label: n.title?.trim() || t("Sin título"),
      degree: 0,
      noteId: n.id,
      group: n.subjectId,
    });
  }

  // Aristas entre notas.
  for (const n of candidates) {
    for (const t of n.links ?? []) {
      if (keep.has(t) && t !== n.id) addEdge(n.id, t);
    }
  }

  // Etiquetas y materias como nodos (opcionales).
  for (const n of candidates) {
    if (opts.showTags && !q) {
      for (const tag of n.tags ?? []) {
        const id = `t:${tag}`;
        if (!nodes.has(id)) nodes.set(id, { id, kind: "etiqueta", label: `#${tag}`, degree: 0, tag });
        addEdge(n.id, id);
      }
    }
    if (opts.showSubjects && !q) {
      const sid = n.subjectId;
      const id = `m:${sid}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: "materia",
          label: SPECIAL_LABEL[sid] ?? subjectName.get(sid) ?? t("Sin materia"),
          degree: 0,
          subjectId: sid,
          group: sid,
        });
      }
      addEdge(n.id, id);
    }
  }

  for (const e of edges) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (s) s.degree++;
    if (t) t.degree++;
  }

  // Grupos de color: una entrada por materia presente, en orden alfabético.
  const groupKeys = new Map<string, string>();
  for (const node of nodes.values()) {
    if (node.group && !groupKeys.has(node.group)) {
      groupKeys.set(node.group, SPECIAL_LABEL[node.group] ?? subjectName.get(node.group) ?? t("Sin materia"));
    }
  }
  const groups: GraphGroup[] = [...groupKeys.entries()]
    .sort((a, b) => a[1].localeCompare(b[1], intlLocale()))
    .map(([key, label], i) => ({ key, label, color: GROUP_PALETTE[i % GROUP_PALETTE.length] }));

  return { nodes: [...nodes.values()], edges, groups };
}
