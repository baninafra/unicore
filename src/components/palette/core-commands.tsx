"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useWorkspace, useRegisterCommands, type Command, type ViewState } from "@/lib/workspace";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { EDITOR_KINDS } from "@/lib/editors/editors";
import { openJoinDialog } from "@/components/share/share-dialog";
import { openScanner } from "@/components/scanner/scanner-app";
import { plainTextOf } from "@/components/notes/note-utils";
import { PromptModal } from "@/components/ui/prompt-modal";
import { LOOSE_FOLDER, type Note } from "@/lib/types";
import {
  addNote,
  bookmarkTargetFor,
  cloneBlocks,
  dailyBaseDate,
  insertBlocks,
  listTemplates,
  newCanvasForView,
  newOfficeForView,
  newNoteForView,
  openDailyNote,
  randomNoteId,
  runSafe,
  shiftDays,
  templateVars,
  toggleBookmark,
} from "@/lib/nav/actions";
import { FOCUS_SEARCH_EVENT, openPalette } from "@/lib/nav/palette-bus";
import { t } from "@/lib/i18n";

// Comandos base de la navegación. Se registran en la paleta (owner "nav").
export function CoreCommands() {
  const ws = useWorkspace();
  const { openTaskDialog } = useAppState();
  const [prompt, setPrompt] = useState<"saveWs" | "web" | null>(null);

  const go = (view: ViewState) => ws.openView(view);

  const cycleTab = (delta: number) => {
    const tabs = ws.activePane.tabs;
    const idx = tabs.findIndex((t) => t.id === ws.activePane.activeTabId);
    const next = tabs[(idx + delta + tabs.length) % tabs.length];
    ws.activateTab(ws.activePane.id, next.id);
  };

  const openDaily = (delta: number) =>
    runSafe(async () => {
      const base = await dailyBaseDate(ws.activeView);
      go({ type: "nota", id: await openDailyNote(shiftDays(base, delta)) });
    });

  const insertTemplate = (tpl: Note) =>
    runSafe(async () => {
      const now = new Date();
      const active = ws.activeView;
      if (active.type === "nota") {
        const current = await db.notes.get(active.id);
        insertBlocks(cloneBlocks(tpl.content, templateVars(now, current?.title || t("Sin título"))));
        return;
      }
      // Sin nota abierta: la plantilla se usa para una nota nueva.
      const blocks = cloneBlocks(tpl.content, templateVars(now, t("Sin título")));
      const id = await addNote(LOOSE_FOLDER, {
        content: blocks,
        plainTextCache: plainTextOf(blocks as Parameters<typeof plainTextOf>[0]),
      });
      go({ type: "nota", id });
    });

  const cmds: Command[] = [
    { id: "nota:nueva", name: t("Nueva nota"), hotkey: "Mod+N", run: () => runSafe(async () => go({ type: "nota", id: await newNoteForView(ws.activeView) })) },
    { id: "diario:hoy", name: t("Nota del día"), hotkey: "Alt+D", run: () => openDaily(0) },
    { id: "diario:anterior", name: t("Nota del día anterior"), run: () => openDaily(-1) },
    { id: "diario:siguiente", name: t("Nota del día siguiente"), run: () => openDaily(1) },
    {
      id: "plantilla:insertar",
      name: t("Insertar plantilla"),
      hotkey: "Alt+T",
      run: () =>
        runSafe(async () => {
          const templates = await listTemplates();
          openPalette({
            mode: "list",
            title: t("Insertar plantilla"),
            items: templates.map((t) => ({ id: t.id, label: t.title, run: () => insertTemplate(t) })),
          });
        }),
    },
    {
      id: "nota:azar",
      name: t("Nota al azar"),
      run: () =>
        runSafe(async () => {
          const id = await randomNoteId();
          if (id) go({ type: "nota", id });
        }),
    },
    {
      id: "nota:unica",
      name: t("Nota única"),
      run: () => runSafe(async () => go({ type: "nota", id: await addNote(LOOSE_FOLDER, { title: format(new Date(), "yyyyMMddHHmm") }) })),
    },
    {
      id: "busqueda:abrir",
      name: t("Buscar"),
      hotkey: "Mod+Shift+F",
      run: () => {
        ws.setLeft(true, "search");
        window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
      },
    },
    { id: "explorador:mostrar", name: t("Mostrar explorador"), hotkey: "Mod+Shift+E", run: () => ws.setLeft(true, "explorer") },
    { id: "panel:izquierdo", name: t("Mostrar u ocultar barra izquierda"), hotkey: "Mod+\\", run: () => ws.setLeft(!ws.leftOpen) },
    { id: "panel:derecho", name: t("Mostrar u ocultar panel derecho"), run: () => ws.setRight(!ws.rightOpen) },
    { id: "pestaña:cerrar", name: t("Cerrar pestaña"), hotkey: "Mod+W", run: () => ws.closeTab(ws.activePane.id, ws.activeTab.id) },
    { id: "pestaña:nueva", name: t("Nueva pestaña"), hotkey: "Mod+T", run: () => ws.openView({ type: "vacia" }, "tab") },
    { id: "pestaña:siguiente", name: t("Pestaña siguiente"), hotkey: "Mod+Tab", run: () => cycleTab(1) },
    { id: "pestaña:anterior", name: t("Pestaña anterior"), hotkey: "Mod+Shift+Tab", run: () => cycleTab(-1) },
    { id: "navegar:atras", name: t("Atrás"), hotkey: "Alt+ArrowLeft", run: () => ws.goBack() },
    { id: "navegar:adelante", name: t("Adelante"), hotkey: "Alt+ArrowRight", run: () => ws.goForward() },
    { id: "dividir:derecha", name: t("Dividir a la derecha"), run: () => ws.openView(ws.activeView, "split") },
    { id: "espacio:guardar", name: t("Guardar espacio de trabajo"), run: () => setPrompt("saveWs") },
    {
      id: "espacio:cargar",
      name: t("Cargar espacio de trabajo"),
      run: () =>
        openPalette({
          mode: "list",
          title: t("Cargar espacio de trabajo"),
          items: ws.savedWorkspaces.map((name) => ({ id: name, label: name, run: () => ws.loadWorkspace(name) })),
        }),
    },
    {
      id: "espacio:borrar",
      name: t("Borrar espacio de trabajo"),
      run: () =>
        openPalette({
          mode: "list",
          title: t("Borrar espacio de trabajo"),
          items: ws.savedWorkspaces.map((name) => ({ id: name, label: name, run: () => ws.deleteWorkspace(name) })),
        }),
    },
    { id: "ir:inicio", name: t("Ir a inicio"), run: () => go({ type: "inicio" }) },
    { id: "ir:calendario", name: t("Ir a calendario"), run: () => go({ type: "calendario" }) },
    { id: "ir:repaso", name: t("Ir a repaso"), run: () => go({ type: "repaso" }) },
    { id: "ir:carreras", name: t("Ir a mis carreras"), run: () => go({ type: "carreras" }) },
    { id: "ir:mails", name: t("Ir a mails"), run: () => go({ type: "mails" }) },
    { id: "ir:grafo", name: t("Ver grafo"), hotkey: "Mod+G", run: () => go({ type: "grafo" }) },
    { id: "ir:ajustes", name: t("Ajustes"), hotkey: "Mod+,", run: () => go({ type: "ajustes" }) },
    { id: "ir:base", name: t("Base de notas"), run: () => go({ type: "base" }) },
    { id: "web:abrir", name: t("Abrir página web"), run: () => setPrompt("web") },
    { id: "ia:abrir", name: t("Asistente IA"), hotkey: "Mod+J", run: () => ws.setRight(true, "ia") },
    { id: "tarea:nueva", name: t("Nueva tarea"), run: () => openTaskDialog() },
    { id: "canvas:nuevo", name: t("Nuevo lienzo"), run: () => runSafe(async () => go({ type: "canvas", id: await newCanvasForView(ws.activeView) })) },
    ...(["doc", "sheet", "deck", "geo"] as const).map((kind) => ({
      id: `editor:nuevo-${kind}`,
      name: EDITOR_KINDS[kind].newLabel,
      run: () => runSafe(async () => go({ type: "editor", id: await newOfficeForView(kind, ws.activeView) })),
    })),
    { id: "compartir:unirse", name: t("Unirse a una nota compartida"), run: () => openJoinDialog() },
    { id: "escaner:fotos", name: t("Escanear documento desde fotos"), run: () => openScanner(true) },
    {
      id: "marcador:alternar",
      name: t("Agregar o quitar marcador"),
      run: () =>
        runSafe(async () => {
          const target = await bookmarkTargetFor(ws.activeView);
          if (target) await toggleBookmark(target.kind, target.targetId, target.title);
        }),
    },
    { id: "paleta:abrir", name: t("Paleta de comandos"), hotkey: "Mod+P", run: () => openPalette({ mode: "commands" }) },
    { id: "selector:abrir", name: t("Ir a un archivo"), hotkey: "Mod+O", run: () => openPalette({ mode: "quick" }) },
  ];
  useRegisterCommands("nav", cmds);

  return (
    <>
      <PromptModal
        open={prompt === "saveWs"}
        title={t("Nombre del espacio")}
        confirmLabel={t("Guardar")}
        onConfirm={(name) => ws.saveWorkspace(name)}
        onClose={() => setPrompt(null)}
      />
      <PromptModal
        open={prompt === "web"}
        title={t("Abrir página web")}
        placeholder="https://"
        confirmLabel={t("Abrir")}
        onConfirm={(value) => go({ type: "web", url: /^https?:\/\//i.test(value) ? value : `https://${value}` })}
        onClose={() => setPrompt(null)}
      />
    </>
  );
}
