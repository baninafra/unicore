"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

// Modal base: fondo oscuro, Esc para cerrar, clic afuera para cerrar.
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={clsx("flex max-h-[80vh] w-full flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-pop", className)}
        style={{ maxWidth: width }}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="t-h2">{title}</div>
            <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Cerrar">
              <X />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
