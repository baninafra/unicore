"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { db } from "@/lib/db";
import { useDegrees } from "@/lib/hooks";
import { PROFILE_KINDS, PROFILES, profileOfDegree, useProfiles, type Profile, type ProfileKind } from "@/lib/profiles";
import { useOpen } from "@/components/workspace/use-open";
import { openOnboarding } from "@/components/onboarding/onboarding";
import { Select } from "@/components/ui/select";
import { Hint, Row } from "./settings-ui";

// Un perfil: nombre editable, tipo y cuántos espacios tiene.
function ProfileRow({ p, spaces, onRename, onKind, onDelete }: { p: Profile; spaces: number; onRename: (name: string) => void; onKind: (k: ProfileKind) => void; onDelete: () => void }) {
  const def = PROFILES[p.kind];
  const [name, setName] = useState(p.name);
  useEffect(() => setName(p.name), [p.name]);
  return (
    <div className="flex min-h-11 items-center gap-2.5 border-b border-border py-1.5">
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-primary-tint text-primary-soft">
        <def.icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <input
        className="input min-w-0 flex-1"
        value={name}
        aria-label={t("Nombre del perfil")}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name.trim() !== p.name ? onRename(name.trim()) : setName(p.name)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <Select className="input w-[140px] flex-none" value={p.kind} onChange={(e) => onKind(e.target.value as ProfileKind)} aria-label={t("Tipo de perfil")}>
        {PROFILE_KINDS.map((k) => (
          <option key={k} value={k}>
            {PROFILES[k].label}
          </option>
        ))}
      </Select>
      <span className="t-small w-[92px] flex-none text-right text-faint">
        {def.study ? `${spaces} ${spaces === 1 ? def.space.one : def.space.many}` : ""}
      </span>
      <button type="button" className="icon-btn flex-none" aria-label={t("Borrar el perfil {name}", { name: p.name })} title={t("Borrar perfil")} onClick={onDelete}>
        <Trash2 strokeWidth={1.75} />
      </button>
    </div>
  );
}

// Ajustes → Perfiles: quién sos, tus perfiles y qué sabe la IA de vos.
export function ProfilesSection() {
  const { profile, profiles, update, setActive, terms } = useProfiles();
  const degrees = useDegrees();
  const open = useOpen();
  const [name, setName] = useState(profile.name);
  const [about, setAbout] = useState(profile.about);
  const [confirm, setConfirm] = useState<Profile | null>(null);
  useEffect(() => {
    setName(profile.name);
    setAbout(profile.about);
  }, [profile.name, profile.about]);

  const spacesOf = (p: Profile) => degrees.filter((d) => profileOfDegree(profiles, d)?.id === p.id);
  const patch = (id: string, changes: Partial<Profile>) => update({ profiles: profiles.map((p) => (p.id === id ? { ...p, ...changes } : p)) });

  // Cambiar el tipo también cambia el de sus espacios (así se ven con los nombres nuevos).
  async function changeKind(p: Profile, kind: ProfileKind) {
    const own = spacesOf(p);
    await db.transaction("rw", db.degrees, async () => {
      for (const d of own) await db.degrees.update(d.id, { kind, profileId: p.id });
    });
    patch(p.id, { kind });
  }

  // Borrar un perfil no borra nada adentro: sus espacios quedan visibles en «Todos los perfiles».
  async function remove(p: Profile) {
    const own = spacesOf(p);
    await db.transaction("rw", db.degrees, async () => {
      for (const d of own) await db.degrees.update(d.id, { profileId: p.id });
    });
    update({ profiles: profiles.filter((x) => x.id !== p.id) });
    setConfirm(null);
  }

  return (
    <>
      <Row label={t("Tu nombre")}>
        <input
          className="input w-[240px]"
          value={name}
          placeholder={t("Cómo te llamás")}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== profile.name && update({ name: name.trim() })}
        />
      </Row>

      <Row label={t("Perfil que se ve ahora")}>
        <Select className="input w-[240px]" value={profile.active} onChange={(e) => setActive(e.target.value)}>
          <option value="todos">{t("Todos los perfiles")}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Row>

      <div className="mb-1 mt-6 flex items-center justify-between">
        <span className="section-label px-0">{t("Tus perfiles")}</span>
        <button type="button" className="btn btn-sm" onClick={() => openOnboarding("agregar")}>
          <Plus strokeWidth={1.75} />
          {t("Nuevo perfil")}
        </button>
      </div>
      {profiles.length === 0 && <Hint>{t("Todavía no tenés perfiles. Creá uno para la facultad, tu trabajo o tus proyectos.")}</Hint>}
      {profiles.map((p) =>
        confirm?.id === p.id ? (
          <div key={p.id} className="flex min-h-11 items-center gap-2 border-b border-border py-1.5">
            <span className="t-small flex-1 text-text">
              {t("¿Borrar «{name}»? Sus {spaces} y todo lo que tienen adentro no se borran: quedan en «Todos los perfiles».", { name: p.name, spaces: PROFILES[p.kind].space.many })}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setConfirm(null)}>
              {t("Cancelar")}
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(p)}>
              {t("Borrar perfil")}
            </button>
          </div>
        ) : (
          <ProfileRow
            key={p.id}
            p={p}
            spaces={spacesOf(p).length}
            onRename={(n) => patch(p.id, { name: n })}
            onKind={(k) => void changeKind(p, k)}
            onDelete={() => setConfirm(p)}
          />
        ),
      )}
      <Hint>{t("Podés tener todos los perfiles que quieras, incluso varios del mismo tipo (por ejemplo, dos trabajos). El tipo cambia los nombres, los tipos de tarea y las secciones.")}</Hint>

      <div className="mt-6 flex flex-col gap-1.5">
        <span className="t-small text-text">{t("Sobre vos (para la IA)")}</span>
        <textarea
          className="input min-h-[96px] py-2"
          value={about}
          placeholder={t("Qué hacés, qué querés lograr, cómo te gusta que te expliquen.")}
          onChange={(e) => setAbout(e.target.value)}
          onBlur={() => about !== profile.about && update({ about: about.trim() })}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={() => openOnboarding("rehacer")}>
          {t("Volver a hacer las preguntas")}
        </button>
        <button type="button" className="btn btn-sm" onClick={(e) => open({ type: "carreras" }, e)}>
          {t("Abrir {view}", { view: terms.spacesView.toLowerCase() })}
        </button>
      </div>
    </>
  );
}
