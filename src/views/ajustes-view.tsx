"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useAppState } from "@/lib/app-state";
import { isDesktop } from "@/lib/desktop";
import { useWorkspace } from "@/lib/workspace";
import { useOpen } from "@/components/workspace/use-open";
import { useSettings } from "@/components/settings/apply-settings";
import { AISection } from "@/components/settings/ai-section";
import { CalendarSection } from "@/components/settings/calendar-section";
import { DataSection, useCounts } from "@/components/settings/data-section";
import { DEFAULT_SETTINGS } from "@/components/settings/apply-settings";
import { Hint, Row, Segmented, Slider, Toggle } from "@/components/settings/settings-ui";

const SECTIONS = [
  { key: "apariencia", label: "Apariencia" },
  { key: "editor", label: "Editor" },
  { key: "calendarios", label: "Calendarios" },
  { key: "notificaciones", label: "Notificaciones" },
  { key: "ia", label: "IA" },
  { key: "atajos", label: "Atajos" },
  { key: "carreras", label: "Carreras" },
  { key: "datos", label: "Datos" },
  { key: "acerca", label: "Acerca de" },
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
      <Row label="Tema">
        <Segmented
          value={theme}
          options={[
            { value: "dark", label: "Oscuro" },
            { value: "light", label: "Claro" },
          ]}
          onChange={(next) => {
            if (next !== theme) toggleTheme();
          }}
        />
      </Row>
      <Row label="Tamaño de texto de la interfaz">
        <Slider value={settings.uiFont} min={12} max={16} onChange={(v) => update({ uiFont: v })} />
      </Row>
      <Row label="Tamaño de texto del editor">
        <Slider value={settings.editorFont} min={14} max={20} onChange={(v) => update({ editorFont: v })} />
      </Row>
      <Row label="Limitar ancho de lectura">
        <Toggle checked={settings.readableWidth} onChange={(v) => update({ readableWidth: v })} label="Limitar ancho de lectura" />
      </Row>
      <Row label="Restablecer apariencia">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            update({ uiFont: DEFAULT_SETTINGS.uiFont, editorFont: DEFAULT_SETTINGS.editorFont, readableWidth: DEFAULT_SETTINGS.readableWidth })
          }
        >
          Restablecer
        </button>
      </Row>
    </>
  );
}

function Editor() {
  const [settings, update] = useSettings();
  return (
    <>
      <Row label="Tipografía">
        <Segmented
          value={settings.editorFamily}
          options={[
            { value: "sans", label: "Sans" },
            { value: "serif", label: "Serif" },
            { value: "mono", label: "Monoespaciada" },
          ]}
          onChange={(editorFamily) => update({ editorFamily })}
        />
      </Row>
      <Row label="Espaciado entre líneas">
        <Segmented
          value={settings.editorSpacing}
          options={[
            { value: "compacto", label: "Compacto" },
            { value: "normal", label: "Normal" },
            { value: "amplio", label: "Amplio" },
          ]}
          onChange={(editorSpacing) => update({ editorSpacing })}
        />
      </Row>
      <Row label="Corrector ortográfico">
        <Toggle checked={settings.spellcheck} onChange={(v) => update({ spellcheck: v })} label="Corrector ortográfico" />
      </Row>
      <Row label="Mostrar conteo de palabras">
        <Toggle checked={settings.wordCount} onChange={(v) => update({ wordCount: v })} label="Mostrar conteo de palabras" />
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
        placeholder="Buscar comando"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Buscar comando"
      />
      {list.length === 0 ? (
        <p className="t-small text-faint py-2">Sin resultados</p>
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

function Carreras() {
  const open = useOpen();
  return (
    <Row label="Mis carreras">
      <button type="button" className="btn btn-sm" onClick={(e) => open({ type: "carreras" }, e)}>
        Abrir
      </button>
    </Row>
  );
}

function Notificaciones() {
  const [settings, update] = useSettings();
  const rows: { key: keyof typeof settings; label: string }[] = [
    { key: "notifOverdue", label: "Entregas vencidas" },
    { key: "notifToday", label: "Lo que vence hoy" },
    { key: "notifTomorrow", label: "Lo que vence mañana" },
    { key: "notifUpcoming", label: "Parciales, finales y entregas de los próximos días" },
    { key: "notifReview", label: "Flashcards para repasar" },
    { key: "notifEvents", label: "Eventos de tus calendarios (hoy y mañana)" },
  ];
  return (
    <>
      <Hint>Elegí qué avisos aparecen en la campana y en Notificaciones.</Hint>
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
  return (
    <>
      <Row label="UniCore">
        <span className="t-small num text-muted">0.1.0</span>
      </Row>
      <Row label="Plataforma">
        <span className="t-small text-muted">{isDesktop() ? "Aplicación de escritorio" : "Navegador"}</span>
      </Row>
      <Row label="Tus datos">
        <span className="t-small text-muted">Se guardan en este equipo, sin cuenta</span>
      </Row>
      {counts && (
        <Row label="Notas · tareas · flashcards">
          <span className="t-small num text-muted">
            {counts.notas.toLocaleString("es-AR")} · {counts.tareas.toLocaleString("es-AR")} · {counts.flashcards.toLocaleString("es-AR")}
          </span>
        </Row>
      )}
      <Row label="Paleta de comandos">
        <span className="kbd">Ctrl</span>
        <span className="kbd">K</span>
      </Row>
      <Row label="Asistente de IA">
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
  carreras: Carreras,
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
      <nav className="w-[200px] flex-none border-r border-border bg-bg px-2 py-4" aria-label="Secciones de ajustes">
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
