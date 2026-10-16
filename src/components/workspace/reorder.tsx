"use client";

import { useEffect, useRef, useState } from "react";

// Orden de un grupo de íconos guardado en este equipo. Si aparecen íconos nuevos van al final;
// los que ya no existen se descartan.
export function useOrder(key: string, ids: readonly string[]) {
  const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(v)) setSaved(v);
    } catch {}
  }, [key]);
  const order = [...saved.filter((id) => ids.includes(id)), ...ids.filter((id) => !saved.includes(id))];
  const move = (from: string, to: string) => {
    if (from === to) return;
    const next = order.filter((id) => id !== from);
    const idx = next.indexOf(to);
    // Si se arrastra hacia abajo queda después del destino; hacia arriba, antes.
    next.splice(order.indexOf(from) < order.indexOf(to) ? idx + 1 : idx, 0, from);
    setSaved(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return [order, move] as const;
}

const HOLD_MS = 300;

// Mantener apretado un ícono y arrastrarlo para cambiarlo de lugar dentro de su grupo.
// Un clic corto sigue funcionando como siempre.
export function useReorderDrag(group: string, move: (from: string, to: string) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const moveRef = useRef(move);
  moveRef.current = move;

  const bind = (id: string) => ({
    "data-reorder": group,
    "data-reorder-id": id,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let active = false;
      const timer = window.setTimeout(() => {
        active = true;
        setDragging(id);
        document.body.style.cursor = "grabbing";
      }, HOLD_MS);
      const onMove = (ev: PointerEvent) => {
        if (!active) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) cleanup();
          return;
        }
        ev.preventDefault();
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(`[data-reorder="${group}"]`);
        const to = over?.dataset.reorderId;
        if (to && to !== id) moveRef.current(id, to);
      };
      const onUp = () => {
        if (active) {
          // El clic que viene después de soltar no tiene que abrir nada.
          const swallow = (ev: MouseEvent) => {
            ev.stopPropagation();
            ev.preventDefault();
          };
          window.addEventListener("click", swallow, { capture: true, once: true });
          window.setTimeout(() => window.removeEventListener("click", swallow, true), 50);
        }
        cleanup();
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (active) {
          setDragging(null);
          document.body.style.cursor = "";
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
  });

  return { dragging, bind };
}
