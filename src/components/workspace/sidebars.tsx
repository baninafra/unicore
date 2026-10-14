"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Bookmark, Files, Hash, Link2, ListTree, PanelRight, Search, Sparkles, SquareArrowOutUpRight, Table2, type LucideIcon } from "lucide-react";
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

export function RightSidebar() {
  const { rightOpen, rightView, setRight } = useWorkspace();
  const [width, setWidth] = useWidth("uc-right-width", 320, 240, 760);
  if (!rightOpen) return null;
  return (
    <aside className="relative flex flex-none flex-col border-l border-border bg-bg" style={{ width }}>
      <ResizeHandle side="right" width={width} onResize={setWidth} onReset={() => setWidth(320)} />
      <div className="flex h-9 flex-none items-center gap-0.5 px-2">
        {RIGHT.map((v) => (
          <PaneTab key={v.key} icon={v.icon} label={v.label} active={rightView === v.key} onClick={() => setRight(true, v.key)} />
        ))}
        <button
          aria-label="Cerrar panel derecho"
          title="Cerrar panel derecho"
          onClick={() => setRight(false)}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-surface-raised hover:text-text"
        >
          <PanelRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rightView === "ia" && <AIChatPane />}
        {rightView === "backlinks" && <BacklinksPane />}
        {rightView === "outgoing" && <OutgoingPane />}
        {rightView === "outline" && <OutlinePane />}
        {rightView === "tags" && <TagsPane />}
        {rightView === "properties" && <PropertiesPane />}
      </div>
    </aside>
  );
}

// Botón para abrir el panel derecho cuando está cerrado (arriba a la derecha).
export function RightToggle() {
  const { rightOpen, setRight } = useWorkspace();
  if (rightOpen) return null;
  return (
    <button
      aria-label="Abrir panel derecho"
      title="Abrir panel derecho"
      onClick={() => setRight(true)}
      className="mb-1 flex h-6 w-6 flex-none items-center justify-center self-end rounded-sm text-faint hover:bg-surface-raised hover:text-text"
    >
      <PanelRight className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  );
}
