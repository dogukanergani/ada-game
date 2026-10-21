import { describe, expect, it } from 'vitest';
import { deckWindows, findDeckStretch, naiveDeckHit } from './gameplay';

import { game } from './leak-sweep';

describe('the deck detector', () => {
  const deck = ['knight', 'knight', 'monopoly', 'victoryPoint', 'knight', 'roadBuilding', 'yearOfPlenty', 'knight'];
  it('finds a real stretch of the deck order, but not empty or short arrays', () => {
    const windows = deckWindows(deck, 6);
    expect(windows).toHaveLength(3);
    expect(findDeckStretch(`{"x":[${windows[1]}]}`, deck)).toBe(windows[1]);
    for (const innocent of ['{"devCards":[],"stealFrom":[]}', '["knight"]', '["knight","knight"]', '{"kind":"knight"},{"kind":"knight"}']) {
      expect(findDeckStretch(innocent, deck), innocent).toBeNull();
    }
  });
});

describe('the old check\'s false alarm', () => {
  it('reproduces from a seed and is an empty development deck matching "[]" in innocent data', async () => {
    const hits: { deckLen: number; needle: string; context: string }[] = [];
    const first = await game(9, ({ payload, after }) => {
      const raw = JSON.stringify(payload ?? null);
      const needle = naiveDeckHit(raw, after.devDeck as string[]);
      if (needle) hits.push({ deckLen: after.devDeck.length, needle, context: raw.slice(Math.max(0, raw.indexOf(needle) - 20), raw.indexOf(needle) + needle.length + 5) });
    });
    expect(hits.length).toBeGreaterThan(0);
    // every hit is the empty deck "[]" turning up as someone's empty `devCards` list
    for (const h of hits) {
      expect(h.deckLen).toBe(0);
      expect(h.needle).toBe('[]');
      expect(h.context).toContain('"devCards":[]');
    }
    // and the seed reproduces the very same game
    const again = await game(9);
    expect(again.steps).toBe(first.steps);
    expect(again.final.turn).toBe(first.final.turn);
  }, 120_000);
});
