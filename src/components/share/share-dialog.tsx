"use client";

// Ventanas de "Compartir nota" (anfitrión) y "Unirse a una nota compartida" (invitado),
// y el puente que mantiene el título igual en todas las PCs.

import { useEffect, useState, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";
import { Check, Copy, Users } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { db, nowIso } from "@/lib/db";
import { createNote } from "@/components/notes/note-utils";
import { pickFolder } from "@/components/shell/folder-picker";
import { useWorkspace } from "@/lib/workspace";
import { toast } from "@/lib/undo";
import {
  joinShare,
  parseShareLink,
  setShareName,
  shareLink,
  shareOf,
  shareUser,
  startShare,
  stopShare,
  subscribeShares,
  type ShareSession,
} from "@/lib/share/share";

// La sesión de una nota, y que la vista se actualice cuando entra o sale alguien.
let version = 0;
subscribeShares(() => version++);
export function useShare(noteId: string | undefined): ShareSession | undefined {
  useSyncExternalStore(subscribeShares, () => version, () => 0);
  return shareOf(noteId);
}

function NameField() {
  const [name, setName] = useState(() => shareUser().name);
  return (
    <label className="field">
      <span>{t("Tu nombre (lo ven los demás en tu cursor)")}</span>
      <input
        className="input"
        value={name}
        placeholder={t("Ej.: Fede")}
        onChange={(e) => {
          setName(e.target.value);
          setShareName(e.target.value);
        }}
      />
    </label>
  );
}

const peopleText = (n: number) => (n === 0 ? t("Todavía no se conectó nadie") : n === 1 ? t("1 persona conectada") : t("{n} personas conectadas", { n }));

export function ShareDialog({ noteId, title, onClose }: { noteId: string; title: string; onClose: () => void }) {
  const share = useShare(noteId);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const link = share ? shareLink(share) : "";

  return (
    <Modal
      open
      onClose={onClose}
      title={share?.role === "invitado" ? t("Nota compartida") : t("Compartir nota")}
      width={480}
      footer={
        share ? (
          <>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                stopShare(noteId);
                onClose();
              }}
            >
              {share.role === "anfitrion" ? t("Dejar de compartir") : t("Desconectarme")}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t("Listo")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              {t("Cancelar")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={starting}
              onClick={async () => {
                setStarting(true);
                try {
                  await startShare(noteId, title);
                } catch {
                  toast(t("No se pudo empezar a compartir. Revisá la conexión a internet."), { tone: "error" });
                } finally {
                  setStarting(false);
                }
              }}
            >
              <Users />
              {starting ? t("Preparando…") : t("Compartir")}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {!share && (
          <p className="t-small text-muted">
            {t("Te damos un link para pasarle a quien quieras. Se conecta directo a tu PC y escriben los dos a la vez en esta nota; cada uno se guarda una copia. Tu app tiene que quedar abierta mientras editan.")}
          </p>
        )}
        <NameField />
        {share?.role === "anfitrion" && (
          <div className="field">
            <span>{t("Link para invitar")}</span>
            <div className="flex gap-2">
              <input className="input min-w-0 flex-1 font-mono text-[length:calc(12px*var(--ui-scale,1))]" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void navigator.clipboard.writeText(link).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                  })
                }
              >
                {copied ? <Check /> : <Copy />}
                {copied ? t("Copiado") : t("Copiar")}
              </button>
            </div>
            <span className="t-small font-normal text-faint">{t("El otro lo pega en «Unirse a una nota compartida» (barra izquierda o Ctrl+P).")}</span>
          </div>
        )}
        {share && (
          <p className="t-small flex items-center gap-2 text-muted">
            <span className={share.peers.length ? "h-2 w-2 rounded-full bg-mint" : "h-2 w-2 rounded-full bg-faint"} />
            {share.role === "invitado" && !share.synced ? t("Conectando con el anfitrión…") : peopleText(share.peers.length)}
          </p>
        )}
      </div>
    </Modal>
  );
}

// "Unirse a una nota compartida": se abre desde la barra izquierda o la paleta.
const JOIN_EVENT = "uc:share-join";
export function openJoinDialog() {
  window.dispatchEvent(new Event(JOIN_EVENT));
}

export function JoinDialogHost() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { openView } = useWorkspace();
  const link = parseShareLink(text);

  useEffect(() => {
    const show = () => {
      setText("");
      setOpen(true);
    };
    window.addEventListener(JOIN_EVENT, show);
    return () => window.removeEventListener(JOIN_EVENT, show);
  }, []);

  if (!open) return null;

  const join = async () => {
    if (!link) return;
    // Se elige dónde queda la copia local de la nota.
    setOpen(false);
    const to = await pickFolder(t("¿Dónde guardo la nota compartida?"));
    if (!to) return;
    setBusy(true);
    try {
      const id = await createNote({ subjectId: to, title: t("Nota compartida"), unitNumber: 1 });
      await joinShare(id, link);
      openView({ type: "nota", id }, "tab");
      toast(t("Conectando con el anfitrión…"));
    } catch {
      toast(t("No se pudo conectar. Revisá el link y la conexión a internet."), { tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      title={t("Unirse a una nota compartida")}
      width={480}
      footer={
        <>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            {t("Cancelar")}
          </button>
          <button type="button" className="btn btn-primary" disabled={!link || busy} onClick={() => void join()}>
            {t("Unirme")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="field">
          <span>{t("Link que te pasaron")}</span>
          <input
            className="input font-mono text-[length:calc(12px*var(--ui-scale,1))]"
            autoFocus
            value={text}
            placeholder="unicore://unirse/…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void join()}
          />
          {text && !link && <span className="t-small font-normal text-rose">{t("Ese link no parece de UniCore.")}</span>}
        </label>
        <NameField />
      </div>
    </Modal>
  );
}

// Mantiene el título igual en todas las PCs: el anfitrión lo publica y el invitado lo copia.
export function ShareTitleBridge({ noteId, title }: { noteId: string; title: string }) {
  const share = useShare(noteId);
  useEffect(() => {
    if (!share || share.role !== "anfitrion") return;
    if (share.meta.get("title") !== title) share.meta.set("title", title);
  }, [share, title]);
  useEffect(() => {
    if (!share || share.role !== "invitado") return;
    const apply = () => {
      const t = share.meta.get("title");
      if (t) void db.notes.update(noteId, { title: t, updatedAt: nowIso() });
    };
    apply();
    share.meta.observe(apply);
    return () => share.meta.unobserve(apply);
  }, [share, noteId]);
  return null;
}
