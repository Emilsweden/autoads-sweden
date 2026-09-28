/**
 * Veckonummer som i svenska kalendrar (ISO 8601): veckan börjar på måndag,
 * och vecka 1 är den som innehåller årets första torsdag. Runt årsskiftet
 * kan en dag höra till förra eller nästa års vecka — det är där det brukar
 * bli fel.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { vecka } from '../falt/js/ui.js';

describe('veckonummer', () => {
  it('vanliga dagar', () => {
    assert.equal(vecka('2026-09-28'), 40);   // måndag
    assert.equal(vecka('2026-10-04'), 40);   // söndag samma vecka
    assert.equal(vecka('2026-10-05'), 41);
    assert.equal(vecka('2026-09-07'), 37);
  });

  it('runt årsskiftet', () => {
    assert.equal(vecka('2026-01-01'), 1);    // torsdag — årets första torsdag
    assert.equal(vecka('2025-12-29'), 1);    // måndag i samma vecka, förra året
    assert.equal(vecka('2026-12-31'), 53);   // 2026 har 53 veckor
    assert.equal(vecka('2027-01-03'), 53);   // söndag, fortfarande 2026 års v53
    assert.equal(vecka('2027-01-04'), 1);
    assert.equal(vecka('2021-01-03'), 53);   // söndag som hör till 2020
  });

  it('tar emot ett Date också, och tomt ger null', () => {
    assert.equal(vecka(new Date(2026, 8, 28, 23, 30)), 40);
    assert.equal(vecka(''), null);
    assert.equal(vecka('inte ett datum'), null);
  });
});
