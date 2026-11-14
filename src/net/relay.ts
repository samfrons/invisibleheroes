/**
 * The relay carrier: messages between the big screen and the phones travel
 * through a hosted publish/subscribe service instead of a direct WebRTC
 * channel. It is the fallback for networks that keep devices from reaching
 * each other (event, school and hotel wifi), where PeerJS without a TURN
 * server cannot connect.
 *
 * This file knows nothing about any particular service. It is written against
 * RelaySocket, a few calls any broadcast service can provide; relay-supabase.ts
 * is the one implementation.
 *
 * Topics, chosen to keep the metered message count low:
 * - the room topic, `ihb:CODE`: only a guest's hello (join), heard by the host;
 * - one topic per guest, `ihb:CODE:ID`: everything else between the host and
 *   that one guest (presses, pings, pongs, judges, state, goodbye). Nobody else
 *   is meant to be on it, so a guest's presses never reach the other phones.
 *
 * Nothing that arrives is trusted. The envelope (who sent it, what kind) is
 * checked here; the message inside goes untouched to parseGuestMessage /
 * parseHostMessage, as with every carrier. The host takes a guest's identity
 * from the topic a message arrived on, never from the message.
 */
import type { GuestMessage, HostMessage, RoomPhase } from './protocol';
import type { GuestTransport, HostTransport } from './transport';

/* --------------------------------------------------------------- provider */

/** The few things the relay needs from a broadcast service. */
export interface RelaySocket {
  /**
   * Listen on a topic. Resolves once the subscription is live (messages sent
   * after that reach us), rejects if it cannot be made. `onLost` is told if a
   * live subscription ends without us asking.
   */
  subscribe(topic: string, onMessage: (payload: unknown) => void, onLost?: () => void): Promise<void>;
  /** Send to everyone else on a topic this socket is subscribed to. Never echoed back to us. */
  send(topic: string, payload: unknown): void;
  unsubscribe(topic: string): void;
  close(): void;
}

/* --------------------------------------------------------------- envelope */

/** How long a guest keeps saying hello before it gives up, and how often. */
export const HELLO_RETRY_MS = 1000;
export const HELLO_TRIES = 6;
/** How long a guest waits for its own subscriptions to go live. */
export const SUBSCRIBE_TIMEOUT_MS = 8000;
/**
 * A relay guest the host has not heard from in this long has gone (a closed
 * tab cannot always say goodbye). The phone's relay heartbeat is 10 s
 * (SYNC_EVERY_RELAY_MS in controller.ts), so this is three missed beats plus
 * slack. During a take the phone sends no pings, so nobody is dropped then;
 * the clock restarts when the take ends.
 */
export const RELAY_SILENT_MS = 35000;
export const RELAY_SWEEP_MS = 5000;
/** More relay guests than any band needs: keeps a stranger from making the host join hundreds of topics. */
export const MAX_RELAY_GUESTS = 16;

const ID_PATTERN = /^[a-z0-9]{6,16}$/;
const CODE_PATTERN = /^[A-Z0-9]{1,8}$/;

export const isRelayId = (v: unknown): v is string => typeof v === 'string' && ID_PATTERN.test(v);

export const roomTopic = (code: string) => {
  if (!CODE_PATTERN.test(code)) throw new Error('Not a room code.');
  return `ihb:${code}`;
};
export const guestTopic = (code: string, id: string) => {
  if (!isRelayId(id)) throw new Error('Not a relay id.');
  return `${roomTopic(code)}:${id}`;
};

export function makeRelayId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return id;
}

/**
 * What goes on the wire. `f` is who wrote it (g: guest, h: host), so each side
 * ignores frames in its own direction; `t` is the kind; `d` is a protocol
 * message, passed on unparsed.
 */
export type RelayFrame =
  | { v: 1; f: 'g'; t: 'hello'; id: string }
  | { v: 1; f: 'g'; t: 'm'; d: unknown }
  | { v: 1; f: 'g'; t: 'bye' }
  | { v: 1; f: 'h'; t: 'welcome' }
  | { v: 1; f: 'h'; t: 'm'; d: unknown }
  | { v: 1; f: 'h'; t: 'bye' };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A frame from a guest, or null. Only the fields of its kind are kept. */
export function parseGuestFrame(raw: unknown): Extract<RelayFrame, { f: 'g' }> | null {
  if (!isObject(raw) || raw.v !== 1 || raw.f !== 'g') return null;
  switch (raw.t) {
    case 'hello':
      return isRelayId(raw.id) ? { v: 1, f: 'g', t: 'hello', id: raw.id } : null;
    case 'm':
      return 'd' in raw ? { v: 1, f: 'g', t: 'm', d: raw.d } : null;
    case 'bye':
      return { v: 1, f: 'g', t: 'bye' };
    default:
      return null;
  }
}

/** A frame from the host, or null. */
export function parseHostFrame(raw: unknown): Extract<RelayFrame, { f: 'h' }> | null {
  if (!isObject(raw) || raw.v !== 1 || raw.f !== 'h') return null;
  switch (raw.t) {
    case 'welcome':
      return { v: 1, f: 'h', t: 'welcome' };
    case 'm':
      return 'd' in raw ? { v: 1, f: 'h', t: 'm', d: raw.d } : null;
    case 'bye':
      return { v: 1, f: 'h', t: 'bye' };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------- host */

export async function relayHost(code: string, socket: RelaySocket): Promise<HostTransport> {
  const room = roomTopic(code);
  type Guest = { topic: string; joined: boolean; heard: number };
  const guests = new Map<string, Guest>();
  let join: (guest: string) => void = () => undefined;
  let leave: (guest: string) => void = () => undefined;
  let message: (guest: string, data: unknown) => void = () => undefined;
  let down: () => void = () => undefined;
  let phase: RoomPhase = 'lobby';
  let closed = false;

  const tell = (guest: Guest, frame: Extract<RelayFrame, { f: 'h' }>) => socket.send(guest.topic, frame);

  const drop = (id: string, sayBye: boolean) => {
    const guest = guests.get(id);
    if (!guest) return;
    guests.delete(id);
    if (sayBye) tell(guest, { v: 1, f: 'h', t: 'bye' });
    socket.unsubscribe(guest.topic);
    if (guest.joined) leave(id);
  };

  const fromGuest = (id: string) => (raw: unknown) => {
    const guest = guests.get(id);
    const frame = parseGuestFrame(raw);
    if (!guest || !guest.joined || !frame) return;
    guest.heard = Date.now();
    // The sender is whoever owns this topic, whatever the frame inside says.
    if (frame.t === 'm') message(id, frame.d);
    else if (frame.t === 'bye') drop(id, false);
  };

  const hello = (id: string) => {
    const known = guests.get(id);
    if (known) {
      // A repeated hello (our welcome crossed it, or was lost): welcome again, never join twice.
      if (known.joined) tell(known, { v: 1, f: 'h', t: 'welcome' });
      return;
    }
    if (guests.size >= MAX_RELAY_GUESTS) return;
    const guest: Guest = { topic: guestTopic(code, id), joined: false, heard: Date.now() };
    guests.set(id, guest);
    socket
      .subscribe(guest.topic, fromGuest(id), () => drop(id, false))
      .then(() => {
        if (closed || guests.get(id) !== guest) return;
        guest.joined = true;
        guest.heard = Date.now();
        tell(guest, { v: 1, f: 'h', t: 'welcome' });
        join(id);
      })
      .catch(() => {
        if (guests.get(id) === guest) guests.delete(id);
        socket.unsubscribe(guest.topic);
      });
  };

  await socket.subscribe(
    room,
    (raw) => {
      const frame = parseGuestFrame(raw);
      if (frame?.t === 'hello') hello(frame.id);
    },
    () => {
      if (!closed) down();
    },
  );

  // Drop guests gone quiet. Not during a take: the phones stop pinging then, on purpose.
  const sweep = setInterval(() => {
    if (phase === 'take') return;
    const now = Date.now();
    for (const [id, guest] of guests) {
      if (guest.joined && now - guest.heard > RELAY_SILENT_MS) drop(id, true);
    }
  }, RELAY_SWEEP_MS);

  return {
    onJoin: (listener) => void (join = listener),
    onLeave: (listener) => void (leave = listener),
    onMessage: (listener) => void (message = listener),
    onDown: (listener) => void (down = listener),
    send(id, data: HostMessage) {
      // The phase rides along in every state message: it tells the sweep when a take is on.
      if (data.k === 'state' && data.phase !== phase) {
        const wasTake = phase === 'take';
        phase = data.phase;
        // Out of a take, everyone gets a fresh allowance to start pinging again.
        if (wasTake) for (const guest of guests.values()) guest.heard = Date.now();
      }
      const guest = guests.get(id);
      if (guest?.joined) tell(guest, { v: 1, f: 'h', t: 'm', d: data });
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(sweep);
      for (const id of [...guests.keys()]) {
        const guest = guests.get(id)!;
        guests.delete(id);
        if (guest.joined) tell(guest, { v: 1, f: 'h', t: 'bye' });
      }
      socket.close();
    },
  };
}

/* ------------------------------------------------------------------ guest */

export interface RelayGuestOptions {
  /** This phone's id on the relay; random by default. */
  id?: string;
  /** Where to listen for the page going away; window in a browser, nothing in tests. */
  page?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

export async function relayGuest(
  code: string,
  socket: RelaySocket,
  options: RelayGuestOptions = {},
): Promise<GuestTransport> {
  const id = options.id ?? makeRelayId();
  const page = options.page === undefined ? (typeof window === 'undefined' ? null : window) : options.page;
  const room = roomTopic(code);
  const mine = guestTopic(code, id);
  let message: (data: unknown) => void = () => undefined;
  let closed: () => void = () => undefined;
  let welcomed: () => void = () => undefined;
  let over = false;

  const say = (frame: Extract<RelayFrame, { f: 'g' }>, topic = mine) => socket.send(topic, frame);
  const end = () => {
    if (over) return;
    over = true;
    page?.removeEventListener('pagehide', goodbye);
    socket.close();
  };
  function goodbye() {
    if (over) return;
    say({ v: 1, f: 'g', t: 'bye' });
    end();
  }

  const fail = (error: Error) => {
    end();
    throw error;
  };
  const withTimeout = (p: Promise<void>) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The relay did not answer.')), SUBSCRIBE_TIMEOUT_MS);
      p.then(
        () => (clearTimeout(timer), resolve()),
        (error: unknown) => (clearTimeout(timer), reject(error)),
      );
    });

  // Our own topic first, so the host's welcome cannot arrive before we are listening.
  await withTimeout(
    socket.subscribe(
      mine,
      (raw) => {
        const frame = parseHostFrame(raw);
        if (!frame || over) return;
        if (frame.t === 'welcome') welcomed();
        else if (frame.t === 'm') message(frame.d);
        else {
          end();
          closed();
        }
      },
      () => {
        if (!over) {
          end();
          closed();
        }
      },
    ),
  ).catch(fail);
  // Then the room topic, only to be able to say hello on it.
  await withTimeout(socket.subscribe(room, () => undefined)).catch(fail);

  // The host may not be listening yet (or its welcome may be lost): say hello until welcomed.
  await new Promise<void>((resolve, reject) => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const knock = () => {
      if (tries >= HELLO_TRIES) {
        reject(new Error('The room did not answer.'));
        return;
      }
      tries++;
      say({ v: 1, f: 'g', t: 'hello', id }, room);
      timer = setTimeout(knock, HELLO_RETRY_MS);
    };
    welcomed = () => {
      welcomed = () => undefined;
      clearTimeout(timer);
      resolve();
    };
    knock();
  }).catch(fail);

  // Welcomed: the room topic has done its job. Leaving it means we hear no other phone's hello.
  socket.unsubscribe(room);
  page?.addEventListener('pagehide', goodbye);

  return {
    carrier: 'relay',
    onMessage: (listener) => void (message = listener),
    onClose: (listener) => void (closed = listener),
    send(data: GuestMessage) {
      if (!over) say({ v: 1, f: 'g', t: 'm', d: data });
    },
    close: goodbye,
  };
}
