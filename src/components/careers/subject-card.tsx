"use client";

import Link from "next/link";
import { Check, Lock, Pencil } from "lucide-react";
import clsx from "clsx";
import type { CSSProperties } from "react";
import { grade, isSubjectEnabled, missingCorrelatives } from "@/lib/format";
import type { Subject } from "@/lib/types";

export type SubjectState =
  | { kind: "aprobada"; finalGrade?: number }
  | { kind: "habilitada" }
  | { kind: "cursando" }
  | { kind: "regular" }
  | { kind: "bloqueada"; missing: string[] };

export function subjectState(subject: Subject, all: Subject[]): SubjectState {
  if (subject.status === "APROBADA") return { kind: "aprobada", finalGrade: subject.finalGrade };
  if (subject.status === "CURSANDO") return { kind: "cursando" };
  if (subject.status === "REGULAR") return { kind: "regular" };
  if (isSubjectEnabled(subject, all)) return { kind: "habilitada" };
  return { kind: "bloqueada", missing: missingCorrelatives(subject, all).map((s) => s.name) };
}

export function subjectCardClass(state: SubjectState) {
  return clsx(
    "relative flex h-full flex-col rounded-lg border p-4 transition-colors",
    state.kind === "bloqueada" ? "border-dashed bg-transparent" : "bg-surface hover:bg-surface-raised",
  );
}

// Los bordes van por style: globals.css tiene `* { border-color }` sin capa y pisa las utilidades border-*.
export function subjectCardStyle(state: SubjectState): CSSProperties {
  const borderColor =
    state.kind === "habilitada" ? "var(--primary)" : state.kind === "bloqueada" ? "var(--border-strong)" : "var(--border)";
  return { borderColor };
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

// Contenido de la tarjeta. Con href, el nombre enlaza a la materia y ocupa toda la tarjeta.
export function SubjectCardBody({ subject, state, href }: { subject: Subject; state: SubjectState; href: string }) {
  return (
    <>
      <Link
        href={href}
        className="t-h3 line-clamp-2 pr-8 after:absolute after:inset-0 after:rounded-lg after:content-['']"
      >
        {subject.name}
      </Link>
      <div className="mt-3 flex flex-col gap-2">
        {state.kind === "aprobada" && (
          <span className="badge badge-mint">
            <Check strokeWidth={1.75} />
            Aprobada · {grade(state.finalGrade)}
          </span>
        )}
        {state.kind === "habilitada" && (
          <>
            <span className="badge badge-primary">Habilitada</span>
            <p className="t-small text-muted">Podés cursarla</p>
          </>
        )}
        {state.kind === "cursando" && <span className="badge badge-primary">Cursando</span>}
        {state.kind === "regular" && <span className="badge">Regular</span>}
        {state.kind === "bloqueada" && (
          <p className="t-small flex items-start gap-1.5 text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={1.75} />
            <span className="line-clamp-2">
              {state.missing.length ? `Necesitás ${joinNames(state.missing)}` : "Revisá sus correlativas"}
            </span>
          </p>
        )}
      </div>
    </>
  );
}

// Tarjeta de la grilla: clic en el nombre abre la materia, el lápiz edita.
export function SubjectCard({ subject, all, onEdit }: { subject: Subject; all: Subject[]; onEdit: () => void }) {
  const state = subjectState(subject, all);
  return (
    <article className={clsx(subjectCardClass(state), "group")} style={subjectCardStyle(state)}>
      <SubjectCardBody subject={subject} state={state} href={`/materia?id=${subject.id}`} />
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Editar ${subject.name}`}
        className="btn btn-ghost btn-sm btn-icon absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Pencil strokeWidth={1.75} />
      </button>
    </article>
  );
}
