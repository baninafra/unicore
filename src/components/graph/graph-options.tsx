"use client";

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import type { GraphForces, GraphGroup, GraphOptions } from "./graph-model";
import { t } from "@/lib/i18n";

interface Props {
  opts: GraphOptions;
  local: boolean;
  groups: GraphGroup[];
  onChange: (patch: Partial<GraphOptions>) => void;
  onForces: (patch: Partial<GraphForces>) => void;
  onReset: () => void;
}

// Panel flotante arriba a la derecha, como el de Obsidian: Filtros, Grupos y Fuerzas.
export function GraphOptionsPanel({ opts, local, groups, onChange, onForces, onReset }: Props) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="icon-btn absolute right-3 top-3 z-10 border border-border bg-surface shadow-pop"
        aria-label={t("Mostrar opciones del grafo")}
        title={t("Opciones del grafo")}
      >
        <SlidersHorizontal strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <div className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-24px)] w-[232px] flex-col overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-pop">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="section-label">{t("Opciones")}</span>
        <button type="button" className="icon-btn h-6 w-6" onClick={() => setOpen(false)} aria-label={t("Ocultar opciones")} title={t("Ocultar")}>
          <ChevronDown strokeWidth={1.75} />
        </button>
      </div>

      <Section title={t("Filtros")}>
        {local && (
          <Slider
            label={t("Profundidad")}
            value={opts.depth}
            min={1}
            max={3}
            step={1}
            display={String(opts.depth)}
            onChange={(v) => onChange({ depth: v })}
          />
        )}
        <input
          className="input h-7 text-[length:calc(13px*var(--ui-scale,1))]"
          placeholder={t("Buscar nota")}
          value={opts.query}
          onChange={(e) => onChange({ query: e.target.value })}
          aria-label={t("Buscar notas en el grafo")}
        />
        <Check label={t("Mostrar etiquetas")} checked={opts.showTags} onChange={(v) => onChange({ showTags: v })} />
        <Check label={t("Mostrar materias")} checked={opts.showSubjects} onChange={(v) => onChange({ showSubjects: v })} />
        <Check label={t("Mostrar huérfanas")} checked={opts.showOrphans} onChange={(v) => onChange({ showOrphans: v })} />
      </Section>

      <Section title={t("Grupos")}>
        <Check label={t("Colorear por materia")} checked={opts.colorBySubject} onChange={(v) => onChange({ colorBySubject: v })} />
        {groups.map((g) => (
          <div key={g.key} className="row">
            <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: g.color }} aria-hidden />
            <span className="truncate">{g.label}</span>
          </div>
        ))}
      </Section>

      <Section title={t("Fuerzas")}>
        <Slider
          label={t("Repulsión")}
          value={opts.forces.repulsion}
          min={100}
          max={2000}
          step={50}
          onChange={(v) => onForces({ repulsion: v })}
        />
        <Slider
          label={t("Longitud de enlace")}
          value={opts.forces.linkDistance}
          min={20}
          max={250}
          step={5}
          onChange={(v) => onForces({ linkDistance: v })}
        />
        <Slider
          label={t("Gravedad")}
          value={opts.forces.gravity}
          min={0}
          max={0.2}
          step={0.005}
          display={opts.forces.gravity.toFixed(3).replace(".", ",")}
          onChange={(v) => onForces({ gravity: v })}
        />
        <button type="button" className="btn btn-sm btn-ghost self-start" onClick={onReset}>
          {t("Restablecer")}
        </button>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-border px-2 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-6 w-full items-center gap-1 text-left text-[length:calc(13px*var(--ui-scale,1))] font-medium text-muted hover:text-text"
        aria-expanded={open}
      >
        <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} strokeWidth={1.75} />
        {title}
      </button>
      {open && <div className="flex flex-col gap-1.5 pt-1">{children}</div>}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--primary)]"
      />
      <span>{label}</span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 px-2 text-[length:calc(12px*var(--ui-scale,1))] text-muted">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="num text-faint">{display ?? value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--primary)]"
      />
    </label>
  );
}
