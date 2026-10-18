"use client";

// Diálogo de evento, como el de Thunderbird: título, lugar, calendario, categoría, todo el día, horario,
// repetición, recordatorios, estado, materia, tarea vinculada y descripción. También muestra (sólo para mirar)
// los eventos de calendarios suscritos, con la opción de copiarlos a un calendario propio.
//
// Se abre desde cualquier lado con openEventDialog(); askScope() pregunta si un cambio en un evento
// que se repite va para esa vez, para las siguientes o para todas.

import { useEffect, useState } from "react";
import clsx from "clsx";
import { format } from "date-fns";
import { Bell, CalendarPlus, Copy, ListTodo, MapPin, Repeat, Trash2, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { db } from "@/lib/db";
import { useAllSubjects } from "@/lib/hooks";
import { useAppState } from "@/lib/app-state";
import { CALENDAR_BORDER_L } from "@/lib/calendars/sync";
import { defaultCalendarId, deleteOccurrence, duplicateEvent, eventToTask, saveEvent, updateOccurrence, useLocalCalendars, type CalItem, type Scope } from "@/lib/calendars/events";
import { buildRRule, DAY_CODES, DAY_SHORT, describeRecurrence, parseRecurrence, REMINDER_OPTIONS, reminderLabel, type Freq, type Recurrence } from "@/lib/calendars/recurrence";
import { EVENT_CATEGORY_LABEL, type CalEvent, type EventCategory, type EventStatus } from "@/lib/types";
import { toast } from "@/lib/undo";

const EVENT = "uc:event-dialog";
const SCOPE_EVENT = "uc:event-scope";

export type EventDialogRequest =
  | { item: CalItem } // abrir lo que se tocó en el calendario
  | { defaults: Partial<CalEvent> }; // evento nuevo

export function openEventDialog(req: EventDialogRequest) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: req }));
}

export function askScope(action: "cambiar" | "borrar"): Promise<Scope | null> {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent(SCOPE_EVENT, { detail: { action, resolve } })));
}

const CONTROL = "input h-7 min-w-0 border-transparent bg-transparent px-2 hover:bg-surface-raised";
const STATUS_LABEL: Record<EventStatus, string> = { CONFIRMED: "Confirmado", TENTATIVE: "Provisional", CANCELLED: "Cancelado" };

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span>{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const dateInput = (d: Date) => format(d, "yyyy-MM-dd");
const timeInput = (d: Date) => format(d, "HH:mm");
function combine(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = (time || "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, h, mi, 0, 0);
}

export function EventDialogHost() {
  const [req, setReq] = useState<EventDialogRequest | null>(null);
  const [scope, setScope] = useState<{ action: "cambiar" | "borrar"; resolve: (s: Scope | null) => void } | null>(null);

  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<EventDialogRequest>).detail);
    const onScope = (e: Event) => setScope((e as CustomEvent<{ action: "cambiar" | "borrar"; resolve: (s: Scope | null) => void }>).detail);
    window.addEventListener(EVENT, on);
    window.addEventListener(SCOPE_EVENT, onScope);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener(SCOPE_EVENT, onScope);
    };
  }, []);

  const answer = (s: Scope | null) => {
    scope?.resolve(s);
    setScope(null);
  };

  return (
    <>
      {req && ("item" in req && req.item.kind !== "event" ? <ReadOnlyEvent item={req.item} onClose={() => setReq(null)} /> : <EventEditor key={JSON.stringify("item" in req ? req.item.key : req.defaults)} req={req} onClose={() => setReq(null)} />)}
      <Modal
        open={!!scope}
        onClose={() => answer(null)}
        title={scope?.action === "borrar" ? "Borrar un evento que se repite" : "Cambiar un evento que se repite"}
        width={420}
      >
        <div className="flex flex-col gap-2">
          <p className="t-small mb-1 text-muted">¿{scope?.action === "borrar" ? "Qué repeticiones borrás" : "A qué repeticiones se aplica el cambio"}?</p>
          <button className="btn justify-start" onClick={() => answer("one")}>
            Sólo esta
          </button>
          <button className="btn justify-start" onClick={() => answer("following")}>
            Esta y las siguientes
          </button>
          <button className="btn justify-start" onClick={() => answer("all")}>
            Todas
          </button>
        </div>
      </Modal>
    </>
  );
}

// Eventos de un calendario suscrito o del cronograma: se miran, y se pueden copiar a un calendario propio.
function ReadOnlyEvent({ item, onClose }: { item: CalItem; onClose: () => void }) {
  const when = `${format(item.start, "dd/MM/yyyy HH:mm")} – ${format(item.end, "HH:mm")}`;
  return (
    <Modal
      open
      onClose={onClose}
      title={item.title}
      width={460}
      footer={
        <>
          <button
            className="btn btn-sm mr-auto"
            onClick={async () => {
              await saveEvent({
                calendarId: await defaultCalendarId(),
                title: item.title,
                start: item.start.toISOString(),
                end: item.end.toISOString(),
                allDay: item.allDay,
                location: item.location,
                description: item.description,
              });
              toast("Copiado a tu calendario.");
              onClose();
            }}
          >
            <CalendarPlus />
            Copiar a mi calendario
          </button>
          <button className="btn btn-sm" onClick={onClose}>
            Cerrar
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-[length:calc(13px*var(--ui-scale,1))]">
        <div className={clsx("border-l-2 pl-2 text-muted", CALENDAR_BORDER_L[item.color])}>{item.calendarName}</div>
        <div>{item.allDay ? `Todo el día · ${format(item.start, "dd/MM/yyyy")}` : when}</div>
        {item.location && (
          <div className="flex items-center gap-1.5 text-muted">
            <MapPin className="h-3.5 w-3.5" /> {item.location}
          </div>
        )}
        {item.description && <p className="whitespace-pre-wrap text-muted">{item.description}</p>}
        <p className="t-small text-faint">Este evento viene de un calendario suscrito: se cambia en su calendario de origen.</p>
      </div>
    </Modal>
  );
}

function EventEditor({ req, onClose }: { req: EventDialogRequest; onClose: () => void }) {
  const item = "item" in req ? req.item : undefined;
  const ev = item?.event;
  const occurrence = item?.occurrence ?? (ev ? new Date(ev.start) : undefined);
  const base: Partial<CalEvent> = ev ?? ("defaults" in req ? req.defaults : {});
  const length = ev ? new Date(ev.end).getTime() - new Date(ev.start).getTime() : 0;
  const initStart = occurrence ?? (base.start ? new Date(base.start) : nextHour());
  const initEnd = ev && occurrence ? new Date(occurrence.getTime() + length) : base.end ? new Date(base.end) : new Date(initStart.getTime() + 3_600_000);

  const calendars = useLocalCalendars();
  const subjects = useAllSubjects();
  const { openTaskDialog } = useAppState();
  const tasks = useLiveQuery(() => db.tasks.filter((t) => t.status !== "DONE" && t.status !== "INBOX_EMAIL").toArray(), []) ?? [];
  const linkedTask = useLiveQuery(async () => (base.taskId ? ((await db.tasks.get(base.taskId)) ?? null) : null), [base.taskId]);

  const [title, setTitle] = useState(base.title ?? "");
  const [location, setLocation] = useState(base.location ?? "");
  const [calendarId, setCalendarId] = useState(base.calendarId ?? "");
  const [category, setCategory] = useState<EventCategory | "">(base.category ?? "");
  const [status, setStatus] = useState<EventStatus>(base.status ?? "CONFIRMED");
  const [allDay, setAllDay] = useState(base.allDay ?? false);
  const [startDate, setStartDate] = useState(dateInput(initStart));
  const [startTime, setStartTime] = useState(timeInput(initStart));
  // En los de día completo, el fin guardado es exclusivo: se muestra el último día.
  const [endDate, setEndDate] = useState(dateInput(base.allDay ? new Date(initEnd.getTime() - 1) : initEnd));
  const [endTime, setEndTime] = useState(timeInput(initEnd));
  const [rec, setRec] = useState<Recurrence>(() => parseRecurrence(base.rrule, initStart));
  const [reminders, setReminders] = useState<number[]>(base.reminders ?? (ev ? [] : [15]));
  const [subjectId, setSubjectId] = useState(base.subjectId ?? "");
  const [taskId, setTaskId] = useState(base.taskId ?? "");
  const [description, setDescription] = useState(base.description ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Sin calendario elegido, el primero visible (o "Personal", que se crea solo).
  useEffect(() => {
    if (calendarId) return;
    void defaultCalendarId().then(setCalendarId);
  }, [calendarId]);

  const start = allDay ? combine(startDate, "00:00") : combine(startDate, startTime);
  const end = allDay ? (() => { const d = combine(endDate, "00:00"); d.setDate(d.getDate() + 1); return d; })() : combine(endDate, endTime);

  // Al mover el inicio, el fin se corre lo mismo (como en Thunderbird).
  const moveStart = (date: string, time: string) => {
    const prev = allDay ? combine(startDate, "00:00") : combine(startDate, startTime);
    const next = allDay ? combine(date, "00:00") : combine(date, time);
    const delta = next.getTime() - prev.getTime();
    const newEnd = new Date(combine(endDate, allDay ? "00:00" : endTime).getTime() + delta);
    setStartDate(date);
    setStartTime(time);
    setEndDate(dateInput(newEnd));
    setEndTime(timeInput(newEnd));
  };

  const setFreq = (freq: Freq | "WORKDAYS") => {
    if (freq === "WORKDAYS") setRec({ ...rec, freq: "WEEKLY", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"] });
    else setRec({ ...rec, freq });
  };

  async function onSave() {
    const clean = title.trim();
    if (!clean) return setError("Escribí un título para el evento.");
    if (end.getTime() < start.getTime()) return setError("El evento termina antes de empezar.");
    setError("");
    setSaving(true);
    try {
      const fields: Omit<CalEvent, "id" | "createdAt" | "updatedAt"> = {
        calendarId: calendarId || (await defaultCalendarId()),
        title: clean,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        category: category || undefined,
        status: status === "CONFIRMED" ? undefined : status,
        rrule: buildRRule(rec, start),
        exdates: ev?.exdates,
        reminders: reminders.length ? [...new Set(reminders)].sort((a, b) => a - b) : undefined,
        subjectId: subjectId || undefined,
        taskId: taskId || undefined,
        noteId: base.noteId,
      };
      if (ev && occurrence) {
        let scope: Scope = "all";
        if (ev.rrule) {
          const picked = await askScope("cambiar");
          if (!picked) return setSaving(false);
          scope = picked;
        }
        // Si cambió la regla, las fechas borradas de la vieja ya no aplican.
        if (fields.rrule !== ev.rrule) fields.exdates = undefined;
        await updateOccurrence(ev, occurrence, fields, scope);
      } else {
        await saveEvent(fields);
      }
      onClose();
    } catch {
      setError("No pudimos guardar el evento.");
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!ev || !occurrence) return;
    let scope: Scope = "all";
    if (ev.rrule) {
      const picked = await askScope("borrar");
      if (!picked) return;
      scope = picked;
    }
    await deleteOccurrence(ev, occurrence, scope);
    toast("Evento borrado.");
    onClose();
  }

  const footer = (
    <>
      {ev && (
        <>
          <button className="btn btn-ghost btn-sm" onClick={() => void onDelete()}>
            <Trash2 />
            Borrar
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => void duplicateEvent(ev, occurrence).then(() => (toast("Evento duplicado."), onClose()))}>
            <Copy />
            Duplicar
          </button>
          {!ev.taskId && (
            <button
              className="btn btn-ghost btn-sm"
              title="Crea una tarea con este evento y las deja vinculadas"
              onClick={() => void eventToTask(ev, occurrence).then(() => (toast("Tarea creada."), onClose()))}
            >
              <ListTodo />
              Convertir en tarea
            </button>
          )}
        </>
      )}
      <span className="flex-1" />
      <button className="btn btn-sm" onClick={onClose}>
        Cancelar
      </button>
      <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void onSave()}>
        Guardar
      </button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={ev ? "Editar evento" : "Nuevo evento"} footer={footer} width={640} className="max-h-[90vh]">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        <input
          className={clsx("w-full bg-transparent t-h2 outline-none placeholder:text-faint", error && !title.trim() && "text-rose")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título del evento"
          aria-label="Título"
          autoFocus
        />
        {error && <p className="t-small text-rose">{error}</p>}

        <div className="flex flex-col">
          <Prop label="Lugar">
            <input className={clsx(CONTROL, "flex-1")} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Aula, link de la videollamada…" />
          </Prop>
          <Prop label="Calendario">
            <Select className={CONTROL} value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Prop>
          <Prop label="Categoría">
            <Select className={CONTROL} value={category} onChange={(e) => setCategory(e.target.value as EventCategory | "")}>
              <option value="">Sin categoría</option>
              {(Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((c) => (
                <option key={c} value={c}>
                  {EVENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Prop>
          <Prop label="Todo el día">
            <label className="flex h-7 items-center gap-2 px-2 text-[length:calc(13px*var(--ui-scale,1))]">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-[var(--primary)]" />
              Dura el día entero
            </label>
          </Prop>
          <Prop label="Empieza">
            <input type="date" className={CONTROL} value={startDate} onChange={(e) => e.target.value && moveStart(e.target.value, startTime)} aria-label="Fecha de inicio" />
            {!allDay && <input type="time" className={clsx(CONTROL, "w-28")} value={startTime} onChange={(e) => e.target.value && moveStart(startDate, e.target.value)} aria-label="Hora de inicio" />}
          </Prop>
          <Prop label="Termina">
            <input type="date" className={CONTROL} value={endDate} onChange={(e) => e.target.value && setEndDate(e.target.value)} aria-label="Fecha de fin" />
            {!allDay && <input type="time" className={clsx(CONTROL, "w-28")} value={endTime} onChange={(e) => e.target.value && setEndTime(e.target.value)} aria-label="Hora de fin" />}
            {!allDay && end > start && (
              <span className="t-small text-faint">
                {(() => {
                  const min = Math.round((end.getTime() - start.getTime()) / 60000);
                  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
                })()}
              </span>
            )}
          </Prop>
          <Prop label="Repetir">
            <Select
              className={CONTROL}
              value={rec.freq === "WEEKLY" && rec.interval === 1 && rec.byDay.length === 5 && !rec.byDay.includes("SA") && !rec.byDay.includes("SU") ? "WORKDAYS" : rec.freq}
              onChange={(e) => setFreq(e.target.value as Freq | "WORKDAYS")}
            >
              <option value="NONE">No se repite</option>
              <option value="DAILY">Cada día</option>
              <option value="WORKDAYS">De lunes a viernes</option>
              <option value="WEEKLY">Cada semana</option>
              <option value="MONTHLY">Cada mes</option>
              <option value="YEARLY">Cada año</option>
            </Select>
            {rec.freq !== "NONE" && <Repeat className="h-3.5 w-3.5 text-faint" />}
          </Prop>
          {rec.freq !== "NONE" && (
            <div className="ml-[148px] flex flex-col gap-2 rounded-md border border-border p-2.5 text-[length:calc(13px*var(--ui-scale,1))]">
              <div className="flex flex-wrap items-center gap-2">
                Cada
                <input type="number" min={1} max={99} className="input h-7 w-16" value={rec.interval} onChange={(e) => setRec({ ...rec, interval: Math.max(1, Number(e.target.value) || 1) })} />
                {{ DAILY: "día(s)", WEEKLY: "semana(s)", MONTHLY: "mes(es)", YEARLY: "año(s)", NONE: "" }[rec.freq]}
              </div>
              {rec.freq === "WEEKLY" && (
                <div className="flex gap-1">
                  {DAY_CODES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={rec.byDay.includes(d)}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-[length:calc(12px*var(--ui-scale,1))] aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
                      onClick={() => setRec({ ...rec, byDay: rec.byDay.includes(d) ? rec.byDay.filter((x) => x !== d) : [...rec.byDay, d] })}
                    >
                      {DAY_SHORT[d]}
                    </button>
                  ))}
                </div>
              )}
              {rec.freq === "MONTHLY" && (
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={rec.monthMode === "day"} onChange={() => setRec({ ...rec, monthMode: "day" })} className="accent-[var(--primary)]" />
                    El día {start.getDate()}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={rec.monthMode === "nth"} onChange={() => setRec({ ...rec, monthMode: "nth" })} className="accent-[var(--primary)]" />
                    {describeRecurrence(buildRRule({ ...rec, monthMode: "nth", interval: 1, end: "never" }, start), start).replace(/^Cada mes, /, "")}
                  </label>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                Termina
                <Select className="input h-7 w-auto" value={rec.end} onChange={(e) => setRec({ ...rec, end: e.target.value as Recurrence["end"] })}>
                  <option value="never">Nunca</option>
                  <option value="until">El día…</option>
                  <option value="count">Después de…</option>
                </Select>
                {rec.end === "until" && <input type="date" className="input h-7 w-auto" value={rec.until} onChange={(e) => setRec({ ...rec, until: e.target.value })} />}
                {rec.end === "count" && (
                  <>
                    <input type="number" min={1} className="input h-7 w-16" value={rec.count} onChange={(e) => setRec({ ...rec, count: Math.max(1, Number(e.target.value) || 1) })} />
                    veces
                  </>
                )}
              </div>
              <div className="t-small text-faint">{describeRecurrence(buildRRule(rec, start), start)}</div>
            </div>
          )}
          <Prop label="Recordatorios">
            {reminders.map((m) => (
              <span key={m} className="badge gap-1">
                <Bell className="h-3 w-3" />
                {reminderLabel(m)}
                <button type="button" aria-label="Quitar recordatorio" className="text-faint hover:text-text" onClick={() => setReminders(reminders.filter((x) => x !== m))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <Select className={clsx(CONTROL, "w-auto")} value="" onChange={(e) => {
                if (e.target.value === "") return;
                setReminders([...reminders, Number(e.target.value)]);
                // Para que el aviso también salga como notificación del sistema.
                if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
              }}>
              <option value="">{reminders.length ? "Agregar otro…" : "Agregar recordatorio…"}</option>
              {REMINDER_OPTIONS.filter((o) => !reminders.includes(o.value)).map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Prop>
          <Prop label="Estado">
            <Select className={CONTROL} value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>
              {(Object.keys(STATUS_LABEL) as EventStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Prop>
          <Prop label="Materia">
            <Select className={CONTROL} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Sin materia</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Prop>
          <Prop label="Tarea">
            <Select className={clsx(CONTROL, "max-w-[280px]")} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">Sin tarea vinculada</option>
              {linkedTask && linkedTask.status === "DONE" && <option value={linkedTask.id}>{linkedTask.title} (hecha)</option>}
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </Select>
            {taskId && (
              <button
                type="button"
                className="text-[length:calc(12px*var(--ui-scale,1))] text-primary-soft hover:underline"
                onClick={async () => {
                  const t = await db.tasks.get(taskId);
                  if (t) openTaskDialog(t);
                }}
              >
                Abrir
              </button>
            )}
          </Prop>
        </div>

        <textarea className="input min-h-[90px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción, temas, qué llevar…" aria-label="Descripción" />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function nextHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
