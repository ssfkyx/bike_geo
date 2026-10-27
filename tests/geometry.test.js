/*
 * Tracer-bullet tests for the geometry solver.
 *
 * Oracles: the two reference bikes from Bike Insights that started this
 * project. Their published geometry charts let us check that the solver's
 * derived values (reach / stack / wheelbase / trail) land within rounding
 * distance of the real numbers.
 *
 *   node --test tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../js/geometry.js');

const TARMAC = {
  bsd: 622, tireWidth: 26, chainstay: 410, bbDrop: 74,
  seatTubeLength: 447, seatTubeAngle: 75.5, headTubeAngle: 71.75,
  headTubeLength: 102, frontCenter: 574.5, forkOffset: 47.5, forkLength: 388.3
};

const CRUX = {
  bsd: 622, tireWidth: 38, chainstay: 425, bbDrop: 74,
  seatTubeLength: 466, seatTubeAngle: 75.5, headTubeAngle: 70.5,
  headTubeLength: 100, frontCenter: 594.1, forkOffset: 50, forkLength: 404.5
};

function near(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ±${tolerance}, got ${actual}`
  );
}

test('defaults solve to the Tarmac reference bike', () => {
  const g = Geo.solve();
  const solved = {};
  for (const key of Object.keys(TARMAC)) solved[key] = g.input[key];
  assert.deepEqual(solved, TARMAC);
});

test('Tarmac 49 derives the published values', () => {
  const g = Geo.solve(TARMAC);

  near(g.tireRadius, 337, 0.01, 'tire radius');
  near(g.tireOuterDiameter, 674, 0.01, 'tire outer diameter');
  near(g.bbHeight, 263, 0.01, 'BB height');
  near(g.chainstayHorizontal, 403.3, 0.2, 'chainstay horizontal');       // published 403.3
  near(g.frontCenter, 574.5, 0.01, 'front center (input)');              // published 574
  near(g.frontCenterHorizontal, 569.7, 0.2, 'front center horizontal');  // published 569.7
  near(g.wheelbase, 973, 0.5, 'wheelbase (derived)');                    // published 973
  near(g.reach, 372, 0.5, 'reach (derived)');                            // published 372
  near(g.stack, 522, 0.5, 'stack (derived)');                            // published 522
  near(g.forkOffset, 47.5, 0.01, 'fork offset (input)');                 // published 47
  near(g.forkLength, 388.3, 0.01, 'fork length (input)');
  near(g.trail, 61.5, 1.2, 'trail');                                      // published 61.6
  near(g.mechanicalTrail, 58.5, 1.2, 'mechanical trail');                 // published 58.5
  near(g.effectiveTopTube, 509, 3, 'effective top tube');                 // published 509
  near(g.stackReachRatio, 1.403, 0.005, 'stack/reach ratio');             // published 1.4
});

test('CruX 49 derives the published values', () => {
  const g = Geo.solve(CRUX);

  near(g.tireRadius, 349, 0.01, 'tire radius');
  near(g.tireOuterDiameter, 698, 0.01, 'tire outer diameter');
  near(g.bbHeight, 275, 0.01, 'BB height');
  near(g.chainstayHorizontal, 418.5, 0.2, 'chainstay horizontal');       // published 418.5
  near(g.frontCenterHorizontal, 589.5, 0.2, 'front center horizontal');  // published 589.5
  near(g.wheelbase, 1008, 0.5, 'wheelbase (derived)');                   // published 1008
  near(g.reach, 375, 0.5, 'reach (derived)');                            // published 375
  near(g.stack, 530, 0.5, 'stack (derived)');                            // published 530
  near(g.forkOffset, 50, 0.01, 'fork offset (input)');                    // published 50
  near(g.trail, 70.5, 1.2, 'trail');                                      // published 70.5
  near(g.mechanicalTrail, 66.5, 1.2, 'mechanical trail');                 // published 66.5
  near(g.effectiveTopTube, 512, 3, 'effective top tube');                 // published 512
});

test('tire outer diameter follows BSD + 2 × tire width', () => {
  const tarmac = Geo.solve(TARMAC);
  near(tarmac.tireOuterDiameter, 674, 1e-9, '700C x 26 -> 674');
  near(tarmac.tireRadius, 337, 1e-9, '700C x 26 -> radius 337');

  const gravel = Geo.solve({ bsd: 584, tireWidth: 47 });
  near(gravel.tireOuterDiameter, 678, 1e-9, '650B x 47 -> 678');
  near(gravel.tireRadius, 339, 1e-9, '650B x 47 -> radius 339');

  const crux = Geo.solve(CRUX);
  near(crux.tireOuterDiameter, 698, 1e-9, '700C x 38 -> 698');

  const wider = Geo.solve(Object.assign({}, TARMAC, { tireWidth: TARMAC.tireWidth + 1 }));
  near(wider.tireOuterDiameter - tarmac.tireOuterDiameter, 2, 1e-9, '+1 mm width -> +2 mm OD');
  near(wider.tireRadius - tarmac.tireRadius, 1, 1e-9, '+1 mm width -> +1 mm radius');
});

test('650B gravel preset matches the 650B x 47 reference', () => {
  const preset = Geo.PRESETS.filter(p => p.id === 'gravel650')[0];
  assert.ok(preset, 'preset exists');
  assert.equal(Geo.solve(preset.inputs).input.bsd, 584);
  near(Geo.solve(preset.inputs).tireOuterDiameter, 678, 1e-9);
});

test('solved points are internally consistent', () => {
  for (const fixture of [TARMAC, CRUX]) {
    const g = Geo.solve(fixture);
    const hta = g.input.headTubeAngle * Math.PI / 180;

    // Head tube: top = bottom + headTubeLength along the steering axis.
    near(Geo.dist(g.htTop, g.htBottom), g.input.headTubeLength, 1e-9, 'head tube length');
    near(g.htTop.x, g.htBottom.x - g.input.headTubeLength * Math.cos(hta), 1e-9, 'head tube top x');
    near(g.htTop.y, g.htBottom.y + g.input.headTubeLength * Math.sin(hta), 1e-9, 'head tube top y');

    // Reach and stack are exactly HT top relative to the BB.
    near(g.reach, g.htTop.x - g.bb.x, 1e-9, 'reach definition');
    near(g.stack, g.htTop.y - g.bb.y, 1e-9, 'stack definition');

    // Rear triangle: chainstay and seat tube lengths are preserved.
    near(Geo.dist(g.rearAxle, g.bb), g.input.chainstay, 1e-9, 'chainstay length');
    near(Geo.dist(g.bb, g.seatTop), g.input.seatTubeLength, 1e-9, 'seat tube length');

    // Front axle from front center; wheelbase falls out of it.
    near(Geo.dist(g.bb, g.frontAxle), g.input.frontCenter, 1e-9, 'front center');
    near(g.wheelbase, g.frontAxle.x, 1e-9, 'wheelbase = front axle x');
    near(Geo.dist(g.rearAxle, g.frontAxle), g.wheelbase, 1e-9, 'rear axle to front axle');

    // Front end: fork offset is the perpendicular axle-to-axis distance and the
    // fork length is the straight axle-to-head-tube-bottom distance.
    const u = g.steerDir;
    const v = { x: g.frontAxle.x - g.htBottom.x, y: g.frontAxle.y - g.htBottom.y };
    near(Math.abs(u.x * v.y - u.y * v.x), g.input.forkOffset, 1e-9, 'fork offset');
    near(Geo.dist(g.htBottom, g.frontAxle), g.input.forkLength, 1e-9, 'fork length');

    // Trail identities and wheel-on-ground.
    near(g.trail * Math.sin(hta), g.mechanicalTrail, 0.5, 'trail * sin(HTA)');
    near(g.frontAxle.y - g.groundY, g.tireRadius, 1e-9, 'front wheel on ground');
  }
});

test('changing the front center moves the axle and reach, not stack/trail', () => {
  const base = Geo.solve(TARMAC);
  const longer = Geo.solve(Object.assign({}, TARMAC, { frontCenter: TARMAC.frontCenter + 20 }));

  const drop = TARMAC.bbDrop;
  const expectedWheelbaseDelta =
    Math.sqrt((TARMAC.frontCenter + 20) ** 2 - drop * drop) -
    Math.sqrt(TARMAC.frontCenter ** 2 - drop * drop);

  near(longer.input.frontCenter - base.input.frontCenter, 20, 1e-9, 'front center input');
  near(longer.wheelbase - base.wheelbase, expectedWheelbaseDelta, 1e-9, 'wheelbase follows front center');
  near(longer.reach - base.reach, expectedWheelbaseDelta, 1e-9, 'reach follows front center');
  near(longer.stack, base.stack, 1e-9, 'stack does not move');
  near(longer.trail, base.trail, 1e-9, 'trail does not move');
});

test('invalid or extreme input is clamped, never NaN', () => {
  const weird = Geo.solve({
    chainstay: -50, bbDrop: 400, tireWidth: -20, headTubeAngle: 300,
    frontCenter: -100, forkOffset: 999, forkLength: 10
  });
  for (const key of Object.keys(weird.input)) {
    assert.ok(Number.isFinite(weird.input[key]), `${key} is finite`);
  }
  for (const key of ['trail', 'reach', 'stack', 'wheelbase', 'mechanicalTrail']) {
    assert.ok(Number.isFinite(weird[key]), `${key} is finite`);
  }
  assert.ok(weird.tireRadius > 0);
});

test('string input is accepted (form values are strings)', () => {
  const fromStrings = {};
  for (const key of Object.keys(TARMAC)) fromStrings[key] = String(TARMAC[key]);
  const g = Geo.solve(fromStrings);
  assert.deepEqual(g.input, TARMAC);
});

test('every preset solves to finite values', () => {
  for (const preset of Geo.PRESETS) {
    const g = Geo.solve(preset.inputs);
    for (const key of ['trail', 'forkOffset', 'forkLength', 'frontCenter', 'reach', 'stack', 'wheelbase']) {
      assert.ok(Number.isFinite(g[key]), `${preset.id}.${key} is finite`);
    }
    assert.ok(g.trail > 0 && g.trail < 200, `${preset.id} trail is plausible`);
    assert.ok(g.stack > 300 && g.stack < 800, `${preset.id} stack is plausible`);
  }
});

test('parameter catalogue covers every displayed datum once', () => {
  const keys = Geo.PARAMS.map(p => p.key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate parameter keys');

  const g = Geo.solve(TARMAC);
  for (const param of Geo.PARAMS) {
    const value = Geo.valueOf(param.key, g);
    assert.ok(Number.isFinite(value), `${param.key} has a finite value`);
  }

  assert.equal(Geo.PARAMS.filter(p => p.group === 'input').length, Object.keys(Geo.DEFAULTS).length);

  // Reach, stack and the ratio lead the compensated list.
  const computed = Geo.PARAMS.filter(p => p.group === 'computed').map(p => p.key);
  assert.deepEqual(computed.slice(0, 3), ['reach', 'stack', 'stackReachRatio']);

  const inputs = Geo.PARAMS.filter(p => p.group === 'input').map(p => p.key);
  for (const key of ['frontCenter', 'forkOffset', 'forkLength']) {
    assert.ok(inputs.includes(key), `${key} is an input`);
  }
  for (const key of ['wheelbase', 'reach', 'stack']) {
    assert.ok(computed.includes(key), `${key} is compensated`);
    assert.ok(!inputs.includes(key), `${key} is not an input`);
  }
  assert.ok(!keys.includes('wheelFlop'), 'wheel flop was removed');
});

/* ------------------------------------------------------------------ *
 * Personal fitting (optional)
 * ------------------------------------------------------------------ */
test('stem length + angle converts to reach + stack and back', () => {
  const a = Geo.stemFromLengthAngle(100, 6);
  near(a.reach, 99.452, 0.01, 'reach from length/angle');
  near(a.stack, 10.453, 0.01, 'stack from length/angle');

  const b = Geo.stemFromReachStack(a.reach, a.stack);
  near(b.length, 100, 1e-9, 'length round-trip');
  near(b.angle, 6, 1e-9, 'angle round-trip');

  const down = Geo.stemFromLengthAngle(100, -6);
  near(down.reach, 99.452, 0.01, 'negative angle keeps reach positive');
  near(down.stack, -10.453, 0.01, 'negative angle gives negative stack');
});

test('personal fitting derives seatpost numbers and fit points', () => {
  const g = Geo.solve(TARMAC);
  const fitting = {
    stemLength: 100, stemAngle: 6,
    saddleHeight: 700, seatpostLength: 350, crankLength: 172.5
  };
  const sf = Geo.solveFitting(fitting, g);

  near(sf.seatpostOverFrame, 700 - TARMAC.seatTubeLength, 1e-9, 'seatpost over frame');
  near(sf.seatpostInsertLength, 350 - (700 - TARMAC.seatTubeLength), 1e-9, 'seatpost insert');
  near(Geo.dist(sf.points.stemClamp, sf.points.stemEnd), 100, 1e-9, 'stem length');

  const stem = {
    x: sf.points.stemEnd.x - sf.points.stemClamp.x,
    y: sf.points.stemEnd.y - sf.points.stemClamp.y
  };
  const along = stem.x * g.steerDir.x + stem.y * g.steerDir.y;
  const across = Math.abs(g.steerDir.x * stem.y - g.steerDir.y * stem.x);
  near(along, sf.stemStack, 1e-9, 'stack is the projection on the steerer');
  near(across, sf.stemReach, 1e-9, 'reach is perpendicular to the steerer');

  near(Geo.dist(g.bb, sf.points.saddleTop), 700, 1e-9, 'saddle height along the seat tube');
  near(sf.points.crankEnd.x, g.bb.x, 1e-9, 'crank line is vertical');
  near(sf.points.crankEnd.y, g.bb.y - 172.5, 1e-9, 'crank line points down');

  // Deriving fit data must never disturb the frame geometry.
  const again = Geo.solve(TARMAC);
  assert.deepEqual(again.input, g.input);
  near(again.reach, g.reach, 1e-9, 'frame reach unchanged');
  near(again.wheelbase, g.wheelbase, 1e-9, 'wheelbase unchanged');
});

test('personal fitting is optional and tolerates partial input', () => {
  const g = Geo.solve(TARMAC);
  const blank = Geo.solveFitting(null, g);
  assert.equal(blank.stemLength, null);
  assert.equal(blank.saddleHeight, null);
  assert.equal(blank.points.stemEnd, null);
  assert.equal(blank.points.saddleTop, null);
  assert.equal(blank.points.crankEnd, null);
  assert.equal(Geo.hasFittingData(null), false);

  const partial = Geo.solveFitting({ stemLength: 100 }, g);
  assert.equal(partial.stemLength, 100);
  assert.equal(partial.stemAngle, null);
  assert.equal(partial.points.stemEnd, null, 'no drawing until the pair is complete');

  const clamped = Geo.solveFitting({
    stemLength: 9999, stemAngle: -999, crankLength: 1, saddleHeight: 10
  }, g);
  assert.equal(clamped.stemLength, Geo.FITTING_RULES.stemLength.max);
  assert.equal(clamped.stemAngle, Geo.FITTING_RULES.stemAngle.min);
  assert.equal(clamped.crankLength, Geo.FITTING_RULES.crankLength.min);
  assert.equal(clamped.saddleHeight, Geo.FITTING_RULES.saddleHeight.min);

  assert.equal(Geo.hasFittingData({ stemLength: 100 }), true);
  assert.equal(Geo.hasFittingData({}), false);
});

test('fitting fields all carry labels, units and highlight parts', () => {
  const keys = Geo.FITTING_FIELDS.map(f => f.key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate fit keys');
  for (const field of Geo.FITTING_FIELDS) {
    assert.ok(field.label && field.unit, `${field.key} label/unit`);
    assert.ok(Array.isArray(field.parts) && field.parts.length > 0, `${field.key} parts`);
  }
  const derived = Geo.FITTING_FIELDS.filter(f => f.derived).map(f => f.key);
  assert.deepEqual(derived, ['seatpostOverFrame', 'seatpostInsertLength']);
});
