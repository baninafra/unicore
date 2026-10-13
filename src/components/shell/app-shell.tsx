"use client";

import { useEffect, useState } from "react";
import { AppStateProvider } from "@/lib/app-state";
import { AIProvider } from "@/lib/ai/ai-provider";
import { initDesktopStorage } from "@/lib/desktop";
import { seedIfEmpty } from "@/lib/seed";
import { LogoMark } from "@/components/ui/logo";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AIPanel } from "@/components/ai/ai-panel";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { SearchPalette } from "@/components/search/search-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  // En la app de escritorio primero se cargan los datos desde Documentos\UniCore.
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  useEffect(() => {
    initDesktopStorage()
      .then(() => seedIfEmpty())
      .catch((e) => {
        console.error(e);
        setLoadError("No pudimos abrir tu carpeta de datos. Cerrá la app y volvé a abrirla.");
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-muted">
        <LogoMark size={40} />
        <span className="t-small">Abriendo tus datos…</span>
      </div>
    );
  }

  return (
    <AppStateProvider>
      <AIProvider>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            {loadError && <div className="border-b border-border bg-rose-tint px-6 py-2 t-small text-rose">{loadError}</div>}
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </main>
        </div>
        <AIPanel />
        <TaskDialog />
        <SearchPalette />
      </AIProvider>
    </AppStateProvider>
  );
}
