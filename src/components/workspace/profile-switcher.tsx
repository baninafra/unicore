"use client";

import { Check, Plus, SlidersHorizontal } from "lucide-react";
import { t } from "@/lib/i18n";
import { GENERAL, PROFILES, useProfiles } from "@/lib/profiles";
import { useWorkspace } from "@/lib/workspace";
import { useContextMenu, type MenuItem } from "@/components/ui/menu";
import { openOnboarding } from "@/components/onboarding/onboarding";

// Perfil activo, abajo junto a Ajustes: un clic abre la lista para cambiar de perfil o crear otro.
export function ProfileSwitcher() {
  const { profiles, activeProfile, setActive } = useProfiles();
  const { openView } = useWorkspace();
  const { open, menu } = useContextMenu();

  const def = activeProfile ? PROFILES[activeProfile.kind] : GENERAL;
  const name = activeProfile?.name ?? (profiles.length > 1 ? t("Todos los perfiles") : (profiles[0]?.name ?? t("Mi espacio")));
  const sub = activeProfile ? def.label : profiles.length > 1 ? t("{n} perfiles", { n: profiles.length }) : t("Perfil");

  const items: MenuItem[] = [
    ...(profiles.length > 1
      ? [{ label: t("Todos los perfiles"), icon: activeProfile ? GENERAL.icon : Check, onSelect: () => setActive("todos") }]
      : []),
    ...profiles.map((p) => ({
      label: p.name,
      icon: activeProfile?.id === p.id ? Check : PROFILES[p.kind].icon,
      hint: PROFILES[p.kind].label,
      onSelect: () => setActive(p.id),
    })),
    { type: "separator" },
    { label: t("Nuevo perfil…"), icon: Plus, onSelect: () => openOnboarding("agregar") },
    { label: t("Administrar perfiles"), icon: SlidersHorizontal, onSelect: () => openView({ type: "ajustes", section: "perfiles" }) },
  ];

  return (
    <>
      <button
        type="button"
        aria-label={t("Perfil: {name}. Cambiar de perfil", { name })}
        title={`${name} · ${sub}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          open({ clientX: r.right + 6, clientY: r.top }, items);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-tint text-primary-soft hover:brightness-110"
      >
        <def.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </button>
      {menu}
    </>
  );
}
