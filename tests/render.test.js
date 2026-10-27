/*
 * Tracer-bullet tests for the SVG renderer: the pure string output is checked
 * without a browser, so the drawing logic is verified the same way the
 * geometry is. Covers single-bike and multi-bike (comparison) rendering.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../js/geometry.js');
const Render = require('../js/render.js');

const G = Geo.solve(); // Tarmac SL7
const G2 = Geo.solve({
  bsd: 622, tireWidth: 38, chainstay: 425, bbDrop: 74,
  seatTubeLength: 466, seatTubeAngle: 75.5, headTubeAngle: 70.5,
  headTubeLength: 100, frontCenter: 594.1, forkOffset: 50, forkLength: 404.5
});

function fakeSvg() {
  return {
    attrs: {},
    innerHTML: '',
    setAttribute(name, value) { this.attrs[name] = value; },
    removeAttribute(name) { delete this.attrs[name]; }
  };
}

function entries() {
  return Array.from(arguments).map((g, index) => ({
    g: g, colorIndex: index, selected: index === 0
  }));
}

function render(svg, bikes, activeKey, showAnnotation, align) {
  return Render.render(svg, {
    bikes: bikes,
    activeKey: activeKey || null,
    showAnnotation: showAnnotation !== false,
    align: align || 'axle'
  });
}

test('scene contains one element per bike part', () => {
  const parts = Render.buildParts(G);
  const ids = parts.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'part ids are unique');
  for (const expected of ['wheel-rear', 'wheel-front', 'chainstay', 'seattube',
    'toptube', 'downtube', 'headtube', 'fork', 'bbshell', 'ground']) {
    assert.ok(ids.includes(expected), `scene has ${expected}`);
  }

  const wheels = parts.filter(p => p.id.startsWith('wheel'));
  for (const wheel of wheels) {
    assert.equal(wheel.type, 'circle');
    assert.equal(wheel.r, G.tireRadius);
  }

  const tyres = parts.filter(p => p.id.startsWith('tire-'));
  assert.equal(tyres.length, 2, 'one tyre band per wheel');
  for (const tyre of tyres) {
    assert.equal(tyre.type, 'annulus');
    assert.ok(tyre.rOuter > tyre.rInner, 'band sits between the two circles');
    assert.equal(tyre.rOuter, G.tireRadius);
    assert.equal(tyre.rInner, G.rimRadius);
  }

  const head = parts.find(p => p.id === 'headtube');
  assert.ok(Math.abs(Geo.dist(head.a, head.b) - G.input.headTubeLength) < 1e-9);
});

test('ground alignment shifts every bike up by its tyre radius', () => {
  const shifted = Render.alignGeometries([G, G2], 'ground');
  assert.equal(shifted.length, 2);
  assert.equal(shifted[0].groundY, 0);
  assert.equal(shifted[1].groundY, 0);
  assert.equal(shifted[0].rearAxle.y, G.tireRadius);
  assert.equal(shifted[1].rearAxle.y, G2.tireRadius);
  assert.equal(shifted[0].bb.y, G.bb.y + G.tireRadius);
  assert.equal(shifted[0].htTop.y, G.htTop.y + G.tireRadius);
  assert.equal(shifted[0].anchors.ttHead.y, G.anchors.ttHead.y + G.tireRadius);
  assert.equal(shifted[0].tireRadius, G.tireRadius, 'tyre radius is unchanged');
  assert.equal(shifted[0].input, G.input, 'inputs are shared');
  assert.equal(Render.alignGeometries([G], 'axle')[0], G, 'axle mode returns the input');
});

test('ground alignment stands every bike on the same ground line', () => {
  const svg = fakeSvg();
  render(svg, entries(G, G2), null, true, 'ground');

  const lines = Array.from(svg.innerHTML.matchAll(/class="part ground"[^>]*y1="([^"]+)"[^>]*y2="([^"]+)"/g));
  assert.equal(lines.length, 2, 'one ground line per bike');
  for (const line of lines) {
    assert.equal(line[1], '0');
    assert.equal(line[2], '0');
  }
  assert.ok(!svg.innerHTML.includes('NaN'));
});

test('axle alignment keeps the ground at the tyre radius', () => {
  const svg = fakeSvg();
  render(svg, entries(G));
  const match = svg.innerHTML.match(/class="part ground"[^>]*y1="([^"]+)"/);
  assert.ok(match, 'ground line exists');
  assert.equal(match[1], String(Math.round(G.tireRadius)));
});

test('dimensions follow the ground alignment', () => {
  const svg = fakeSvg();
  render(svg, entries(G), 'bbHeight', true, 'ground');
  assert.ok(svg.innerHTML.includes('263.0 mm'));
  assert.equal(svg.attrs.class, 'is-inspecting');
  assert.ok(!svg.innerHTML.includes('NaN'));
});

test('the tyre band is filled with a tint of the bike colour', () => {
  const svg = fakeSvg();
  render(svg, entries(G));

  assert.equal((svg.innerHTML.match(/data-part="tire-/g) || []).length, 2);
  assert.ok(svg.innerHTML.includes('class="part tire"'));
  assert.ok(svg.innerHTML.includes('fill-rule="evenodd"'));
  assert.ok(!svg.innerHTML.includes('NaN'));
});

test('view box encloses every part (single and multi bike)', () => {
  const single = Render.viewBoxFor([G]);
  assert.ok(single.w > 0 && single.h > 0);

  for (const part of Render.buildParts(G)) {
    const points = part.type === 'line' ? [part.a, part.b] : [part.c];
    for (const p of points) {
      assert.ok(p.x >= single.x && p.x <= single.x + single.w, `x ${p.x} inside view box`);
      assert.ok(-p.y >= single.y && -p.y <= single.y + single.h, `y ${p.y} inside view box`);
    }
  }

  const union = Render.viewBoxFor([G, G2]);
  assert.ok(union.w >= single.w, 'union is at least as wide');
  assert.ok(union.x <= Math.min(-G.tireRadius, -G2.tireRadius) - 89, 'union covers the rear wheels');
  assert.ok(union.x + union.w >= G2.frontAxle.x + G2.tireRadius + 89, 'union covers the front wheels');
});

test('render writes a viewBox and all scene parts', () => {
  const svg = fakeSvg();
  render(svg, entries(G));

  assert.ok(svg.attrs.viewBox, 'viewBox is set');
  assert.equal(svg.innerHTML.includes('<circle'), true);
  for (const part of Render.buildParts(G)) {
    assert.ok(svg.innerHTML.includes('data-part="' + part.id + '"'), `renders ${part.id}`);
  }
  assert.ok(!svg.innerHTML.includes('NaN'), 'no NaN coordinates');
  assert.ok(!svg.attrs.class, 'not in inspecting state');
});

test('two bikes render as separate colour groups', () => {
  const svg = fakeSvg();
  const list = entries(G, G2);
  list[1].selected = true;
  list[0].selected = false;
  render(svg, list);

  assert.equal((svg.innerHTML.match(/class="bike bike-/g) || []).length, 2);
  assert.ok(svg.innerHTML.includes('class="bike bike-0"'), 'bike A group');
  assert.ok(svg.innerHTML.includes('class="bike bike-1 is-selected"'), 'selected bike B group');
  assert.ok(!svg.innerHTML.includes('NaN'), 'no NaN coordinates');
});

test('hovering Stack highlights the head tube/top tube and adds a dimension', () => {
  const svg = fakeSvg();
  render(svg, entries(G), 'stack');

  assert.ok(svg.innerHTML.includes(Render.fmt(G.stack, 1) + ' mm'), 'dimension label is rendered');
  assert.ok(svg.innerHTML.includes('class="part frame is-active" data-part="headtube"'));
  assert.ok(svg.innerHTML.includes('class="part frame is-active" data-part="toptube"'));
  assert.ok(svg.innerHTML.includes('dim-line'), 'dimension primitives are rendered');
  assert.equal(svg.attrs.class, 'is-inspecting', 'focus state is set');
});

test('hovering Wheelbase adds a dimension between the axles', () => {
  const svg = fakeSvg();
  render(svg, entries(G), 'wheelbase');
  assert.ok(svg.innerHTML.includes(Render.fmt(G.wheelbase, 1) + ' mm'));
  assert.ok(svg.innerHTML.includes('is-active'));
  assert.ok(!svg.innerHTML.includes('NaN'));
});

test('BB drop renders its dimension even though it is a short one', () => {
  const svg = fakeSvg();
  render(svg, entries(G), 'bbDrop');
  assert.ok(svg.innerHTML.includes('74 mm'), 'BB drop dimension label');
  assert.ok(svg.innerHTML.includes('dim-arrow'), 'BB drop dimension arrows');
});

test('hovering a parameter with two bikes highlights both bikes', () => {
  const svg = fakeSvg();
  const list = entries(G, G2);
  list[1].selected = true;
  list[0].selected = false;
  render(svg, list, 'stack');

  assert.equal((svg.innerHTML.match(/is-active/g) || []).length, 4,
    'head tube + top tube are highlighted on each bike');
  assert.equal((svg.innerHTML.match(new RegExp(Render.fmt(G2.stack, 1) + ' mm', 'g')) || []).length, 1,
    'only the selected bike gets the dimension');
  assert.ok(!svg.innerHTML.includes(Render.fmt(G.stack, 1) + ' mm'), 'no annotation for the other bike');
});

test('compare table mode can suppress the dimension overlay', () => {
  const svg = fakeSvg();
  const list = entries(G, G2);
  list[1].selected = true;
  render(svg, list, 'stack', false);

  assert.ok(svg.innerHTML.includes('is-active'), 'lines are still highlighted');
  assert.ok(!svg.innerHTML.includes('dim-line'), 'no dimension primitives');
  assert.ok(!svg.innerHTML.includes(Render.fmt(G.stack, 1) + ' mm'), 'no dimension labels');
});

test('tire outer diameter annotation spans the wheel', () => {
  const svg = fakeSvg();
  render(svg, entries(G), 'tireOuterDiameter');
  assert.ok(svg.innerHTML.includes('\u00d8 674.0 mm'), 'diameter label');
  assert.ok(svg.innerHTML.includes('is-active'), 'wheels are highlighted');
  assert.ok(!svg.innerHTML.includes('NaN'));
});

test('every parameter row produces a drawable annotation', () => {
  for (const param of Geo.PARAMS) {
    const ctx = Render.makeContext(G, Render.viewBoxFor([G]));
    const primitives = Render.annotationFor(param.key, G, ctx);
    assert.ok(Array.isArray(primitives), `${param.key} returns an array`);
    assert.ok(primitives.length > 0, `${param.key} has at least one primitive`);
    for (const primitive of primitives) {
      assert.equal(typeof primitive, 'object', `${param.key} primitives are flat objects`);
      assert.ok(primitive && typeof primitive.k === 'string', `${param.key} primitive has a kind`);
    }

    const markup = Render.serializeAnnotations(primitives, ctx);
    assert.ok(markup.length > 0, `${param.key} serializes`);
    assert.ok(!markup.includes('NaN'), `${param.key} has no NaN`);
    assert.ok(!markup.includes('undefined'), `${param.key} has no undefined`);
  }
});

test('annotation values come from the solved geometry', () => {
  const ctx = Render.makeContext(G, Render.viewBoxFor([G]));
  const markup = Render.serializeAnnotations(Render.annotationFor('trail', G, ctx), ctx);
  assert.ok(markup.includes(Render.fmt(G.trail, 1) + ' mm'));

  const seatAngle = Render.serializeAnnotations(Render.annotationFor('seatTubeAngle', G, ctx), ctx);
  assert.ok(seatAngle.includes('75.50\u00b0'));
});

test('an unknown active key is harmless', () => {
  const svg = fakeSvg();
  assert.doesNotThrow(() => render(svg, entries(G), 'not-a-parameter'));
  assert.ok(svg.innerHTML.length > 0);
});

test('standalone SVG export inlines styles and dotted paper', () => {
  const el = fakeSvg();
  render(el, entries(G), 'stack');
  const box = Render.viewBoxFor([G]);
  const svg = Render.standaloneSvg(el.innerHTML, box);

  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'has XML declaration');
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'has SVG namespace');
  assert.ok(svg.includes('viewBox="' + [box.x, box.y, box.w, box.h].join(' ') + '"'), 'keeps the view box');
  assert.ok(svg.includes('<style>'), 'inlines the stylesheet');
  assert.ok(svg.includes('bikegeo-dots'), 'has the dotted paper pattern');
  assert.ok(svg.includes('data-part="headtube"'), 'contains the scene');
  assert.ok(svg.includes(Render.fmt(G.stack, 1) + ' mm'), 'keeps the active annotation');
  assert.ok(!svg.includes('NaN'), 'no NaN');
  assert.ok(!svg.includes('<script'), 'no scripts');
});

test('standalone SVG export keeps comparison colours', () => {
  const el = fakeSvg();
  const list = entries(G, G2);
  list[1].selected = true;
  render(el, list);
  const svg = Render.standaloneSvg(el.innerHTML, Render.viewBoxFor([G, G2]));

  assert.ok(svg.includes('bike bike-0'), 'bike A group is exported');
  assert.ok(svg.includes('bike bike-1 is-selected'), 'bike B group is exported');
  assert.ok(svg.includes('.bike-0{--bike:#111827}'), 'bike A colour is inlined');
  assert.ok(svg.includes('.bike-1{--bike:#4FA8E8}'), 'bike B colour is inlined');
  assert.ok(svg.includes('.bike-2{--bike:#F97316}'), 'bike C colour is inlined');
  assert.ok(svg.includes('.part.tire{fill:var(--bike'), 'tyre tint is inlined');
});

test('render is re-runnable and reflects tuned input', () => {
  const svg = fakeSvg();
  render(svg, entries(G), null);
  const tuned = Geo.solve(Object.assign({}, G.input, { frontCenter: 620 }));
  render(svg, entries(tuned), 'reach');
  assert.ok(svg.innerHTML.includes(Render.fmt(tuned.reach, 1) + ' mm'));
  render(svg, entries(tuned), 'stack');
  assert.ok(svg.innerHTML.includes(Render.fmt(tuned.stack, 1) + ' mm'));
});

/* ------------------------------------------------------------------ *
 * Personal fitting overlays
 * ------------------------------------------------------------------ */
function sampleFitting() {
  return Geo.solveFitting({
    stemLength: 100, stemAngle: 6,
    saddleHeight: 690, seatpostLength: 350, crankLength: 172.5
  }, G);
}

test('fitting overlays appear only when fitting data is present', () => {
  const svg = fakeSvg();
  render(svg, entries(G));
  assert.ok(!svg.innerHTML.includes('data-part="fit-'), 'no fitting parts by default');

  render(svg, [{ g: G, fitting: sampleFitting(), colorIndex: 0, selected: true }]);
  for (const id of ['fit-stem', 'fit-seatpost', 'fit-saddle', 'fit-crank']) {
    assert.ok(svg.innerHTML.includes('data-part="' + id + '"'), id + ' is drawn');
  }
  assert.ok(!svg.innerHTML.includes('NaN'), 'no NaN in fitting parts');
});

test('fitting overlays expand the view box so nothing is clipped', () => {
  const fitting = sampleFitting();
  const base = Render.viewBoxFor(G);
  const box = Render.viewBoxFor([G], [
    fitting.points.saddleTop,
    fitting.points.stemEnd,
    fitting.points.crankEnd
  ]);

  assert.ok(box.y < base.y, 'view box grows upwards for the saddle / stem');
  assert.ok(box.h > base.h, 'view box is taller');

  const svg = fakeSvg();
  render(svg, [{ g: G, fitting: fitting, colorIndex: 0, selected: true }]);
  assert.equal(svg.attrs.viewBox, [box.x, box.y, box.w, box.h].join(' '));
});

test('hovering a fitting field highlights its overlay', () => {
  const svg = fakeSvg();
  const fitting = sampleFitting();
  render(svg, [{ g: G, fitting: fitting, colorIndex: 0, selected: true }], 'stemLength');
  assert.ok(/class="part fit stem is-active"/.test(svg.innerHTML), 'stem is active');
  assert.ok(/class="part fit crank"/.test(svg.innerHTML), 'crank is not active');

  render(svg, [{ g: G, fitting: fitting, colorIndex: 0, selected: true }], 'crankLength');
  assert.ok(/class="part fit crank is-active"/.test(svg.innerHTML), 'crank is active');
  assert.ok(/class="part fit stem"/.test(svg.innerHTML), 'stem is not active');
});

test('ground alignment shifts fitting overlays too', () => {
  const svg = fakeSvg();
  render(svg, [{ g: G, fitting: sampleFitting(), colorIndex: 0, selected: true }], null, true, 'ground');
  const ground = svg.innerHTML.match(/class="part ground"[^>]*y1="([^"]+)"/);
  assert.ok(ground && Number(ground[1]) === 0, 'ground sits at y = 0');
  assert.ok(svg.innerHTML.includes('data-part="fit-saddle"'), 'fitting overlay is still drawn');
  assert.ok(!svg.innerHTML.includes('NaN'), 'no NaN after shifting');
});

test('standalone SVG export keeps fitting overlays and their styles', () => {
  const el = fakeSvg();
  const fitting = sampleFitting();
  const result = render(el, [{ g: G, fitting: fitting, colorIndex: 0, selected: true }]);
  const svg = Render.standaloneSvg(el.innerHTML, result.box);
  assert.ok(svg.includes('data-part="fit-stem"'), 'stem is exported');
  assert.ok(svg.includes('data-part="fit-crank"'), 'crank is exported');
  assert.ok(svg.includes('.part.fit{stroke-width:1.6px'), 'fit style is inlined');
});
