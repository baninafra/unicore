"use client";

import { useState, type FormEvent } from "react";
import { ArrowLeft, ExternalLink, RotateCw } from "lucide-react";

// Solo dejamos http y https dentro del marco: lo demás se trata como una dirección web.
function normalize(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// Visor web: barra fina y la página embebida. Algunas páginas no se dejan embeber; por eso
// siempre queda el enlace para abrirlas en el navegador del sistema.
export function WebView({ url }: { url: string }) {
  const [seen, setSeen] = useState(url);
  const [history, setHistory] = useState<string[]>([normalize(url)]);
  const [draft, setDraft] = useState(normalize(url));
  const [frameKey, setFrameKey] = useState(0);

  // Si cambia la dirección de la vista, reiniciamos el historial del visor.
  if (seen !== url) {
    setSeen(url);
    setHistory([normalize(url)]);
    setDraft(normalize(url));
  }

  const current = history[history.length - 1];

  const go = (next: string) => {
    const target = normalize(next);
    if (!target) return;
    setHistory((h) => [...h, target]);
    setDraft(target);
  };

  const back = () => {
    if (history.length < 2) return;
    const prev = history[history.length - 2];
    setHistory((h) => h.slice(0, -1));
    setDraft(prev);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    go(draft);
  };

  const openExternal = () => window.open(current, "_blank");

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-9 flex-none items-center gap-1 border-b border-border bg-bg px-2">
        <button type="button" className="icon-btn" onClick={back} disabled={history.length < 2} aria-label="Atrás">
          <ArrowLeft strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setFrameKey((k) => k + 1)} aria-label="Recargar">
          <RotateCw strokeWidth={1.75} />
        </button>
        <form onSubmit={onSubmit} className="min-w-0 flex-1">
          <input
            className="input h-7 text-[length:calc(13px*var(--ui-scale,1))]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Dirección"
            spellCheck={false}
          />
        </form>
        <button type="button" className="icon-btn" onClick={openExternal} aria-label="Abrir en el navegador">
          <ExternalLink strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-none px-3 py-1">
        <button type="button" className="text-[length:calc(12px*var(--ui-scale,1))] text-faint hover:text-muted" onClick={openExternal}>
          ¿No carga? Abrir en el navegador
        </button>
      </div>

      <iframe
        key={frameKey}
        src={current}
        title="Página web"
        className="min-h-0 w-full flex-1 border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
