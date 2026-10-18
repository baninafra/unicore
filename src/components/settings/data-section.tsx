"use client";

// Ajustes > Datos: carpeta de datos, resumen de lo guardado y copia de seguridad.

import { useEffect, useRef, useState } from "react";
import { t, intlLocale } from "@/lib/i18n";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, FolderOpen, Upload } from "lucide-react";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { getDataFolder, isDesktop, openDataFolder } from "@/lib/desktop";
import { saveBlob } from "@/lib/export/save";
import { toast } from "@/lib/undo";
import { Heading, Hint, Row } from "./settings-ui";

// Tablas que entran en la copia. Los archivos (PDF y fotos) quedan afuera: están en la carpeta de datos.
const BACKUP_TABLES = [
  "degrees",
  "subjects",
  "tasks",
  "notes",
  "documents",
  "flashcards",
  "studySessions",
  "canvases",
  "snapshots",
  "bookmarks",
  "calendars",
] as const;

export function useCounts() {
  return useLiveQuery(async () => {
    const [carreras, materias, notas, tareas, flashcards, pdfs] = await Promise.all([
      db.degrees.count(),
      db.subjects.count(),
      db.notes.count(),
      db.tasks.count(),
      db.flashcards.count(),
      db.documents.count(),
    ]);
    return { carreras, materias, notas, tareas, flashcards, pdfs };
  }, []);
}

async function exportBackup() {
  const tables: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) tables[name] = await db.table(name).toArray();
  const json = JSON.stringify({ app: "unicore", version: 1, exportedAt: new Date().toISOString(), tables });
  await saveBlob(t("unicore-copia-{fecha}.json", { fecha: format(new Date(), "yyyy-MM-dd") }), new Blob([json], { type: "application/json" }));
}

async function importBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text()) as { app?: string; tables?: Record<string, unknown[]> };
  if (data.app !== "unicore" || !data.tables) throw new Error("formato");
  let total = 0;
  await db.transaction("rw", BACKUP_TABLES.map((t) => db.table(t)), async () => {
    for (const name of BACKUP_TABLES) {
      const rows = (data.tables![name] ?? []).filter((r): r is { id: string } => typeof (r as { id?: unknown })?.id === "string");
      if (rows.length) await db.table(name).bulkPut(rows);
      total += rows.length;
    }
  });
  return total;
}

export function DataSection() {
  const [folder, setFolder] = useState<string>();
  const desktop = isDesktop();
  const counts = useCounts();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!desktop) return;
    getDataFolder()
      .then((path) => setFolder(path))
      .catch(() => setFolder(undefined));
  }, [desktop]);

  return (
    <>
      <Heading>{t("Almacenamiento")}</Heading>
      <Row label={t("Carpeta de datos")}>
        {desktop ? (
          <>
            <span className="t-small max-w-[320px] truncate text-muted" title={folder}>
              {folder ?? "–"}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => void openDataFolder()} aria-label={t("Abrir carpeta de datos")}>
              <FolderOpen strokeWidth={1.75} />
              {t("Abrir")}
            </button>
          </>
        ) : (
          <span className="t-small text-faint">{t("Solo en la app de escritorio")}</span>
        )}
      </Row>
      {counts &&
        (
          [
            [t("Carreras"), counts.carreras],
            [t("Materias"), counts.materias],
            [t("Notas"), counts.notas],
            [t("Tareas"), counts.tareas],
            [t("Flashcards"), counts.flashcards],
            [t("PDF de bibliografía"), counts.pdfs],
          ] as const
        ).map(([label, n]) => (
          <Row key={label} label={label}>
            <span className="t-small num text-muted">{n.toLocaleString(intlLocale())}</span>
          </Row>
        ))}

      <Heading>{t("Copia de seguridad")}</Heading>
      <Hint>
        {t("La copia incluye carreras, materias, notas, tareas, flashcards, lienzos y calendarios conectados. Los PDF y las fotos no entran: quedan en la carpeta de datos.")}
      </Hint>
      <Row label={t("Guardar una copia")}>
        <button type="button" className="btn btn-sm" onClick={() => void exportBackup().catch(() => toast(t("No pudimos guardar la copia. Probá de nuevo."), { tone: "error" }))}>
          <Download strokeWidth={1.75} />
          {t("Exportar")}
        </button>
      </Row>
      <Row label={t("Restaurar desde una copia")}>
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
          <Upload strokeWidth={1.75} />
          {t("Importar")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            importBackup(f)
              .then((n) => toast(t("Restauramos {n} registros. Lo que ya existía con el mismo id se reemplazó.", { n: n.toLocaleString(intlLocale()) }), { ms: 6000 }))
              .catch(() => toast(t("No pudimos leer esa copia. Elegí un archivo exportado desde UniCore."), { tone: "error" }));
          }}
        />
      </Row>
    </>
  );
}
