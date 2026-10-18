"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowRight, Pin, Plus, X } from "lucide-react";
import { GLYPH, TOP_BTN, TopGlyph, useWindowControls } from "@/components/shell/window-controls";
import { useWorkspace, type Pane, type Tab } from "@/lib/workspace";
import { useViewTitle } from "./view-title";
import { t } from "@/lib/i18n";

function TabButton({ pane, tab, active, divider }: { pane: Pane; tab: Tab; active: boolean; divider: boolean }) {
  const { activateTab, closeTab, togglePin } = useWorkspace();
  const title = useViewTitle(tab.view);
  return (
    <div
      role="tab"
      aria-selected={active}
      title={title}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(pane.id, tab.id);
        } else activateTab(pane.id, tab.id);
      }}
      onDoubleClick={() => togglePin(pane.id, tab.id)}
      className={clsx(
        "group relative flex h-[30px] min-w-0 max-w-[200px] flex-1 basis-[160px] cursor-default items-center gap-1.5 rounded-t-md px-2.5 text-[length:calc(13px*var(--ui-scale,1))]",
        active ? "bg-surface text-text" : "text-muted hover:bg-surface-raised/60 hover:text-text",
        // Como en Chrome: una rayita entre pestañas inactivas (no al lado de la activa ni de la que tiene el mouse).
        divider && "after:pointer-events-none after:absolute after:-right-px after:top-1/2 after:h-4 after:w-px after:-translate-y-1/2 after:bg-border-strong hover:after:opacity-0",
      )}
    >
      {tab.pinned && <Pin className="h-3 w-3 flex-none text-faint" strokeWidth={1.75} />}
      <span className="truncate">{title}</span>
      {!tab.pinned && (
        <button
          aria-label={t("Cerrar pestaña")}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => closeTab(pane.id, tab.id)}
          className={clsx(
            "ml-auto flex h-4 w-4 flex-none items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

export function TabBar({ pane, isActivePane }: { pane: Pane; isActivePane: boolean }) {
  const { openView, goBack, goForward, activeTab, panes, closePane, focusPane } = useWorkspace();
  const current = pane.tabs.find((t) => t.id === pane.activeTabId);
  // En la app de escritorio "Dividir" está arriba a la derecha, junto a los botones de la ventana.
  const controls = useWindowControls();
  const canNav = isActivePane && activeTab;
  return (
    <div data-tauri-drag-region className="flex h-10 flex-none items-end gap-0.5 bg-bg px-1.5" onMouseDown={() => focusPane(pane.id)}>
      <div className="mb-1 flex flex-none items-center">
        <button
          className="flex h-7 w-7 items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text disabled:opacity-40"
          aria-label={t("Atrás")}
          disabled={!canNav || !current?.back.length}
          onClick={goBack}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text disabled:opacity-40"
          aria-label={t("Adelante")}
          disabled={!canNav || !current?.forward.length}
          onClick={goForward}
        >
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div role="tablist" data-tauri-drag-region className="flex min-w-0 flex-1 items-end gap-0.5 overflow-hidden">
        {pane.tabs.map((t, i) => {
          const next = pane.tabs[i + 1];
          const active = t.id === pane.activeTabId;
          return <TabButton key={t.id} pane={pane} tab={t} active={active} divider={!active && !!next && next.id !== pane.activeTabId} />;
        })}
        <button
          aria-label={t("Nueva pestaña")}
          className="mb-1 flex h-7 w-7 flex-none items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text"
          onClick={() => {
            focusPane(pane.id);
            openView({ type: "vacia" }, "tab");
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div className="mb-1 flex flex-none items-center">
        {panes.length > 1 ? (
          <button
            aria-label={t("Cerrar panel")}
            title={t("Cerrar panel")}
            className="flex h-7 w-7 items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text"
            onClick={() => closePane(pane.id)}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : controls ? null : (
          <button
            aria-label={t("Dividir a la derecha")}
            title={t("Dividir a la derecha")}
            className={TOP_BTN}
            onClick={() => current && openView(current.view, "split")}
          >
            <TopGlyph d={GLYPH.split} />
          </button>
        )}
      </div>
    </div>
  );
}
