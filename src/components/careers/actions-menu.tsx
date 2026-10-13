"use client";

import { EllipsisVertical, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
}

// Menú chico de acciones (⋮). Se cierra con clic afuera o Esc.
export function ActionsMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-none">
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <EllipsisVertical strokeWidth={1.75} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 flex w-48 flex-col gap-0.5 rounded-md border border-border bg-surface p-1 shadow-pop"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={clsx(
                "flex h-9 items-center gap-2 rounded-sm px-2.5 text-left text-sm hover:bg-surface-raised",
                item.danger ? "text-rose" : "text-text",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <item.icon className="h-4 w-4 flex-none" strokeWidth={1.75} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
