# Invisible Heroes: Electron Chain (Memory Mode)

A same-screen co-op game for 4 players, about 5 minutes. No music needed: each
player is a microbe with its own signal pattern, and the team only wins if
nobody breaks the chain.

## The hook

Real science: in a biofilm, bacteria like *Geobacter* pass electrons to each
other through tiny "nanowires", like a bucket brigade, and that makes real
electricity. Microbes also "talk" by sending each other signals (quorum
sensing). Your team *is* that chain. To move an electron, the colony has to
signal in the right order. One mistake and the chain breaks.

## How a round works

1. **Signal:** the microbes flash one after another, e.g. green, blue, green,
   red. Each flash has its own sound and colour.
2. **Repeat:** the players repeat the sequence, each pressing only their own
   key when it's their microbe's turn. With every correct press, the electron
   visibly jumps along the chain to the next microbe.
3. **Deliver:** if the whole sequence is right, the electron reaches the
   battery (+1 charge). The next round adds one step to the sequence.

## Escalation (fills the 5 minutes)

- **Rounds 1–3:** short sequences, slow flashes.
- **Rounds 4–7:** longer, faster; the same microbe can appear twice in a row.
- **Rounds 8–10:** pattern twist: some flashes mean *double-tap* or *hold*
  instead of a single press (the "instrument pattern" of each microbe).

## Win and lose

- **Win:** fill the battery (10 electrons) within 5 minutes and a dark town
  lights up, house by house.
- **Lose:** 3 broken chains, or the timer runs out, and it's a blackout.

## Controls

- 4 players on one keyboard, one key each (e.g. A, F, J, L), each with its own
  colour and microbe.

## Why it works for the demo

- Everyone understands it in 10 seconds.
- People shout "you, now YOU!", which is fun to watch.
- The ending is a clear visual, with the lights either on or off.

## Reuse from the first version

The electrons rolling down a chain-reaction machine and the hit-judging engine
in `src/` can be reused; the music is replaced by the flash-and-repeat
patterns.

## Open tasks (to split between the four of us)

- [ ] Playable prototype (screen, keys, rounds, battery, timer)
- [ ] Microbe characters and art (replace placeholder shapes)
- [ ] Sounds for each microbe's signal, buzz on mistake, win/lose sounds
- [ ] Win screen (town lights up) and lose screen (blackout)
- [ ] Playtesting and tuning the difficulty to about 5 minutes
