"use client";

// Árbol de etiquetas: "materia/unidad1" es hijo de "materia".

import type { Note } from "@/lib/types";

export interface TagNode {
  name: string; // último segmento
  path: string; // "materia/unidad1"
  total: number; // notas con esta etiqueta o alguna hija
  children: TagNode[];
}

export function buildTagTree(notes: Note[]): TagNode[] {
  const nodes = new Map<string, TagNode>();
  const ensure = (path: string): TagNode => {
    let node = nodes.get(path);
    if (!node) {
      const parts = path.split("/");
      node = { name: parts[parts.length - 1], path, total: 0, children: [] };
      nodes.set(path, node);
    }
    return node;
  };

  for (const note of notes) {
    const tags = [
      ...new Set(
        (note.tags ?? []).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter((t) => t && !t.includes("//")),
      ),
    ];
    // Cada nota suma una vez a cada nivel de sus etiquetas (padres incluidos).
    const levels = new Set<string>();
    for (const tag of tags) {
      const parts = tag.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) levels.add(parts.slice(0, i).join("/"));
    }
    for (const level of levels) ensure(level).total++;
  }

  const roots: TagNode[] = [];
  for (const node of nodes.values()) {
    const cut = node.path.lastIndexOf("/");
    if (cut === -1) roots.push(node);
    else nodes.get(node.path.slice(0, cut))?.children.push(node);
  }
  return roots;
}

export function sortNodes(nodes: TagNode[], mode: "nombre" | "frecuencia"): TagNode[] {
  return [...nodes].sort((a, b) =>
    mode === "frecuencia" ? b.total - a.total || a.name.localeCompare(b.name, "es") : a.name.localeCompare(b.name, "es"),
  );
}
