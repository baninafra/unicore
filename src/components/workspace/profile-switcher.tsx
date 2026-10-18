"use client";

import { Check, ChevronsUpDown, Plus, SlidersHorizontal } from "lucide-react";
import { GENERAL, PROFILES, useProfiles } from "@/lib/profiles";
import { useWorkspace } from "@/lib/workspace";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { openOnboarding } from "@/components/onboarding/onboarding";

// Perfil activo, arriba de Archivos: un clic abre la lista para cambiar de perfil o crear otro.
export function ProfileSwitcher() {
  const { profiles, activeProfile, setActive } = useProfiles();
  const { openView } = useWorkspace();
  const { open, menu } = useContextMenu();

  const def = activeProfile ? PROFILES[activeProfile.kind] : GENERAL;
  const name = activeProfile?.name ?? (profiles.length > 1 ? "Todos los perfiles" : (profiles[0]?.name ?? "Mi espacio"));
  const sub = activeProfile ? def.label : profiles.length > 1 ? `${profiles.length} perfiles` : "Perfil";

  const items: MenuItem[] = [
    ...(profiles.length > 1
      ? [{ label: "Todos los perfiles", icon: activeProfile ? GENERAL.icon : Check, onSelect: () => setActive("todos") }]
      : []),
    ...profiles.map((p) => ({
      label: p.name,
      icon: activeProfile?.id === p.id ? Check : PROFILES[p.kind].icon,
      hint: PROFILES[p.kind].label,
      onSelect: () => setActive(p.id),
    })),
    { type: "separator" },
    { label: "Nuevo perfil…", icon: Plus, onSelect: () => openOnboarding("agregar") },
    { label: "Administrar perfiles", icon: SlidersHorizontal, onSelect: () => openView({ type: "ajustes", section: "perfiles" }) },
  ];

  return (
    <div className="flex-none px-2 pt-2">
      <button
        type="button"
        aria-label={`Perfil: ${name}. Cambiar de perfil`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          open({ clientX: r.left, clientY: r.bottom + 4 }, items);
        }}
        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-left hover:border-border-strong hover:bg-surface-raised"
      >
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-primary-tint text-primary-soft">
          <def.icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="t-small truncate font-medium text-text">{name}</span>
          <span className="truncate text-[length:calc(11px*var(--ui-scale,1))] text-faint">{sub}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 flex-none text-faint" strokeWidth={1.75} />
      </button>
      {menu}
    </div>
  );
}
