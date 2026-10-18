"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronRight, type LucideIcon } from "lucide-react";

// Un ítem con `submenu` abre sus opciones al pasar el mouse por arriba o al hacer clic (un solo nivel).
export type MenuItem =
  | {
      type?: "item";
      label: string;
      icon?: LucideIcon;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect?: () => void | Promise<void>;
      submenu?: MenuItem[];
    }
  | { type: "separator" };

type ActionItem = Exclude<MenuItem, { type: "separator" }>;

const PANEL = "fixed z-[60] max-h-[75vh] min-w-[180px] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-pop";

function Rows({
  items,
  onPick,
  onHover,
  openIndex,
  onOpenSub,
}: {
  items: MenuItem[];
  onPick: (it: ActionItem) => void;
  onHover?: (index: number, el: HTMLElement, hasSub: boolean) => void;
  openIndex?: number | null;
  onOpenSub?: (index: number, el: HTMLElement) => void;
}) {
  return (
    <>
      {items.map((it, i) =>
        it.type === "separator" ? (
          <div key={i} className="my-1 h-px bg-border" />
        ) : (
          <button
            key={i}
            role="menuitem"
            aria-haspopup={it.submenu ? "menu" : undefined}
            aria-expanded={it.submenu ? openIndex === i : undefined}
            disabled={it.disabled}
            // Mantiene el foco y la selección donde estaban (para Cortar, Copiar y Pegar).
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={(e) => onHover?.(i, e.currentTarget, !!it.submenu)}
            onClick={(e) => (it.submenu ? onOpenSub?.(i, e.currentTarget) : onPick(it))}
            className={clsx(
              "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-[length:calc(13px*var(--ui-scale,1))] disabled:opacity-40",
              it.danger ? "text-rose hover:bg-rose-tint" : "text-text hover:bg-surface-raised",
              openIndex === i && "bg-surface-raised",
            )}
          >
            {it.icon && <it.icon className="h-3.5 w-3.5 flex-none text-faint" strokeWidth={1.75} />}
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-[length:calc(11px*var(--ui-scale,1))] text-faint">{it.hint}</span>}
            {it.submenu && <ChevronRight className="h-3.5 w-3.5 flex-none text-faint" strokeWidth={1.75} />}
          </button>
        ),
      )}
    </>
  );
}

// Opciones de un ítem con submenú: se abren al costado, o del otro lado si no entran.
function SubMenu({
  items,
  anchor,
  onPick,
  onEnter,
  innerRef,
}: {
  items: MenuItem[];
  anchor: DOMRect;
  onPick: (it: ActionItem) => void;
  onEnter: () => void;
  innerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [pos, setPos] = useState({ x: anchor.right - 2, y: anchor.top - 5 });

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const fitsRight = anchor.right - 2 + r.width <= window.innerWidth - 8;
    setPos({
      x: fitsRight ? anchor.right - 2 : Math.max(8, anchor.left - r.width + 2),
      y: Math.max(8, Math.min(anchor.top - 5, window.innerHeight - r.height - 8)),
    });
  }, [anchor, innerRef]);

  return createPortal(
    <div ref={innerRef} role="menu" className={PANEL} style={{ left: pos.x, top: pos.y }} onMouseEnter={onEnter} onContextMenu={(e) => e.preventDefault()}>
      <Rows items={items} onPick={onPick} />
    </div>,
    document.body,
  );
}

// Menú flotante (clic derecho o botón "…"). Se cierra con Esc, clic afuera o al elegir.
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ index: number; anchor: DOMRect } | null>(null);

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
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !subRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
      clearTimeout(closeTimer.current);
    };
  }, [onClose]);

  const pick = (it: ActionItem) => {
    onClose();
    void it.onSelect?.();
  };

  const openSub = (index: number, el: HTMLElement) => {
    clearTimeout(closeTimer.current);
    setSub({ index, anchor: el.getBoundingClientRect() });
  };

  const current = sub ? items[sub.index] : undefined;
  const subItems = current && current.type !== "separator" ? current.submenu : undefined;

  return createPortal(
    <>
      <div ref={ref} role="menu" className={PANEL} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
        <Rows
          items={items}
          onPick={pick}
          openIndex={sub?.index}
          onHover={(i, el, hasSub) => {
            if (hasSub) return openSub(i, el);
            // Una pausa corta evita que el submenú se cierre al ir en diagonal hacia sus opciones.
            clearTimeout(closeTimer.current);
            closeTimer.current = setTimeout(() => setSub(null), 150);
          }}
          onOpenSub={openSub}
        />
      </div>
      {sub && subItems && (
        <SubMenu items={subItems} anchor={sub.anchor} onPick={pick} onEnter={() => clearTimeout(closeTimer.current)} innerRef={subRef} />
      )}
    </>,
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
