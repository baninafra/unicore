"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { Modal } from "@/components/ui/modal";
import { LOOSE_FOLDER, TEMPLATES_FOLDER, type Degree, type Subject } from "@/lib/types";
import { foldText } from "@/lib/nav/fold";

interface Destination {
  id: string;
  label: string;
  hint?: string;
}

// Elige la carpeta o materia a la que se mueve una nota o un lienzo. Enter elige la primera opción.
export function MoveDialog({
  open,
  title,
  subjects,
  degrees,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  subjects: Subject[];
  degrees: Degree[];
  onPick: (subjectId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const degreeName = useMemo(() => Object.fromEntries(degrees.map((d) => [d.id, d.shortName])), [degrees]);

  const all = useMemo<Destination[]>(
    () => [
      { id: LOOSE_FOLDER, label: t("Notas") },
      { id: TEMPLATES_FOLDER, label: t("Plantillas") },
      ...subjects.map((s) => ({ id: s.id, label: s.name, hint: degreeName[s.degreeId] })),
    ],
    [subjects, degreeName],
  );

  const q = foldText(query.trim());
  const shown = q ? all.filter((d) => foldText(`${d.label} ${d.hint ?? ""}`).includes(q)) : all;

  const pick = (id: string) => {
    onPick(id);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} width={420}>
      <input
        className="input"
        autoFocus
        value={query}
        placeholder={t("Buscar carpeta o materia")}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && shown[0]) pick(shown[0].id);
        }}
      />
      <div className="mt-3 flex max-h-[50vh] flex-col overflow-y-auto">
        {shown.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => pick(d.id)}
            className="row w-full justify-between text-left"
          >
            <span className="min-w-0 truncate text-text">{d.label}</span>
            {d.hint && <span className="shrink-0 text-[length:calc(12px*var(--ui-scale,1))] text-faint">{d.hint}</span>}
          </button>
        ))}
        {!shown.length && <p className="px-2 py-3 text-[length:calc(13px*var(--ui-scale,1))] text-faint">{t("Sin resultados")}</p>}
      </div>
    </Modal>
  );
}
