/**
 * The big screen's side of a room: it owns the seat list, answers pings,
 * turns a phone's press into a press on that phone's seat, and tells every
 * phone what is going on. The game itself never sees a phone: it gets
 * `(seat, time)` like any key press.
 */
import {
  makeRoomCode,
  parseGuestMessage,
  type HostMessage,
  type RoomPhase,
} from './protocol';
import { createRoom } from './room';
import { RoomTakenError, openHost, type Carrier, type HostTransport } from './transport';

export interface HostRoomOptions {
  carrier: Carrier;
  /** Which seats someone at the big screen plays; phones cannot take those. */
  local(): readonly boolean[];
  /** The host's clock in seconds: the same clock presses are judged on. */
  clock(): number;
  /** A phone's seat was pressed; `at` is on the host's clock, or null if the phone had no sync yet. */
  onPress(seat: number, at: number | null): void;
  /** The set of phone-held seats changed. */
  onSeats(phones: boolean[]): void;
  /** The room is gone (the broker connection died for good). */
  onDown(): void;
}

export interface HostRoom {
  code: string;
  /** Per seat: true where a phone plays. */
  phones(): boolean[];
  /** Tell the phones the game moved on. Seats can only be changed in the lobby. */
  setPhase(phase: RoomPhase, score?: number | null): void;
  /** The big screen's own line-up changed: tell the phones. */
  refresh(): void;
  /** Take a seat back from a phone (the host tapped it). */
  evict(seat: number): void;
  /** How a seat's press or note went, for the phone that holds it. */
  judge(seat: number, grade: number): void;
  close(): void;
}

export async function openHostRoom(options: HostRoomOptions): Promise<HostRoom> {
  let transport: HostTransport | null = null;
  let code = '';
  // A code already in use is someone else's room: roll again.
  for (let attempt = 0; !transport; attempt++) {
    code = makeRoomCode();
    try {
      transport = await openHost(code, options.carrier);
    } catch (error) {
      if (!(error instanceof RoomTakenError) || attempt >= 4) throw error;
    }
  }
  const wire = transport;
  const room = createRoom();
  let phase: RoomPhase = 'lobby';
  let score: number | null = null;

  const tell = (guest: string, message: HostMessage) => wire.send(guest, message);
  const broadcast = () => {
    const seats = room.holders(options.local());
    for (const guest of room.guests()) {
      tell(guest, { k: 'state', phase, seats, you: room.seatOf(guest), score });
    }
  };
  const seatsChanged = () => {
    options.onSeats(room.phones());
    broadcast();
  };

  wire.onJoin((guest) => {
    // Mid-take a newcomer waits for the lobby: the band on stage does not change under it.
    if (phase === 'lobby') room.join(guest, options.local());
    else room.join(guest, new Array<boolean>(room.phones().length).fill(true));
    seatsChanged();
  });
  wire.onLeave((guest) => {
    room.leave(guest);
    seatsChanged();
  });
  wire.onDown(() => options.onDown());
  wire.onMessage((guest, data) => {
    const message = parseGuestMessage(data);
    if (!message) return;
    switch (message.k) {
      case 'ping':
        tell(guest, { k: 'pong', c: message.c, h: options.clock() });
        break;
      case 'press': {
        const seat = room.seatOf(guest);
        if (seat !== null && phase === 'take') options.onPress(seat, message.at);
        break;
      }
      case 'claim':
        if (phase === 'lobby') room.claim(guest, message.seat, options.local());
        seatsChanged();
        break;
      case 'release':
        if (phase === 'lobby') room.release(guest);
        seatsChanged();
        break;
    }
  });

  return {
    code,
    phones: () => room.phones(),
    setPhase(next, nextScore = null) {
      phase = next;
      score = nextScore;
      broadcast();
    },
    refresh: broadcast,
    evict(seat) {
      if (room.evict(seat) !== null) seatsChanged();
    },
    judge(seat, grade) {
      const guest = room.guestAt(seat);
      if (guest !== null) tell(guest, { k: 'judge', grade });
    },
    close() {
      wire.close();
    },
  };
}
