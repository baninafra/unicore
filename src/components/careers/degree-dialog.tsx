"use client";

import clsx from "clsx";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { Degree, DegreeColor, ProfileKind } from "@/lib/types";
import { kindOf, nuevo, PROFILE_KINDS, PROFILES, profileOfDegree, useProfiles } from "@/lib/profiles";
import { saveDegree, type DegreeInput } from "./actions";
import { FormField } from "./form-field";
import { t } from "@/lib/i18n";

type Errors = Partial<Record<"name" | "shortName" | "totalYears", string>>;

const PLACEHOLDER: Record<ProfileKind, string> = {
  universidad: t("Tecnicatura en Administración"),
  colegio: t("5.º año B"),
  trabajo: t("Estudio Contable Pérez"),
  proyectos: t("Freelance"),
  personal: t("Personal"),
};

const COLORS: { value: DegreeColor; label: string; accent: string }[] = [
  { value: "primary", label: t("Blurple"), accent: "var(--primary)" },
  { value: "cyan", label: t("Cian"), accent: "var(--cyan)" },
];

// Se monta sólo cuando está abierto: el estado inicial sale de `degree`.
export function DegreeDialog({ degree, onClose }: { degree?: Degree; onClose: () => void }) {
  const { activeKinds, activeProfile, profiles } = useProfiles();
  // Perfil del espacio: el suyo, el que se está viendo, o el primero.
  const initialProfile = degree ? profileOfDegree(profiles, degree) : (activeProfile ?? profiles.find((p) => PROFILES[p.kind].study));
  const [profileId, setProfileId] = useState(initialProfile?.id ?? "");
  const [kind, setKind] = useState<ProfileKind>(degree ? kindOf(degree) : (initialProfile?.kind ?? activeKinds[0] ?? "universidad"));
  const profile = PROFILES[kind];
  // Sin perfiles creados se elige directamente el tipo.
  // Sólo los perfiles de estudio suman espacios (los demás tienen uno solo, el propio perfil).
  const studyProfiles = profiles.filter((p) => PROFILES[p.kind].study || p.id === initialProfile?.id);
  const options = studyProfiles.length ? studyProfiles : PROFILE_KINDS.filter((k) => PROFILES[k].study).map((k) => ({ id: "", name: PROFILES[k].label, kind: k }));
  const [name, setName] = useState(degree?.name ?? "");
  const [shortName, setShortName] = useState(degree?.shortName ?? "");
  const [institution, setInstitution] = useState(degree?.institution ?? "");
  const [color, setColor] = useState<DegreeColor>(degree?.color ?? "primary");
  const [totalYears, setTotalYears] = useState(degree ? String(degree.totalYears) : "");
  const [shortTouched, setShortTouched] = useState(!!degree);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    const cleanName = name.trim();
    const cleanShort = shortName.trim().toLocaleUpperCase("es-AR");
    const years = profile.study ? Number(totalYears) : degree?.totalYears ?? 1;

    if (!cleanName) next.name = profile.space.f ? t("Ponele un nombre a la {space}.", { space: profile.space.one }) : t("Ponele un nombre al {space}.", { space: profile.space.one });
    if (cleanShort.length < 2 || cleanShort.length > 8) next.shortName = t("La sigla tiene que tener entre 2 y 8 letras.");
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      next.totalYears = t("Los años tienen que ser un número entre 1 y 10.");
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const input: DegreeInput = {
      name: cleanName,
      shortName: cleanShort,
      institution: institution.trim() || undefined,
      color,
      totalYears: years,
      kind,
      profileId: profileId || undefined,
    };
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveDegree(input, degree);
      onClose();
    } catch {
      setSaveError(profile.space.f ? t("No pudimos guardar la {space}. Probá de nuevo.", { space: profile.space.one }) : t("No pudimos guardar el {space}. Probá de nuevo.", { space: profile.space.one }));
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={degree ? t("Editar {space}", { space: profile.space.one }) : nuevo(profile.space)}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t("Cancelar")}
          </button>
          <button type="submit" form="degree-form" className="btn btn-primary" disabled={saving}>
            {t("Guardar")}
          </button>
        </>
      }
    >
      <form id="degree-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {options.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="t-small font-medium text-muted">{t("Perfil")}</span>
            <div className="flex flex-wrap gap-1.5">
              {options.map((p) => {
                const def = PROFILES[p.kind];
                const on = p.id ? profileId === p.id : kind === p.kind;
                return (
                  <button
                    key={p.id || p.kind}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setProfileId(p.id);
                      setKind(p.kind);
                    }}
                    className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
                  >
                    <def.icon strokeWidth={1.75} />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <FormField label={t("Nombre")} error={errors.name}>
          <input
            className={clsx("input", errors.name && "input-error")}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // La sigla se sugiere sola hasta que el usuario la toca.
              if (!shortTouched) {
                const words = e.target.value.split(/\s+/).filter((w) => w.length > 2);
                setShortName(words.map((w) => w[0]).join("").toLocaleUpperCase("es-AR").slice(0, 8));
              }
            }}
            placeholder={PLACEHOLDER[kind]}
            aria-invalid={!!errors.name}
            autoFocus
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label={t("Sigla")} error={errors.shortName}>
            <input
              className={clsx("input", errors.shortName && "input-error")}
              value={shortName}
              onChange={(e) => {
                setShortTouched(true);
                setShortName(e.target.value.toLocaleUpperCase("es-AR"));
              }}
              placeholder="ADMIN"
              maxLength={8}
              aria-invalid={!!errors.shortName}
            />
          </FormField>

          {profile.study && <FormField label={t("Años totales")} error={errors.totalYears}>
            <input
              className={clsx("input", errors.totalYears && "input-error")}
              value={totalYears}
              onChange={(e) => setTotalYears(e.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder="3"
              inputMode="numeric"
              aria-invalid={!!errors.totalYears}
            />
          </FormField>}
        </div>

        <FormField label={kind === "trabajo" ? t("Empresa u organización") : kind === "universidad" || kind === "colegio" ? t("Institución") : t("Detalle")}>
          <input
            className="input"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder={t("Opcional")}
          />
        </FormField>

        <div className="flex flex-col gap-1.5">
          <span className="t-small font-medium text-muted">{t("Color")}</span>
          <div className="grid grid-cols-2 gap-2">
            {COLORS.map((c) => {
              const active = color === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setColor(c.value)}
                  className="btn justify-center"
                  style={active ? { borderColor: c.accent, boxShadow: `inset 0 0 0 1px ${c.accent}` } : undefined}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {saveError && <p className="t-small text-rose" role="alert">{saveError}</p>}
      </form>
    </Modal>
  );
}
