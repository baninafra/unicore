"use client";

// Espacio de trabajo estilo Obsidian: paneles con pestañas (se pueden dividir en dos),
// barra lateral izquierda y derecha con vistas intercambiables, comandos con atajos,
// elementos de la barra de estado y espacios de trabajo guardados.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";

// ---------- Vistas ----------

export type ViewState =
  | { type: "inicio" }
  | { type: "calendario" }
  | { type: "mails" }
  | { type: "repaso"; subjectId?: string }
  | { type: "carreras" }
  | { type: "materia"; id: string }
  | { type: "nota"; id: string }
  | { type: "grafo"; noteId?: string } // sin noteId = grafo global
  | { type: "canvas"; id: string }
  | { type: "pdf"; id: string; page?: number } // id de SubjectDocument; lector con resaltado
  | { type: "busqueda"; query?: string }
  | { type: "web"; url: string }
  | { type: "slides"; id: string }
  | { type: "editor"; id: string } // archivo de Word, Excel, PowerPoint o PDF en su editor
  | { type: "base" } // tabla de notas filtrable por propiedades (Bases)
  | { type: "ideas" } // ideas estilo Keep
  | { type: "plantillas" }
  | { type: "notificaciones" }
  | { type: "ajustes"; section?: string }
  | { type: "vacia" };

export type ViewType = ViewState["type"];

export function sameView(a: ViewState, b: ViewState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface Tab {
  id: string;
  view: ViewState;
  back: ViewState[];
  forward: ViewState[];
  pinned?: boolean;
}

export interface Pane {
  id: string;
  tabs: Tab[];
  activeTabId: string;
}

export type LeftView = "explorer" | "search" | "bookmarks";
export type RightView =
  | "ia"
  | "backlinks"
  | "outgoing"
  | "outline"
  | "tags"
  | "properties"
  // Herramientas
  | "calc"
  | "translate"
  | "plot"
  | "units"
  | "grades"
  | "bases";

export type OpenMode = "current" | "tab" | "split";

// Clic del medio: mientras corre `fn`, todo lo que se abra va a una pestaña nueva.
let forcedMode: OpenMode | null = null;
export function withOpenMode(mode: OpenMode, fn: () => void) {
  forcedMode = mode;
  try {
    fn();
  } finally {
    forcedMode = null;
  }
}
// Si durante el clic simulado se abrió algo (para saber si el clic del medio sirvió).
let openedDuringForce = false;
export function consumeOpened() {
  const v = openedDuringForce;
  openedDuringForce = false;
  return v;
}

// ---------- Comandos ----------

export interface Command {
  id: string;
  name: string; // "Abrir nota del día"
  hotkey?: string; // "Mod+Shift+D" (Mod = Ctrl en Windows)
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  run: () => void;
}

interface Layout {
  panes: Pane[];
  activePaneId: string;
  leftOpen: boolean;
  leftView: LeftView;
  rightOpen: boolean;
  rightView: RightView;
}

interface WorkspaceCtx extends Layout {
  activePane: Pane;
  activeTab: Tab;
  activeView: ViewState;
  openView: (view: ViewState, mode?: OpenMode) => void;
  closeTab: (paneId: string, tabId: string) => void;
  activateTab: (paneId: string, tabId: string) => void;
  focusPane: (paneId: string) => void;
  togglePin: (paneId: string, tabId: string) => void;
  goBack: () => void;
  goForward: () => void;
  moveTab: (paneId: string, from: number, to: number) => void;
  closePane: (paneId: string) => void;
  setLeft: (open: boolean, view?: LeftView) => void;
  setRight: (open: boolean, view?: RightView) => void;
  // Comandos
  commands: Command[];
  registerCommands: (owner: string, cmds: Command[]) => void;
  unregisterCommands: (owner: string) => void;
  runCommand: (id: string) => void;
  // Barra de estado
  statusItems: Record<string, React.ReactNode>;
  setStatusItem: (key: string, node: React.ReactNode | null) => void;
  // Espacios de trabajo guardados
  savedWorkspaces: string[];
  saveWorkspace: (name: string) => void;
  loadWorkspace: (name: string) => void;
  deleteWorkspace: (name: string) => void;
}

const Ctx = createContext<WorkspaceCtx | null>(null);

const LS_LAYOUT = "uc-layout";
const LS_SAVED = "uc-workspaces";

function newTab(view: ViewState): Tab {
  return { id: nanoid(8), view, back: [], forward: [] };
}

function defaultLayout(): Layout {
  const tab = newTab({ type: "inicio" });
  const pane: Pane = { id: nanoid(8), tabs: [tab], activeTabId: tab.id };
  return { panes: [pane], activePaneId: pane.id, leftOpen: true, leftView: "explorer", rightOpen: false, rightView: "ia" };
}

function readJSON<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}
function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function validLayout(l: Layout | undefined): l is Layout {
  return !!l && Array.isArray(l.panes) && l.panes.length > 0 && l.panes.every((p) => p.tabs.length > 0);
}

// "Mod+Shift+P" contra un KeyboardEvent
function matchesHotkey(hotkey: string, e: KeyboardEvent) {
  const parts = hotkey.toLowerCase().split("+");
  const key = parts.pop()!;
  const mod = parts.includes("mod") || parts.includes("ctrl");
  if (mod !== (e.ctrlKey || e.metaKey)) return false;
  if (parts.includes("shift") !== e.shiftKey) return false;
  if (parts.includes("alt") !== e.altKey) return false;
  const k = e.key.toLowerCase();
  return k === key || (key === "tab" && k === "tab") || e.code.toLowerCase() === `key${key}` || e.code.toLowerCase() === `digit${key}`;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [layout, setLayout] = useState<Layout>(defaultLayout);
  const [loaded, setLoaded] = useState(false);
  const [commandMap, setCommandMap] = useState<Record<string, Command[]>>({});
  const [statusItems, setStatusItems] = useState<Record<string, React.ReactNode>>({});
  const [saved, setSaved] = useState<Record<string, Layout>>({});

  useEffect(() => {
    const l = readJSON<Layout>(LS_LAYOUT);
    if (validLayout(l)) setLayout(l);
    setSaved(readJSON<Record<string, Layout>>(LS_SAVED) ?? {});
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) writeJSON(LS_LAYOUT, layout);
  }, [layout, loaded]);

  const activePane = layout.panes.find((p) => p.id === layout.activePaneId) ?? layout.panes[0];
  const activeTab = activePane.tabs.find((t) => t.id === activePane.activeTabId) ?? activePane.tabs[0];

  const updatePane = useCallback((paneId: string, fn: (p: Pane) => Pane) => {
    setLayout((l) => ({ ...l, panes: l.panes.map((p) => (p.id === paneId ? fn(p) : p)) }));
  }, []);

  const openView = useCallback((view: ViewState, requested: OpenMode = "current") => {
    const mode = forcedMode && requested === "current" ? forcedMode : requested;
    if (forcedMode) openedDuringForce = true;
    setLayout((l) => {
      const pane = l.panes.find((p) => p.id === l.activePaneId) ?? l.panes[0];
      if (mode === "split") {
        const tab = newTab(view);
        if (l.panes.length >= 2) {
          const other = l.panes.find((p) => p.id !== pane.id)!;
          return {
            ...l,
            activePaneId: other.id,
            panes: l.panes.map((p) => (p.id === other.id ? { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id } : p)),
          };
        }
        const newPane: Pane = { id: nanoid(8), tabs: [tab], activeTabId: tab.id };
        return { ...l, panes: [...l.panes, newPane], activePaneId: newPane.id };
      }
      // Si la vista ya está abierta en una pestaña de este panel, la activamos.
      const existing = pane.tabs.find((t) => sameView(t.view, view));
      if (existing) return { ...l, panes: l.panes.map((p) => (p.id === pane.id ? { ...p, activeTabId: existing.id } : p)) };
      const current = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0];
      if (mode === "tab" || current.pinned) {
        const tab = newTab(view);
        const idx = pane.tabs.findIndex((t) => t.id === current.id);
        const tabs = [...pane.tabs.slice(0, idx + 1), tab, ...pane.tabs.slice(idx + 1)];
        return { ...l, panes: l.panes.map((p) => (p.id === pane.id ? { ...p, tabs, activeTabId: tab.id } : p)) };
      }
      const updated: Tab = { ...current, view, back: [...current.back, current.view].slice(-50), forward: [] };
      return {
        ...l,
        panes: l.panes.map((p) => (p.id === pane.id ? { ...p, tabs: p.tabs.map((t) => (t.id === current.id ? updated : t)) } : p)),
      };
    });
  }, []);

  const closeTab = useCallback((paneId: string, tabId: string) => {
    setLayout((l) => {
      const pane = l.panes.find((p) => p.id === paneId);
      if (!pane) return l;
      const idx = pane.tabs.findIndex((t) => t.id === tabId);
      const tabs = pane.tabs.filter((t) => t.id !== tabId);
      if (tabs.length === 0) {
        if (l.panes.length > 1) {
          const panes = l.panes.filter((p) => p.id !== paneId);
          return { ...l, panes, activePaneId: panes[0].id };
        }
        const tab = newTab({ type: "vacia" });
        return { ...l, panes: [{ ...pane, tabs: [tab], activeTabId: tab.id }] };
      }
      const activeTabId = pane.activeTabId === tabId ? tabs[Math.max(0, idx - 1)].id : pane.activeTabId;
      return { ...l, panes: l.panes.map((p) => (p.id === paneId ? { ...p, tabs, activeTabId } : p)) };
    });
  }, []);

  const activateTab = useCallback((paneId: string, tabId: string) => {
    setLayout((l) => ({ ...l, activePaneId: paneId, panes: l.panes.map((p) => (p.id === paneId ? { ...p, activeTabId: tabId } : p)) }));
  }, []);

  const focusPane = useCallback((paneId: string) => {
    setLayout((l) => (l.activePaneId === paneId ? l : { ...l, activePaneId: paneId }));
  }, []);

  const togglePin = useCallback(
    (paneId: string, tabId: string) =>
      updatePane(paneId, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)) })),
    [updatePane],
  );

  const navigate = useCallback((dir: "back" | "forward") => {
    setLayout((l) => {
      const pane = l.panes.find((p) => p.id === l.activePaneId) ?? l.panes[0];
      const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
      if (!tab) return l;
      const stack = dir === "back" ? tab.back : tab.forward;
      if (!stack.length) return l;
      const target = stack[stack.length - 1];
      const updated: Tab =
        dir === "back"
          ? { ...tab, view: target, back: tab.back.slice(0, -1), forward: [...tab.forward, tab.view] }
          : { ...tab, view: target, forward: tab.forward.slice(0, -1), back: [...tab.back, tab.view] };
      return { ...l, panes: l.panes.map((p) => (p.id === pane.id ? { ...p, tabs: p.tabs.map((t) => (t.id === tab.id ? updated : t)) } : p)) };
    });
  }, []);

  const moveTab = useCallback(
    (paneId: string, from: number, to: number) =>
      updatePane(paneId, (p) => {
        const tabs = [...p.tabs];
        const [t] = tabs.splice(from, 1);
        tabs.splice(to, 0, t);
        return { ...p, tabs };
      }),
    [updatePane],
  );

  const closePane = useCallback((paneId: string) => {
    setLayout((l) => {
      if (l.panes.length < 2) return l;
      const panes = l.panes.filter((p) => p.id !== paneId);
      return { ...l, panes, activePaneId: panes[0].id };
    });
  }, []);

  const setLeft = useCallback((open: boolean, view?: LeftView) => {
    setLayout((l) => ({ ...l, leftOpen: open, leftView: view ?? l.leftView }));
  }, []);
  const setRight = useCallback((open: boolean, view?: RightView) => {
    setLayout((l) => ({ ...l, rightOpen: open, rightView: view ?? l.rightView }));
  }, []);

  // ----- comandos -----
  const registerCommands = useCallback((owner: string, cmds: Command[]) => {
    setCommandMap((m) => ({ ...m, [owner]: cmds }));
  }, []);
  const unregisterCommands = useCallback((owner: string) => {
    setCommandMap((m) => {
      const next = { ...m };
      delete next[owner];
      return next;
    });
  }, []);
  const commands = useMemo(() => Object.values(commandMap).flat(), [commandMap]);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const runCommand = useCallback((id: string) => commandsRef.current.find((c) => c.id === id)?.run(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      const cmd = commandsRef.current.find((c) => c.hotkey && matchesHotkey(c.hotkey, e));
      if (cmd) {
        e.preventDefault();
        cmd.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setStatusItem = useCallback((key: string, node: React.ReactNode | null) => {
    setStatusItems((s) => {
      if (node === null) {
        if (!(key in s)) return s;
        const next = { ...s };
        delete next[key];
        return next;
      }
      return { ...s, [key]: node };
    });
  }, []);

  // ----- espacios de trabajo -----
  const saveWorkspace = useCallback(
    (name: string) => {
      setSaved((s) => {
        const next = { ...s, [name]: layout };
        writeJSON(LS_SAVED, next);
        return next;
      });
    },
    [layout],
  );
  const loadWorkspace = useCallback(
    (name: string) => {
      const l = saved[name];
      if (validLayout(l)) setLayout(l);
    },
    [saved],
  );
  const deleteWorkspace = useCallback((name: string) => {
    setSaved((s) => {
      const next = { ...s };
      delete next[name];
      writeJSON(LS_SAVED, next);
      return next;
    });
  }, []);

  const value: WorkspaceCtx = {
    ...layout,
    activePane,
    activeTab,
    activeView: activeTab.view,
    openView,
    closeTab,
    activateTab,
    focusPane,
    togglePin,
    goBack: () => navigate("back"),
    goForward: () => navigate("forward"),
    moveTab,
    closePane,
    setLeft,
    setRight,
    commands,
    registerCommands,
    unregisterCommands,
    runCommand,
    statusItems,
    setStatusItem,
    savedWorkspaces: Object.keys(saved),
    saveWorkspace,
    loadWorkspace,
    deleteWorkspace,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace tiene que usarse dentro de <WorkspaceProvider>");
  return ctx;
}

// Registra comandos mientras el componente está montado. `owner` tiene que ser único.
export function useRegisterCommands(owner: string, cmds: Command[]) {
  const { registerCommands, unregisterCommands } = useWorkspace();
  const key = cmds.map((c) => `${c.id}:${c.name}:${c.hotkey ?? ""}`).join("|");
  const ref = useRef(cmds);
  ref.current = cmds;
  useEffect(() => {
    // Envolvemos run para usar siempre la última versión del callback.
    registerCommands(
      owner,
      ref.current.map((c) => ({ ...c, run: () => ref.current.find((x) => x.id === c.id)?.run() })),
    );
    return () => unregisterCommands(owner);
  }, [owner, key, registerCommands, unregisterCommands]);
}

// Muestra algo en la barra de estado mientras el componente está montado.
export function useStatusItem(key: string, node: React.ReactNode | null) {
  const { setStatusItem } = useWorkspace();
  useEffect(() => {
    setStatusItem(key, node);
  }, [key, node, setStatusItem]);
  useEffect(() => () => setStatusItem(key, null), [key, setStatusItem]);
}
