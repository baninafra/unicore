"use client";

// Notas compartidas en vivo, estilo Google Docs, sin servidor propio.
// - Yjs guarda el texto como un documento colaborativo: dos personas escriben a la vez sin pisarse.
// - Trystero conecta las PCs directo por WebRTC. Para el primer contacto usa relays públicos y gratuitos
//   (Nostr); lo que se escribe viaja de PC a PC, cifrado con la clave que va dentro del link.
// - Cada uno guarda su copia de la nota en su disco, como cualquier otra nota.
// El anfitrión tiene que tener la app abierta mientras los demás editan.

import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { Room } from "trystero";

export type ShareRole = "anfitrion" | "invitado";

export interface ShareSession {
  noteId: string;
  room: string;
  secret: string;
  role: ShareRole;
  doc: Y.Doc;
  fragment: Y.XmlFragment;
  meta: Y.Map<string>;
  awareness: Awareness;
  peers: string[]; // ids de las PCs conectadas
  synced: boolean; // el invitado ya recibió el contenido del anfitrión
  needsSeed: boolean; // el anfitrión todavía no cargó la nota en el documento compartido
}

const APP_ID = "unicore-notas-compartidas";
const LINK_PREFIX = "unicore://unirse/";
const COLORS = ["#7c6cf2", "#e5568a", "#2bb39b", "#e8a33d", "#4f9be8", "#c75ce0", "#5dbb4f"];

const sessions = new Map<string, ShareSession & { leave: () => void }>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function subscribeShares(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function shareOf(noteId: string | undefined): ShareSession | undefined {
  return noteId ? sessions.get(noteId) : undefined;
}

export function shareLink(s: Pick<ShareSession, "room" | "secret">): string {
  return `${LINK_PREFIX}${s.room}.${s.secret}`;
}

// Acepta el link entero o sólo el código ("sala.clave").
export function parseShareLink(text: string): { room: string; secret: string } | null {
  const m = text.trim().replace(LINK_PREFIX, "").match(/^([a-z0-9]{8,})\.([a-z0-9]{8,})$/i);
  return m ? { room: m[1], secret: m[2] } : null;
}

const randomId = (n: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
};

// Nombre y color que ven los demás en tu cursor.
export function shareUser(role?: ShareRole): { name: string; color: string } {
  let name = "";
  try {
    name = localStorage.getItem("uc-share-name") ?? "";
  } catch {}
  let hash = 0;
  for (const ch of name || "x") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { name: name || (role === "anfitrion" ? "Anfitrión" : role === "invitado" ? "Invitado" : ""), color: COLORS[hash % COLORS.length] };
}

export function setShareName(name: string) {
  try {
    localStorage.setItem("uc-share-name", name.trim());
  } catch {}
  for (const s of sessions.values()) s.awareness.setLocalStateField("user", shareUser(s.role));
}

async function open(noteId: string, room: string, secret: string, role: ShareRole, title?: string): Promise<ShareSession> {
  const { joinRoom } = await import("trystero");
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("document");
  const meta = doc.getMap<string>("meta");
  if (title) meta.set("title", title);
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", shareUser(role));

  const conn: Room = joinRoom({ appId: APP_ID, password: secret }, room);
  const sync = conn.makeAction<Uint8Array>("sync");
  const aware = conn.makeAction<Uint8Array>("aware");
  // Qué clientes de Yjs vinieron de cada PC (para borrar su cursor cuando se va).
  const clientsByPeer = new Map<string, Set<number>>();

  const session: ShareSession & { leave: () => void } = {
    noteId,
    room,
    secret,
    role,
    doc,
    fragment,
    meta,
    awareness,
    peers: [],
    synced: role === "anfitrion",
    needsSeed: role === "anfitrion",
    leave: () => {
      doc.off("update", onDoc);
      awareness.off("update", onAware);
      removeAwarenessStates(awareness, [doc.clientID], "local");
      void conn.leave();
      awareness.destroy();
      doc.destroy();
    },
  };

  // Lo que cambia acá va a los demás; lo que llega de afuera no se reenvía.
  const onDoc = (update: Uint8Array, origin: unknown) => {
    if (origin !== conn) void sync.send(update);
  };
  const onAware = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === conn) return;
    void aware.send(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
  };
  doc.on("update", onDoc);
  awareness.on("update", onAware);

  sync.onMessage = (data) => {
    Y.applyUpdate(doc, new Uint8Array(data as unknown as ArrayBuffer), conn);
    if (!session.synced) {
      session.synced = true;
      emit();
    }
  };
  aware.onMessage = (data, { peerId }) => {
    const update = new Uint8Array(data as unknown as ArrayBuffer);
    const before = new Set(awareness.getStates().keys());
    applyAwarenessUpdate(awareness, update, conn);
    const mine = clientsByPeer.get(peerId) ?? new Set<number>();
    for (const id of awareness.getStates().keys()) if (!before.has(id) && id !== doc.clientID) mine.add(id);
    clientsByPeer.set(peerId, mine);
  };

  conn.onPeerJoin = (peerId) => {
    session.peers = [...new Set([...session.peers, peerId])];
    // Al que llega le mandamos todo lo que tenemos (texto y cursores).
    void sync.send(Y.encodeStateAsUpdate(doc), { target: peerId });
    void aware.send(encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]), { target: peerId });
    emit();
  };
  conn.onPeerLeave = (peerId) => {
    session.peers = session.peers.filter((p) => p !== peerId);
    const gone = clientsByPeer.get(peerId);
    if (gone?.size) removeAwarenessStates(awareness, [...gone], conn);
    clientsByPeer.delete(peerId);
    emit();
  };

  sessions.set(noteId, session);
  emit();
  return session;
}

// El anfitrión comparte una nota suya: devuelve el link para pasarle a los demás.
export async function startShare(noteId: string, title: string): Promise<ShareSession> {
  return sessions.get(noteId) ?? open(noteId, randomId(12), randomId(16), "anfitrion", title);
}

// El invitado se une con el link; la nota local (ya creada) queda atada a la sala.
export async function joinShare(noteId: string, link: { room: string; secret: string }): Promise<ShareSession> {
  return open(noteId, link.room, link.secret, "invitado");
}

export function stopShare(noteId: string) {
  const s = sessions.get(noteId);
  if (!s) return;
  sessions.delete(noteId);
  s.leave();
  emit();
}

export function markSeeded(noteId: string) {
  const s = sessions.get(noteId);
  if (s) s.needsSeed = false;
}
