"use client";

// Versión de escritorio (Tauri): todo se guarda en Documentos\UniCore.
// La interfaz sigue usando IndexedDB (Dexie); acá espejamos cada cambio a la base SQLite
// y a la carpeta "archivos", y al abrir la app restauramos desde el disco, que es la copia que manda.
// En el navegador (npm run dev) estas funciones no hacen nada.

import { db } from "./db";
import type { StoredFile } from "./types";

const TABLES = ["degrees", "subjects", "tasks", "notes", "documents", "files", "flashcards", "studySessions"] as const;
type TableName = (typeof TABLES)[number];
type Row = { id: string } & Record<string, unknown>;
type DiskFile = Omit<StoredFile, "blob"> & { diskName: string };

export function isDesktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args, headers ? { headers } : undefined);
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

// Nombre en disco: <id>.<extensión>
function diskName(f: Pick<StoredFile, "id" | "name" | "type">) {
  const fromName = f.name.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  const ext = (fromName ?? MIME_EXT[f.type] ?? "bin").toLowerCase();
  return `${f.id}.${ext}`;
}

// Las escrituras a disco van en fila, en el mismo orden en que pasaron.
let chain: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  chain = chain.then(task).catch((e) => console.error("[UniCore] no se pudo guardar en la carpeta de datos", e));
}

async function pushPut(table: TableName, row: Row) {
  if (table === "files") {
    const file = row as unknown as StoredFile;
    const { blob, ...meta } = file;
    if (blob) {
      await call("file_write", new Uint8Array(await blob.arrayBuffer()), { "x-file": diskName(file) });
    }
    await call("db_put", { table, id: file.id, data: { ...meta, diskName: diskName(file) } });
    return;
  }
  await call("db_put", { table, id: row.id, data: row });
}

async function pushDelete(table: TableName, id: string, old?: Row) {
  if (table === "files" && old) await call("file_delete", { file: diskName(old as unknown as StoredFile) });
  await call("db_delete", { table, id });
}

let paused = false;
let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  for (const name of TABLES) {
    const table = db.table(name);
    table.hook("creating", function (pk, obj) {
      if (paused) return;
      this.onsuccess = (key) => enqueue(() => pushPut(name, { ...(obj as Row), id: (obj as Row).id ?? String(key) }));
    });
    table.hook("updating", function () {
      if (paused) return;
      this.onsuccess = (updated) => enqueue(() => pushPut(name, updated as Row));
    });
    table.hook("deleting", function (pk, obj) {
      if (paused) return;
      this.onsuccess = () => enqueue(() => pushDelete(name, String(pk), obj as Row));
    });
  }
}

// Se llama una vez al abrir la app, antes de mostrar nada.
export async function initDesktopStorage(): Promise<void> {
  if (!isDesktop()) return;
  installHooks();

  const dump = await call<Record<string, Row[]>>("db_dump");
  const hasDiskData = Object.values(dump).some((rows) => rows.length > 0);

  if (!hasDiskData) {
    // Primera vez: si había datos de antes en esta ventana, los pasamos a la carpeta.
    for (const t of TABLES) {
      const rows = (await db.table(t).toArray()) as Row[];
      if (!rows.length) continue;
      if (t === "files") for (const r of rows) await pushPut("files", r);
      else await call("db_put_many", { table: t, records: rows });
    }
    return;
  }

  const files = await Promise.all(
    ((dump.files ?? []) as unknown as DiskFile[]).map(async (f) => {
      try {
        const bytes = await call<ArrayBuffer>("file_read", { file: f.diskName });
        const { diskName: _ignored, ...meta } = f;
        void _ignored;
        return { ...meta, blob: new Blob([bytes], { type: f.type }) } as StoredFile;
      } catch {
        return null; // el archivo se borró a mano de la carpeta
      }
    }),
  );

  paused = true;
  try {
    await db.transaction("rw", db.tables, async () => {
      for (const t of TABLES) {
        const table = db.table(t);
        await table.clear();
        const rows = t === "files" ? files.filter((f): f is StoredFile => f !== null) : (dump[t] ?? []);
        if (rows.length) await table.bulkPut(rows);
      }
    });
  } finally {
    paused = false;
  }
}

export async function getDataFolder(): Promise<string | undefined> {
  if (!isDesktop()) return undefined;
  return call<string>("data_dir");
}

export async function openDataFolder() {
  if (isDesktop()) await call("open_data_folder");
}
