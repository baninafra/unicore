"use client";

import { ProfileSwitcher } from "./profile-switcher";
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
import { ScannerApp, SCANNER_EVENT } from "@/components/scanner/scanner-app";
import { CalcStack } from "@/components/tools/calc-stack";
import { useWindowControls, WINDOW_CONTROLS_W } from "@/components/shell/window-controls";

// Las herramientas se cargan recién cuando se abren (mathjs y el traductor pesan).
const ToolLoading = () => <div className="tool-pane t-small text-faint">Cargando…</div>;
const TranslatorTool = dynamic(() => import("@/components/tools/translator").then((m) => m.TranslatorTool), { ssr: false, loading: ToolLoading });

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
        // Capturar el puntero: si se suelta encima de un editor (iframe), igual nos enteramos.
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        const move = (ev: PointerEvent) => onResize(startW + (side === "left" ? ev.clientX - startX : startX - ev.clientX));
        const up = () => {
          setDragging(false);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          el.removeEventListener("lostpointercapture", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        el.addEventListener("lostpointercapture", up);
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
// Todas las de cálculo van juntas en un solo ícono ("Cálculo"), con pestañas adentro.
const CALC: { key: RightView; label: string; short: string; icon: LucideIcon }[] = [
  { key: "calc", label: "Calculadora científica", short: "Calculadora", icon: Calculator },
  { key: "plot", label: "Graficador de funciones", short: "Gráficos", icon: ChartSpline },
  { key: "units", label: "Conversor de unidades", short: "Unidades", icon: Ruler },
  { key: "grades", label: "Promedio y nota necesaria", short: "Promedio", icon: GraduationCap },
  { key: "bases", label: "Bases numéricas", short: "Bases", icon: Binary },
];
const isCalc = (k: RightView) => CALC.some((c) => c.key === k);
const TOOLS: { key: RightView; label: string; icon: LucideIcon }[] = [
  { key: "calc", label: "Cálculo", icon: Calculator },
  { key: "translate", label: "Traductor", icon: Languages },
  { key: "scanner", label: "Escáner de documentos", icon: ScanLine },
];

export function LeftSidebar() {
  const { leftOpen, leftView, setLeft } = useWorkspace();
  const [width, setWidth] = useWidth("uc-left-width", 260, 180, 560);
  if (!leftOpen) return null;
  return (
    <aside className="relative flex flex-none flex-col border-r border-border bg-bg" style={{ width }}>
      <ResizeHandle side="left" width={width} onResize={setWidth} onReset={() => setWidth(260)} />
      <ProfileSwitcher />
      <div className="flex h-10 flex-none items-center gap-0.5 px-2">
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

export function useRailHidden() {
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
  const { rightView, setRight } = useWorkspace();
  const [railHidden, setRailHidden] = useRailHidden();
  const [width, setWidth] = useWidth("uc-right-width", 320, 240, 760);
  // Sin barra de Windows: arriba a la derecha van los botones de la ventana.
  const controls = useWindowControls();
  const RAIL_W = 44;
  // La barra derecha se muestra o se esconde entera (botón de arriba): un ícono sólo cambia de panel.
  const open = !railHidden;
  const pick = (key: RightView) => setRight(true, key);
  const current = isCalc(rightView) ? { label: "Cálculo" } : [...RIGHT, ...TOOLS].find((v) => v.key === rightView);
  // openScanner() (paleta, IA) abre el escáner acá.
  useEffect(() => {
    const show = () => setRight(true, "scanner");
    window.addEventListener(SCANNER_EVENT, show);
    return () => window.removeEventListener(SCANNER_EVENT, show);
  }, [setRight]);
  return (
    <>
      {open && (
        <aside className="relative flex min-w-[220px] flex-[0_1_auto] flex-col border-l border-border bg-bg" style={{ width }}>
          <ResizeHandle side="right" width={width} onResize={setWidth} onReset={() => setWidth(320)} />
          <div
            data-tauri-drag-region
            className="flex h-10 flex-none items-center gap-2 px-4"
            style={controls ? { paddingRight: WINDOW_CONTROLS_W - (railHidden ? 0 : RAIL_W) + 8 } : undefined}
          >
            <span data-tauri-drag-region className="t-label truncate text-muted">{current?.label}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {rightView === "ia" && <AIChatPane />}
            {rightView === "backlinks" && <BacklinksPane />}
            {rightView === "outgoing" && <OutgoingPane />}
            {rightView === "outline" && <OutlinePane />}
            {rightView === "tags" && <TagsPane />}
            {rightView === "properties" && <PropertiesPane />}
            {isCalc(rightView) && <CalcStack />}
            {rightView === "translate" && <TranslatorTool />}
            {/* Queda montado mientras el panel está abierto: cambiar a otra herramienta no pierde las páginas. */}
            <ScannerApp visible={rightView === "scanner"} />
          </div>
        </aside>
      )}
      {!railHidden && <nav
        aria-label="Paneles y herramientas"
        data-tauri-drag-region
        className={clsx("flex w-11 flex-none flex-col items-center gap-1 border-l border-border bg-bg py-2", controls && "pt-11")}
      >
        {/* En la app de escritorio este botón está arriba, con los de la ventana. */}
        {!controls && (
          <>
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
          </>
        )}
        <RailGroup group="rail-panes" items={RIGHT} isActive={(k: RightView) => rightView === k} onPick={pick} />
        <div className="my-1 h-px w-5 bg-border" />
        <RailGroup group="rail-tools" items={TOOLS} isActive={(k: RightView) => rightView === k || (k === "calc" && isCalc(rightView))} onPick={pick} />
      </nav>}
    </>
  );
}

// Con el riel escondido, el botón para volver a mostrarlo va al final de la barra de pestañas
// del último panel (en el flujo normal, así no tapa el botón de dividir ni el de cerrar panel).
export function RightToggle() {
  const [railHidden, setRailHidden] = useRailHidden();
  const { setRight } = useWorkspace();
  const controls = useWindowControls();
  if (!railHidden || controls) return null;
  return (
    <button
      aria-label="Mostrar la barra derecha"
      title="Mostrar la barra derecha"
      onClick={() => {
        // Vuelve a abrir el panel que estaba antes de esconderla (IA, calculadora…).
        setRailHidden(false);
        setRight(true);
      }}
      className="mb-1 ml-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md text-faint hover:bg-surface-raised hover:text-text"
    >
      <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}
