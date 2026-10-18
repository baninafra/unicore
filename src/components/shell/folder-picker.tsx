"use client";

// "¿Dónde lo guardo?": cuando algo nuevo (un documento, una planilla…) no tiene una carpeta clara,
// se le pregunta al usuario en qué materia o carpeta crearlo.

import { useEffect, useState } from "react";
import { MoveDialog } from "@/components/explorer/move-dialog";
import { useAllSubjects, useDegrees } from "@/lib/hooks";
import { t } from "@/lib/i18n";

const EVENT = "uc:pick-folder";

// Devuelve la carpeta elegida, o null si se canceló.
export function pickFolder(title = t("¿Dónde lo guardo?")): Promise<string | null> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { title, resolve } })));
}

export function FolderPicker() {
  const subjects = useAllSubjects() ?? [];
  const degrees = useDegrees() ?? [];
  const [req, setReq] = useState<{ title: string; resolve: (id: string | null) => void } | null>(null);

  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<{ title: string; resolve: (id: string | null) => void }>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  return (
    <MoveDialog
      open={!!req}
      title={req?.title ?? ""}
      subjects={subjects}
      degrees={degrees}
      onPick={(id) => {
        req?.resolve(id);
        setReq(null);
      }}
      onClose={() => {
        req?.resolve(null);
        setReq(null);
      }}
    />
  );
}
