"use client";

import clsx from "clsx";
import { CalendarDays, CalendarCheck, FolderOpen, GitFork, GraduationCap, Inbox, Layers, LayoutDashboard, PanelLeft, Settings, Terminal, type LucideIcon, Lightbulb, Bell } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { isDesktop, openDataFolder } from "@/lib/desktop";
import { useNotifications } from "@/lib/notifications";

function RibbonButton({ icon: Icon, label, onClick, active, badge }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; badge?: number }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-raised hover:text-text",
        active ? "text-primary-soft" : "text-faint",
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {!!badge && (
        <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose px-1 text-[10px] font-semibold leading-none text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

// Columna de íconos a la izquierda, como el "ribbon" de Obsidian.
export function Ribbon() {
  const { leftOpen, setLeft, openView, runCommand, activeView } = useWorkspace();
  const { unread } = useNotifications();
  return (
    <nav className="flex w-11 flex-none flex-col items-center gap-1 border-r border-border bg-bg py-2">
      <RibbonButton icon={PanelLeft} label="Mostrar u ocultar la barra lateral" onClick={() => setLeft(!leftOpen)} />
      <div className="my-1 h-px w-5 bg-border" />
      <RibbonButton icon={LayoutDashboard} label="Inicio" active={activeView.type === "inicio"} onClick={() => openView({ type: "inicio" })} />
      <RibbonButton
        icon={Bell}
        label={unread ? `Notificaciones (${unread})` : "Notificaciones"}
        badge={unread}
        active={activeView.type === "notificaciones"}
        onClick={() => openView({ type: "notificaciones" })}
      />
      <RibbonButton icon={CalendarCheck} label="Nota del día" onClick={() => runCommand("diario:hoy")} />
      <RibbonButton icon={CalendarDays} label="Calendario" active={activeView.type === "calendario"} onClick={() => openView({ type: "calendario" })} />
      <RibbonButton icon={GraduationCap} label="Mis carreras" active={activeView.type === "carreras"} onClick={() => openView({ type: "carreras" })} />
      <RibbonButton icon={Lightbulb} label="Ideas" active={activeView.type === "ideas"} onClick={() => openView({ type: "ideas" })} />
      <RibbonButton icon={Layers} label="Repaso" active={activeView.type === "repaso"} onClick={() => openView({ type: "repaso" })} />
      <RibbonButton icon={Inbox} label="Mails" active={activeView.type === "mails"} onClick={() => openView({ type: "mails" })} />
      <RibbonButton icon={GitFork} label="Grafo" active={activeView.type === "grafo"} onClick={() => openView({ type: "grafo" })} />
      <RibbonButton icon={Terminal} label="Comandos (Ctrl+P)" onClick={() => runCommand("paleta:abrir")} />
      <div className="mt-auto flex flex-col items-center gap-1">
        {isDesktop() && <RibbonButton icon={FolderOpen} label="Carpeta de datos" onClick={() => openDataFolder()} />}
        <RibbonButton icon={Settings} label="Ajustes" active={activeView.type === "ajustes"} onClick={() => openView({ type: "ajustes" })} />
      </div>
    </nav>
  );
}
