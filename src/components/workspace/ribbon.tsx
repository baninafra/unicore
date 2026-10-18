"use client";

import clsx from "clsx";
import { CalendarDays, CalendarCheck, FolderOpen, GitFork, Inbox, Layers, LayoutDashboard, PanelLeft, Settings, Terminal, UserPlus, type LucideIcon, Lightbulb, Bell, LayoutTemplate } from "lucide-react";
import { useWorkspace, type ViewState } from "@/lib/workspace";
import { useOrder, useReorderDrag } from "./reorder";
import { isDesktop, openDataFolder } from "@/lib/desktop";
import { useNotifications } from "@/lib/notifications";
import { DraftingCompass, FileSpreadsheet, FileText, FileType, Presentation } from "lucide-react";
import { EDITOR_KINDS } from "@/lib/editors/editors";
import { openEditorApp } from "@/components/shell/editor-app";
import { openJoinDialog } from "@/components/share/share-dialog";
import { PROFILES, useProfiles } from "@/lib/profiles";
import { ProfileSwitcher } from "./profile-switcher";

// El PDF no se crea vacío: se elige uno del equipo y se abre en el editor.
function pickPdf(onPick: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,application/pdf";
  input.onchange = () => input.files?.[0] && onPick(input.files[0]);
  input.click();
}

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
        <span className="num absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose px-1 text-[length:calc(10px*var(--ui-scale,1))] font-semibold leading-none text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

type Item = { id: string; node: React.ReactNode };

// Un grupo de íconos que se reordena manteniendo apretado y arrastrando.
function Group({ group, items }: { group: string; items: Item[] }) {
  const [order, move] = useOrder(`uc-order-${group}`, items.map((i) => i.id));
  const { dragging, bind } = useReorderDrag(group, move);
  return (
    <>
      {order.map((id) => (
        <div key={id} {...bind(id)} className={clsx("rounded-md", dragging === id && "bg-surface-raised opacity-70 ring-1 ring-primary")}>
          {items.find((i) => i.id === id)!.node}
        </div>
      ))}
    </>
  );
}

// Columna de íconos a la izquierda, como el "ribbon" de Obsidian.
export function Ribbon() {
  const { leftOpen, setLeft, openView, runCommand, activeView } = useWorkspace();
  const { unread } = useNotifications();
  const { terms, activeKinds } = useProfiles();
  const studying = activeKinds.some((k) => PROFILES[k].study);
  const view = (type: string, icon: LucideIcon, label: string): Item => ({
    id: type,
    node: <RibbonButton icon={icon} label={label} active={activeView.type === type} onClick={() => openView({ type } as ViewState)} />,
  });
  const views: Item[] = [
    view("inicio", LayoutDashboard, "Inicio"),
    {
      id: "notificaciones",
      node: (
        <RibbonButton
          icon={Bell}
          label={unread ? `Notificaciones (${unread})` : "Notificaciones"}
          badge={unread}
          active={activeView.type === "notificaciones"}
          onClick={() => openView({ type: "notificaciones" })}
        />
      ),
    },
    { id: "diario", node: <RibbonButton icon={CalendarCheck} label="Nota del día" onClick={() => runCommand("diario:hoy")} /> },
    view("calendario", CalendarDays, "Calendario"),
    view("carreras", terms.spaceIcon, terms.spacesView),
    view("plantillas", LayoutTemplate, "Plantillas"),
    view("ideas", Lightbulb, "Ideas"),
    ...(studying ? [view("repaso", Layers, "Repaso")] : []),
    view("mails", Inbox, "Mails"),
    view("grafo", GitFork, "Grafo"),
    { id: "unirse", node: <RibbonButton icon={UserPlus} label="Unirse a una nota compartida" onClick={openJoinDialog} /> },
    { id: "paleta", node: <RibbonButton icon={Terminal} label="Comandos (Ctrl+P)" onClick={() => runCommand("paleta:abrir")} /> },
  ];
  const editors: Item[] = [
    ...([
      ["doc", FileText],
      ["sheet", FileSpreadsheet],
      ["deck", Presentation],
      ["geo", DraftingCompass],
    ] as const).map(([kind, icon]) => ({
      id: kind,
      node: <RibbonButton icon={icon} label={EDITOR_KINDS[kind].label} onClick={() => openEditorApp(kind)} />,
    })),
    { id: "pdf", node: <RibbonButton icon={FileType} label="PDF" onClick={() => pickPdf((file) => openEditorApp("pdf", file))} /> },
  ];
  return (
    <nav className="flex w-11 flex-none flex-col items-center gap-1 border-r border-border bg-bg py-2">
      <RibbonButton icon={PanelLeft} label="Mostrar u ocultar la barra lateral" onClick={() => setLeft(!leftOpen)} />
      <div className="my-1 h-px w-5 bg-border" />
      <Group group="ribbon-views" items={views} />
      <div className="my-1 h-px w-5 bg-border" />
      <ProfileSwitcher />
      <div className="my-1 h-px w-5 bg-border" />
      <Group group="ribbon-editors" items={editors} />
      <div className="mt-auto flex flex-col items-center gap-1">
        {isDesktop() && <RibbonButton icon={FolderOpen} label="Carpeta de datos" onClick={() => openDataFolder()} />}
        <RibbonButton icon={Settings} label="Ajustes" active={activeView.type === "ajustes"} onClick={() => openView({ type: "ajustes" })} />
      </div>
    </nav>
  );
}
