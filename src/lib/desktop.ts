"use client";

// Versión de escritorio (Tauri): todo se guarda en Documentos\UniCore.
// La interfaz sigue usando IndexedDB (Dexie); acá espejamos cada cambio a la base SQLite
// y a la carpeta "archivos", y al abrir la app restauramos desde el disco, que es la copia que manda.
// La base lleva un número de revisión: si coincide con el último que vio la interfaz, IndexedDB
// ya está igual al disco y el arranque se saltea la restauración.

import { db } from "./db";
import type { StoredFile } from "./types";

const TABLES = [
  "degrees",
  "subjects",
  "tasks",
  "notes",
  "documents",
  "files",
  "flashcards",
  "studySessions",
  "canvases",
  "snapshots",
  "bookmarks",
  "calendars", // calendarEvents no se espeja: es una copia que se regenera al sincronizar
  "officeDocs",
  "events",
] as const;
// Tablas que se sumaron al espejo después: si el disco todavía no tiene nada de ellas,
// lo que hay en IndexedDB se sube en lugar de borrarse.
const LATE_TABLES: readonly TableName[] = ["officeDocs", "events"];
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

// Última revisión del disco que IndexedDB tiene entera ("<uid de la base>:<revisión>").
// Sin valor: hay que restaurar al abrir.
const REV_KEY = "uc-disk-rev";
let diskUid = "";
let knownRev: number | null = null;
function setKnownRev(rev: number | null) {
  knownRev = rev;
  try {
    if (rev === null) localStorage.removeItem(REV_KEY);
    else localStorage.setItem(REV_KEY, `${diskUid}:${rev}`);
  } catch {}
}
function readKnownRev(): string | null {
  try {
    return localStorage.getItem(REV_KEY);
  } catch {
    return null;
  }
}
async function diskRev(): Promise<number> {
  const [uid, rev] = await call<[string, number]>("db_rev");
  diskUid = uid;
  return rev;
}
// Cada escritura propia sube la revisión en uno. Si saltó más, alguien más escribió (el MCP)
// y al próximo arranque conviene restaurar.
function afterWrite(prev: number | null, rev: number) {
  setKnownRev(prev !== null && rev === prev + 1 ? rev : null);
}

// Las escrituras a disco van en fila, en el mismo orden en que pasaron.
let chain: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>) {
  chain = chain
    .then(async () => {
      const prev = knownRev;
      // Si se corta a mitad de camino, el próximo arranque restaura desde el disco.
      if (prev !== null) setKnownRev(null);
      knownRev = prev;
      await task();
    })
    .catch((e) => {
      setKnownRev(null);
      console.error("[UniCore] no se pudo guardar en la carpeta de datos", e);
    });
}

async function pushPut(table: TableName, row: Row) {
  if (table === "files") {
    const file = row as unknown as StoredFile;
    const { blob, ...meta } = file;
    if (blob) {
      await call("file_write", new Uint8Array(await blob.arrayBuffer()), { "x-file": diskName(file) });
    }
    afterWrite(knownRev, await call<number>("db_put", { table, id: file.id, data: { ...meta, diskName: diskName(file) } }));
    return;
  }
  afterWrite(knownRev, await call<number>("db_put", { table, id: row.id, data: row }));
}

async function pushDelete(table: TableName, id: string, old?: Row) {
  if (table === "files" && old) await call("file_delete", { file: diskName(old as unknown as StoredFile) });
  afterWrite(knownRev, await call<number>("db_delete", { table, id }));
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

  // IndexedDB ya tiene todo lo del disco: no hay nada que recargar.
  const rev = await diskRev();
  const [notes, subjects] = await Promise.all([db.notes.count(), db.subjects.count()]);
  if (readKnownRev() === `${diskUid}:${rev}` && (rev === 0 || notes + subjects > 0)) {
    knownRev = rev;
    return;
  }

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
    setKnownRev(await diskRev());
    return;
  }

  // Los archivos que IndexedDB ya tiene (mismo id y tamaño) no se vuelven a leer del disco.
  const cached = new Map((await db.files.toArray()).map((f) => [f.id, f]));
  const files = await Promise.all(
    ((dump.files ?? []) as unknown as DiskFile[]).map(async (f) => {
      const hit = cached.get(f.id);
      if (hit?.blob && hit.size === f.size) {
        const { diskName: _ignored, ...meta } = f;
        void _ignored;
        return { ...meta, blob: hit.blob } as StoredFile;
      }
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

  const late: TableName[] = [];
  for (const t of LATE_TABLES) {
    if ((dump[t] ?? []).length > 0) continue;
    const rows = (await db.table(t).toArray()) as Row[];
    if (rows.length) {
      await call("db_put_many", { table: t, records: rows });
      late.push(t);
    }
  }

  paused = true;
  try {
    await db.transaction("rw", db.tables, async () => {
      for (const t of TABLES) {
        if (late.includes(t)) continue;
        const table = db.table(t);
        await table.clear();
        const rows = t === "files" ? files.filter((f): f is StoredFile => f !== null) : (dump[t] ?? []);
        if (rows.length) await table.bulkPut(rows);
      }
    });
  } finally {
    paused = false;
  }
  setKnownRev(rev);
}

// Lo que escriben otras IAs por MCP (unicore.exe --mcp) entra a la app cada pocos segundos.
let syncStarted = false;
export function startExternalSync() {
  if (!isDesktop() || syncStarted) return;
  syncStarted = true;
  let since = "9999-12-31 00:00:00";
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const [now, changes] = await call<[string, Record<string, Row[]>]>("db_changes_since", { since });
      const first = since.startsWith("9999");
      since = now;
      if (first) return;
      const tables = Object.keys(changes).filter((t) => (TABLES as readonly string[]).includes(t) && t !== "files");
      if (!tables.length) return;
      paused = true;
      try {
        await db.transaction("rw", tables.map((t) => db.table(t)), async () => {
          for (const t of tables) await db.table(t).bulkPut(changes[t]);
        });
      } finally {
        paused = false;
      }
    } catch (e) {
      console.error("[UniCore] no se pudieron leer los cambios externos", e);
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(tick, 3000);
  window.addEventListener("focus", () => void tick());
}

export async function getDataFolder(): Promise<string | undefined> {
  if (!isDesktop()) return undefined;
  return call<string>("data_dir");
}

export async function openDataFolder() {
  if (isDesktop()) await call("open_data_folder");
}
