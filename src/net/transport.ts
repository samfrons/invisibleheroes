/**
 * How messages travel between the big screen and the phones.
 *
 * Three carriers behind one pair of interfaces. 'peer' is the real one: WebRTC
 * data channels through PeerJS, whose public broker only introduces the
 * devices; after that the presses go from phone to screen directly. 'relay'
 * sends every message through a hosted broadcast service (relay.ts), for
 * networks that keep devices from reaching each other; it is on only when
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set. 'local' is a
 * BroadcastChannel between tabs of one browser, for trying the phone screen on
 * a laptop and for tests; pick it with ?net=local (and the relay with ?net=relay).
 *
 * By default the big screen listens on PeerJS and, when configured, on the
 * relay at the same time, as one room; a phone tries PeerJS first and moves to
 * the relay by itself if that does not connect within GUEST_PEER_PATIENCE_MS.
 *
 * PeerJS and the relay are loaded on demand, so a visitor who never opens a
 * room never downloads them or talks to their servers.
 */
import { peerIdFor, type GuestMessage, type HostMessage } from './protocol';
import type { RelaySocket } from './relay';

export interface HostTransport {
  onJoin(listener: (guest: string) => void): void;
  onLeave(listener: (guest: string) => void): void;
  onMessage(listener: (guest: string, data: unknown) => void): void;
  /** The room itself failed (the broker dropped us). */
  onDown(listener: () => void): void;
  send(guest: string, message: HostMessage): void;
  close(): void;
}

export interface GuestTransport {
  /** The carrier this connection ended up on (the phone paces its pings by it). */
  readonly carrier: Carrier;
  onMessage(listener: (data: unknown) => void): void;
  /** The connection to the host ended. */
  onClose(listener: () => void): void;
  send(message: GuestMessage): void;
  close(): void;
}

export type Carrier = 'peer' | 'local' | 'relay';

/** Thrown by openHost when the code is already in use, so the caller can try another. */
export class RoomTakenError extends Error {}

const CONNECT_TIMEOUT_MS = 12000;

/* ------------------------------------------------------------------ peer */

async function peerHost(code: string): Promise<HostTransport> {
  const { Peer } = await import('peerjs');
  const peer = new Peer(peerIdFor(code), { debug: 0 });
  type Conn = ReturnType<typeof peer.connect>;
  const conns = new Map<string, Conn>();
  let join: (guest: string) => void = () => undefined;
  let leave: (guest: string) => void = () => undefined;
  let message: (guest: string, data: unknown) => void = () => undefined;
  let down: () => void = () => undefined;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The room could not be opened in time.')), CONNECT_TIMEOUT_MS);
    peer.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    peer.on('error', (error) => {
      clearTimeout(timer);
      reject(error.type === 'unavailable-id' ? new RoomTakenError() : error);
    });
  }).catch((error) => {
    peer.destroy();
    throw error;
  });

  peer.on('connection', (conn) => {
    const guest = conn.peer;
    const gone = () => {
      if (conns.get(guest) !== conn) return;
      conns.delete(guest);
      leave(guest);
    };
    conn.on('open', () => {
      conns.set(guest, conn);
      join(guest);
    });
    conn.on('data', (data) => message(guest, data));
    conn.on('close', gone);
    conn.on('error', gone);
  });
  // The broker connection can drop while the phones stay connected: try to get it back.
  peer.on('disconnected', () => {
    if (!peer.destroyed) peer.reconnect();
  });
  peer.on('close', () => down());
  // After the room is open, a broker error (a dropped socket, a guest that failed to reach us)
  // is not the room failing: the phones already connected stay connected.
  peer.on('error', () => undefined);

  return {
    onJoin: (listener) => void (join = listener),
    onLeave: (listener) => void (leave = listener),
    onMessage: (listener) => void (message = listener),
    onDown: (listener) => void (down = listener),
    send(guest, data) {
      const conn = conns.get(guest);
      if (conn?.open) void conn.send(data);
    },
    close() {
      conns.clear();
      peer.destroy();
    },
  };
}

async function peerGuest(code: string): Promise<GuestTransport> {
  const { Peer } = await import('peerjs');
  const peer = new Peer({ debug: 0 });
  let message: (data: unknown) => void = () => undefined;
  let closed: () => void = () => undefined;

  let fail: (error: unknown) => void = () => undefined;
  const conn = await new Promise<ReturnType<typeof peer.connect>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The room did not answer.')), CONNECT_TIMEOUT_MS);
    fail = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    peer.on('error', fail);
    peer.on('open', () => {
      // JSON keeps the wire readable; presses are tiny, so ordering costs nothing.
      const c = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
      c.on('open', () => {
        clearTimeout(timer);
        resolve(c);
      });
      c.on('error', fail);
    });
  }).catch((error) => {
    peer.destroy();
    throw error;
  });

  conn.on('data', (data) => message(data));
  conn.on('close', () => closed());
  conn.on('error', () => closed());
  // Once the phone and the screen are talking directly, the broker no longer matters: if its
  // socket drops, quietly ask for it back, and never mistake that for losing the room.
  peer.off('error', fail);
  peer.on('error', () => undefined);
  peer.on('disconnected', () => {
    if (!peer.destroyed) peer.reconnect();
  });

  return {
    carrier: 'peer',
    onMessage: (listener) => void (message = listener),
    onClose: (listener) => void (closed = listener),
    send(data) {
      if (conn.open) void conn.send(data);
    },
    close() {
      peer.destroy();
    },
  };
}

/* ----------------------------------------------------------------- local */

type ToHost =
  | { to: 'host'; from: string; kind: 'join' }
  | { to: 'host'; from: string; kind: 'leave' }
  | { to: 'host'; from: string; kind: 'data'; data: unknown };
type ToGuest =
  | { to: string; kind: 'welcome' }
  | { to: string; kind: 'bye' }
  | { to: string; kind: 'data'; data: unknown };
type LocalFrame = ToHost | ToGuest;

const forHost = (frame: LocalFrame): frame is ToHost => frame.to === 'host';

const channelName = (code: string) => `invisible-heroes-band-${code}`;

function localHost(code: string): HostTransport {
  const channel = new BroadcastChannel(channelName(code));
  let join: (guest: string) => void = () => undefined;
  let leave: (guest: string) => void = () => undefined;
  let message: (guest: string, data: unknown) => void = () => undefined;
  channel.onmessage = (event: MessageEvent<LocalFrame>) => {
    const frame = event.data;
    if (!forHost(frame)) return;
    if (frame.kind === 'join') {
      channel.postMessage({ to: frame.from, kind: 'welcome' } satisfies LocalFrame);
      join(frame.from);
    } else if (frame.kind === 'leave') {
      leave(frame.from);
    } else {
      message(frame.from, frame.data);
    }
  };
  return {
    onJoin: (listener) => void (join = listener),
    onLeave: (listener) => void (leave = listener),
    onMessage: (listener) => void (message = listener),
    onDown: () => undefined,
    send: (guest, data) => channel.postMessage({ to: guest, kind: 'data', data } satisfies LocalFrame),
    close: () => channel.close(),
  };
}

function localGuest(code: string): Promise<GuestTransport> {
  const channel = new BroadcastChannel(channelName(code));
  const id = `guest-${Math.random().toString(36).slice(2, 10)}`;
  let message: (data: unknown) => void = () => undefined;
  let closed: () => void = () => undefined;
  const say = (frame: ToHost) => channel.postMessage(frame);
  const leave = () => say({ to: 'host', from: id, kind: 'leave' });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.close();
      reject(new Error('The room did not answer.'));
    }, 3000);
    channel.onmessage = (event: MessageEvent<LocalFrame>) => {
      const frame = event.data;
      if (forHost(frame) || frame.to !== id) return;
      if (frame.kind === 'welcome') {
        clearTimeout(timer);
        window.addEventListener('pagehide', leave);
        resolve({
          carrier: 'local',
          onMessage: (listener) => void (message = listener),
          onClose: (listener) => void (closed = listener),
          send: (data) => say({ to: 'host', from: id, kind: 'data', data }),
          close() {
            leave();
            window.removeEventListener('pagehide', leave);
            channel.close();
          },
        });
      } else if (frame.kind === 'bye') {
        closed();
      } else {
        message(frame.data);
      }
    };
    say({ to: 'host', from: id, kind: 'join' });
  });
}

/* ----------------------------------------------------------------- relay */

const relayUrl = () => import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const relayKey = () => import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

/** True when the relay has somewhere to go. Without both variables it is off and nothing changes. */
export function relayConfigured(): boolean {
  return relayUrl() !== '' && relayKey() !== '';
}

/** One relay connection, opened only when a room is opened or joined (never on page load). */
async function relaySocket(): Promise<RelaySocket> {
  if (!relayConfigured()) throw new Error('The relay is not configured.');
  const { createSupabaseRelaySocket } = await import('./relay-supabase');
  return createSupabaseRelaySocket(relayUrl(), relayKey());
}

async function relayHostCarrier(code: string): Promise<HostTransport> {
  const socket = await relaySocket();
  const { relayHost } = await import('./relay');
  try {
    return await relayHost(code, socket);
  } catch (error) {
    socket.close();
    throw error;
  }
}

async function relayGuestCarrier(code: string): Promise<GuestTransport> {
  const socket = await relaySocket();
  const { relayGuest } = await import('./relay');
  return relayGuest(code, socket);
}

/* ------------------------------------------------------------- fallback */

/**
 * How long a phone waits for PeerJS before it moves to the relay. A direct
 * connection usually opens in one or two seconds; a network that isolates
 * clients never opens it, so waiting the full CONNECT_TIMEOUT_MS would only
 * keep the player looking at "joining".
 */
export const GUEST_PEER_PATIENCE_MS = 4000;

export interface GuestDeps {
  peer(code: string): Promise<GuestTransport>;
  /** null when the relay is not configured. */
  relay: ((code: string) => Promise<GuestTransport>) | null;
  patienceMs: number;
}

/**
 * PeerJS first; if it fails or has not connected within `patienceMs`, the
 * relay. Once the phone has moved to the relay, a PeerJS connection that
 * opens late is closed: one phone is never in the room twice.
 */
export function openGuestWith(code: string, deps: GuestDeps): Promise<GuestTransport> {
  const peer = deps.peer(code);
  const relay = deps.relay;
  if (!relay) return peer;
  return new Promise<GuestTransport>((resolve, reject) => {
    let switched = false;
    const toRelay = () => {
      if (switched) return;
      switched = true;
      clearTimeout(timer);
      relay(code).then(resolve, reject);
    };
    const timer = setTimeout(toRelay, deps.patienceMs);
    peer.then(
      (transport) => {
        if (switched) transport.close();
        else {
          clearTimeout(timer);
          resolve(transport);
        }
      },
      toRelay,
    );
  });
}

export interface HostDeps {
  peer(code: string): Promise<HostTransport>;
  relay: ((code: string) => Promise<HostTransport>) | null;
}

/** Guests of each carrier under their own prefix, so two carriers can never hand out the same id. */
const PREFIX = { peer: 'p:', relay: 'r:' } as const;

/**
 * Several host carriers as one room. A carrier can be added after the room is
 * open (the relay answering after PeerJS); the room is down only when every
 * carrier in it is.
 */
function combineHosts() {
  let join: (guest: string) => void = () => undefined;
  let leave: (guest: string) => void = () => undefined;
  let message: (guest: string, data: unknown) => void = () => undefined;
  let down: () => void = () => undefined;
  const parts = new Map<string, HostTransport>();
  const alive = new Set<string>();
  let closed = false;

  const add = (prefix: string, part: HostTransport) => {
    if (closed) {
      part.close();
      return;
    }
    parts.set(prefix, part);
    alive.add(prefix);
    part.onJoin((guest) => join(prefix + guest));
    part.onLeave((guest) => leave(prefix + guest));
    part.onMessage((guest, data) => message(prefix + guest, data));
    part.onDown(() => {
      if (!alive.delete(prefix)) return;
      if (alive.size === 0) down();
    });
  };

  const transport: HostTransport = {
    onJoin: (listener) => void (join = listener),
    onLeave: (listener) => void (leave = listener),
    onMessage: (listener) => void (message = listener),
    onDown: (listener) => void (down = listener),
    send(guest, data) {
      for (const [prefix, part] of parts) {
        if (guest.startsWith(prefix)) {
          part.send(guest.slice(prefix.length), data);
          return;
        }
      }
    },
    close() {
      closed = true;
      for (const part of parts.values()) part.close();
      parts.clear();
    },
  };
  return { add, transport };
}

/**
 * PeerJS and, when configured, the relay, as one room. PeerJS decides whether
 * the code is free (only its broker can tell): a taken code closes the relay
 * too, so the caller rolls a new code. If PeerJS cannot open for any other
 * reason, the room opens on the relay alone; if the relay cannot, on PeerJS
 * alone; the room waits for the relay only when PeerJS has failed.
 */
export async function openHostWith(code: string, deps: HostDeps): Promise<HostTransport> {
  if (!deps.relay) return deps.peer(code);
  const relay = deps.relay(code);
  // Never an unhandled rejection: a relay failure only matters if PeerJS fails too.
  relay.catch(() => undefined);
  const room = combineHosts();
  try {
    room.add(PREFIX.peer, await deps.peer(code));
  } catch (error) {
    if (error instanceof RoomTakenError) {
      void relay.then((t) => t.close(), () => undefined);
      throw error;
    }
    try {
      room.add(PREFIX.relay, await relay);
    } catch {
      throw error;
    }
    return room.transport;
  }
  void relay.then((t) => room.add(PREFIX.relay, t), () => undefined);
  return room.transport;
}

/* ---------------------------------------------------------------- public */

export function carrierFromUrl(search: string): Carrier {
  const net = new URLSearchParams(search).get('net');
  return net === 'local' ? 'local' : net === 'relay' ? 'relay' : 'peer';
}

export function openHost(code: string, carrier: Carrier): Promise<HostTransport> {
  if (carrier === 'local') return Promise.resolve(localHost(code));
  if (carrier === 'relay') return relayHostCarrier(code);
  return openHostWith(code, { peer: peerHost, relay: relayConfigured() ? relayHostCarrier : null });
}

export function openGuest(code: string, carrier: Carrier): Promise<GuestTransport> {
  if (carrier === 'local') return localGuest(code);
  if (carrier === 'relay') return relayGuestCarrier(code);
  return openGuestWith(code, {
    peer: peerGuest,
    relay: relayConfigured() ? relayGuestCarrier : null,
    patienceMs: GUEST_PEER_PATIENCE_MS,
  });
}
