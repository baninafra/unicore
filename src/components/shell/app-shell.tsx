"use client";

import { UpdateChecker } from "./update-checker";
import { FolderDialogHost } from "@/components/explorer/folder-dialog";
import { t } from "@/lib/i18n";
import { Fragment, useEffect, useRef, useState } from "react";
import { AppStateProvider, useAppState } from "@/lib/app-state";
import { AIProvider } from "@/lib/ai/ai-provider";
import { initDesktopStorage, startExternalSync } from "@/lib/desktop";
import { ProfileProvider } from "@/lib/profiles";
import { OnboardingHost } from "@/components/onboarding/onboarding";
import { useWorkspace, WorkspaceProvider, type Pane } from "@/lib/workspace";
import { LogoMark } from "@/components/ui/logo";
import { Ribbon } from "@/components/workspace/ribbon";
import { EditorApp } from "./editor-app";
import { JoinDialogHost } from "@/components/share/share-dialog";
import { FolderPicker } from "./folder-picker";
import { LeftSidebar, RightSidebar, RightToggle, useRailHidden } from "@/components/workspace/sidebars";
import { useWindowControls, WindowControls, WINDOW_CONTROLS_W } from "./window-controls";
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

function PaneView({ pane, active, last, grow }: { pane: Pane; active: boolean; last: boolean; grow: number }) {
  const { focusPane } = useWorkspace();
  const tab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
  // Con la barra derecha escondida, los botones de la ventana caen sobre esta barra: se les deja lugar.
  const controls = useWindowControls();
  const [railHidden] = useRailHidden();
  const reserve = controls && last && railHidden ? WINDOW_CONTROLS_W : 0;
  return (
    <section
      className="flex min-w-[160px] flex-col"
      style={{ flex: `${grow} 1 0` }}
      onMouseDownCapture={() => !active && focusPane(pane.id)}
    >
      <div data-tauri-drag-region className="flex items-end bg-bg pr-2" style={reserve ? { paddingRight: reserve - 4 } : undefined}>
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

// Barra entre dos pantallas divididas: se arrastra para agrandar una y achicar la otra (doble clic: mitad y mitad).
function PaneDivider({ index, sizes, setSizes }: { index: number; sizes: number[]; setSizes: (s: number[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      title={t("Arrastrá para cambiar el tamaño · doble clic para igualar")}
      onDoubleClick={() => setSizes(sizes.map(() => 1))}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        // Capturar el puntero: si pasa por encima de un editor (iframe), igual nos enteramos.
        el.setPointerCapture(e.pointerId);
        const left = el.previousElementSibling as HTMLElement | null;
        const right = el.nextElementSibling as HTMLElement | null;
        if (!left || !right) return;
        const startX = e.clientX;
        const lw = left.getBoundingClientRect().width;
        const rw = right.getBoundingClientRect().width;
        const pair = sizes[index - 1] + sizes[index];
        document.body.style.cursor = "col-resize";
        const move = (ev: PointerEvent) => {
          const nl = Math.min(lw + rw - 160, Math.max(160, lw + ev.clientX - startX));
          const next = [...sizes];
          next[index - 1] = (pair * nl) / (lw + rw);
          next[index] = pair - next[index - 1];
          setSizes(next);
        };
        const up = () => {
          document.body.style.cursor = "";
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("lostpointercapture", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("lostpointercapture", up);
      }}
      className="relative w-px flex-none cursor-col-resize bg-border after:absolute after:inset-y-0 after:-left-[3px] after:w-[7px] hover:bg-primary/60"
    />
  );
}

function Workspace({ notice }: { notice?: string }) {
  const { panes, activePaneId } = useWorkspace();
  // Proporción de cada pantalla dividida (se vuelve a igualar cuando cambia la cantidad).
  const [sizes, setSizes] = useState<number[]>([]);
  const fitted = sizes.length === panes.length ? sizes : panes.map(() => 1);
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <Ribbon />
        <LeftSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {notice && <div className="border-b border-border bg-rose-tint px-4 py-1.5 t-small text-rose">{notice}</div>}
          <div className="flex min-h-0 flex-1">
            {panes.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && <PaneDivider index={i} sizes={fitted} setSizes={setSizes} />}
                <PaneView pane={p} active={p.id === activePaneId} last={i === panes.length - 1} grow={fitted[i]} />
              </Fragment>
            ))}
          </div>
        </main>
        <RightSidebar />
      </div>
      <StatusBar />
      <EditorApp />
      <FolderPicker />
      <WindowControls />
      <JoinDialogHost />
    </div>
  );
}

export function AppShell() {
  // En la app de escritorio primero se cargan los datos desde Documentos\UniCore.
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    initDesktopStorage()
      // Se arranca vacío: el asistente de bienvenida hace las preguntas (y ofrece cargar datos de ejemplo).
      .then(() => startExternalSync())
      .catch((e) => {
        console.error(e);
        setLoadError(t("No pudimos abrir tu carpeta de datos. Cerrá la app y volvé a abrirla."));
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
      <ProfileProvider>
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
          <OnboardingHost />
          <FolderDialogHost />
          <UpdateChecker />
        </AIProvider>
      </WorkspaceProvider>
      </ProfileProvider>
    </AppStateProvider>
  );
}
