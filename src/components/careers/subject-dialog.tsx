"use client";

import clsx from "clsx";
import { t, intlLocale } from "@/lib/i18n";
import { deleteWithUndo } from "@/lib/undo";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { SUBJECT_STATUS_LABEL, type Degree, type Subject, type SubjectStatus } from "@/lib/types";
import { kindOf, nuevo, PROFILES } from "@/lib/profiles";
import { deleteSubjectCascade, saveSubject, type SubjectInput } from "./actions";
import { FormField } from "./form-field";
import { periodIndex, periodLabel, sortSubjects } from "./plan";
import { Select } from "@/components/ui/select";

type Errors = Partial<Record<"name" | "grade" | "professorEmail" | "campusUrl" | "driveUrl", string>>;

const STATUSES = Object.keys(SUBJECT_STATUS_LABEL) as SubjectStatus[];

const ITEM_PLACEHOLDER: Record<string, string> = {
  trabajo: t("Lanzamiento de la web"),
  proyectos: t("App de recetas"),
  personal: t("Salud"),
  colegio: t("Matemática"),
};

// "8,42" o "8.42" → 8.42. Null si no es un número.
function parseGrade(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Acepta "campus.ejemplo.edu.ar" y la guarda con https. "" si está vacío, null si no es un link.
function parseUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return "";
  const full = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const url = new URL(full);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase(intlLocale());
}

// Se monta sólo cuando está abierto: el estado inicial sale de `subject` o `defaultDegreeId`.
export function SubjectDialog({
  degrees,
  allSubjects,
  subject,
  defaultDegreeId,
  defaultYear,
  onClose,
}: {
  degrees: Degree[];
  allSubjects: Subject[];
  subject?: Subject;
  defaultDegreeId?: string;
  defaultYear?: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(subject?.name ?? "");
  const [degreeId, setDegreeId] = useState(subject?.degreeId ?? defaultDegreeId ?? degrees[0]?.id ?? "");
  const [year, setYear] = useState(subject?.year ?? defaultYear ?? 1);
  const [semester, setSemester] = useState<1 | 2>(subject?.semester ?? 1);
  const [status, setStatus] = useState<SubjectStatus>(subject?.status ?? "PENDIENTE");
  const [grade, setGrade] = useState(subject?.finalGrade !== undefined ? String(subject.finalGrade).replace(".", ",") : "");
  const [correlatives, setCorrelatives] = useState<string[]>(subject?.correlatives ?? []);
  const [search, setSearch] = useState("");
  const [professorEmail, setProfessorEmail] = useState(subject?.professorEmail ?? "");
  const [campusUrl, setCampusUrl] = useState(subject?.campusUrl ?? "");
  const [driveUrl, setDriveUrl] = useState(subject?.driveUrl ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const degree = degrees.find((d) => d.id === degreeId);
  const profile = PROFILES[kindOf(degree)];
  const study = profile.study;
  const yearOptions = Array.from({ length: Math.max(degree?.totalYears ?? 1, year) }, (_, i) => i + 1);

  // Materias elegibles: de la misma carrera, de cuatrimestres anteriores (y las ya marcadas, para no perderlas sin verlo).
  const current = periodIndex(year, semester);
  const q = normalize(search.trim());
  const candidates = sortSubjects(
    allSubjects.filter((s) => s.degreeId === degreeId && s.id !== subject?.id),
  ).filter(
    (s) =>
      (periodIndex(s.year, s.semester) < current || correlatives.includes(s.id)) &&
      normalize(s.name).includes(q),
  );

  function changeDegree(id: string) {
    setDegreeId(id);
    // Las correlativas son de la misma carrera: al cambiar, se sueltan las de la otra.
    setCorrelatives((prev) => prev.filter((c) => allSubjects.some((s) => s.id === c && s.degreeId === id)));
  }

  function toggleCorrelative(id: string) {
    setCorrelatives((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    const cleanName = name.trim();
    if (!cleanName) next.name = profile.item.f ? t("Ponele un nombre a la {item}.", { item: profile.item.one }) : t("Ponele un nombre al {item}.", { item: profile.item.one });

    let finalGrade: number | undefined;
    if (study && status === "APROBADA") {
      const n = parseGrade(grade);
      if (n === null || n < 1 || n > 10) next.grade = t("La nota tiene que estar entre 1 y 10.");
      else finalGrade = n;
    }

    const email = professorEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.professorEmail = t("Revisá el mail. Tiene que tener la forma nombre@dominio.com.");
    }
    const campus = parseUrl(campusUrl);
    if (campus === null) next.campusUrl = t("Revisá el link. Tiene que ser una dirección web.");
    const drive = parseUrl(driveUrl);
    if (drive === null) next.driveUrl = t("Revisá el link. Tiene que ser una dirección web.");

    setErrors(next);
    if (Object.keys(next).length) return;

    const input: SubjectInput = {
      degreeId,
      name: cleanName,
      year,
      semester,
      status,
      finalGrade,
      correlatives: correlatives.filter((id) =>
        allSubjects.some((s) => s.id === id && s.degreeId === degreeId && s.id !== subject?.id),
      ),
      professorEmail: email || undefined,
      campusUrl: campus || undefined,
      driveUrl: drive || undefined,
    };
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveSubject(input, subject);
      onClose();
    } catch {
      setSaveError(profile.item.f ? t("No pudimos guardar la {item}. Probá de nuevo.", { item: profile.item.one }) : t("No pudimos guardar el {item}. Probá de nuevo.", { item: profile.item.one }));
      setSaving(false);
    }
  }

  async function remove() {
    if (!subject) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      const { id, name } = subject;
      onClose();
      await deleteWithUndo(t("Se eliminó «{name}»", { name }), () => deleteSubjectCascade(id));
    } catch {
      setSaveError(profile.item.f ? t("No pudimos eliminar la {item}. Probá de nuevo.", { item: profile.item.one }) : t("No pudimos eliminar el {item}. Probá de nuevo.", { item: profile.item.one }));
      setSaving(false);
    }
  }

  const footer = confirmingDelete ? (
    <>
      <button type="button" className="btn" onClick={() => setConfirmingDelete(false)} disabled={saving}>
        {t("Cancelar")}
      </button>
      <button type="button" className="btn btn-danger" onClick={remove} disabled={saving}>
        {t("Eliminar {item}", { item: profile.item.one })}
      </button>
    </>
  ) : (
    <>
      {subject && (
        <button type="button" className="btn btn-danger mr-auto" onClick={() => void remove()} disabled={saving}>
          <Trash2 strokeWidth={1.75} />
          {t("Eliminar")}
        </button>
      )}
      <button type="button" className="btn" onClick={onClose} disabled={saving}>
        {t("Cancelar")}
      </button>
      <button type="submit" form="subject-form" className="btn btn-primary" disabled={saving}>
        {t("Guardar")}
      </button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={subject ? t("Editar {item}", { item: profile.item.one }) : nuevo(profile.item)} width={600} footer={footer}>
      {confirmingDelete ? (
        <p className="t-body text-muted">
          {profile.item.f ? t("Se borran la {item} y sus tareas.", { item: profile.item.one }) : t("Se borran el {item} y sus tareas.", { item: profile.item.one })}
          {study && <> {t("También se saca de las correlativas de las materias que la usan.")}</>}
        </p>
      ) : (
        <form id="subject-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <FormField label={t("Nombre")} error={errors.name}>
            <input
              className={clsx("input", errors.name && "input-error")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={ITEM_PLACEHOLDER[profile.kind] ?? t("Matemática I")}
              aria-invalid={!!errors.name}
              autoFocus
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            {study && <FormField label={profile.space.one.charAt(0).toUpperCase() + profile.space.one.slice(1)}>
              <Select className="input" value={degreeId} onChange={(e) => changeDegree(e.target.value)}>
                {degrees.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>}

            <FormField label={t("Estado")}>
              <Select className="input" value={status} onChange={(e) => setStatus(e.target.value as SubjectStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {profile.statuses[s]}
                  </option>
                ))}
              </Select>
            </FormField>

            {study && <FormField label={t("Año")}>
              <Select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {t("{y}.º año", { y })}
                  </option>
                ))}
              </Select>
            </FormField>}

            {study && <FormField label={t("Cuatrimestre")}>
              <Select
                className="input"
                value={semester}
                onChange={(e) => setSemester(Number(e.target.value) as 1 | 2)}
              >
                <option value={1}>{t("1.º cuatrimestre")}</option>
                <option value={2}>{t("2.º cuatrimestre")}</option>
              </Select>
            </FormField>}
          </div>

          {study && status === "APROBADA" && (
            <FormField label={t("Nota final")} error={errors.grade}>
              <input
                className={clsx("input", errors.grade && "input-error")}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="8,42"
                inputMode="decimal"
                aria-invalid={!!errors.grade}
              />
            </FormField>
          )}

          {study && <div className="flex flex-col gap-2">
            <span className="t-small font-medium text-muted">{t("Correlativas")}</span>
            <input
              type="search"
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Buscar materia")}
              aria-label={t("Buscar correlativas")}
            />
            <div className="max-h-48 overflow-y-auto rounded-md border border-border">
              {candidates.length === 0 ? (
                <p className="t-small p-3 text-faint">
                  {search.trim()
                    ? t("Ninguna materia coincide con la búsqueda.")
                    : t("Todavía no hay materias de cuatrimestres anteriores para elegir.")}
                </p>
              ) : (
                candidates.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-raised"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 flex-none"
                      style={{ accentColor: "var(--primary)" }}
                      checked={correlatives.includes(s.id)}
                      onChange={() => toggleCorrelative(s.id)}
                    />
                    <span className="t-small flex-1">{s.name}</span>
                    <span className="t-small text-faint">{periodLabel(s.year, s.semester)}</span>
                  </label>
                ))
              )}
            </div>
          </div>}

          <FormField label={study ? t("Mail del profesor") : t("Mail de contacto")} error={errors.professorEmail}>
            <input
              type="email"
              className="input"
              value={professorEmail}
              onChange={(e) => setProfessorEmail(e.target.value)}
              placeholder="nombre@institucion.edu.ar"
              aria-invalid={!!errors.professorEmail}
            />
          </FormField>

          <FormField label={study ? t("Link del campus") : t("Link principal")} error={errors.campusUrl}>
            <input
              className="input"
              value={campusUrl}
              onChange={(e) => setCampusUrl(e.target.value)}
              placeholder="campus.institucion.edu.ar/materia"
              inputMode="url"
              aria-invalid={!!errors.campusUrl}
            />
          </FormField>

          <FormField label={t("Link del drive")} error={errors.driveUrl}>
            <input
              className="input"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
              placeholder="drive.google.com/..."
              inputMode="url"
              aria-invalid={!!errors.driveUrl}
            />
          </FormField>

          {saveError && <p className="t-small text-rose" role="alert">{saveError}</p>}
        </form>
      )}
    </Modal>
  );
}
