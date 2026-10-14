"use client";

// Selector con el diseño de la app (reemplaza al <select> nativo, cuya lista abre con el estilo de Windows).
// Misma forma de uso: <Select value onChange={(e) => e.target.value}> con <option> adentro.

import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

interface Opt {
  value: string;
  label: ReactNode;
  text: string;
  disabled?: boolean;
}

type ChangeLike = { target: { value: string }; currentTarget: { value: string } };

function readOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.toArray(children).forEach((ch) => {
    if (!isValidElement(ch)) return;
    const p = ch.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    if (ch.type === "optgroup") {
      out.push(...readOptions(p.children));
      return;
    }
    if (ch.type !== "option") return;
    const text = Children.toArray(p.children).join("");
    out.push({ value: String(p.value ?? text), label: p.children, text, disabled: p.disabled });
  });
  return out;
}

export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
  id,
  title,
  "aria-label": ariaLabel,
}: {
  value?: string | number | null;
  onChange?: (e: ChangeLike) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const options = readOptions(children);
  const current = options.find((o) => o.value === String(value ?? "")) ?? options[0];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, up: false });
  const typed = useRef({ text: "", at: 0 });

  const choose = (o: Opt) => {
    if (o.disabled) return;
    setOpen(false);
    btnRef.current?.focus();
    if (o.value !== String(value ?? "")) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const listH = Math.min(320, options.length * 30 + 8);
    const up = r.bottom + listH + 8 > window.innerHeight && r.top > listH;
    setPos({ left: r.left, top: up ? r.top - listH - 4 : r.bottom + 4, width: r.width, up });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", () => setOpen(false), { once: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openList = () => {
    setActive(Math.max(0, options.indexOf(current)));
    setOpen(true);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) choose(options[active]);
    } else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1) {
      // Escribir salta a la opción que empieza así.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => o.text.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        title={title}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        className={clsx("uc-select", className)}
      >
        <span className="min-w-0 flex-1 truncate text-left">{current?.label ?? ""}</span>
        <ChevronDown className={clsx("h-3.5 w-3.5 flex-none text-faint transition-transform", open && "rotate-180")} strokeWidth={1.75} />
      </button>
      {open &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[90] max-h-[320px] overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-pop"
            style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.width, 140) }}
            onKeyDown={onKey}
          >
            {options.map((o, i) => {
              const selected = o === current;
              return (
                <div
                  key={`${o.value}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  className={clsx(
                    "flex h-[30px] cursor-default items-center gap-2 rounded-sm px-2 text-[13px]",
                    o.disabled ? "opacity-40" : i === active ? "bg-surface-raised text-text" : "text-text",
                    selected && "text-primary-soft",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate whitespace-nowrap">{o.label}</span>
                  {selected && <Check className="h-3.5 w-3.5 flex-none" strokeWidth={2} />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
