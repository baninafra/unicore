"use client";

import clsx from "clsx";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { Degree, DegreeColor } from "@/lib/types";
import { saveDegree, type DegreeInput } from "./actions";
import { FormField } from "./form-field";

type Errors = Partial<Record<"name" | "shortName" | "totalYears", string>>;

const COLORS: { value: DegreeColor; label: string; accent: string }[] = [
  { value: "primary", label: "Blurple", accent: "var(--primary)" },
  { value: "cyan", label: "Cian", accent: "var(--cyan)" },
];

// Se monta sólo cuando está abierto: el estado inicial sale de `degree`.
export function DegreeDialog({ degree, onClose }: { degree?: Degree; onClose: () => void }) {
  const [name, setName] = useState(degree?.name ?? "");
  const [shortName, setShortName] = useState(degree?.shortName ?? "");
  const [institution, setInstitution] = useState(degree?.institution ?? "");
  const [color, setColor] = useState<DegreeColor>(degree?.color ?? "primary");
  const [totalYears, setTotalYears] = useState(degree ? String(degree.totalYears) : "");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    const cleanName = name.trim();
    const cleanShort = shortName.trim().toLocaleUpperCase("es-AR");
    const years = Number(totalYears);

    if (!cleanName) next.name = "Ponele un nombre a la carrera.";
    if (cleanShort.length < 2 || cleanShort.length > 8) next.shortName = "La sigla tiene que tener entre 2 y 8 letras.";
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      next.totalYears = "Los años tienen que ser un número entre 1 y 10.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const input: DegreeInput = {
      name: cleanName,
      shortName: cleanShort,
      institution: institution.trim() || undefined,
      color,
      totalYears: years,
    };
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveDegree(input, degree);
      onClose();
    } catch {
      setSaveError("No pudimos guardar la carrera. Probá de nuevo.");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={degree ? "Editar carrera" : "Nueva carrera"}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" form="degree-form" className="btn btn-primary" disabled={saving}>
            Guardar
          </button>
        </>
      }
    >
      <form id="degree-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <FormField label="Nombre" error={errors.name}>
          <input
            className={clsx("input", errors.name && "input-error")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tecnicatura en Administración"
            aria-invalid={!!errors.name}
            autoFocus
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Sigla" error={errors.shortName}>
            <input
              className={clsx("input", errors.shortName && "input-error")}
              value={shortName}
              onChange={(e) => setShortName(e.target.value.toLocaleUpperCase("es-AR"))}
              placeholder="ADMIN"
              maxLength={8}
              aria-invalid={!!errors.shortName}
            />
          </FormField>

          <FormField label="Años totales" error={errors.totalYears}>
            <input
              className={clsx("input", errors.totalYears && "input-error")}
              value={totalYears}
              onChange={(e) => setTotalYears(e.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder="3"
              inputMode="numeric"
              aria-invalid={!!errors.totalYears}
            />
          </FormField>
        </div>

        <FormField label="Institución">
          <input
            className="input"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            placeholder="Opcional"
          />
        </FormField>

        <div className="flex flex-col gap-1.5">
          <span className="t-small font-medium text-muted">Color</span>
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
