"use client";

// Carpeta libre (o proyecto) con el nombre que quieras y el ícono que elijas.
// Se abre desde cualquier lado con openFolderDialog(); también sirve para cambiarle el nombre o el ícono a una existente.

import { useEffect, useState } from "react";
import clsx from "clsx";
import { db, newId, nowIso } from "@/lib/db";
import { FOLDER_ICONS } from "@/lib/folder-icons";
import { useDegrees } from "@/lib/hooks";
import { kindOf, profileOfDegree, PROFILES, useProfiles } from "@/lib/profiles";
import type { Subject } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { useWorkspace } from "@/lib/workspace";

export type FolderDialogRequest =
  | { degreeId?: string; item?: boolean } // nueva carpeta (item: un proyecto/materia en vez de una carpeta libre)
  | { subject: Subject }; // cambiar nombre o ícono

const EVENT = "uc:folder-dialog";
export function openFolderDialog(req: FolderDialogRequest = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: req }));
}

function FolderDialog({ req, onClose }: { req: FolderDialogRequest; onClose: () => void }) {
  const { singleSpace, activeProfile, profiles, inScope, termsFor } = useProfiles();
  const { openView } = useWorkspace();
  const editing = "subject" in req ? req.subject : undefined;
  const asItem = !editing && "item" in req && !!req.item;
  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? (asItem ? "kanban" : "folder"));
  const [degreeId, setDegreeId] = useState(editing?.degreeId ?? ("degreeId" in req ? req.degreeId : undefined) ?? "");
  const degrees = useDegrees();

  // Sin un espacio elegido: el del perfil activo, o el primero que se ve.
  useEffect(() => {
    if (degreeId || !degrees.length) return;
    const own = activeProfile ? degrees.find((d) => profileOfDegree(profiles, d)?.id === activeProfile.id) : undefined;
    setDegreeId(singleSpace?.id ?? own?.id ?? degrees.find((d) => inScope(d.id))?.id ?? degrees[0].id);
  }, [degreeId, degrees, singleSpace, activeProfile, profiles, inScope]);

  const terms = termsFor(degreeId || undefined);
  const what = editing ? (editing.folder ? "carpeta" : terms.item.one) : asItem ? terms.item.one : "carpeta";
  const fem = editing ? editing.folder || terms.item.f : asItem ? terms.item.f : true;
  const title = editing ? `Editar ${what}` : `${fem ? "Nueva" : "Nuevo"} ${what}`;
  const options = degrees.filter((d) => inScope(d.id) || d.id === degreeId);

  async function save() {
    const clean = name.trim();
    if (!clean || !degreeId) return;
    if (editing) {
      await db.subjects.update(editing.id, { name: clean, icon });
    } else {
      const id = newId();
      await db.subjects.add({
        id,
        degreeId,
        name: clean,
        icon,
        folder: asItem ? undefined : true,
        year: 1,
        semester: 1,
        status: "CURSANDO",
        correlatives: [],
        createdAt: nowIso(),
      });
      openView({ type: "materia", id });
    }
    onClose();
  }

  const Preview = FOLDER_ICONS[icon] ?? FOLDER_ICONS.folder;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim() || !degreeId} onClick={() => void save()}>
            {editing ? "Guardar" : "Crear"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-md bg-primary-tint text-primary-soft">
            <Preview className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <input
            className="input h-11 flex-1"
            autoFocus
            value={name}
            placeholder={`Nombre ${fem ? "de la" : "del"} ${what}`}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
          />
        </div>

        {!editing && options.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className="t-small font-medium text-muted">Dónde</span>
            <select className="input" value={degreeId} onChange={(e) => setDegreeId(e.target.value)}>
              {options.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {PROFILES[kindOf(d)].label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!degrees.length && <p className="t-small text-rose">Primero creá un perfil (abajo a la izquierda, junto a Ajustes).</p>}

        <div className="flex flex-col gap-1.5">
          <span className="t-small font-medium text-muted">Ícono</span>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5">
            {Object.entries(FOLDER_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={icon === key}
                onClick={() => setIcon(key)}
                className={clsx(
                  "flex h-10 items-center justify-center rounded-md border",
                  icon === key ? "border-primary bg-primary-tint text-primary-soft" : "border-transparent text-muted hover:bg-surface-raised hover:text-text",
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Se monta una vez en la raíz.
export function FolderDialogHost() {
  const [req, setReq] = useState<FolderDialogRequest | null>(null);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const show = (e: Event) => {
      setReq((e as CustomEvent<FolderDialogRequest>).detail ?? {});
      setKey((k) => k + 1);
    };
    window.addEventListener(EVENT, show);
    return () => window.removeEventListener(EVENT, show);
  }, []);
  return req ? <FolderDialog key={key} req={req} onClose={() => setReq(null)} /> : null;
}
