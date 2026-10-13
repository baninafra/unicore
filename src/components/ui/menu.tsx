"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

export type MenuItem =
  | { type?: "item"; label: string; icon?: LucideIcon; hint?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { type: "separator" };

// Menú flotante (clic derecho o botón "…"). Se cierra con Esc, clic afuera o al elegir.
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[60] min-w-[180px] rounded-md border border-border bg-surface p-1 shadow-pop"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.type === "separator" ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={clsx(
              "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] disabled:opacity-40",
              it.danger ? "text-rose hover:bg-rose-tint" : "text-text hover:bg-surface-raised",
            )}
          >
            {it.icon && <it.icon className="h-3.5 w-3.5 flex-none text-faint" strokeWidth={1.75} />}
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-[11px] text-faint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

// Hook para menú contextual: const { open, menu } = useContextMenu(); onContextMenu={(e) => open(e, items)}
export function useContextMenu() {
  const [state, setState] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = (e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) => {
    e.preventDefault?.();
    e.stopPropagation?.();
    setState({ x: e.clientX, y: e.clientY, items });
  };
  const menu = state ? <Menu x={state.x} y={state.y} items={state.items} onClose={() => setState(null)} /> : null;
  return { open, menu };
}
