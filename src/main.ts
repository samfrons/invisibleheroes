/**
 * The front door. A join link (?join=CODE) opens the phone's button; anything
 * else opens the game. Each is loaded on demand, so a phone never downloads
 * the stage and the big screen never downloads the phone's page.
 */
const params = new URLSearchParams(location.search);
const join = params.get('join');

if (join !== null) {
  void import('./controller').then(({ startController }) => startController(join));
} else if (params.get('game') === 'chain') {
  // Electron Chain, the memory-mode concept (CONCEPT.md). Same page, same phones.
  void import('./chain/shell');
} else {
  void import('./shell');
}

export {};
