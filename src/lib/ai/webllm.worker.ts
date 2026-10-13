// Worker dedicado: corre el motor de WebLLM fuera del hilo principal para no trabar la UI.
// Sólo lo instancia ai-provider.tsx con `new Worker(new URL("./webllm.worker.ts", import.meta.url))`.

import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (msg: MessageEvent) => {
  handler.onmessage(msg);
};
