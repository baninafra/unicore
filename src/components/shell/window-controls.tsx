"use client";

// Botones de la ventana (minimizar, maximizar, cerrar) dentro de la app: la barra de título de Windows está escondida.
// Van fijos arriba a la derecha; las barras que quedan debajo dejan ese lugar libre (WINDOW_CONTROLS_W).

import { useEffect, useState } from "react";
import { isDesktop } from "@/lib/desktop";
import { useWorkspace } from "@/lib/workspace";
import { useRailHidden } from "@/components/workspace/sidebars";

export const WINDOW_CONTROLS_W = 214; // dividir, barra derecha y 3 botones de la ventana, de 40 px (con sus márgenes)

async function appWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

// En la app de escritorio, si hay que dejar lugar para los botones.
export function useWindowControls() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(isDesktop()), []);
  return on;
}

// Todos los íconos de arriba a la derecha (dividir, barra derecha y ventana) salen de acá:
// mismo tamaño (12 px), misma línea y misma altura que los botones de la barra de pestañas.
export function TopGlyph({ d }: { d: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
export const GLYPH = {
  split: "M1.5 1.5h9v9h-9z M6 1.5v9",
  panelOpen: "M1.5 1.5h9v9h-9z M7.5 1.5v9",
  panelClosed: "M1.5 1.5h9v9h-9z M7.5 1.5v9 M5 4.5l-1.5 1.5 1.5 1.5",
  minimize: "M1.5 6h9",
  maximize: "M1.5 1.5h9v9h-9z",
  restore: "M1.5 3.5h7v7h-7z M3.5 3.5v-2h7v7h-2",
  close: "M2 2l8 8M10 2l-8 8",
};
export const TOP_BTN = "flex h-7 w-10 flex-none items-center justify-center rounded-md text-faint hover:bg-surface-raised hover:text-text";

export function WindowControls() {
  const on = useWindowControls();
  const [maximized, setMaximized] = useState(false);
  const [railHidden, setRailHidden] = useRailHidden();
  const { setRight, openView, activeView, panes } = useWorkspace();

  useEffect(() => {
    if (!on) return;
    let unlisten: (() => void) | undefined;
    void appWindow().then(async (w) => {
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => unlisten?.();
  }, [on]);

  if (!on) return null;
  return (
    // Misma altura que la barra de pestañas (h-10) y los botones apoyados igual que los de las pestañas (mb-1).
    <div className="fixed right-0 top-0 z-50 flex h-10 items-end gap-0.5 bg-bg pb-1 pr-1.5">
      {panes.length === 1 && (
        <button aria-label="Dividir a la derecha" title="Dividir a la derecha" className={TOP_BTN} onClick={() => openView(activeView, "split")}>
          <TopGlyph d={GLYPH.split} />
        </button>
      )}
      {/* Mostrar y esconder la barra derecha: siempre en el mismo lugar. Al mostrarla vuelve al panel que estaba. */}
      <button
        aria-label={railHidden ? "Mostrar la barra derecha" : "Esconder la barra derecha"}
        title={railHidden ? "Mostrar la barra derecha" : "Esconder la barra derecha"}
        className={TOP_BTN}
        onClick={() => {
          if (railHidden) {
            setRailHidden(false);
            setRight(true);
          } else {
            setRight(false);
            setRailHidden(true);
          }
        }}
      >
        <TopGlyph d={railHidden ? GLYPH.panelClosed : GLYPH.panelOpen} />
      </button>
      <button aria-label="Minimizar" title="Minimizar" className={TOP_BTN} onClick={() => void appWindow().then((w) => w.minimize())}>
        <TopGlyph d={GLYPH.minimize} />
      </button>
      <button
        aria-label={maximized ? "Restaurar" : "Maximizar"}
        title={maximized ? "Restaurar" : "Maximizar"}
        className={TOP_BTN}
        onClick={() => void appWindow().then((w) => w.toggleMaximize())}
      >
        <TopGlyph d={maximized ? GLYPH.restore : GLYPH.maximize} />
      </button>
      <button aria-label="Cerrar" title="Cerrar" className={`${TOP_BTN} hover:!bg-[#c42b1c] hover:!text-white`} onClick={() => void appWindow().then((w) => w.close())}>
        <TopGlyph d={GLYPH.close} />
      </button>
    </div>
  );
}
