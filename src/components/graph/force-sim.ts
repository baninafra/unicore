"use client";

// Simulación de fuerzas propia (sin d3): repulsión entre nodos, resortes por enlace,
// gravedad al centro y amortiguación. Se enfría con `alpha` hasta estabilizarse.

export interface SimNode {
  id: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

export interface SimLink {
  source: SimNode;
  target: SimNode;
}

const MAX_SPEED = 40;
const ALPHA_MIN = 0.002;
const ALPHA_DECAY = 0.0228;
const FRICTION = 0.6;

export class ForceSim {
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  alpha = 1;
  repulsion = 600;
  linkDistance = 90;
  gravity = 0.03;

  // Reemplaza el grafo conservando la posición de los nodos que ya estaban.
  setGraph(nodes: { id: string; r: number }[], edges: { source: string; target: string }[]) {
    const prev = new Map(this.nodes.map((n) => [n.id, n]));
    const spread = 60 + Math.sqrt(nodes.length) * 18;
    this.nodes = nodes.map((n, i) => {
      const old = prev.get(n.id);
      if (old) return { ...old, r: n.r };
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 + Math.random() * 0.5;
      const radius = spread * (0.4 + Math.random() * 0.6);
      return { id: n.id, r: n.r, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0, fx: null, fy: null };
    });
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.links = edges.flatMap((e) => {
      const source = byId.get(e.source);
      const target = byId.get(e.target);
      return source && target ? [{ source, target }] : [];
    });
    this.reheat(0.6);
  }

  reheat(alpha = 0.3) {
    this.alpha = Math.max(this.alpha, alpha);
  }

  get active() {
    return this.alpha >= ALPHA_MIN;
  }

  // Un paso de la simulación. Devuelve true si todavía se mueve.
  tick(): boolean {
    if (!this.active) return false;
    const a = this.alpha;
    const ns = this.nodes;

    // Repulsión (todos contra todos, con corte a distancia grande).
    for (let i = 0; i < ns.length; i++) {
      const p = ns[i];
      for (let j = i + 1; j < ns.length; j++) {
        const q = ns[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        if (d2 > 250000) continue;
        const d = Math.sqrt(d2);
        const f = (this.repulsion * a) / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        p.vx -= fx;
        p.vy -= fy;
        q.vx += fx;
        q.vy += fy;
      }
    }

    // Resortes por enlace.
    const L = this.linkDistance;
    for (const l of this.links) {
      const s = l.source;
      const t = l.target;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const k = ((d - L) / d) * 0.12 * a;
      s.vx += dx * k * 0.5;
      s.vy += dy * k * 0.5;
      t.vx -= dx * k * 0.5;
      t.vy -= dy * k * 0.5;
    }

    // Gravedad al centro y posiciones.
    const g = this.gravity * 0.1 * a;
    let moving = false;
    for (const n of ns) {
      if (n.fx !== null && n.fy !== null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx -= n.x * g;
      n.vy -= n.y * g;
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > MAX_SPEED) {
        n.vx = (n.vx / speed) * MAX_SPEED;
        n.vy = (n.vy / speed) * MAX_SPEED;
      }
      n.x += n.vx;
      n.y += n.vy;
      if (speed > 0.05) moving = true;
    }

    this.alpha *= 1 - ALPHA_DECAY;
    if (!moving) this.alpha = Math.min(this.alpha, ALPHA_MIN);
    return this.active;
  }
}
