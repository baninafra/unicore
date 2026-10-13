"use client";

import { useEffect } from "react";
import { AppStateProvider } from "@/lib/app-state";
import { AIProvider } from "@/lib/ai/ai-provider";
import { seedIfEmpty } from "@/lib/seed";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { AIPanel } from "@/components/ai/ai-panel";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { SearchPalette } from "@/components/search/search-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    seedIfEmpty().catch(console.error);
  }, []);

  return (
    <AppStateProvider>
      <AIProvider>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Topbar />
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
