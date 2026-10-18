"use client";

// Ajustes > Calendarios: conectar Google Calendar, Outlook, iCloud o cualquier calendario con enlace iCal.

import { useRef, useState } from "react";
import { t } from "@/lib/i18n";
import clsx from "clsx";
import { FileUp, Link2, RefreshCw, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { shortDateTime } from "@/lib/format";
import { toast } from "@/lib/undo";
import {
  CALENDAR_BORDER_L,
  CALENDAR_COLORS,
  CALENDAR_COLOR_LABEL,
  addCalendar,
  removeCalendar,
  syncCalendar,
  useCalendars,
} from "@/lib/calendars/sync";
import type { CalendarColor, CalendarSource } from "@/lib/types";
import { useSettings } from "./apply-settings";
import { Heading, Row, Segmented, Toggle } from "./settings-ui";

type Provider = "google" | "outlook" | "icloud" | "otro";

const PROVIDERS: { value: Provider; label: string; name: string; steps: string }[] = [
  {
    value: "google",
    label: "Google Calendar",
    name: "Google Calendar",
    steps: t(
      "Entrá a calendar.google.com, abrí Configuración y elegí tu calendario. En \"Integrar el calendario\" copiá la \"Dirección secreta en formato iCal\" y pegala acá.",
    ),
  },
  {
    value: "outlook",
    label: "Outlook",
    name: "Outlook",
    steps: t(
      "En Outlook.com abrí Configuración, Calendario, Calendarios compartidos. En \"Publicar un calendario\" elegí el calendario y \"Puede ver todos los detalles\", tocá Publicar y copiá el enlace ICS.",
    ),
  },
  {
    value: "icloud",
    label: "Apple iCloud",
    name: "iCloud",
    steps: t(
      "En icloud.com/calendar tocá el ícono de compartir junto a tu calendario, activá \"Calendario público\" y copiá el enlace (empieza con webcal://).",
    ),
  },
  {
    value: "otro",
    label: t("Otro"),
    name: t("Calendario"),
    steps: t(
      "Sirve cualquier enlace que termine en .ics: el campus virtual, Moodle, el calendario de la facultad, Notion. Buscá la opción \"Exportar\" o \"Suscribirse\" y copiá el enlace.",
    ),
  },
];

const SYNC_OPTIONS = [
  { value: "0", label: t("A mano") },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 h" },
  { value: "360", label: "6 h" },
];

function ColorPicker({ value, onChange }: { value: CalendarColor; onChange: (c: CalendarColor) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label={t("Color")}>
      {CALENDAR_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={value === c}
          title={CALENDAR_COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={clsx(
            "btn btn-sm border-l-2 aria-pressed:bg-primary-tint aria-pressed:text-primary-soft",
            CALENDAR_BORDER_L[c],
          )}
        >
          {CALENDAR_COLOR_LABEL[c]}
        </button>
      ))}
    </div>
  );
}

function CalendarCard({ cal }: { cal: CalendarSource }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function sync() {
    setBusy(true);
    await syncCalendar(cal);
    setBusy(false);
  }

  return (
    <div className={clsx("card space-y-2 border-l-2 p-3", CALENDAR_BORDER_L[cal.color])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-h3 truncate">{cal.name}</p>
          <p className="t-small text-muted">
            {cal.url ? t("Enlace iCal") : t("Archivo .ics")}
            {cal.eventCount !== undefined && (cal.eventCount === 1 ? t(" · {n} evento", { n: cal.eventCount }) : t(" · {n} eventos", { n: cal.eventCount }))}
            {cal.lastSync && t(" · sincronizado {fecha}", { fecha: shortDateTime(cal.lastSync) })}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="t-small text-muted">{t("Visible")}</span>
          <Toggle checked={cal.enabled} onChange={(v) => void db.calendars.update(cal.id, { enabled: v })} label={t("Mostrar {name}", { name: cal.name })} />
        </div>
      </div>

      {cal.error && <p className="t-small text-rose">{cal.error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <ColorPicker value={cal.color} onChange={(color) => void db.calendars.update(cal.id, { color })} />
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void sync()}>
            <RefreshCw strokeWidth={1.75} className={clsx(busy && "animate-spin")} />
            {t("Sincronizar")}
          </button>
          {confirm ? (
            <>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void removeCalendar(cal.id)}>
                {t("Quitar")}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setConfirm(false)}>
                {t("Cancelar")}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => setConfirm(true)} aria-label={t("Quitar {name}", { name: cal.name })}>
              <Trash2 strokeWidth={1.75} />
              {t("Quitar")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AddCalendar() {
  const [provider, setProvider] = useState<Provider>("google");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [color, setColor] = useState<CalendarColor>("cyan");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const info = PROVIDERS.find((p) => p.value === provider)!;
  const calendars = useCalendars();

  function nextColor() {
    setColor(CALENDAR_COLORS[(calendars.length + 1) % CALENDAR_COLORS.length]);
  }

  async function connect() {
    setError(undefined);
    if (!/^(https?|webcal):\/\//i.test(url.trim())) {
      setError(t("Pegá el enlace completo del calendario. Empieza con https:// o webcal://."));
      return;
    }
    setBusy(true);
    const cal = await addCalendar({ name: name || info.name, url, color });
    setBusy(false);
    if (cal.error) {
      // No dejamos un calendario roto: se quita y se muestra el motivo.
      setError(cal.error);
      await removeCalendar(cal.id);
      return;
    }
    toast(t("Conectamos {name}: {n} eventos.", { name: cal.name, n: cal.eventCount ?? 0 }));
    setName("");
    setUrl("");
    nextColor();
  }

  async function importFile(file: File) {
    setError(undefined);
    const text = await file.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      setError(t("Ese archivo no es un calendario. Probá con un archivo .ics."));
      return;
    }
    const cal = await addCalendar({ name: name || file.name.replace(/\.ics$/i, ""), ics: text, color });
    toast(t("Importamos {name}: {n} eventos.", { name: cal.name, n: cal.eventCount ?? 0 }));
    setName("");
    nextColor();
  }

  return (
    <div className="card space-y-3 p-4">
      <p className="t-h3">{t("Conectar un calendario")}</p>
      <Segmented value={provider} options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))} onChange={setProvider} />
      <p className="t-small text-muted">{info.steps}</p>

      <label className="field">
        <span>{t("Nombre")}</span>
        <input className="input" value={name} placeholder={info.name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>{t("Enlace del calendario")}</span>
        <input
          className={clsx("input", error && "input-error")}
          value={url}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && void connect()}
        />
      </label>
      <div className="field">
        <span>{t("Color")}</span>
        <ColorPicker value={color} onChange={setColor} />
      </div>
      {error && <p className="t-small text-rose">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={busy || !url.trim()} onClick={() => void connect()}>
          <Link2 strokeWidth={1.75} />
          {busy ? t("Conectando…") : t("Conectar")}
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <FileUp strokeWidth={1.75} />
          {t("Importar archivo .ics")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
      </div>

      <p className="t-small text-faint">
        {t("El enlace da acceso a tu calendario: tratalo como una contraseña. Queda guardado sólo en este equipo. Los eventos se ven en UniCore pero se editan en el calendario de origen.")}
      </p>
    </div>
  );
}

export function CalendarSection() {
  const calendars = useCalendars();
  const [settings, update] = useSettings();

  return (
    <>
      <Heading>{t("Calendarios conectados")}</Heading>
      <div className="flex flex-col gap-3">
        {calendars.length === 0 ? <p className="t-small py-1 text-faint">{t("Todavía no conectaste ningún calendario.")}</p> : calendars.map((c) => <CalendarCard key={c.id} cal={c} />)}
        <AddCalendar />
      </div>

      <Heading>{t("Preferencias")}</Heading>
      <Row label={t("Sincronizar automáticamente")}>
        <Segmented
          value={String(settings.calendarSyncMinutes)}
          options={SYNC_OPTIONS}
          onChange={(v) => update({ calendarSyncMinutes: Number(v) })}
        />
      </Row>
      <Row label={t("La semana empieza el")}>
        <Segmented
          value={settings.weekStart}
          options={[
            { value: "lun", label: t("Lunes") },
            { value: "dom", label: t("Domingo") },
          ]}
          onChange={(weekStart) => update({ weekStart })}
        />
      </Row>
      <Row label={t("Mostrar tareas hechas en el calendario")}>
        <Toggle checked={settings.showDoneTasks} onChange={(v) => update({ showDoneTasks: v })} label={t("Mostrar tareas hechas en el calendario")} />
      </Row>
      <Row label={t("Mostrar el cronograma de las materias")}>
        <Toggle checked={settings.showCronogramas} onChange={(v) => update({ showCronogramas: v })} label={t("Mostrar el cronograma de las materias")} />
      </Row>
    </>
  );
}
