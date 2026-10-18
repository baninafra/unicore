"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { ForceSim, type SimNode } from "./force-sim";
import type { GraphData, GraphForces, GraphNode } from "./graph-model";

export interface OpenModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  button: number;
}

export interface MenuEvent {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface Props {
  graph: GraphData;
  forces: GraphForces;
  colorBySubject: boolean;
  activeId?: string;
  onOpen: (node: GraphNode, mods: OpenModifiers) => void;
  onMenu: (node: GraphNode, e: MenuEvent) => void;
}

interface Colors {
  bg: string;
  node: string;
  edge: string;
  primary: string;
  text: string;
  muted: string;
  cyan: string;
  font: string;
}

// Lee los tokens de color del tema (cambian con data-theme). Canvas no entiende var(), así que los resolvemos.
function readColors(): Colors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--surface", "#1e1e24"),
    node: v("--text-faint", "#8b8b97"),
    edge: v("--border-strong", "#3c3c48"),
    primary: v("--primary", "#6366f1"),
    text: v("--text", "#f4f4f6"),
    muted: v("--text-muted", "#a1a1ad"),
    cyan: v("--cyan", "#67e8f9"),
    font: `12px ${getComputedStyle(document.body).fontFamily || "system-ui, sans-serif"}`,
  };
}

// Radio en píxeles de pantalla (no escala con el zoom, como en Obsidian).
function radiusOf(n: GraphNode) {
  if (n.kind === "nota") return Math.min(14, 4 + Math.sqrt(n.degree) * 1.8);
  return Math.min(16, 6 + Math.sqrt(n.degree) * 1.6);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function GraphCanvas({ graph, forces, colorBySubject, activeId, onOpen, onMenu }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sim] = useState(() => new ForceSim());

  // Datos que usa el bucle de dibujo (se leen en cada cuadro, sin re-renderizar React).
  const metaRef = useRef(new Map<string, GraphNode>());
  const neighborsRef = useRef(new Map<string, Set<string>>());
  const groupColorRef = useRef(new Map<string, string>());
  const colorsRef = useRef<Colors | null>(null);
  const latest = useRef({ onOpen, onMenu, colorBySubject, activeId });
  const kickRef = useRef<() => void>(() => {});
  const refitRef = useRef<() => void>(() => {});
  const shapeRef = useRef<string | null>(null);

  // Escuchadores y bucle de animación. Se montan una sola vez.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    colorsRef.current = readColors();
    const view = { x: 0, y: 0, k: 1 };
    const size = { w: 0, h: 0, dpr: 1 };
    let hover: string | null = null;
    let autoFit = true;
    let rafId = 0;
    let gesture:
      | { kind: "nodo"; node: SimNode; sx0: number; sy0: number; moved: boolean }
      | { kind: "fondo"; vx0: number; vy0: number; sx0: number; sy0: number; moved: boolean }
      | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { sx: e.clientX - r.left, sy: e.clientY - r.top };
    };

    const hitTest = (sx: number, sy: number): SimNode | null => {
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of sim.nodes) {
        if (!metaRef.current.has(n.id)) continue;
        const d = Math.hypot(n.x * view.k + view.x - sx, n.y * view.k + view.y - sy);
        if (d <= n.r + 4 && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    // Encuadra todos los nodos en la pantalla (mientras la simulación se está acomodando).
    const fit = () => {
      if (!sim.nodes.length || !size.w) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of sim.nodes) {
        minX = Math.min(minX, n.x);
        maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y);
        maxY = Math.max(maxY, n.y);
      }
      const pad = 60;
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const k = clamp(Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh, 1.5), 0.1, 3);
      view.k = k;
      view.x = size.w / 2 - ((minX + maxX) / 2) * k;
      view.y = size.h / 2 - ((minY + maxY) / 2) * k;
    };

    const draw = () => {
      const c = colorsRef.current;
      if (!c) return;
      const { w, h, dpr } = size;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);

      const { activeId: active, colorBySubject: byGroup } = latest.current;
      const nb = hover ? neighborsRef.current.get(hover) : undefined;

      // Aristas
      for (const l of sim.links) {
        const hot = !!hover && (l.source.id === hover || l.target.id === hover);
        ctx.globalAlpha = hover ? (hot ? 1 : 0.1) : 1;
        ctx.strokeStyle = hot ? c.primary : c.edge;
        ctx.lineWidth = hot ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(l.source.x * view.k + view.x, l.source.y * view.k + view.y);
        ctx.lineTo(l.target.x * view.k + view.x, l.target.y * view.k + view.y);
        ctx.stroke();
      }

      // Nodos
      for (const n of sim.nodes) {
        const meta = metaRef.current.get(n.id);
        if (!meta) continue;
        const sx = n.x * view.k + view.x;
        const sy = n.y * view.k + view.y;
        const isHover = n.id === hover;
        const isActive = n.id === active;
        const related = !hover || isHover || !!nb?.has(n.id);
        ctx.globalAlpha = related ? 1 : 0.18;
        const group = byGroup && meta.group ? groupColorRef.current.get(meta.group) : undefined;
        let fill = meta.kind === "etiqueta" ? c.cyan : c.node;
        if (group) fill = group;
        if (isHover || isActive) fill = c.primary;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(sx, sy, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Etiquetas: aparecen al acercar el zoom, y siempre para el activo, el hover y sus vecinos.
      ctx.font = c.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      for (const n of sim.nodes) {
        const meta = metaRef.current.get(n.id);
        if (!meta) continue;
        const isHover = n.id === hover;
        const isActive = n.id === active;
        const related = !hover || isHover || !!nb?.has(n.id);
        const near = isHover || isActive || (!!hover && !!nb?.has(n.id));
        const show = near || view.k >= 1.2 || (n.r >= 9 && view.k >= 0.7);
        if (!show) continue;
        const label = meta.label.length > 32 ? `${meta.label.slice(0, 31)}…` : meta.label;
        const sx = n.x * view.k + view.x;
        const sy = n.y * view.k + view.y + n.r + 4;
        ctx.globalAlpha = related ? 1 : 0.18;
        ctx.strokeStyle = c.bg;
        ctx.strokeText(label, sx, sy);
        ctx.fillStyle = isHover || isActive ? c.text : c.muted;
        ctx.fillText(label, sx, sy);
      }
      ctx.globalAlpha = 1;
    };

    const frame = () => {
      rafId = 0;
      const dragging = gesture?.kind === "nodo";
      if (sim.active) sim.tick();
      if (autoFit && !dragging && sim.active) fit();
      draw();
      if (sim.active || gesture) kick();
    };

    const kick = () => {
      if (!rafId) rafId = requestAnimationFrame(frame);
    };
    kickRef.current = kick;
    refitRef.current = () => {
      autoFit = true;
      kick();
    };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      size.dpr = window.devicePixelRatio || 1;
      size.w = r.width;
      size.h = r.height;
      canvas.width = Math.round(r.width * size.dpr);
      canvas.height = Math.round(r.height * size.dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      if (autoFit) fit();
      kick();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const mo = new MutationObserver(() => {
      colorsRef.current = readColors();
      kick();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { sx, sy } = local(e);
      const hit = hitTest(sx, sy);
      canvas.setPointerCapture(e.pointerId);
      autoFit = false;
      if (hit) {
        gesture = { kind: "nodo", node: hit, sx0: sx, sy0: sy, moved: false };
        hit.fx = hit.x;
        hit.fy = hit.y;
        sim.reheat(0.3);
      } else {
        gesture = { kind: "fondo", vx0: view.x, vy0: view.y, sx0: sx, sy0: sy, moved: false };
      }
      kick();
    };

    const onMove = (e: PointerEvent) => {
      const { sx, sy } = local(e);
      if (!gesture) {
        const hit = hitTest(sx, sy);
        const id = hit ? hit.id : null;
        if (id !== hover) {
          hover = id;
          canvas.style.cursor = id ? "pointer" : "grab";
          kick();
        }
        return;
      }
      if (Math.hypot(sx - gesture.sx0, sy - gesture.sy0) > 4) gesture.moved = true;
      if (gesture.kind === "nodo") {
        const wx = (sx - view.x) / view.k;
        const wy = (sy - view.y) / view.k;
        gesture.node.fx = wx;
        gesture.node.fy = wy;
        sim.reheat(0.3);
      } else {
        view.x = gesture.vx0 + (sx - gesture.sx0);
        view.y = gesture.vy0 + (sy - gesture.sy0);
      }
      kick();
    };

    const onUp = (e: PointerEvent) => {
      const g = gesture;
      if (!g) return;
      gesture = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (g.kind === "nodo") {
        g.node.fx = null;
        g.node.fy = null;
        if (!g.moved) {
          const meta = metaRef.current.get(g.node.id);
          if (meta) latest.current.onOpen(meta, e);
        }
      }
      canvas.style.cursor = hover ? "pointer" : "grab";
      kick();
    };

    const onLeave = () => {
      if (hover) {
        hover = null;
        kick();
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { sx, sy } = local(e);
      const k0 = view.k;
      const k1 = clamp(k0 * Math.exp(-e.deltaY * 0.0015), 0.1, 6);
      view.x = sx - (sx - view.x) * (k1 / k0);
      view.y = sy - (sy - view.y) * (k1 / k0);
      view.k = k1;
      autoFit = false;
      kick();
    };

    const onContext = (e: MouseEvent) => {
      const { sx, sy } = local(e);
      const hit = hitTest(sx, sy);
      const meta = hit ? metaRef.current.get(hit.id) : undefined;
      e.preventDefault();
      if (meta) latest.current.onMenu(meta, e);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContext);
    canvas.style.cursor = "grab";

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContext);
    };
  }, [sim]);

  // Últimos valores para el bucle (se actualizan después de cada render).
  useEffect(() => {
    latest.current = { onOpen, onMenu, colorBySubject, activeId };
    kickRef.current();
  });

  // Cambió el grafo: reconstruimos la simulación conservando las posiciones existentes.
  useEffect(() => {
    metaRef.current = new Map(graph.nodes.map((n) => [n.id, n]));
    const nb = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!nb.has(e.source)) nb.set(e.source, new Set());
      if (!nb.has(e.target)) nb.set(e.target, new Set());
      nb.get(e.source)!.add(e.target);
      nb.get(e.target)!.add(e.source);
    }
    neighborsRef.current = nb;
    groupColorRef.current = new Map(graph.groups.map((g) => [g.key, g.color]));
    sim.setGraph(
      graph.nodes.map((n) => ({ id: n.id, r: radiusOf(n) })),
      graph.edges,
    );
    // Sólo reencuadramos si cambió la forma del grafo (no al mover un slider de fuerzas).
    const shape = `${graph.nodes.map((n) => n.id).join(",")}#${graph.edges.length}`;
    if (shape !== shapeRef.current) {
      shapeRef.current = shape;
      refitRef.current();
    }
  }, [graph, sim]);

  // Cambiaron las fuerzas: ajustamos la simulación y la reactivamos.
  useEffect(() => {
    sim.repulsion = forces.repulsion;
    sim.linkDistance = forces.linkDistance;
    sim.gravity = forces.gravity;
    sim.reheat(0.4);
    kickRef.current();
  }, [forces.repulsion, forces.linkDistance, forces.gravity, sim]);

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="block touch-none" aria-label={t("Grafo de notas")} />
    </div>
  );
}
