"use client";

// Traductor sin conexión (modelos chicos que se bajan por idioma; ver lib/tools/translate.ts).

import { useEffect, useState } from "react";
import { ArrowLeftRight, Check, ClipboardPaste, Copy, Download, Trash2 } from "lucide-react";
import { insertBlocks } from "@/lib/nav/actions";
import { toast } from "@/lib/undo";
import { directions, downloadedModels, downloadModels, forgetModels, LANGS, modelsForLang, route, translate } from "@/lib/tools/translate";
import { Select } from "@/components/ui/select";

const LS_PAIR = "uc-translate-pair";

export function TranslatorTool() {
  const [from, setFrom] = useState("en");
  const [to, setTo] = useState("es");
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [have, setHave] = useState<Set<string>>(new Set());
  const [showLangs, setShowLangs] = useState(false);

  useEffect(() => {
    setHave(downloadedModels());
    try {
      const [f, t] = (localStorage.getItem(LS_PAIR) ?? "").split(">");
      if (f && t) {
        setFrom(f);
        setTo(t);
      }
    } catch {}
  }, []);

  const savePair = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    try {
      localStorage.setItem(LS_PAIR, `${f}>${t}`);
    } catch {}
  };

  const steps = route(from, to);
  const missing = (steps ?? []).filter((s) => !have.has(s.model));
  const options = LANGS.map((l) => (
    <option key={l.code} value={l.code}>
      {l.name}
    </option>
  ));

  const run = async () => {
    if (!text.trim() || !steps) return;
    setBusy(missing.length ? "Bajando el idioma…" : "Traduciendo…");
    setPct(missing.length ? 0 : null);
    try {
      const res = await translate(text, from, to, (p) => {
        setPct(p);
        if (p >= 100) setBusy("Traduciendo…");
      });
      setOut(res);
      setHave(downloadedModels());
    } catch (err) {
      toast(err instanceof Error ? `No pudimos traducir: ${err.message}` : "No pudimos traducir. Revisá la conexión para bajar el idioma.", { tone: "error" });
    } finally {
      setBusy(null);
      setPct(null);
    }
  };

  const fetchLang = async (code: string) => {
    const models = modelsForLang(code);
    setBusy(`Bajando ${LANGS.find((l) => l.code === code)?.name ?? code}…`);
    setPct(0);
    try {
      await downloadModels(models, (p) => setPct(p));
      setHave(downloadedModels());
      toast("Listo: ya podés traducir sin conexión");
    } catch {
      toast("No pudimos bajar el idioma. Revisá la conexión y probá de nuevo.", { tone: "error" });
    } finally {
      setBusy(null);
      setPct(null);
    }
  };

  const removeLang = async (code: string) => {
    // Sólo se borran los modelos que no usa otro idioma bajado.
    const others = LANGS.filter((l) => l.code !== code && modelsForLang(l.code).every((m) => have.has(m))).flatMap((l) => modelsForLang(l.code));
    await forgetModels(modelsForLang(code).filter((m) => !others.includes(m)));
    setHave(downloadedModels());
  };

  return (
    <div className="tool-pane">
      <div className="flex items-end gap-1.5">
        <label className="field min-w-0 flex-1">
          <span>De</span>
          <Select value={from} onChange={(e) => savePair(e.target.value, to === e.target.value ? from : to)}>{options}</Select>
        </label>
        <button type="button" className="btn btn-ghost btn-icon mb-0.5" title="Invertir idiomas" aria-label="Invertir idiomas" onClick={() => {
          savePair(to, from);
          if (out) {
            setText(out);
            setOut(text);
          }
        }}>
          <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <label className="field min-w-0 flex-1">
          <span>A</span>
          <Select value={to} onChange={(e) => savePair(from === e.target.value ? to : from, e.target.value)}>{options}</Select>
        </label>
      </div>

      <textarea
        className="input min-h-[96px] resize-y"
        placeholder="Escribí o pegá el texto…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run();
        }}
      />

      {!steps ? (
        <div className="t-small text-rose">Todavía no hay un modelo para traducir de ese idioma a ese otro.</div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={!!busy || !text.trim()} onClick={() => void run()}>
          {missing.length ? <Download className="h-4 w-4" strokeWidth={1.75} /> : null}
          {missing.length ? "Bajar idioma y traducir" : "Traducir"}
          <span className="kbd ml-1">Ctrl Enter</span>
        </button>
      )}
      {missing.length > 0 && !busy && steps && (
        <div className="t-small text-faint">La primera vez se baja el modelo de ese idioma (unos 100 MB). Después funciona sin conexión.</div>
      )}

      {busy && (
        <div className="flex flex-col gap-1">
          <div className="t-small text-muted">
            {busy}
            {pct !== null && pct < 100 && ` ${pct}%`}
          </div>
          {pct !== null && (
            <div className="progress">
              <i style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      {out && (
        <div className="flex flex-col gap-2">
          <div className="whitespace-pre-wrap rounded-md border border-border bg-surface p-2 text-[14px]">{out}</div>
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(out).then(() => toast("Copiamos la traducción"))}>
              <Copy className="h-4 w-4" strokeWidth={1.75} />
              Copiar
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Agrega la traducción al final de la nota abierta"
              onClick={() => insertBlocks(out.split("\n").map((p) => ({ type: "paragraph", content: p })))}
            >
              <ClipboardPaste className="h-4 w-4" strokeWidth={1.75} />
              Pegar en la nota
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 border-t border-border pt-3">
        <button type="button" className="t-label text-muted hover:text-text" onClick={() => setShowLangs((v) => !v)}>
          {showLangs ? "Ocultar idiomas" : "Idiomas sin conexión"}
        </button>
        {showLangs && (
          <div className="mt-2 flex flex-col gap-0.5">
            {LANGS.map((l) => {
              const ready = modelsForLang(l.code).every((m) => have.has(m));
              const dir = directions(l.code);
              const oneWay = !dir.toSpanish || !dir.fromSpanish;
              return (
                <div key={l.code} className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-surface-raised">
                  <span className="text-[13px]">{l.name}</span>
                  {l.main && <span className="badge badge-primary">Principal</span>}
                  {oneWay && <span className="t-small text-faint">{dir.toSpanish ? "sólo al español" : "sólo desde el español"}</span>}
                  <span className="ml-auto" />
                  {ready ? (
                    <>
                      <span className="badge badge-mint">
                        <Check className="h-3 w-3" strokeWidth={2} />
                        Listo
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Quitar" aria-label={`Quitar ${l.name}`} onClick={() => void removeLang(l.code)}>
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void fetchLang(l.code)}>
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Bajar
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
