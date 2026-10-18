"use client";

// Panel "Cálculo": todas las herramientas una debajo de otra, como la barra lateral de Edge.
// Cada una se puede minimizar y anclar (las ancladas van arriba). Se recuerda en este equipo.

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { Binary, Calculator, ChartSpline, ChevronDown, GraduationCap, Pin, PinOff, Ruler, type LucideIcon } from "lucide-react";

const ToolLoading = () => <div className="px-4 py-3 t-small text-faint">Cargando…</div>;
const CalculatorTool = dynamic(() => import("./calculator").then((m) => m.CalculatorTool), { ssr: false, loading: ToolLoading });
const PlotTool = dynamic(() => import("./plotter").then((m) => m.PlotTool), { ssr: false, loading: ToolLoading });
const UnitsTool = dynamic(() => import("./units").then((m) => m.UnitsTool), { ssr: false, loading: ToolLoading });
const GradesTool = dynamic(() => import("./grades").then((m) => m.GradesTool), { ssr: false, loading: ToolLoading });
const BasesTool = dynamic(() => import("./bases").then((m) => m.BasesTool), { ssr: false, loading: ToolLoading });

type Key = "calc" | "plot" | "units" | "grades" | "bases";
const TOOLS: { key: Key; label: string; icon: LucideIcon; node: () => ReactNode }[] = [
  { key: "calc", label: "Calculadora científica", icon: Calculator, node: () => <CalculatorTool /> },
  { key: "plot", label: "Gráficos de funciones", icon: ChartSpline, node: () => <PlotTool /> },
  { key: "units", label: "Conversor de unidades", icon: Ruler, node: () => <UnitsTool /> },
  { key: "grades", label: "Promedio y nota necesaria", icon: GraduationCap, node: () => <GradesTool /> },
  { key: "bases", label: "Bases numéricas", icon: Binary, node: () => <BasesTool /> },
];

const LS = "uc-calc-stack";
interface State {
  pinned: Key[]; // en el orden en que se anclaron
  closed: Key[];
}
// Al principio: la calculadora abierta y el resto minimizado.
const DEFAULT: State = { pinned: [], closed: ["plot", "units", "grades", "bases"] };

export function CalcStack() {
  const [state, setState] = useState<State>(DEFAULT);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS) ?? "null") as State | null;
      if (v?.pinned && v.closed) setState(v);
    } catch {}
  }, []);
  const save = (next: State) => {
    setState(next);
    try {
      localStorage.setItem(LS, JSON.stringify(next));
    } catch {}
  };
  const toggle = (k: Key) =>
    save({ ...state, closed: state.closed.includes(k) ? state.closed.filter((x) => x !== k) : [...state.closed, k] });
  const pin = (k: Key) =>
    save({
      pinned: state.pinned.includes(k) ? state.pinned.filter((x) => x !== k) : [...state.pinned, k],
      // Al anclar una herramienta se abre.
      closed: state.pinned.includes(k) ? state.closed : state.closed.filter((x) => x !== k),
    });

  const ordered = [
    ...state.pinned.map((k) => TOOLS.find((t) => t.key === k)!).filter(Boolean),
    ...TOOLS.filter((t) => !state.pinned.includes(t.key)),
  ];

  return (
    <div className="flex flex-col">
      {ordered.map((t) => {
        const open = !state.closed.includes(t.key);
        const pinned = state.pinned.includes(t.key);
        return (
          <section key={t.key} className="border-b border-border">
            <div className="group flex h-10 items-center gap-2 px-4">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-[length:calc(13px*var(--ui-scale,1))] font-medium text-text"
                aria-expanded={open}
                onClick={() => toggle(t.key)}
              >
                <t.icon className="h-4 w-4 flex-none text-faint" strokeWidth={1.75} />
                <span className="truncate">{t.label}</span>
              </button>
              <button
                type="button"
                className={clsx("icon-btn", pinned ? "text-primary-soft" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                title={pinned ? "Desanclar" : "Anclar arriba"}
                aria-label={pinned ? `Desanclar ${t.label}` : `Anclar ${t.label} arriba`}
                aria-pressed={pinned}
                onClick={() => pin(t.key)}
              >
                {pinned ? <PinOff /> : <Pin />}
              </button>
              <button
                type="button"
                className="icon-btn"
                title={open ? "Minimizar" : "Abrir"}
                aria-label={open ? `Minimizar ${t.label}` : `Abrir ${t.label}`}
                onClick={() => toggle(t.key)}
              >
                <ChevronDown className={clsx("transition-transform", !open && "-rotate-90")} />
              </button>
            </div>
            {/* Dentro de la pila cada herramienta va arriba (no centrada a lo alto). */}
            {open && <div className="pb-2 [&_.tool-pane]:my-0 [&_.tool-pane]:pt-0">{t.node()}</div>}
          </section>
        );
      })}
    </div>
  );
}
