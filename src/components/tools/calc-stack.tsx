"use client";

// Panel "Cálculo": todas las herramientas una debajo de otra, como la barra lateral de Edge.
// Cada una se puede minimizar y anclar (las ancladas van arriba). Se recuerda en este equipo.

import { PROFILES, useProfiles } from "@/lib/profiles";
import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { t } from "@/lib/i18n";
import { Binary, Calculator, ChartSpline, ChevronDown, GraduationCap, Pin, PinOff, Ruler, type LucideIcon } from "lucide-react";

const ToolLoading = () => <div className="px-4 py-3 t-small text-faint">{t("Cargando…")}</div>;
const CalculatorTool = dynamic(() => import("./calculator").then((m) => m.CalculatorTool), { ssr: false, loading: ToolLoading });
const PlotTool = dynamic(() => import("./plotter").then((m) => m.PlotTool), { ssr: false, loading: ToolLoading });
const UnitsTool = dynamic(() => import("./units").then((m) => m.UnitsTool), { ssr: false, loading: ToolLoading });
const GradesTool = dynamic(() => import("./grades").then((m) => m.GradesTool), { ssr: false, loading: ToolLoading });
const BasesTool = dynamic(() => import("./bases").then((m) => m.BasesTool), { ssr: false, loading: ToolLoading });

type Key = "calc" | "plot" | "units" | "grades" | "bases";
const TOOLS: { key: Key; label: string; icon: LucideIcon; node: () => ReactNode }[] = [
  { key: "calc", label: t("Calculadora científica"), icon: Calculator, node: () => <CalculatorTool /> },
  { key: "plot", label: t("Gráficos de funciones"), icon: ChartSpline, node: () => <PlotTool /> },
  { key: "units", label: t("Conversor de unidades"), icon: Ruler, node: () => <UnitsTool /> },
  { key: "grades", label: t("Promedio y nota necesaria"), icon: GraduationCap, node: () => <GradesTool /> },
  { key: "bases", label: t("Bases numéricas"), icon: Binary, node: () => <BasesTool /> },
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

  const { activeKinds } = useProfiles();
  const studying = activeKinds.some((k) => PROFILES[k].study);
  // El promedio de notas sólo tiene sentido en perfiles de estudio.
  const visible = (tool: (typeof TOOLS)[number]) => tool.key !== "grades" || studying;
  const ordered = [
    ...state.pinned.map((k) => TOOLS.find((tool) => tool.key === k)!).filter(Boolean),
    ...TOOLS.filter((tool) => !state.pinned.includes(tool.key)),
  ].filter(visible);

  return (
    <div className="flex flex-col">
      {ordered.map((tool) => {
        const open = !state.closed.includes(tool.key);
        const pinned = state.pinned.includes(tool.key);
        return (
          <section key={tool.key} className="border-b border-border">
            <div className="group flex h-10 items-center gap-2 px-4">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-[length:calc(13px*var(--ui-scale,1))] font-medium text-text"
                aria-expanded={open}
                onClick={() => toggle(tool.key)}
              >
                <tool.icon className="h-4 w-4 flex-none text-faint" strokeWidth={1.75} />
                <span className="truncate">{tool.label}</span>
              </button>
              <button
                type="button"
                className={clsx("icon-btn", pinned ? "text-primary-soft" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                title={pinned ? t("Desanclar") : t("Anclar arriba")}
                aria-label={pinned ? t("Desanclar {name}", { name: tool.label }) : t("Anclar {name} arriba", { name: tool.label })}
                aria-pressed={pinned}
                onClick={() => pin(tool.key)}
              >
                {pinned ? <PinOff /> : <Pin />}
              </button>
              <button
                type="button"
                className="icon-btn"
                title={open ? t("Minimizar") : t("Abrir")}
                aria-label={open ? t("Minimizar {name}", { name: tool.label }) : t("Abrir {name}", { name: tool.label })}
                onClick={() => toggle(tool.key)}
              >
                <ChevronDown className={clsx("transition-transform", !open && "-rotate-90")} />
              </button>
            </div>
            {/* Dentro de la pila cada herramienta va arriba (no centrada a lo alto). */}
            {open && <div className="pb-2 [&_.tool-pane]:my-0 [&_.tool-pane]:pt-0">{tool.node()}</div>}
          </section>
        );
      })}
    </div>
  );
}
