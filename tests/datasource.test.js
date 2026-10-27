/*
 * Tests for the reserved online-data extension point.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/datasource.js');

test('the reserved Bike Insights adapter is registered as planned', () => {
  const adapter = Data.get('bikeinsights');
  assert.ok(adapter, 'adapter exists');
  assert.equal(adapter.status, 'planned');
  assert.equal(typeof adapter.fetchGeometry, 'function');
  assert.ok(Data.list().some(a => a.id === 'bikeinsights'));
});

test('fetchGeometry rejects for the reserved adapter', async () => {
  await assert.rejects(
    () => Data.fetchGeometry('bikeinsights', {}),
    /reserved for a future version/
  );
});

test('an unknown data source rejects cleanly', async () => {
  await assert.rejects(() => Data.fetchGeometry('nope', {}), /Unknown geometry data source/);
});

test('a future adapter can be plugged in and resolves inputs', async () => {
  Data.register({
    id: 'fixture',
    label: 'Fixture',
    status: 'available',
    fetchGeometry: async () => ({
      name: 'Test bike',
      inputs: { frontCenter: 600, forkOffset: 45, forkLength: 380 }
    })
  });

  const result = await Data.fetchGeometry('fixture', { url: 'https://example.com' });
  assert.equal(result.name, 'Test bike');
  assert.equal(result.inputs.frontCenter, 600);

  // The solver accepts partial input and compensates the rest.
  const Geo = require('../js/geometry.js');
  const g = Geo.solve(result.inputs);
  assert.equal(g.input.frontCenter, 600);
  assert.equal(g.input.forkOffset, 45);
  assert.ok(Number.isFinite(g.reach));
  assert.ok(Number.isFinite(g.stack));
  assert.ok(Number.isFinite(g.trail));
});

test('malformed registration is rejected', () => {
  assert.throws(() => Data.register({ label: 'no id' }), /string id/);
  assert.throws(() => Data.register({ id: 'x' }), /fetchGeometry/);
});

test('a source returning no inputs is rejected', async () => {
  Data.register({
    id: 'empty',
    label: 'Empty',
    status: 'available',
    fetchGeometry: async () => ({ name: 'nope' })
  });
  await assert.rejects(() => Data.fetchGeometry('empty', {}), /no inputs object/);
});
