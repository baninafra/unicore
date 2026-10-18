"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

// Piezas compartidas por las secciones de Ajustes.

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-6 border-b border-border py-1.5">
      <span className="t-small text-text">{label}</span>
      <div className="flex flex-none items-center gap-2">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer accent-primary"
    />
  );
}

export function Slider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 accent-primary"
        aria-label={t("Tamaño")}
      />
      <span className="t-small num w-12 text-right text-muted">{value} px</span>
    </>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="t-small py-2 text-muted">{children}</p>;
}

export function Heading({ children }: { children: ReactNode }) {
  return <h2 className="section-label mb-1 mt-6 first:mt-0">{children}</h2>;
}
