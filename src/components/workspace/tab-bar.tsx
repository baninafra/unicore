"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowRight, Columns2, Pin, Plus, X } from "lucide-react";
import { useWorkspace, type Pane, type Tab } from "@/lib/workspace";
import { useViewTitle } from "./view-title";

function TabButton({ pane, tab, active }: { pane: Pane; tab: Tab; active: boolean }) {
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
        "group relative flex h-[30px] min-w-0 max-w-[200px] flex-1 basis-[160px] cursor-default items-center gap-1.5 rounded-t-md px-2.5 text-[13px]",
        active ? "bg-surface text-text" : "text-muted hover:bg-surface-raised/60 hover:text-text",
      )}
    >
      {tab.pinned && <Pin className="h-3 w-3 flex-none text-faint" strokeWidth={1.75} />}
      <span className="truncate">{title}</span>
      {!tab.pinned && (
        <button
          aria-label="Cerrar pestaña"
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
  const canNav = isActivePane && activeTab;
  return (
    <div className="flex h-10 flex-none items-end gap-0.5 bg-bg px-1.5" onMouseDown={() => focusPane(pane.id)}>
      <div className="mb-1 flex flex-none items-center">
        <button
          className="flex h-7 w-7 items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text disabled:opacity-40"
          aria-label="Atrás"
          disabled={!canNav || !current?.back.length}
          onClick={goBack}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          className="flex h-7 w-7 items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text disabled:opacity-40"
          aria-label="Adelante"
          disabled={!canNav || !current?.forward.length}
          onClick={goForward}
        >
          <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <div role="tablist" className="flex min-w-0 flex-1 items-end gap-0.5 overflow-hidden">
        {pane.tabs.map((t) => (
          <TabButton key={t.id} pane={pane} tab={t} active={t.id === pane.activeTabId} />
        ))}
        <button
          aria-label="Nueva pestaña"
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
            aria-label="Cerrar panel"
            title="Cerrar panel"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text"
            onClick={() => closePane(pane.id)}
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            aria-label="Dividir a la derecha"
            title="Dividir a la derecha"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-faint hover:bg-surface-raised hover:text-text"
            onClick={() => current && openView(current.view, "split")}
          >
            <Columns2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  );
}
