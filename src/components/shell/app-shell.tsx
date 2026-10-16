"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { AppStateProvider, useAppState } from "@/lib/app-state";
import { AIProvider } from "@/lib/ai/ai-provider";
import { initDesktopStorage, startExternalSync } from "@/lib/desktop";
import { seedIfEmpty } from "@/lib/seed";
import { useWorkspace, WorkspaceProvider, type Pane } from "@/lib/workspace";
import { LogoMark } from "@/components/ui/logo";
import { Ribbon } from "@/components/workspace/ribbon";
import { EditorApp } from "./editor-app";
import { ScannerApp } from "@/components/scanner/scanner-app";
import { FolderPicker } from "./folder-picker";
import { LeftSidebar, RightSidebar, RightToggle } from "@/components/workspace/sidebars";
import { TabBar } from "@/components/workspace/tab-bar";
import { ViewHost } from "@/components/workspace/view-host";
import { StatusBar } from "@/components/workspace/status-bar";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { CommandPalette } from "@/components/palette/command-palette";
import { ExportCommands } from "@/components/export/export-commands";
import { ApplySettings } from "@/components/settings/apply-settings";
import { CalendarSync } from "@/components/calendar/calendar-sync";
import { EventDialogHost } from "@/components/calendar/event-dialog";
import { EventReminders } from "@/components/calendar/event-reminders";
import { Toaster } from "@/components/ui/toaster";
import { GlobalMouse } from "./global-mouse";
import { GlobalFiles } from "./global-files";

function PaneView({ pane, active, last }: { pane: Pane; active: boolean; last: boolean }) {
  const { focusPane } = useWorkspace();
  const tab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
  return (
    <section
      className={clsx("flex min-w-0 flex-1 flex-col", !last && "border-r border-border")}
      onMouseDownCapture={() => !active && focusPane(pane.id)}
    >
      <div className="flex items-end bg-bg pr-2">
        <div className="min-w-0 flex-1">
          <TabBar pane={pane} isActivePane={active} />
        </div>
        {last && <RightToggle />}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <ViewHost view={tab.view} />
      </div>
    </section>
  );
}

// El viejo "abrir IA" (Ctrl+J y botones) ahora abre la IA en el panel derecho.
function AIBridge() {
  const { aiOpen, setAiOpen } = useAppState();
  const { setRight } = useWorkspace();
  useEffect(() => {
    if (aiOpen) {
      setRight(true, "ia");
      setAiOpen(false);
    }
  }, [aiOpen, setAiOpen, setRight]);
  return null;
}

function Workspace({ notice }: { notice?: string }) {
  const { panes, activePaneId } = useWorkspace();
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <Ribbon />
        <LeftSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {notice && <div className="border-b border-border bg-rose-tint px-4 py-1.5 t-small text-rose">{notice}</div>}
          <div className="flex min-h-0 flex-1">
            {panes.map((p, i) => (
              <PaneView key={p.id} pane={p} active={p.id === activePaneId} last={i === panes.length - 1} />
            ))}
          </div>
        </main>
        <RightSidebar />
      </div>
      <StatusBar />
      <EditorApp />
      <ScannerApp />
      <FolderPicker />
    </div>
  );
}

export function AppShell() {
  // En la app de escritorio primero se cargan los datos desde Documentos\UniCore.
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    initDesktopStorage()
      .then(() => seedIfEmpty())
      .then(() => startExternalSync())
      .catch((e) => {
        console.error(e);
        setLoadError("No pudimos abrir tu carpeta de datos. Cerrá la app y volvé a abrirla.");
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg">
        <LogoMark size={40} />
      </div>
    );
  }

  return (
    <AppStateProvider>
      <WorkspaceProvider>
        <AIProvider>
          <AIBridge />
          <Workspace notice={loadError} />
          <TaskDialog />
          <CommandPalette />
          <ExportCommands />
          <ApplySettings />
          <CalendarSync />
          <EventReminders />
          <EventDialogHost />
          <Toaster />
          <GlobalMouse />
          <GlobalFiles />
        </AIProvider>
      </WorkspaceProvider>
    </AppStateProvider>
  );
}
