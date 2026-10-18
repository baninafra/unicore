"use client";

// Avisos flotantes abajo al centro ("Se eliminó… · Deshacer"). Se disparan con toast() de lib/undo.

import { useEffect, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { undoLastDelete, type ToastDetail } from "@/lib/undo";

export function Toaster() {
  const [items, setItems] = useState<ToastDetail[]>([]);

  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<ToastDetail>).detail;
      setItems((prev) => [...prev.slice(-2), t]);
      window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), t.ms ?? 4000);
    };
    window.addEventListener("uc:toast", on);
    return () => window.removeEventListener("uc:toast", on);
  }, []);

  // Ctrl+Z restaura lo último que se eliminó, salvo mientras se escribe en un campo o en el editor (ahí deshace el texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], .bn-editor")) return;
      e.preventDefault();
      void undoLastDelete();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = (id: number) => setItems((prev) => prev.filter((x) => x.id !== id));

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-9 z-[70] flex flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            "pointer-events-auto flex max-w-[520px] items-center gap-3 rounded-md border bg-surface-raised px-3 py-2 text-[length:calc(13px*var(--ui-scale,1))] shadow-pop",
            t.tone === "error" ? "border-rose text-rose" : "border-border-strong text-text",
          )}
        >
          <span className="min-w-0 flex-1 truncate">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="flex-none font-medium text-primary-soft hover:underline"
              onClick={() => {
                close(t.id);
                void t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="flex-none text-faint hover:text-text" onClick={() => close(t.id)} aria-label="Cerrar aviso">
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}
