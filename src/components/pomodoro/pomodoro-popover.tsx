"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Pause, Play, SkipForward, Square } from "lucide-react";
import { db } from "@/lib/db";
import { useAllSubjects } from "@/lib/hooks";
import {
  finish,
  formatClock,
  formatDuration,
  pause,
  phaseTotalMs,
  POMODORO_CYCLE,
  POMODORO_MODES,
  remainingAt,
  setMode,
  setSubject,
  skip,
  start,
  startOfTodayIso,
  type PomodoroMode,
  type PomodoroState,
} from "./pomodoro-store";
import { Select } from "@/components/ui/select";
import { t } from "@/lib/i18n";

// Panel del reloj: se abre hacia arriba desde la barra de estado, alineado a la derecha.
export function PomodoroPopover({ s, now }: { s: PomodoroState; now: number }) {
  const subjects = useAllSubjects();
  const todayIso = startOfTodayIso();
  const sessions = useLiveQuery(() => db.studySessions.where("completedAt").aboveOrEqual(todayIso).toArray(), [todayIso]);
  const minutesToday = (sessions ?? []).reduce((acc, x) => acc + x.durationMinutes, 0);

  const total = phaseTotalMs(s);
  const remaining = remainingAt(s, now);
  const pct = total > 0 ? ((total - remaining) / total) * 100 : 0;
  const cursando = subjects.filter((x) => x.status === "CURSANDO").sort((a, b) => a.name.localeCompare(b.name));
  const phaseLabel =
    s.phase === "focus" ? t("Foco {a}/{b}", { a: (s.completedFocus % POMODORO_CYCLE) + 1, b: POMODORO_CYCLE }) : s.longBreak ? t("Descanso largo") : t("Descanso");

  return (
    <div
      role="dialog"
      aria-label={t("Reloj Pomodoro")}
      className="card shadow-pop absolute bottom-full right-0 mb-1.5 flex w-[248px] flex-col gap-3 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label={t("Modo")}>
          {(Object.keys(POMODORO_MODES) as PomodoroMode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={s.status !== "idle"}
              aria-pressed={s.mode === m}
              onClick={() => setMode(m)}
              className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
            >
              {m}
            </button>
          ))}
        </div>
        <span className="t-small text-faint">{phaseLabel}</span>
      </div>

      <Select className="input h-7 px-2" value={s.subjectId ?? ""} onChange={(e) => setSubject(e.target.value || null)} aria-label={t("Materia")}>
        <option value="">{t("Sin materia")}</option>
        {cursando.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>

      <div className="num t-timer text-center" style={{ fontSize: 40, lineHeight: "44px" }}>
        {formatClock(remaining)}
      </div>

      <div className="progress" style={{ height: 2 }}>
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center gap-1.5">
        {s.status === "running" ? (
          <button type="button" className="btn btn-primary btn-sm flex-1" onClick={pause}>
            <Pause strokeWidth={1.75} />
            {t("Pausar")}
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm flex-1" onClick={start}>
            <Play strokeWidth={1.75} />
            {s.status === "paused" ? t("Reanudar") : t("Empezar")}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={skip} aria-label={t("Saltar fase")} title={t("Saltar fase")}>
          <SkipForward strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={finish}
          disabled={s.status === "idle" && s.phase === "focus"}
          aria-label={t("Terminar sesión")}
          title={t("Terminar sesión")}
        >
          <Square strokeWidth={1.75} />
        </button>
      </div>

      <div className="t-small num text-faint">{t("Hoy {duracion}", { duracion: formatDuration(minutesToday) })}</div>
    </div>
  );
}
