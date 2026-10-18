"use client";

// Lo propio de cada tipo de perfil en Inicio: accesos rápidos arriba y un panel al costado.
// Universidad/colegio: exámenes que vienen y repaso. Trabajo: lo de hoy en el calendario y proyectos en curso.
// Proyectos: avance de cada proyecto. Personal: metas y áreas.

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { addDays, format, startOfDay } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarPlus, FilePlus, FolderPlus, Layers, Lightbulb, ListPlus, NotebookPen, Target, type LucideIcon } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { db } from "@/lib/db";
import { useWorkspace } from "@/lib/workspace";
import { occurrences } from "@/lib/calendars/events";
import { nuevo, PROFILES, useProfiles, type ProfileDef } from "@/lib/profiles";
import type { Subject, Task } from "@/lib/types";
import { openEventDialog } from "@/components/calendar/event-dialog";
import { SubjectDialog } from "@/components/careers/subject-dialog";
import { SummaryLines } from "./summary-lines";

function Action({ icon: Icon, label, onClick, primary }: { icon: LucideIcon; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" className={primary ? "btn btn-primary" : "btn"} onClick={onClick}>
      <Icon strokeWidth={1.75} />
      {label}
    </button>
  );
}

// Próxima hora en punto (para una reunión nueva).
function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

export function QuickActions() {
  const { activeProfile, singleSpace, terms } = useProfiles();
  const { openTaskDialog } = useAppState();
  const { runCommand, openView } = useWorkspace();
  const [newItem, setNewItem] = useState(false);
  const kind = activeProfile?.kind;
  const degreeId = singleSpace?.id;
  const task = (patch: Partial<Task>) => openTaskDialog({ degreeId, ...patch });

  let actions: React.ReactNode;
  switch (kind) {
    case "universidad":
    case "colegio":
      actions = (
        <>
          <Action primary icon={ListPlus} label={`Nuevo ${terms.taskTypes.PARCIAL.toLowerCase()} o entrega`} onClick={() => task({ type: "PARCIAL" })} />
          <Action icon={NotebookPen} label="Nuevo apunte" onClick={() => runCommand("nota:nueva")} />
          <Action icon={Layers} label="Repasar" onClick={() => openView({ type: "repaso" })} />
        </>
      );
      break;
    case "trabajo":
      actions = (
        <>
          <Action
            primary
            icon={CalendarPlus}
            label="Nueva reunión"
            onClick={() => {
              const start = nextHour();
              openEventDialog({ defaults: { title: "", category: "REUNION", allDay: false, start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString() } });
            }}
          />
          <Action icon={ListPlus} label="Nueva tarea" onClick={() => task({ type: "TAREA" })} />
          <Action icon={FolderPlus} label={nuevo(terms.item)} onClick={() => setNewItem(true)} />
        </>
      );
      break;
    case "proyectos":
      actions = (
        <>
          <Action primary icon={FolderPlus} label={nuevo(terms.item)} onClick={() => setNewItem(true)} />
          <Action icon={Target} label="Nuevo hito" onClick={() => task({ type: "PARCIAL" })} />
          <Action icon={Lightbulb} label="Anotar una idea" onClick={() => openView({ type: "ideas" })} />
        </>
      );
      break;
    case "personal":
      actions = (
        <>
          <Action primary icon={ListPlus} label="Nuevo pendiente" onClick={() => task({ type: "TAREA" })} />
          <Action icon={Target} label="Nueva meta" onClick={() => task({ type: "FINAL" })} />
          <Action icon={NotebookPen} label="Nota del día" onClick={() => runCommand("diario:hoy")} />
        </>
      );
      break;
    default:
      actions = (
        <>
          <Action primary icon={ListPlus} label="Nueva tarea" onClick={() => task({})} />
          <Action icon={FilePlus} label="Nueva nota" onClick={() => runCommand("nota:nueva")} />
          <Action
            icon={CalendarPlus}
            label="Nuevo evento"
            onClick={() => {
              const start = nextHour();
              openEventDialog({ defaults: { title: "", allDay: false, start: start.toISOString(), end: new Date(start.getTime() + 3600_000).toISOString() } });
            }}
          />
        </>
      );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {actions}
      {newItem && singleSpace && <SubjectDialog degrees={[singleSpace]} allSubjects={[]} defaultDegreeId={singleSpace.id} onClose={() => setNewItem(false)} />}
    </div>
  );
}

function Panel({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="section-label">{title}</h2>
      {children ?? <p className="t-small px-2 py-1 text-faint">{empty}</p>}
    </section>
  );
}

const open = (t: Task) => t.status !== "DONE" && t.status !== "INBOX_EMAIL";

// Lista de proyectos o áreas con sus tareas: abiertas, o avance (hechas / total).
function ItemsPanel({ title, terms, subjects, tasks, progress }: { title: string; terms: ProfileDef; subjects: Subject[]; tasks: Task[]; progress?: boolean }) {
  const { openView } = useWorkspace();
  const list = subjects.filter((s) => s.status === "CURSANDO" || s.status === "PENDIENTE");
  if (!list.length) return <Panel title={title} empty={`Sin ${terms.item.many} en curso`} />;
  return (
    <Panel title={title}>
      {list.map((s) => {
        const own = tasks.filter((t) => t.subjectId === s.id && t.status !== "INBOX_EMAIL");
        const done = own.filter((t) => t.status === "DONE").length;
        const pending = own.length - done;
        return (
          <button key={s.id} type="button" className="row flex-col !items-stretch gap-1 py-1.5 text-left" onClick={() => openView({ type: "materia", id: s.id })}>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-text">{s.name}</span>
              <span className="t-small num flex-none text-faint">{progress ? `${done}/${own.length}` : pending ? `${pending} pendiente${pending === 1 ? "" : "s"}` : "al día"}</span>
            </span>
            {progress && (
              <span className="progress" style={{ height: 3 }}>
                <i style={{ width: `${own.length ? Math.round((done / own.length) * 100) : 0}%` }} />
              </span>
            )}
          </button>
        );
      })}
    </Panel>
  );
}

// Eventos propios de hoy (con repeticiones), ordenados por hora.
function TodayEvents() {
  const { openView } = useWorkspace();
  const items = useLiveQuery(async () => {
    const from = startOfDay(new Date());
    const to = addDays(from, 1);
    const events = await db.events.toArray();
    return events
      .flatMap((ev) => (ev.status === "CANCELLED" ? [] : occurrences(ev, from, to).map((at) => ({ ev, at }))))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, []);
  if (!items?.length) return <Panel title="Hoy en el calendario" empty="Nada agendado para hoy" />;
  return (
    <Panel title="Hoy en el calendario">
      {items.map(({ ev, at }) => (
        <button key={`${ev.id}-${at.getTime()}`} type="button" className="row text-left" onClick={() => openView({ type: "calendario" })}>
          <span className="t-small num w-11 flex-none text-faint">{ev.allDay ? "Todo el día" : format(at, "HH:mm", { locale: es })}</span>
          <span className="min-w-0 flex-1 truncate text-text">{ev.title || "Sin título"}</span>
        </button>
      ))}
    </Panel>
  );
}

// Exámenes y entregas de los próximos 30 días.
function UpcomingExams({ tasks, terms }: { tasks: Task[]; terms: ProfileDef }) {
  const { openTaskDialog } = useAppState();
  const limit = addDays(new Date(), 30).toISOString();
  const now = new Date().toISOString();
  const list = tasks
    .filter((t) => open(t) && (t.type === "PARCIAL" || t.type === "FINAL" || t.type === "TP") && t.dueDate && t.dueDate >= now && t.dueDate <= limit)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, 6);
  if (!list.length) return <Panel title="Lo que se viene" empty="Sin exámenes ni entregas en el próximo mes" />;
  return (
    <Panel title="Lo que se viene">
      {list.map((t) => (
        <button key={t.id} type="button" className="row text-left" onClick={() => openTaskDialog(t)}>
          <span className="t-small num w-14 flex-none text-faint">{format(new Date(t.dueDate!), "EEE d/M", { locale: es })}</span>
          <span className="min-w-0 flex-1 truncate text-text">{t.title}</span>
          <span className="t-small flex-none text-faint">{terms.taskTypes[t.type]}</span>
        </button>
      ))}
    </Panel>
  );
}

function Goals({ tasks }: { tasks: Task[] }) {
  const { openTaskDialog } = useAppState();
  const list = tasks.filter((t) => open(t) && t.type === "FINAL");
  if (!list.length) return <Panel title="Metas" empty="Todavía no anotaste metas" />;
  return (
    <Panel title="Metas">
      {list.map((t) => (
        <button key={t.id} type="button" className="row text-left" onClick={() => openTaskDialog(t)}>
          <Target strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-text">{t.title}</span>
          {t.dueDate && <span className="t-small num flex-none text-faint">{format(new Date(t.dueDate), "d/M")}</span>}
        </button>
      ))}
    </Panel>
  );
}

// Panel al costado de Inicio según el perfil activo.
export function ProfileSide({ now, tasks, subjects }: { now?: Date; tasks: Task[]; subjects: Subject[] }) {
  const { activeProfile } = useProfiles();
  const kind = activeProfile?.kind;
  const terms = kind ? PROFILES[kind] : PROFILES.universidad;
  switch (kind) {
    case "trabajo":
      return (
        <>
          <TodayEvents />
          <ItemsPanel title={`${terms.item.many} en curso`} terms={terms} subjects={subjects} tasks={tasks} />
        </>
      );
    case "proyectos":
      return <ItemsPanel title="Avance" terms={terms} subjects={subjects} tasks={tasks} progress />;
    case "personal":
      return (
        <>
          <Goals tasks={tasks} />
          <ItemsPanel title={terms.item.many} terms={terms} subjects={subjects} tasks={tasks} />
        </>
      );
    case "universidad":
    case "colegio":
      return (
        <>
          <UpcomingExams tasks={tasks} terms={terms} />
          <SummaryLines now={now} />
        </>
      );
    default:
      return (
        <>
          <TodayEvents />
          <SummaryLines now={now} />
        </>
      );
  }
}
