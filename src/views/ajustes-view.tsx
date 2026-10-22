"use client";

import { checkForUpdates } from "@/components/shell/update-checker";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { getLang, LANGS, setLang, t, intlLocale, type Lang } from "@/lib/i18n";
import { useAppState } from "@/lib/app-state";
import { isDesktop } from "@/lib/desktop";
import { useWorkspace } from "@/lib/workspace";
import { useSettings } from "@/components/settings/apply-settings";
import { AISection } from "@/components/settings/ai-section";
import { ProfilesSection } from "@/components/settings/profiles-section";
import { CalendarSection } from "@/components/settings/calendar-section";
import { DataSection, useCounts } from "@/components/settings/data-section";
import { DEFAULT_SETTINGS } from "@/components/settings/apply-settings";
import { Hint, Row, Segmented, Slider, Toggle } from "@/components/settings/settings-ui";

const SECTIONS = [
  { key: "perfiles", label: t("Perfiles") },
  { key: "apariencia", label: t("Apariencia") },
  { key: "editor", label: t("Editor") },
  { key: "calendarios", label: t("Calendarios") },
  { key: "notificaciones", label: t("Notificaciones") },
  { key: "ia", label: t("IA") },
  { key: "atajos", label: t("Atajos") },
  { key: "datos", label: t("Datos") },
  { key: "acerca", label: t("Acerca de") },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

// "Ctrl+Shift+D" a partir de "Mod+Shift+D"
function hotkeyParts(hotkey: string) {
  return hotkey
    .split("+")
    .map((p) => (p.toLowerCase() === "mod" ? "Ctrl" : p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)));
}

function Apariencia() {
  const { theme, toggleTheme } = useAppState();
  const [settings, update] = useSettings();
  return (
    <>
      <Row label={t("Idioma")}>
        <select className="input w-[180px]" value={getLang()} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("Idioma")}>
          {LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Tema de colores")}>
        <Segmented
          value={theme}
          options={[
            { value: "dark", label: t("Oscuro") },
            { value: "light", label: t("Claro") },
          ]}
          onChange={(next) => {
            if (next !== theme) toggleTheme();
          }}
        />
      </Row>
      <Row label={t("Tamaño de texto de la interfaz")}>
        <Slider value={settings.uiFont} min={12} max={20} onChange={(v) => update({ uiFont: v })} />
      </Row>
      <Row label={t("Tamaño de texto del editor")}>
        <Slider value={settings.editorFont} min={14} max={24} onChange={(v) => update({ editorFont: v })} />
      </Row>
      <Row label={t("Limitar ancho de lectura")}>
        <Toggle checked={settings.readableWidth} onChange={(v) => update({ readableWidth: v })} label={t("Limitar ancho de lectura")} />
      </Row>
      <Row label={t("Restablecer apariencia")}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            update({ uiFont: DEFAULT_SETTINGS.uiFont, editorFont: DEFAULT_SETTINGS.editorFont, readableWidth: DEFAULT_SETTINGS.readableWidth })
          }
        >
          {t("Restablecer")}
        </button>
      </Row>
    </>
  );
}

function Editor() {
  const [settings, update] = useSettings();
  return (
    <>
      <Row label={t("Tipografía")}>
        <Segmented
          value={settings.editorFamily}
          options={[
            { value: "sans", label: t("Sans") },
            { value: "serif", label: t("Serif") },
            { value: "mono", label: t("Monoespaciada") },
          ]}
          onChange={(editorFamily) => update({ editorFamily })}
        />
      </Row>
      <Row label={t("Espaciado entre líneas")}>
        <Segmented
          value={settings.editorSpacing}
          options={[
            { value: "compacto", label: t("Compacto") },
            { value: "normal", label: t("Normal") },
            { value: "amplio", label: t("Amplio") },
          ]}
          onChange={(editorSpacing) => update({ editorSpacing })}
        />
      </Row>
      <Row label={t("Corrector ortográfico")}>
        <Toggle checked={settings.spellcheck} onChange={(v) => update({ spellcheck: v })} label={t("Corrector ortográfico")} />
      </Row>
      <Row label={t("Mostrar conteo de palabras")}>
        <Toggle checked={settings.wordCount} onChange={(v) => update({ wordCount: v })} label={t("Mostrar conteo de palabras")} />
      </Row>
    </>
  );
}

function Atajos() {
  const { commands } = useWorkspace();
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commands
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.hotkey ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [commands, query]);

  return (
    <div className="flex flex-col gap-2">
      <input
        className="input h-7 max-w-xs"
        placeholder={t("Buscar comando")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={t("Buscar comando")}
      />
      {list.length === 0 ? (
        <p className="t-small text-faint py-2">{t("Sin resultados")}</p>
      ) : (
        <div className="flex flex-col">
          {list.map((c) => (
            <div key={c.id} className="row justify-between">
              <span className="truncate">{c.name}</span>
              {c.hotkey ? (
                <span className="flex flex-none items-center gap-1">
                  {hotkeyParts(c.hotkey).map((k, i) => (
                    <span key={i} className="kbd">
                      {k}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notificaciones() {
  const [settings, update] = useSettings();
  const rows: { key: keyof typeof settings; label: string }[] = [
    { key: "notifOverdue", label: t("Entregas vencidas") },
    { key: "notifToday", label: t("Lo que vence hoy") },
    { key: "notifTomorrow", label: t("Lo que vence mañana") },
    { key: "notifUpcoming", label: t("Parciales, finales y entregas de los próximos días") },
    { key: "notifReview", label: t("Flashcards para repasar") },
    { key: "notifEvents", label: t("Eventos de tus calendarios (hoy y mañana)") },
  ];
  return (
    <>
      <Hint>{t("Elegí qué avisos aparecen en la campana y en Notificaciones.")}</Hint>
      {rows.map((r) => (
        <Row key={r.key} label={r.label}>
          <Toggle checked={settings[r.key] as boolean} onChange={(v) => update({ [r.key]: v })} label={r.label} />
        </Row>
      ))}
    </>
  );
}

function Acerca() {
  const counts = useCounts();
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<string>();
  useEffect(() => {
    if (isDesktop()) void import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setVersion);
  }, []);
  return (
    <>
      <Row label="UniCore">
        <span className="t-small num text-muted">{version || "0.4.0"}</span>
      </Row>
      {isDesktop() && (
        <Row label={t("Actualizaciones")}>
          {status && <span className="t-small text-muted">{status}</span>}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setStatus(t("Buscando…"));
              void checkForUpdates().then((r) =>
                setStatus(r === "nueva" ? t("Hay una versión nueva: mirá el aviso abajo") : r === "al-dia" ? t("Tenés la última versión") : t("No se pudo buscar (¿sin internet?)")),
              );
            }}
          >
            {t("Buscar actualizaciones")}
          </button>
        </Row>
      )}
      <Row label={t("Tus datos")}>
        <span className="t-small text-muted">{t("Se guardan en este equipo, sin cuenta")}</span>
      </Row>
      {counts && (
        <Row label={t("Notas · tareas · flashcards")}>
          <span className="t-small num text-muted">
            {counts.notas.toLocaleString(intlLocale())} · {counts.tareas.toLocaleString(intlLocale())} · {counts.flashcards.toLocaleString(intlLocale())}
          </span>
        </Row>
      )}
      <Row label={t("Paleta de comandos")}>
        <span className="kbd">Ctrl</span>
        <span className="kbd">K</span>
      </Row>
      <Row label={t("Asistente de IA")}>
        <span className="kbd">Ctrl</span>
        <span className="kbd">J</span>
      </Row>
    </>
  );
}

const CONTENT: Record<SectionKey, () => React.ReactElement> = {
  apariencia: Apariencia,
  editor: Editor,
  ia: AISection,
  atajos: Atajos,
  calendarios: CalendarSection,
  notificaciones: Notificaciones,
  perfiles: ProfilesSection,
  datos: DataSection,
  acerca: Acerca,
};

// Ajustes estilo Obsidian: secciones a la izquierda, opciones a la derecha.
export function AjustesView({ section }: { section?: string }) {
  const initial = SECTIONS.some((s) => s.key === section) ? (section as SectionKey) : "apariencia";
  const [current, setCurrent] = useState<SectionKey>(initial);
  const Content = CONTENT[current];

  return (
    <div className="flex min-h-full">
      <nav className="w-[200px] flex-none border-r border-border bg-bg px-2 py-4" aria-label={t("Secciones de ajustes")}>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-current={current === s.key ? "page" : undefined}
            onClick={() => setCurrent(s.key)}
            className={clsx("nav-item w-full text-left", current !== s.key && "text-muted")}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 px-8 py-6">
        <div className="max-w-[640px]">
          <Content />
        </div>
      </div>
    </div>
  );
}
