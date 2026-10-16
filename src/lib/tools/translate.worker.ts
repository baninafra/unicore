// Worker del traductor: corre los modelos de traducción (Opus-MT, MarianMT de Helsinki-NLP en ONNX)
// con transformers.js fuera del hilo principal. Lo instancia lib/tools/translate.ts.
//
// Mensajes que recibe:
//   { type: "translate", id, text, steps: [{ model, prefix? }] }  traduce pasando por cada modelo
//   { type: "download", id, models: string[] }                     baja los modelos (quedan en caché)
// Mensajes que manda:
//   { type: "progress", id, model, loaded, total }
//   { type: "done", id, text? }   |   { type: "error", id, error }

import { env, pipeline, type TranslationPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

const loaded = new Map<string, Promise<TranslationPipeline>>();

function load(model: string, id: string): Promise<TranslationPipeline> {
  let p = loaded.get(model);
  if (!p) {
    p = pipeline("translation", `Xenova/${model}`, {
      dtype: "q8",
      progress_callback: (info: { status?: string; loaded?: number; total?: number; file?: string }) => {
        if (info.status === "progress") self.postMessage({ type: "progress", id, model, file: info.file, loaded: info.loaded ?? 0, total: info.total ?? 0 });
      },
    }) as Promise<TranslationPipeline>;
    p.catch(() => loaded.delete(model));
    loaded.set(model, p);
  }
  return p;
}

// Los modelos traducen mejor de a oraciones o párrafos cortos: se respeta el salto de línea.
async function run(tr: TranslationPipeline, text: string, prefix = ""): Promise<string> {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    const res = (await tr(prefix + para, { max_new_tokens: 512 })) as { translation_text: string }[];
    out.push(res.map((r) => r.translation_text).join(" "));
  }
  return out.join("\n");
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as
    | { type: "translate"; id: string; text: string; steps: { model: string; prefix?: string }[] }
    | { type: "download"; id: string; models: string[] };
  try {
    if (msg.type === "download") {
      for (const m of msg.models) await load(m, msg.id);
      self.postMessage({ type: "done", id: msg.id });
      return;
    }
    let text = msg.text;
    for (const step of msg.steps) text = await run(await load(step.model, msg.id), text, step.prefix);
    self.postMessage({ type: "done", id: msg.id, text });
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
