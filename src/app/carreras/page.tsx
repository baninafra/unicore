"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { GraduationCap, LayoutGrid, Network, Plus } from "lucide-react";
import clsx from "clsx";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useAllSubjects } from "@/lib/hooks";
import type { Degree, Subject } from "@/lib/types";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/careers/confirm-dialog";
import { DegreeDialog } from "@/components/careers/degree-dialog";
import { PlanGrid } from "@/components/careers/plan-grid";
import { ProgressStat } from "@/components/careers/progress-stat";
import { SubjectDialog } from "@/components/careers/subject-dialog";
import { deleteDegreeCascade } from "@/components/careers/actions";

// React Flow toca window: se carga sólo en el cliente.
const PlanMap = dynamic(() => import("@/components/careers/plan-map").then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="h-[560px] w-full rounded-lg border border-border" />,
});

type View = "grid" | "map";

export default function CarrerasPage() {
  const { degreeFilter, setDegreeFilter } = useAppState();
  // undefined mientras carga: así no mostramos el estado vacío por un instante.
  const degrees = useLiveQuery(() => db.degrees.orderBy("createdAt").toArray(), []);
  const subjects = useAllSubjects();

  const [view, setView] = useState<View>("grid");
  const [degreeDialog, setDegreeDialog] = useState<{ degree?: Degree } | null>(null);
  const [subjectDialog, setSubjectDialog] = useState<{ subject?: Subject; degreeId?: string } | null>(null);
  const [degreeToDelete, setDegreeToDelete] = useState<Degree | null>(null);

  if (degrees === undefined) return null;

  const visible = degreeFilter === "all" ? degrees : degrees.filter((d) => d.id === degreeFilter);
  const subjectsOf = (degreeId: string) => subjects.filter((s) => s.degreeId === degreeId);

  async function confirmDeleteDegree() {
    if (!degreeToDelete) return;
    await deleteDegreeCascade(degreeToDelete.id);
    if (degreeFilter === degreeToDelete.id) setDegreeFilter("all");
    setDegreeToDelete(null);
  }

  const addButton = (
    <button type="button" className="btn" onClick={() => setDegreeDialog({})}>
      <Plus strokeWidth={1.75} />
      Agregar carrera
    </button>
  );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="t-h1">Mis carreras</h1>
        {degrees.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="Vista del plan">
              {(
                [
                  { value: "grid", label: "Grilla", icon: LayoutGrid },
                  { value: "map", label: "Mapa", icon: Network },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={view === opt.value}
                  onClick={() => setView(opt.value)}
                  className={clsx(
                    "flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-sm font-medium transition-colors",
                    view === opt.value ? "bg-surface-raised text-text" : "text-muted hover:text-text",
                  )}
                >
                  <opt.icon className="h-4 w-4" strokeWidth={1.75} />
                  {opt.label}
                </button>
              ))}
            </div>
            {addButton}
          </div>
        )}
      </div>

      {degrees.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Agregá tu primera carrera"
          text="Cargá el plan de estudios y UniCore te dice qué materias podés cursar."
          action={addButton}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No encontramos esa carrera"
          text="Puede que la hayas eliminado. Elegí otra en el filtro de la barra lateral."
          action={
            <button type="button" className="btn" onClick={() => setDegreeFilter("all")}>
              Ver todas las carreras
            </button>
          }
        />
      ) : view === "grid" ? (
        visible.map((degree) => {
          const own = subjectsOf(degree.id);
          return (
            <section key={degree.id} className="flex flex-col gap-4">
              <ProgressStat
                degree={degree}
                subjects={own}
                onEdit={() => setDegreeDialog({ degree })}
                onDelete={() => setDegreeToDelete(degree)}
                onAddSubject={() => setSubjectDialog({ degreeId: degree.id })}
              />
              <div>
                <h2 className="t-label mb-3">Plan de estudios</h2>
                <PlanGrid
                  degree={degree}
                  subjects={own}
                  all={subjects}
                  onEdit={(subject) => setSubjectDialog({ subject })}
                />
              </div>
            </section>
          );
        })
      ) : (
        <>
          {visible.map((degree) => (
            <ProgressStat
              key={degree.id}
              degree={degree}
              subjects={subjectsOf(degree.id)}
              onEdit={() => setDegreeDialog({ degree })}
              onDelete={() => setDegreeToDelete(degree)}
              onAddSubject={() => setSubjectDialog({ degreeId: degree.id })}
            />
          ))}
          <div>
            <h2 className="t-label mb-3">Correlativas</h2>
            <PlanMap degrees={visible} subjects={subjects} />
          </div>
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
    </div>
  );
}
