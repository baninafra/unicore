"use client";

// Traductor sin conexión (modelos chicos que se bajan por idioma; ver lib/tools/translate.ts).

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowLeftRight, Check, ChevronDown, ClipboardPaste, Copy, Download, Trash2, X } from "lucide-react";
import { insertBlocks } from "@/lib/nav/actions";
import { toast } from "@/lib/undo";
import { directions, downloadedModels, downloadModels, forgetModels, LANGS, modelsForLang, route, translate } from "@/lib/tools/translate";
import { Select } from "@/components/ui/select";
import { intlLocale, t } from "@/lib/i18n";

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
    setBusy(missing.length ? t("Bajando el idioma…") : t("Traduciendo…"));
    setPct(missing.length ? 0 : null);
    try {
      const res = await translate(text, from, to, (p) => {
        setPct(p);
        if (p >= 100) setBusy(t("Traduciendo…"));
      });
      setOut(res);
      setHave(downloadedModels());
    } catch (err) {
      toast(err instanceof Error ? t("No pudimos traducir: {message}", { message: err.message }) : t("No pudimos traducir. Revisá la conexión para bajar el idioma."), { tone: "error" });
    } finally {
      setBusy(null);
      setPct(null);
    }
  };

  const fetchLang = async (code: string) => {
    const models = modelsForLang(code);
    setBusy(t("Bajando {lang}…", { lang: LANGS.find((l) => l.code === code)?.name ?? code }));
    setPct(0);
    try {
      await downloadModels(models, (p) => setPct(p));
      setHave(downloadedModels());
      toast(t("Listo: ya podés traducir sin conexión"));
    } catch {
      toast(t("No pudimos bajar el idioma. Revisá la conexión y probá de nuevo."), { tone: "error" });
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

  // Con el idioma ya bajado, traduce solo mientras escribís (medio segundo después de parar).
  useEffect(() => {
    if (!text.trim()) {
      setOut("");
      return;
    }
    if (!steps || missing.length || busy) return;
    const t = window.setTimeout(() => void run(), 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, from, to, missing.length]);

  const swap = () => {
    savePair(to, from);
    if (out) {
      setText(out);
      setOut(text);
    }
  };
  const langName = (c: string) => LANGS.find((l) => l.code === c)?.name ?? c;
  const readyCount = LANGS.filter((l) => modelsForLang(l.code).every((m) => have.has(m))).length;

  return (
    <div className="tool-pane">
      {/* Idiomas: De ⇄ A en una sola barra */}
      <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1">
        <Select aria-label={t("Idioma de origen")} className="input h-8 min-w-0 flex-1 border-transparent bg-transparent" value={from} onChange={(e) => savePair(e.target.value, to === e.target.value ? from : to)}>
          {options}
        </Select>
        <button type="button" className="icon-btn h-8 w-8" title={t("Invertir idiomas")} aria-label={t("Invertir idiomas")} onClick={swap}>
          <ArrowLeftRight />
        </button>
        <Select aria-label={t("Idioma de destino")} className="input h-8 min-w-0 flex-1 border-transparent bg-transparent" value={to} onChange={(e) => savePair(from === e.target.value ? to : from, e.target.value)}>
          {options}
        </Select>
      </div>

      {/* Texto original */}
      <div className="rounded-md border border-border bg-surface focus-within:border-primary">
        <textarea
          className="block min-h-[110px] w-full resize-y bg-transparent px-3 pt-2.5 text-[length:calc(14px*var(--ui-scale,1))] leading-6 text-text outline-none placeholder:text-faint"
          placeholder={t("Escribí o pegá el texto en {lang}…", { lang: langName(from).toLowerCase() })}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void run();
          }}
        />
        <div className="flex items-center gap-1 px-2 pb-1.5">
          <span className="t-small num text-faint">{t("{n} caracteres", { n: text.length.toLocaleString(intlLocale()) })}</span>
          {text && (
            <button type="button" className="icon-btn ml-auto" title={t("Borrar el texto")} aria-label={t("Borrar el texto")} onClick={() => (setText(""), setOut(""))}>
              <X />
            </button>
          )}
        </div>
      </div>

      {!steps ? (
        <div className="t-small text-rose">{t("Todavía no hay un modelo para traducir de {from} a {to}.", { from: langName(from), to: langName(to) })}</div>
      ) : missing.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border-strong p-3">
          <span className="t-small text-muted">
            {missing.length === 1 ? t("Para traducir sin conexión hay que bajar un modelo de este idioma una sola vez (unos 100 MB).") : t("Para traducir sin conexión hay que bajar los modelos de este idioma una sola vez (unos 100 MB).")}
          </span>
          <button type="button" className="btn btn-primary self-start" disabled={!!busy} onClick={() => void run()}>
            <Download />
            {t("Bajar y traducir")}
          </button>
        </div>
      ) : null}

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

      {/* Traducción: siempre a la vista */}
      <div className="rounded-md border border-border bg-surface-raised">
        <div className={clsx("min-h-[110px] whitespace-pre-wrap px-3 pt-2.5 text-[length:calc(14px*var(--ui-scale,1))] leading-6", out ? "text-text" : "text-faint")}>
          {out || (busy === t("Traduciendo…") ? t("Traduciendo…") : t("La traducción al {lang} aparece acá", { lang: langName(to).toLowerCase() }))}
        </div>
        <div className="flex items-center justify-end gap-1 px-2 pb-1.5">
          <button
            type="button"
            className="icon-btn"
            disabled={!out}
            title={t("Copiar la traducción")}
            aria-label={t("Copiar la traducción")}
            onClick={() => void navigator.clipboard.writeText(out).then(() => toast(t("Copiamos la traducción")))}
          >
            <Copy />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={!out}
            title={t("Pegar la traducción al final de la nota abierta")}
            aria-label={t("Pegar en la nota")}
            onClick={() => insertBlocks(out.split("\n").map((p) => ({ type: "paragraph", content: p })))}
          >
            <ClipboardPaste />
          </button>
        </div>
      </div>

      {/* Idiomas sin conexión, plegado */}
      <div className="border-t border-border pt-2">
        <button type="button" className="flex w-full items-center gap-2 py-1 text-[length:calc(13px*var(--ui-scale,1))] text-muted hover:text-text" onClick={() => setShowLangs((v) => !v)} aria-expanded={showLangs}>
          <ChevronDown className={clsx("h-4 w-4 transition-transform", !showLangs && "-rotate-90")} strokeWidth={1.75} />
          {t("Idiomas sin conexión")}
          <span className="t-small ml-auto text-faint">{readyCount === 0 ? t("ninguno bajado") : t("{n} bajado{s}", { n: readyCount, s: readyCount === 1 ? "" : "s" })}</span>
        </button>
        {showLangs && (
          <div className="mt-1 flex flex-col gap-0.5">
            {LANGS.map((l) => {
              const ready = modelsForLang(l.code).every((m) => have.has(m));
              const dir = directions(l.code);
              const oneWay = !dir.toSpanish || !dir.fromSpanish;
              return (
                <div key={l.code} className="flex min-h-8 items-center gap-2 rounded-sm px-2 hover:bg-surface-raised">
                  <span className="text-[length:calc(13px*var(--ui-scale,1))]">{l.name}</span>
                  {oneWay && <span className="t-small text-faint">{dir.toSpanish ? t("sólo al español") : t("sólo desde el español")}</span>}
                  <span className="ml-auto" />
                  {ready ? (
                    <>
                      <span className="badge badge-mint">
                        <Check className="h-3 w-3" strokeWidth={2} />
                        {t("Listo")}
                      </span>
                      <button type="button" className="icon-btn" title={t("Quitar")} aria-label={t("Quitar {name}", { name: l.name })} onClick={() => void removeLang(l.code)}>
                        <Trash2 />
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void fetchLang(l.code)}>
                      <Download />
                      {t("Bajar")}
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
