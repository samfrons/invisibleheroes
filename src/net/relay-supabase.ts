/**
 * RelaySocket over Supabase Realtime Broadcast: the only file that knows
 * Supabase. No database tables and no presence: just ephemeral broadcast
 * messages on public channels, sent over one WebSocket.
 *
 * Loaded on demand (see transport.ts), and it loads the client library on
 * demand too, so a visitor who never opens or joins a room downloads neither.
 *
 * Budget, as the Supabase docs stated on 2026-11-14
 * (https://supabase.com/docs/guides/realtime/limits,
 *  https://supabase.com/docs/guides/realtime/pricing,
 *  https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages):
 * Free plan 200 concurrent connections, 100 messages per second, 100 channel
 * joins per second, 100 channels per connection, 2 million messages per billing
 * cycle. "Each broadcast message counts as one message sent plus one message per
 * subscribed client that receives it"; the sender is not a recipient unless it
 * enables self-send, so `self` stays false here. A press on a guest topic
 * (host and one phone) therefore costs 2 messages.
 */
import type { RelaySocket } from './relay';

const EVENT = 'f';
const SUBSCRIBE_TIMEOUT_MS = 8000;

export async function createSupabaseRelaySocket(url: string, key: string): Promise<RelaySocket> {
  const { RealtimeClient } = await import('@supabase/realtime-js');
  // https://<ref>.supabase.co -> wss://<ref>.supabase.co/realtime/v1 (the library appends /websocket).
  const endpoint = `${url.replace(/\/+$/, '').replace(/^http/i, 'ws')}/realtime/v1`;
  const client = new RealtimeClient(endpoint, { params: { apikey: key }, logLevel: 'error' });
  type Channel = ReturnType<typeof client.channel>;
  const channels = new Map<string, Channel>();
  /** Topics we are leaving on purpose: their CLOSED status is not a loss. */
  const leaving = new Set<Channel>();

  return {
    subscribe(topic, onMessage, onLost) {
      return new Promise<void>((resolve, reject) => {
        if (channels.has(topic)) {
          reject(new Error('Already subscribed.'));
          return;
        }
        const channel = client.channel(topic, { config: { broadcast: { self: false, ack: false } } });
        channels.set(topic, channel);
        let live = false;
        channel.on('broadcast', { event: EVENT }, (message) => onMessage(message['payload']));
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            live = true;
            resolve();
          } else if (!live && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
            channels.delete(topic);
            void client.removeChannel(channel);
            reject(new Error(`Relay subscription failed: ${status}`));
          } else if (live && status === 'CLOSED' && !leaving.has(channel)) {
            // A live channel the server closed. (A CHANNEL_ERROR after joining is retried by the library.)
            channels.delete(topic);
            onLost?.();
          }
        }, SUBSCRIBE_TIMEOUT_MS);
      });
    },
    send(topic, payload) {
      const channel = channels.get(topic);
      // Only over the open socket: never let the library fall back to its REST endpoint.
      if (channel?.state === 'joined') void channel.send({ type: 'broadcast', event: EVENT, payload });
    },
    unsubscribe(topic) {
      const channel = channels.get(topic);
      if (!channel) return;
      channels.delete(topic);
      leaving.add(channel);
      void client.removeChannel(channel);
    },
    close() {
      for (const channel of channels.values()) leaving.add(channel);
      channels.clear();
      // removeAllChannels leaves each topic, then the library drops the socket once none are left.
      void client.removeAllChannels().finally(() => void client.disconnect());
    },
  };
}
