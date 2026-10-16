"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Binary,
  Bookmark,
  Calculator,
  ChartSpline,
  Files,
  GraduationCap,
  Hash,
  Languages,
  Link2,
  ListTree,
  PanelRightClose,
  PanelRightOpen,
  Ruler,
  ScanLine,
  Search,
  Sparkles,
  SquareArrowOutUpRight,
  Table2,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useWorkspace, type LeftView, type RightView } from "@/lib/workspace";
import { FileExplorer } from "@/components/explorer/file-explorer";
import { SearchPane } from "@/components/search/search-pane";
import { BookmarksPane } from "@/components/bookmarks/bookmarks-pane";
import { AIChatPane } from "@/components/ai/ai-chat-pane";
import { BacklinksPane } from "@/components/panes/backlinks-pane";
import { OutgoingPane } from "@/components/panes/outgoing-pane";
import { OutlinePane } from "@/components/panes/outline-pane";
import { TagsPane } from "@/components/panes/tags-pane";
import { PropertiesPane } from "@/components/panes/properties-pane";
import { useOrder, useReorderDrag } from "./reorder";
import { openScanner } from "@/components/scanner/scanner-app";

// Las herramientas se cargan recién cuando se abren (mathjs y el traductor pesan).
const ToolLoading = () => <div className="tool-pane t-small text-faint">Cargando…</div>;
const CalculatorTool = dynamic(() => import("@/components/tools/calculator").then((m) => m.CalculatorTool), { ssr: false, loading: ToolLoading });
const PlotTool = dynamic(() => import("@/components/tools/plotter").then((m) => m.PlotTool), { ssr: false, loading: ToolLoading });
const TranslatorTool = dynamic(() => import("@/components/tools/translator").then((m) => m.TranslatorTool), { ssr: false, loading: ToolLoading });
const UnitsTool = dynamic(() => import("@/components/tools/units").then((m) => m.UnitsTool), { ssr: false, loading: ToolLoading });
const GradesTool = dynamic(() => import("@/components/tools/grades").then((m) => m.GradesTool), { ssr: false, loading: ToolLoading });
const BasesTool = dynamic(() => import("@/components/tools/bases").then((m) => m.BasesTool), { ssr: false, loading: ToolLoading });

function PaneTab({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-raised",
        active ? "bg-surface-raised text-text" : "text-faint hover:text-text",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}

// Ancho de una barra lateral, guardado entre sesiones. Doble clic en el borde vuelve al ancho original.
function useWidth(key: string, initial: number, min: number, max: number) {
  const [w, setW] = useState(initial);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(key));
      if (v) setW(Math.min(max, Math.max(min, v)));
    } catch {}
  }, [key, min, max]);
  const set = (v: number) => {
    const next = Math.min(max, Math.max(min, Math.round(v)));
    setW(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {}
  };
  return [w, set] as const;
}

// Manija para arrastrar el borde de una barra lateral.
function ResizeHandle({ side, width, onResize, onReset }: { side: "left" | "right"; width: number; onResize: (w: number) => void; onReset: () => void }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Cambiar el ancho del panel"
      title="Arrastrá para agrandar o achicar · doble clic para volver al tamaño original"
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const move = (ev: PointerEvent) => onResize(startW + (side === "left" ? ev.clientX - startX : startX - ev.clientX));
        const up = () => {
          setDragging(false);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className={clsx(
        "absolute top-0 z-20 h-full w-1.5 cursor-col-resize transition-colors hover:bg-primary/60",
        side === "left" ? "-right-[3px]" : "-left-[3px]",
        dragging && "bg-primary",
      )}
    />
  );
}

const LEFT: { key: LeftView; label: string; icon: LucideIcon }[] = [
  { key: "explorer", label: "Archivos", icon: Files },
  { key: "search", label: "Buscar", icon: Search },
  { key: "bookmarks", label: "Marcadores", icon: Bookmark },
];

const RIGHT: { key: RightView; label: string; icon: LucideIcon }[] = [
  { key: "ia", label: "Asistente IA", icon: Sparkles },
  { key: "backlinks", label: "Menciones", icon: Link2 },
  { key: "outgoing", label: "Enlaces salientes", icon: SquareArrowOutUpRight },
  { key: "outline", label: "Esquema", icon: ListTree },
  { key: "tags", label: "Etiquetas", icon: Hash },
  { key: "properties", label: "Propiedades", icon: Table2 },
];

// Herramientas sueltas, debajo de lo que tiene que ver con la nota abierta.
const TOOLS: { key: RightView; label: string; icon: LucideIcon }[] = [
  { key: "calc", label: "Calculadora científica", icon: Calculator },
  { key: "plot", label: "Graficador de funciones", icon: ChartSpline },
  { key: "translate", label: "Traductor", icon: Languages },
  { key: "units", label: "Conversor de unidades", icon: Ruler },
  { key: "grades", label: "Promedio y nota necesaria", icon: GraduationCap },
  { key: "bases", label: "Bases numéricas", icon: Binary },
];

export function LeftSidebar() {
  const { leftOpen, leftView, setLeft } = useWorkspace();
  const [width, setWidth] = useWidth("uc-left-width", 260, 180, 560);
  if (!leftOpen) return null;
  return (
    <aside className="relative flex flex-none flex-col border-r border-border bg-bg" style={{ width }}>
      <ResizeHandle side="left" width={width} onResize={setWidth} onReset={() => setWidth(260)} />
      <div className="flex h-9 flex-none items-center gap-0.5 px-2">
        {LEFT.map((v) => (
          <PaneTab key={v.key} icon={v.icon} label={v.label} active={leftView === v.key} onClick={() => setLeft(true, v.key)} />
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {leftView === "explorer" && <FileExplorer />}
        {leftView === "search" && <SearchPane />}
        {leftView === "bookmarks" && <BookmarksPane />}
      </div>
    </aside>
  );
}

function RailButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-raised hover:text-text",
        active ? "bg-surface-raised text-primary-soft" : "text-faint",
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </button>
  );
}

const SCANNER = { key: "scanner" as RightView, label: "Escáner de documentos", icon: ScanLine };

// Íconos del riel que se reordenan manteniendo apretado y arrastrando (el orden queda guardado).
function RailGroup({
  group,
  items,
  isActive,
  onPick,
}: {
  group: string;
  items: { key: RightView; label: string; icon: LucideIcon }[];
  isActive: (k: RightView) => boolean;
  onPick: (k: RightView) => void;
}) {
  const [order, move] = useOrder(`uc-order-${group}`, items.map((i) => i.key));
  const { dragging, bind } = useReorderDrag(group, move);
  return (
    <>
      {(order as RightView[]).map((k) => {
        const v = items.find((i) => i.key === k)!;
        return (
          <div key={k} {...bind(k)} className={clsx("rounded-md", dragging === k && "bg-surface-raised opacity-70 ring-1 ring-primary")}>
            <RailButton icon={v.icon} label={v.label} active={isActive(k)} onClick={() => onPick(k)} />
          </div>
        );
      })}
    </>
  );
}

// Panel derecho: el contenido a la izquierda y una columna de íconos pegada al borde, siempre visible.
// Clic en un ícono abre ese panel; clic en el que ya está abierto lo cierra.
// La columna de íconos de la derecha se puede esconder del todo (se recuerda en este equipo).
const LS_RAIL = "uc-right-rail-hidden";
const RAIL_EVENT = "uc:right-rail";

function useRailHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        setHidden(localStorage.getItem(LS_RAIL) === "1");
      } catch {}
    };
    read();
    window.addEventListener(RAIL_EVENT, read);
    return () => window.removeEventListener(RAIL_EVENT, read);
  }, []);
  const set = (v: boolean) => {
    try {
      localStorage.setItem(LS_RAIL, v ? "1" : "0");
    } catch {}
    window.dispatchEvent(new Event(RAIL_EVENT));
  };
  return [hidden, set] as const;
}

export function RightSidebar() {
  const { rightOpen, rightView, setRight } = useWorkspace();
  const [railHidden, setRailHidden] = useRailHidden();
  const [width, setWidth] = useWidth("uc-right-width", 320, 240, 760);
  const pick = (key: RightView) => (rightOpen && rightView === key ? setRight(false) : setRight(true, key));
  const current = [...RIGHT, ...TOOLS].find((v) => v.key === rightView);
  return (
    <>
      {rightOpen && (
        <aside className="relative flex min-w-[220px] flex-[0_1_auto] flex-col border-l border-border bg-bg" style={{ width }}>
          <ResizeHandle side="right" width={width} onResize={setWidth} onReset={() => setWidth(320)} />
          <div className="flex h-9 flex-none items-center gap-2 px-3">
            <span className="t-label truncate text-muted">{current?.label}</span>
            <button
              aria-label="Cerrar panel derecho"
              title="Cerrar panel derecho"
              onClick={() => setRight(false)}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-raised hover:text-text"
            >
              <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rightView === "ia" && <AIChatPane />}
            {rightView === "backlinks" && <BacklinksPane />}
            {rightView === "outgoing" && <OutgoingPane />}
            {rightView === "outline" && <OutlinePane />}
            {rightView === "tags" && <TagsPane />}
            {rightView === "properties" && <PropertiesPane />}
            {rightView === "calc" && <CalculatorTool />}
            {rightView === "plot" && <PlotTool />}
            {rightView === "translate" && <TranslatorTool />}
            {rightView === "units" && <UnitsTool />}
            {rightView === "grades" && <GradesTool />}
            {rightView === "bases" && <BasesTool />}
          </div>
        </aside>
      )}
      {!railHidden && <nav aria-label="Paneles y herramientas" className="flex w-11 flex-none flex-col items-center gap-1 border-l border-border bg-bg py-2">
        <RailButton
          icon={PanelRightClose}
          label="Esconder la barra derecha"
          active={false}
          onClick={() => {
            setRight(false);
            setRailHidden(true);
          }}
        />
        <div className="my-1 h-px w-5 bg-border" />
        <RailGroup group="rail-panes" items={RIGHT} isActive={(k: RightView) => rightOpen && rightView === k} onPick={pick} />
        <div className="my-1 h-px w-5 bg-border" />
        {/* El escáner necesita lugar: se abre a pantalla completa. */}
        <RailGroup group="rail-tools" items={[...TOOLS, SCANNER]} isActive={(k: RightView) => rightOpen && rightView === k} onPick={(k) => (k === SCANNER.key ? openScanner() : pick(k))} />
      </nav>}
    </>
  );
}

// Con el riel escondido, el botón para volver a mostrarlo va al final de la barra de pestañas
// del último panel (en el flujo normal, así no tapa el botón de dividir ni el de cerrar panel).
export function RightToggle() {
  const [railHidden, setRailHidden] = useRailHidden();
  if (!railHidden) return null;
  return (
    <button
      aria-label="Mostrar la barra derecha"
      title="Mostrar la barra derecha"
      onClick={() => setRailHidden(false)}
      className="mb-1 ml-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md text-faint hover:bg-surface-raised hover:text-text"
    >
      <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}
