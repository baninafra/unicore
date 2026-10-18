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
import { ItemList } from "@/components/careers/item-list";
import { cap, kindOf, nuevo, PROFILES, useProfiles } from "@/lib/profiles";

// React Flow toca window: se carga sólo en el cliente.
const PlanMap = dynamic(() => import("@/components/careers/plan-map").then((m) => m.PlanMap), {
  ssr: false,
  loading: () => <div className="h-[560px] w-full rounded-md border border-border" />,
});

type Mode = "tabla" | "mapa";

// Mis carreras: una sección por carrera. Tabla por cuatrimestre o mapa de correlativas.
export function CarrerasView() {
  const { degreeFilter, setDegreeFilter } = useAppState();
  const { terms, inScope, termsFor, singleSpace, profiles, activeProfile } = useProfiles();
  // Carreras y cursos se pueden agregar; trabajo, proyectos y personal son un único espacio por perfil.
  const studyProfiles = profiles.filter((p) => PROFILES[p.kind].study);
  const canAddSpace = activeProfile ? PROFILES[activeProfile.kind].study : studyProfiles.length > 0 || profiles.length === 0;
  const addLabel = activeProfile ? terms.space.one : studyProfiles.length === 1 ? PROFILES[studyProfiles[0].kind].space.one : "carrera o curso";
  // undefined mientras carga: así no mostramos nada por un instante.
  const degrees = useLiveQuery(() => db.degrees.orderBy("createdAt").toArray(), []);
  const subjects = useAllSubjects();

  const [mode, setMode] = useState<Mode>("tabla");
  const [degreeDialog, setDegreeDialog] = useState<{ degree?: Degree } | null>(null);
  const [subjectDialog, setSubjectDialog] = useState<{ subject?: Subject; degreeId?: string } | null>(null);
  const [degreeToDelete, setDegreeToDelete] = useState<Degree | null>(null);
  const [subjectToDelete, setSubjectToDelete] = useState<Subject | null>(null);

  if (degrees === undefined) return null;

  const scoped = degrees.filter((d) => inScope(d.id));
  const visible = degreeFilter === "all" ? scoped : scoped.filter((d) => d.id === degreeFilter);
  // El mapa de correlativas sólo tiene sentido para lo que se estudia.
  const studyVisible = visible.filter((d) => PROFILES[kindOf(d)].study);
  const showMode = studyVisible.length > 0;
  const currentMode = showMode ? mode : "tabla";
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

  const dialogs = (
    <>
      {subjectDialog && (
        <SubjectDialog
          degrees={scoped.length ? scoped : degrees}
          allSubjects={subjects}
          subject={subjectDialog.subject}
          defaultDegreeId={subjectDialog.degreeId}
          onClose={() => setSubjectDialog(null)}
        />
      )}
      {subjectToDelete && (
        <ConfirmDialog
          title={`Eliminar ${termsFor(subjectToDelete.degreeId).item.one}`}
          message={`Se borran "${subjectToDelete.name}" con sus tareas, notas, PDFs y flashcards. No se puede deshacer.`}
          confirmLabel={`Eliminar ${termsFor(subjectToDelete.degreeId).item.one}`}
          onConfirm={confirmDeleteSubject}
          onClose={() => setSubjectToDelete(null)}
        />
      )}
    </>
  );

  // Perfil de trabajo, proyectos o personal: el perfil es el espacio, así que se ven directo sus proyectos o áreas.
  if (singleSpace) {
    const own = subjectsOf(singleSpace.id);
    const add = () => setSubjectDialog({ degreeId: singleSpace.id });
    return (
      <div className="view-wide mx-auto flex max-w-[1040px] flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h1 className="t-h1 font-semibold">{cap(terms.item.many)}</h1>
            <p className="t-small text-faint">
              {own.length
                ? `${own.filter((x) => x.status === "CURSANDO").length} ${terms.statuses.CURSANDO.toLowerCase()} · ${own.length} en total`
                : `Cada ${terms.item.one} tiene sus notas, tareas y archivos.`}
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={add}>
            <Plus strokeWidth={1.75} />
            {nuevo(terms.item)}
          </button>
        </div>
        {own.length === 0 ? (
          <button type="button" onClick={add} className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong py-16 text-faint hover:border-primary hover:text-text">
            <terms.icon className="h-7 w-7" strokeWidth={1.5} />
            <span className="t-body">Creá tu primer{terms.item.f ? "a" : ""} {terms.item.one}</span>
          </button>
        ) : (
          <ItemList degree={singleSpace} subjects={own} onEdit={(subject) => setSubjectDialog({ subject })} onDelete={(subject) => setSubjectToDelete(subject)} />
        )}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="view-wide mx-auto flex max-w-[1040px] flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className={showMode ? "flex gap-1" : "invisible flex gap-1"} role="group" aria-label="Vista del plan">
          {(["tabla", "mapa"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={currentMode === m}
              onClick={() => setMode(m)}
              className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
            >
              {m === "tabla" ? "Tabla" : "Correlativas"}
            </button>
          ))}
        </div>
        {canAddSpace && (
          <button type="button" className="btn btn-sm" onClick={() => setDegreeDialog({})}>
            <Plus strokeWidth={1.75} />
            Agregar {addLabel}
          </button>
        )}
      </div>

      {scoped.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <p className="t-small text-faint">Todavía no cargaste {terms.space.f ? "ninguna" : "ningún"} {terms.space.one}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setDegreeDialog({})}>
            <Plus strokeWidth={1.75} />
            {cap(terms.space.one)}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12">
          <p className="t-small text-faint">No encontramos {terms.space.f ? "esa" : "ese"} {terms.space.one}</p>
          <button type="button" className="btn btn-sm" onClick={() => setDegreeFilter("all")}>
            Ver todas
          </button>
        </div>
      ) : currentMode === "tabla" ? (
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
              {PROFILES[kindOf(degree)].study ? (
                <PlanTable
                  degree={degree}
                  subjects={own}
                  all={subjects}
                  onEdit={(subject) => setSubjectDialog({ subject })}
                  onDelete={(subject) => setSubjectToDelete(subject)}
                />
              ) : (
                <ItemList
                  degree={degree}
                  subjects={own}
                  onEdit={(subject) => setSubjectDialog({ subject })}
                  onDelete={(subject) => setSubjectToDelete(subject)}
                />
              )}
            </section>
          );
        })
      ) : (
        <>
          {studyVisible.map((degree) => (
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
            degrees={studyVisible}
            subjects={subjects}
            onEdit={(subject) => setSubjectDialog({ subject })}
            onDelete={(subject) => setSubjectToDelete(subject)}
          />
        </>
      )}

      {degreeDialog && <DegreeDialog degree={degreeDialog.degree} onClose={() => setDegreeDialog(null)} />}

      {subjectDialog && (
        <SubjectDialog
          degrees={scoped.length ? scoped : degrees}
          allSubjects={subjects}
          subject={subjectDialog.subject}
          defaultDegreeId={subjectDialog.degreeId}
          onClose={() => setSubjectDialog(null)}
        />
      )}

      {degreeToDelete && (
        <ConfirmDialog
          title={`Eliminar ${termsFor(degreeToDelete.id).space.one}`}
          message={`Se borran "${degreeToDelete.name}", ${termsFor(degreeToDelete.id).item.f ? "todas sus" : "todos sus"} ${termsFor(degreeToDelete.id).item.many} y sus tareas. No se puede deshacer.`}
          confirmLabel={`Eliminar ${termsFor(degreeToDelete.id).space.one}`}
          onConfirm={confirmDeleteDegree}
          onClose={() => setDegreeToDelete(null)}
        />
      )}

      {subjectToDelete && (
        <ConfirmDialog
          title={`Eliminar ${termsFor(subjectToDelete.degreeId).item.one}`}
          message={`Se borran "${subjectToDelete.name}" con sus tareas, notas, PDFs y flashcards. No se puede deshacer.`}
          confirmLabel={`Eliminar ${termsFor(subjectToDelete.degreeId).item.one}`}
          onConfirm={confirmDeleteSubject}
          onClose={() => setSubjectToDelete(null)}
        />
      )}
    </div>
  );
}
