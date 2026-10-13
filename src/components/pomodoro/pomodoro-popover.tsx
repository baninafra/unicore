"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Pause, Play, SkipForward, Square } from "lucide-react";
import clsx from "clsx";
import { db } from "@/lib/db";
import type { Subject } from "@/lib/types";
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

// Panel que se abre desde el chip. Muestra el reloj grande y los controles.
export function PomodoroPopover({ s, now, subjects }: { s: PomodoroState; now: number; subjects: Subject[] }) {
  const todayIso = startOfTodayIso();
  const sessions = useLiveQuery(() => db.studySessions.where("completedAt").aboveOrEqual(todayIso).toArray(), [todayIso]);
  const minutesToday = (sessions ?? []).reduce((acc, x) => acc + x.durationMinutes, 0);

  const total = phaseTotalMs(s);
  const remaining = remainingAt(s, now);
  const pct = total > 0 ? ((total - remaining) / total) * 100 : 0;
  const cursando = subjects.filter((x) => x.status === "CURSANDO").sort((a, b) => a.name.localeCompare(b.name));
  const phaseLabel =
    s.phase === "focus" ? `Foco · ${(s.completedFocus % POMODORO_CYCLE) + 1} de ${POMODORO_CYCLE}` : s.longBreak ? "Descanso largo" : "Descanso";

  return (
    <div role="dialog" aria-label="Reloj Pomodoro" className="card shadow-pop absolute right-0 top-full z-40 mt-2 flex w-[300px] flex-col gap-4">
      <span className="t-label">{phaseLabel}</span>

      <div className="flex items-center gap-2" role="group" aria-label="Modo">
        {(Object.keys(POMODORO_MODES) as PomodoroMode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={s.status !== "idle"}
            aria-pressed={s.mode === m}
            onClick={() => setMode(m)}
            className={clsx("badge cursor-pointer disabled:cursor-not-allowed disabled:opacity-60", s.mode === m && "badge-primary")}
          >
            {m.replace("/", " / ")}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Materia</span>
        <select className="input" value={s.subjectId ?? ""} onChange={(e) => setSubject(e.target.value || null)}>
          <option value="">Sin materia</option>
          {cursando.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>

      <div className="num t-timer text-center" style={{ fontSize: 48, lineHeight: "52px" }}>
        {formatClock(remaining)}
      </div>

      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <p className="t-small text-muted">Hoy llevás {formatDuration(minutesToday)}</p>

      <div className="flex flex-col gap-2">
        {s.status === "running" ? (
          <button type="button" className="btn btn-primary w-full" onClick={pause}>
            <Pause strokeWidth={1.75} />
            Pausar
          </button>
        ) : (
          <button type="button" className="btn btn-primary w-full" onClick={start}>
            <Play strokeWidth={1.75} />
            {s.status === "paused" ? "Reanudar" : "Empezar"}
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-sm" onClick={skip}>
            <SkipForward strokeWidth={1.75} />
            Saltar
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={finish} disabled={s.status === "idle" && s.phase === "focus"}>
            <Square strokeWidth={1.75} />
            Terminar
          </button>
        </div>
      </div>
    </div>
  );
}
