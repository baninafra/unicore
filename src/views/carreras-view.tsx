"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useAllSubjects } from "@/lib/hooks";
import type { Degree, Subject } from "@/lib/types";
import { ConfirmDialog } from "@/components/careers/confirm-dialog";
import { DegreeDialog } from "@/components/careers/degree-dialog";
import { DegreeHeader } from "@/components/careers/degree-header";
import { PlanTable } from "@/components/careers/plan-table";
import { SubjectDialog } from "@/components/careers/subject-dialog";
import { deleteDegreeCascade, deleteSubjectCascade } from "@/components/careers/actions";

// React Flow toca window: se carga sólo en el cliente.
const PlanMap = dynamic(() => import("@/components/careers/plan-map").then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="h-[560px] w-full rounded-md border border-border" />,
});

type Mode = "tabla" | "mapa";

// Mis carreras: una sección por carrera. Tabla por cuatrimestre o mapa de correlativas.
export function CarrerasView() {
  const { degreeFilter, setDegreeFilter } = useAppState();
  // undefined mientras carga: así no mostramos nada por un instante.
  const degrees = useLiveQuery(() => db.degrees.orderBy("createdAt").toArray(), []);
  const subjects = useAllSubjects();

  const [mode, setMode] = useState<Mode>("tabla");
  const [degreeDialog, setDegreeDialog] = useState<{ degree?: Degree } | null>(null);
  const [subjectDialog, setSubjectDialog] = useState<{ subject?: Subject; degreeId?: string } | null>(null);
  const [degreeToDelete, setDegreeToDelete] = useState<Degree | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);

  if (degrees === undefined) return null;

  const visible = degreeFilter === "all" ? degrees : degrees.filter((d) => d.id === degreeFilter);
  const subjectsOf = (degreeId: string) => subjects.filter((s) => s.degreeId === degreeId);

  async function confirmDeleteDegree() {
    if (!degreeToDelete) return;
    await deleteDegreeCascade(degreeToDelete.id);
    if (degreeFilter === degreeToDelete.id) setDegreeFilter("all");
    setDegreeToDelete(null);
  }

  async function confirmDeleteSubject() {
    if (!subjectToDelete) return;
    await deleteSubjectCascade(subjectToDelete.id);
    setSubjectToDelete(null);
  }

  return (
    <div className="view-wide mx-auto flex max-w-[1040px] flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1" role="group" aria-label="Vista del plan">
          {(["tabla", "mapa"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
            >
              {m === "tabla" ? "Tabla" : "Mapa"}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" onClick={() => setDegreeDialog({})}>
          <Plus strokeWidth={1.75} />
          Agregar carrera
        </button>
      </div>

      {degrees.length === 0 ? (
        <p className="t-small py-12 text-center text-faint">Sin carreras</p>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="t-small text-faint">No encontramos esa carrera</p>
          <button type="button" className="btn btn-sm" onClick={() => setDegreeFilter("all")}>
            Ver todas
          </button>
        </div>
      ) : mode === "tabla" ? (
        visible.map((degree) => {
          const own = subjectsOf(degree.id);
          return (
            <section key={degree.id} className="flex flex-col gap-2">
              <DegreeHeader
                degree={degree}
                subjects={own}
                onEdit={() => setDegreeDialog({ degree })}
                onDelete={() => setDegreeToDelete(degree)}
                onAddSubject={() => setSubjectDialog({ degreeId: degree.id })}
              />
              <PlanTable
                degree={degree}
                subjects={own}
                all={subjects}
                onEdit={(subject) => setSubjectDialog({ subject })}
                onDelete={(subject) => setSubjectToDelete(subject)}
              />
            </section>
          );
        })
      ) : (
        <>
          {visible.map((degree) => (
            <DegreeHeader
              key={degree.id}
              degree={degree}
              subjects={subjectsOf(degree.id)}
              onEdit={() => setDegreeDialog({ degree })}
              onDelete={() => setDegreeToDelete(degree)}
              onAddSubject={() => setSubjectDialog({ degreeId: degree.id })}
            />
          ))}
          <PlanMap
            degrees={visible}
            subjects={subjects}
            onEdit={(subject) => setSubjectDialog({ subject })}
            onDelete={(subject) => setSubjectToDelete(subject)}
          />
        </>
      )}

      {degreeDialog && <DegreeDialog degree={degreeDialog.degree} onClose={() => setDegreeDialog(null)} />}

      {subjectDialog && (
        <SubjectDialog
          degrees={degrees}
          allSubjects={subjects}
          subject={subjectDialog.subject}
          defaultDegreeId={subjectDialog.degreeId}
          onClose={() => setSubjectDialog(null)}
        />
      )}

      {degreeToDelete && (
        <ConfirmDialog
          title="Eliminar carrera"
          message={`Se borran "${degreeToDelete.name}", todas sus materias y sus tareas. No se puede deshacer.`}
          confirmLabel="Eliminar carrera"
          onConfirm={confirmDeleteDegree}
          onClose={() => setDegreeToDelete(null)}
        />
      )}

      {subjectToDelete && (
        <ConfirmDialog
          title="Eliminar materia"
          message={`Se borran "${subjectToDelete.name}" con sus tareas, apuntes, PDFs y flashcards. No se puede deshacer.`}
          confirmLabel="Eliminar materia"
          onConfirm={confirmDeleteSubject}
          onClose={() => setSubjectToDelete(null)}
        />
      )}
    </div>
  );
}
