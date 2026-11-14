/**
 * How messages travel between the big screen and the phones.
 *
 * Two carriers behind one pair of interfaces. 'peer' is the real one: WebRTC
 * data channels through PeerJS, whose public broker only introduces the
 * devices; after that the presses go from phone to screen directly. 'local'
 * is a BroadcastChannel between tabs of one browser, for trying the phone
 * screen on a laptop and for tests; pick it with ?net=local.
 *
 * PeerJS is loaded on demand, so a visitor who never opens a room never
 * downloads it or talks to its broker.
 */
import { peerIdFor, type GuestMessage, type HostMessage } from './protocol';

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
  onMessage(listener: (data: unknown) => void): void;
  /** The connection to the host ended. */
  onClose(listener: () => void): void;
  send(message: GuestMessage): void;
  close(): void;
}

export type Carrier = 'peer' | 'local';

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

/* ---------------------------------------------------------------- public */

export function carrierFromUrl(search: string): Carrier {
  return new URLSearchParams(search).get('net') === 'local' ? 'local' : 'peer';
}

export function openHost(code: string, carrier: Carrier): Promise<HostTransport> {
  return carrier === 'local' ? Promise.resolve(localHost(code)) : peerHost(code);
}

export function openGuest(code: string, carrier: Carrier): Promise<GuestTransport> {
  return carrier === 'local' ? localGuest(code) : peerGuest(code);
}
