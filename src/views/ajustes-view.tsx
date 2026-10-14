"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { FolderOpen } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { getDataFolder, isDesktop, openDataFolder } from "@/lib/desktop";
import { useWorkspace } from "@/lib/workspace";
import { useOpen } from "@/components/workspace/use-open";
import { useSettings } from "@/components/settings/apply-settings";
import { AISection } from "@/components/settings/ai-section";

const SECTIONS = [
  { key: "apariencia", label: "Apariencia" },
  { key: "editor", label: "Editor" },
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-6 border-b border-border py-1.5">
      <span className="t-small text-text">{label}</span>
      <div className="flex flex-none items-center gap-2">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="btn btn-sm aria-pressed:border-primary aria-pressed:bg-primary-tint aria-pressed:text-primary-soft"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer accent-primary"
    />
  );
}

function Slider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 accent-primary"
        aria-label="Tamaño"
      />
      <span className="t-small num w-12 text-right text-muted">{value} px</span>
    </>
  );
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
    </>
  );
}

function Editor() {
  const [settings, update] = useSettings();
  return (
    <>
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

function Datos() {
  const [folder, setFolder] = useState<string>();
  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    getDataFolder()
      .then((path) => setFolder(path))
      .catch(() => setFolder(undefined));
  }, [desktop]);

  return (
    <Row label="Carpeta de datos">
      {desktop ? (
        <>
          <span className="t-small max-w-[320px] truncate text-muted" title={folder}>
            {folder ?? "–"}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => void openDataFolder()} aria-label="Abrir carpeta de datos">
            <FolderOpen strokeWidth={1.75} />
            Abrir
          </button>
        </>
      ) : (
        <span className="t-small text-faint">Solo en la app de escritorio</span>
      )}
    </Row>
  );
}

function Acerca() {
  return (
    <>
      <Row label="UniCore">
        <span className="t-small num text-muted">0.1.0</span>
      </Row>
    </>
  );
}

const CONTENT: Record<SectionKey, () => React.ReactElement> = {
  apariencia: Apariencia,
  editor: Editor,
  ia: AISection,
  atajos: Atajos,
  carreras: Carreras,
  datos: Datos,
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
