/**
 * The front door. A join link (?join=CODE) opens the phone's button; anything
 * else opens the game. Each is loaded on demand, so a phone never downloads
 * the stage and the big screen never downloads the phone's page.
 */
const join = new URLSearchParams(location.search).get('join');

if (join !== null) {
  void import('./controller').then(({ startController }) => startController(join));
} else {
  void import('./shell');
}

export {};
