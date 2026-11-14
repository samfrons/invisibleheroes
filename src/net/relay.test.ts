import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostMessage } from './protocol';
import {
  HELLO_RETRY_MS,
  HELLO_TRIES,
  RELAY_SILENT_MS,
  RELAY_SWEEP_MS,
  guestTopic,
  parseGuestFrame,
  parseHostFrame,
  relayGuest,
  relayHost,
  roomTopic,
  type RelaySocket,
} from './relay';
import {
  RoomTakenError,
  openGuestWith,
  openHostWith,
  type GuestTransport,
  type HostTransport,
} from './transport';

/* ------------------------------------------------------- a fake relay hub */

/**
 * Sockets sharing topics, like a broadcast service: a message goes to every
 * other socket subscribed to its topic when it is sent (nobody listening:
 * lost), after `latency` ms. Subscribing takes `joinDelay` ms. `hold()` stops
 * delivery until `release()`, to set up races.
 */
function createHub(latency = 5, joinDelay = 10) {
  const topics = new Map<string, Map<FakeSocket, (payload: unknown) => void>>();
  let held: (() => void)[] | null = null;
  let sent = 0;
  let delivered = 0;

  class FakeSocket implements RelaySocket {
    closed = false;
    /** Everything this socket heard, by topic: for checking who saw what. */
    heard: { topic: string; payload: unknown }[] = [];
    subscribe(topic: string, onMessage: (payload: unknown) => void): Promise<void> {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (this.closed) return reject(new Error('closed'));
          if (!topics.has(topic)) topics.set(topic, new Map());
          topics.get(topic)!.set(this, (payload) => {
            this.heard.push({ topic, payload });
            onMessage(payload);
          });
          resolve();
        }, joinDelay);
      });
    }
    send(topic: string, payload: unknown) {
      const subscribers = topics.get(topic);
      if (this.closed || !subscribers?.has(this)) return;
      sent++;
      const copy = JSON.parse(JSON.stringify(payload)) as unknown;
      for (const [socket, deliver] of subscribers) {
        if (socket === this) continue;
        const go = () =>
          setTimeout(() => {
            if (!socket.closed && topics.get(topic)?.get(socket) === deliver) {
              delivered++;
              deliver(copy);
            }
          }, latency);
        if (held) held.push(go);
        else go();
      }
    }
    unsubscribe(topic: string) {
      topics.get(topic)?.delete(this);
    }
    close() {
      this.closed = true;
      for (const subscribers of topics.values()) subscribers.delete(this);
    }
  }

  return {
    socket: () => new FakeSocket(),
    hold: () => void (held = []),
    release() {
      const queue = held ?? [];
      held = null;
      queue.forEach((go) => go());
    },
    /** Broadcast cost as Supabase counts it: one per send plus one per delivery. */
    messages: () => sent + delivered,
    subscribers: (topic: string) => topics.get(topic)?.size ?? 0,
  };
}

const CODE = 'ABCD';
const flush = (ms = 100) => vi.advanceTimersByTimeAsync(ms);

function listen(host: HostTransport) {
  const joins: string[] = [];
  const leaves: string[] = [];
  const got: [string, unknown][] = [];
  host.onJoin((g) => joins.push(g));
  host.onLeave((g) => leaves.push(g));
  host.onMessage((g, d) => got.push([g, d]));
  return { joins, leaves, got };
}

function hear(guest: GuestTransport) {
  const got: unknown[] = [];
  const closed = { n: 0 };
  guest.onMessage((d) => got.push(d));
  guest.onClose(() => closed.n++);
  return { got, closed };
}

/** Starts a promise and lets fake time run until it settles. */
async function settle<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => void (done = true));
  for (let t = 0; t < ms && !done; t += 10) await vi.advanceTimersByTimeAsync(10);
  return tracked;
}

const state = (phase: 'lobby' | 'take' | 'results'): HostMessage => ({
  k: 'state',
  phase,
  seats: ['machine', 'machine', 'machine', 'machine', 'machine'],
  you: null,
  score: null,
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the relay carrier', () => {
  it('opens a room, welcomes a guest and carries a press one way and a judge the other', async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    const guest = await settle(relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null }));
    const g = hear(guest);
    expect(guest.carrier).toBe('relay');
    expect(h.joins).toEqual(['aaaaaaaaaaaa']);

    guest.send({ k: 'press', at: 12.5 });
    await flush();
    expect(h.got).toEqual([['aaaaaaaaaaaa', { k: 'press', at: 12.5 }]]);

    host.send('aaaaaaaaaaaa', { k: 'judge', grade: 2 });
    await flush();
    expect(g.got).toEqual([{ k: 'judge', grade: 2 }]);
    // Once welcomed, the guest is off the room topic: only the host is on it.
    expect(hub.subscribers(roomTopic(CODE))).toBe(1);
  });

  it("keeps one guest's traffic away from another guest", async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    const aSocket = hub.socket();
    const bSocket = hub.socket();
    const a = await settle(relayGuest(CODE, aSocket, { id: 'aaaaaaaaaaaa', page: null }));
    const b = await settle(relayGuest(CODE, bSocket, { id: 'bbbbbbbbbbbb', page: null }));
    const ga = hear(a);
    const gb = hear(b);
    expect(h.joins).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);

    host.send('bbbbbbbbbbbb', { k: 'judge', grade: 3 });
    b.send({ k: 'press', at: 1 });
    a.send({ k: 'press', at: 2 });
    await flush();
    expect(ga.got).toEqual([]);
    expect(gb.got).toEqual([{ k: 'judge', grade: 3 }]);
    expect(h.got).toEqual([
      ['bbbbbbbbbbbb', { k: 'press', at: 1 }],
      ['aaaaaaaaaaaa', { k: 'press', at: 2 }],
    ]);
    // A heard nothing on B's topic, ever (not even B's hello on the room topic after A left it).
    expect(aSocket.heard.filter((m) => m.topic !== guestTopic(CODE, 'aaaaaaaaaaaa'))).toEqual([]);
    expect(bSocket.heard.every((m) => m.topic === guestTopic(CODE, 'bbbbbbbbbbbb'))).toBe(true);
  });

  it('a guest that closes says goodbye and the host lets it go', async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    const guest = await settle(relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null }));
    guest.close();
    await flush();
    expect(h.leaves).toEqual(['aaaaaaaaaaaa']);
    expect(hub.subscribers(guestTopic(CODE, 'aaaaaaaaaaaa'))).toBe(0);
  });

  it('a guest says goodbye when its page goes away', async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    const page = new EventTarget();
    await settle(relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: page as unknown as Window }));
    page.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(h.leaves).toEqual(['aaaaaaaaaaaa']);
  });

  it('the host drops a guest it has not heard from, and tells it', async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    const guest = await settle(relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null }));
    const g = hear(guest);
    await flush(RELAY_SILENT_MS - RELAY_SWEEP_MS);
    expect(h.leaves).toEqual([]);
    await flush(2 * RELAY_SWEEP_MS);
    expect(h.leaves).toEqual(['aaaaaaaaaaaa']);
    expect(g.closed.n).toBe(1);
  });

  it('pings keep a guest in the room', async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    const guest = await settle(relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null }));
    for (let i = 0; i < 12; i++) {
      guest.send({ k: 'ping', c: i });
      await flush(10000);
    }
    expect(h.leaves).toEqual([]);
  });

  it('a phone silent through a take is not dropped, and gets a fresh allowance after it', async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    await settle(relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null }));
    host.send('aaaaaaaaaaaa', state('take'));
    await flush(3 * RELAY_SILENT_MS);
    expect(h.leaves).toEqual([]);
    host.send('aaaaaaaaaaaa', state('results'));
    await flush(RELAY_SILENT_MS - RELAY_SWEEP_MS);
    expect(h.leaves).toEqual([]);
    await flush(2 * RELAY_SWEEP_MS);
    expect(h.leaves).toEqual(['aaaaaaaaaaaa']);
  });

  it('a hello sent before the host is listening is said again until welcomed', async () => {
    const hub = createHub();
    // The host's socket subscribes to the room topic a whole 2.5 s late.
    const hostSocket = hub.socket();
    const lateSubscribe = hostSocket.subscribe.bind(hostSocket);
    hostSocket.subscribe = (topic, onMessage) =>
      new Promise((resolve, reject) =>
        setTimeout(() => lateSubscribe(topic, onMessage).then(resolve, reject), topic === roomTopic(CODE) ? 2500 : 0),
      );
    const opening = relayHost(CODE, hostSocket);
    const joining = relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null });
    const host = await settle(opening, 4000);
    const h = listen(host);
    const guest = await settle(joining, 4000);
    expect(guest.carrier).toBe('relay');
    expect(h.joins).toEqual(['aaaaaaaaaaaa']);
    // It stopped knocking once welcomed.
    const before = hub.messages();
    await flush(HELLO_RETRY_MS * HELLO_TRIES);
    expect(hub.messages()).toBe(before);
  });

  it('a hello repeated because the welcome crossed it does not join twice', async () => {
    const hub = createHub(5, 10);
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    hub.hold();
    const joining = relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null });
    await flush(HELLO_RETRY_MS * 2 + 50); // two hellos queued
    hub.release();
    await settle(joining);
    await flush(HELLO_RETRY_MS * 3);
    expect(h.joins).toEqual(['aaaaaaaaaaaa']);
  });

  it('gives up when no room answers', async () => {
    const hub = createHub();
    const joining = relayGuest(CODE, hub.socket(), { id: 'aaaaaaaaaaaa', page: null });
    joining.catch(() => undefined);
    await flush(HELLO_RETRY_MS * (HELLO_TRIES + 1));
    await expect(joining).rejects.toThrow();
  });

  it('drops malformed envelopes, and attributes a message to the topic it came on', async () => {
    const hub = createHub();
    const host = await settle(relayHost(CODE, hub.socket()));
    const h = listen(host);
    const aSocket = hub.socket();
    const guest = await settle(relayGuest(CODE, aSocket, { id: 'aaaaaaaaaaaa', page: null }));
    const g = hear(guest);
    const mine = guestTopic(CODE, 'aaaaaaaaaaaa');

    // A stranger with the key on the room topic.
    const stranger = hub.socket();
    await settle(stranger.subscribe(roomTopic(CODE), () => undefined));
    for (const junk of [
      null,
      'hello',
      { v: 1, f: 'g', t: 'hello', id: 'NOT SAFE!' },
      { v: 1, f: 'g', t: 'hello', id: 'x'.repeat(40) },
      { v: 2, f: 'g', t: 'hello', id: 'cccccccccccc' },
      { v: 1, f: 'g', t: 'party', id: 'cccccccccccc' },
      { v: 1, f: 'h', t: 'hello', id: 'cccccccccccc' },
    ]) {
      stranger.send(roomTopic(CODE), junk);
    }
    // And on the guest's own topic: junk, a frame dressed up as the host, and one claiming another id.
    for (const junk of [[], { v: 1, f: 'g', t: 'm' }, { v: 1, f: 'g', t: 'kick', id: 'aaaaaaaaaaaa' }]) {
      aSocket.send(mine, junk);
    }
    aSocket.send(mine, { v: 1, f: 'h', t: 'm', d: { k: 'judge', grade: 3 } });
    aSocket.send(mine, { v: 1, f: 'g', t: 'm', id: 'bbbbbbbbbbbb', from: 'bbbbbbbbbbbb', d: { k: 'press', at: 1 } });
    await flush();
    expect(h.joins).toEqual(['aaaaaaaaaaaa']);
    expect(h.got).toEqual([['aaaaaaaaaaaa', { k: 'press', at: 1 }]]);
    expect(g.got).toEqual([]);
    expect(g.closed.n).toBe(0);
  });

  it('checks envelopes field by field and passes the message inside on untouched', () => {
    expect(parseGuestFrame({ v: 1, f: 'g', t: 'hello', id: 'abc123', extra: 1 })).toEqual({
      v: 1,
      f: 'g',
      t: 'hello',
      id: 'abc123',
    });
    expect(parseGuestFrame({ v: 1, f: 'g', t: 'hello', id: 'abc' })).toBeNull();
    expect(parseGuestFrame({ v: 1, f: 'g', t: 'm', d: 'anything' })).toEqual({ v: 1, f: 'g', t: 'm', d: 'anything' });
    expect(parseHostFrame({ v: 1, f: 'h', t: 'bye' })).toEqual({ v: 1, f: 'h', t: 'bye' });
    expect(parseHostFrame({ v: 1, f: 'g', t: 'bye' })).toBeNull();
    expect(parseHostFrame({ v: 1, f: 'h', t: 'nope' })).toBeNull();
    expect(() => guestTopic(CODE, '../x')).toThrow();
    expect(() => roomTopic('ab:cd')).toThrow();
  });
});

/* ---------------------------------------------------------- the fallback */

function fakeGuest(carrier: 'peer' | 'relay') {
  const transport: GuestTransport & { closed: number } = {
    carrier,
    closed: 0,
    onMessage: () => undefined,
    onClose: () => undefined,
    send: () => undefined,
    close() {
      transport.closed++;
    },
  };
  return transport;
}

function later<T>(ms: number, value: T | Error): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => (value instanceof Error ? reject(value) : resolve(value)), ms),
  );
}

describe('a phone falling back to the relay', () => {
  it('stays on PeerJS when it connects in time, and never opens the relay', async () => {
    const peer = fakeGuest('peer');
    const relay = vi.fn(() => Promise.resolve(fakeGuest('relay')));
    const opened = await settle(openGuestWith(CODE, { peer: () => later(1000, peer), relay, patienceMs: 4000 }), 6000);
    expect(opened).toBe(peer);
    await flush(10000);
    expect(relay).not.toHaveBeenCalled();
    expect(peer.closed).toBe(0);
  });

  it('moves to the relay when PeerJS is too slow, and closes PeerJS if it opens late', async () => {
    const peer = fakeGuest('peer');
    const relayed = fakeGuest('relay');
    const relay = vi.fn(() => later(500, relayed));
    const opening = openGuestWith(CODE, { peer: () => later(6000, peer), relay, patienceMs: 4000 });
    await flush(3999);
    expect(relay).not.toHaveBeenCalled();
    const opened = await settle(opening, 1000);
    expect(opened).toBe(relayed);
    await flush(3000);
    expect(peer.closed).toBe(1);
    expect(relayed.closed).toBe(0);
  });

  it('moves to the relay at once when PeerJS fails fast', async () => {
    const relayed = fakeGuest('relay');
    const relay = vi.fn(() => Promise.resolve(relayed));
    const opening = openGuestWith(CODE, {
      peer: () => later<GuestTransport>(200, new Error('broker unreachable')),
      relay,
      patienceMs: 4000,
    });
    await flush(250);
    expect(relay).toHaveBeenCalledTimes(1);
    expect(await opening).toBe(relayed);
  });

  it('without a relay behaves as before: the PeerJS error surfaces, after however long PeerJS takes', async () => {
    const opening = openGuestWith(CODE, {
      peer: () => later<GuestTransport>(12000, new Error('The room did not answer.')),
      relay: null,
      patienceMs: 4000,
    });
    opening.catch(() => undefined);
    await flush(11000);
    await flush(2000);
    await expect(opening).rejects.toThrow('The room did not answer.');
  });
});

function fakeHost() {
  let join: (g: string) => void = () => undefined;
  let leave: (g: string) => void = () => undefined;
  let message: (g: string, d: unknown) => void = () => undefined;
  let down: () => void = () => undefined;
  const sent: [string, HostMessage][] = [];
  const transport = {
    closed: 0,
    sent,
    join: (g: string) => join(g),
    leave: (g: string) => leave(g),
    message: (g: string, d: unknown) => message(g, d),
    down: () => down(),
    onJoin: (l: typeof join) => void (join = l),
    onLeave: (l: typeof leave) => void (leave = l),
    onMessage: (l: typeof message) => void (message = l),
    onDown: (l: typeof down) => void (down = l),
    send: (g: string, m: HostMessage) => void sent.push([g, m]),
    close() {
      transport.closed++;
    },
  };
  return transport;
}

describe('a room on both carriers', () => {
  it('delivers joins and messages from both under distinct ids, and replies on the right one', async () => {
    const peer = fakeHost();
    const relay = fakeHost();
    const room = await settle(openHostWith(CODE, { peer: () => later(100, peer), relay: () => later(300, relay) }));
    const h = listen(room);
    await flush(500);
    peer.join('same');
    relay.join('same');
    peer.message('same', { k: 'press', at: 1 });
    relay.message('same', { k: 'press', at: 2 });
    relay.leave('same');
    expect(h.joins).toEqual(['p:same', 'r:same']);
    expect(h.got).toEqual([
      ['p:same', { k: 'press', at: 1 }],
      ['r:same', { k: 'press', at: 2 }],
    ]);
    expect(h.leaves).toEqual(['r:same']);
    room.send('r:same', { k: 'judge', grade: 3 });
    room.send('p:same', { k: 'judge', grade: 2 });
    room.send('x:same', { k: 'judge', grade: 2 });
    expect(relay.sent).toEqual([['same', { k: 'judge', grade: 3 }]]);
    expect(peer.sent).toEqual([['same', { k: 'judge', grade: 2 }]]);
    room.close();
    expect([peer.closed, relay.closed]).toEqual([1, 1]);
  });

  it('opens on PeerJS alone when the relay fails, and is down only when every carrier is', async () => {
    const peer = fakeHost();
    const room = await settle(
      openHostWith(CODE, { peer: () => later(100, peer), relay: () => later<HostTransport>(50, new Error('no relay')) }),
    );
    const downs = { n: 0 };
    room.onDown(() => downs.n++);
    const h = listen(room);
    peer.join('a');
    expect(h.joins).toEqual(['p:a']);
    peer.down();
    expect(downs.n).toBe(1);
  });

  it('opens on the relay alone when the PeerJS broker cannot be reached', async () => {
    const relay = fakeHost();
    const room = await settle(
      openHostWith(CODE, { peer: () => later<HostTransport>(100, new Error('broker down')), relay: () => later(800, relay) }),
    );
    const h = listen(room);
    relay.join('a');
    expect(h.joins).toEqual(['r:a']);
  });

  it('stays up on the relay when the PeerJS side goes down', async () => {
    const peer = fakeHost();
    const relay = fakeHost();
    const room = await settle(openHostWith(CODE, { peer: () => later(10, peer), relay: () => later(10, relay) }));
    await flush(50);
    const downs = { n: 0 };
    room.onDown(() => downs.n++);
    peer.down();
    expect(downs.n).toBe(0);
    relay.down();
    expect(downs.n).toBe(1);
  });

  it('a code PeerJS says is taken closes the relay too, so the caller rolls again', async () => {
    const relay = fakeHost();
    const opening = openHostWith(CODE, {
      peer: () => later<HostTransport>(100, new RoomTakenError()),
      relay: () => later(50, relay),
    });
    opening.catch(() => undefined);
    await flush(200);
    await expect(opening).rejects.toBeInstanceOf(RoomTakenError);
    expect(relay.closed).toBe(1);
  });

  it('fails with the PeerJS error when neither opens', async () => {
    const opening = openHostWith(CODE, {
      peer: () => later<HostTransport>(100, new Error('broker down')),
      relay: () => later<HostTransport>(50, new Error('no relay')),
    });
    opening.catch(() => undefined);
    await flush(200);
    await expect(opening).rejects.toThrow('broker down');
  });
});
