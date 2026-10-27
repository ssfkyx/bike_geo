/*
 * Unit tests for the portable template format (export / import).
 *
 *   node --test tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Templates = require('../js/templates.js');

const SAMPLE = [
  {
    name: 'Road fit',
    presetId: 'tarmac',
    inputs: { bsd: 622, tireWidth: 26, chainstay: 410, frontCenter: 574.5 },
    fitting: { stemLength: 100, stemAngle: 6, saddleHeight: 700, crankLength: 172.5 }
  },
  {
    name: 'Gravel fit',
    presetId: null,
    inputs: { bsd: 584, tireWidth: 47, chainstay: 430, frontCenter: 599.8 },
    fitting: {}
  }
];

test('export document carries schema, templates, inputs and fitting data', () => {
  const date = new Date(2026, 9, 27, 12, 0, 0);
  const doc = Templates.createExport(SAMPLE, date);

  assert.equal(doc.app, 'Bike Geo');
  assert.equal(doc.schemaVersion, Templates.SCHEMA_VERSION);
  assert.equal(doc.exportedAt, date.toISOString());
  assert.equal(doc.templates.length, 2);
  assert.deepEqual(doc.templates[0].inputs, SAMPLE[0].inputs);
  assert.deepEqual(doc.templates[0].fitting, SAMPLE[0].fitting);

  // The export must not alias the live template objects.
  doc.templates[0].inputs.bsd = 999;
  assert.equal(SAMPLE[0].inputs.bsd, 622);

  const file = Templates.exportText(SAMPLE, date);
  assert.ok(file.includes('"schemaVersion": 1'));
  assert.ok(file.includes('Road fit'));
});

test('export -> import round-trips names, inputs, presets and fitting', () => {
  const file = Templates.exportText(SAMPLE);
  const parsed = Templates.parseImport(file);

  assert.equal(parsed.templates.length, 2);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.templates[0].name, 'Road fit');
  assert.equal(parsed.templates[0].presetId, 'tarmac');
  assert.deepEqual(parsed.templates[0].inputs, SAMPLE[0].inputs);
  assert.deepEqual(parsed.templates[0].fitting, SAMPLE[0].fitting);
  assert.equal(parsed.templates[1].presetId, null);
});

test('import accepts a bare array and skips invalid entries', () => {
  const parsed = Templates.parseImport(JSON.stringify([
    { name: 'A', inputs: { bsd: 622 } },
    { name: '   ', inputs: { bsd: 622 } },
    { name: 'B', inputs: 'not-an-object' },
    { name: '', inputs: {} },
    { name: 'C', inputs: { bsd: 584 }, fitting: { crankLength: 165 } }
  ]));

  assert.equal(parsed.templates.length, 2);
  assert.equal(parsed.skipped, 3);
  assert.deepEqual(parsed.templates.map(t => t.name), ['A', 'C']);
  assert.deepEqual(parsed.templates[1].fitting, { crankLength: 165 });
});

test('import rejects bad files with a readable error', () => {
  assert.throws(() => Templates.parseImport('not json'), /JSON/);
  assert.throws(() => Templates.parseImport('{}'), /No template list/);
  assert.throws(() => Templates.parseImport(JSON.stringify({ templates: [] })), /No valid templates/);
  assert.throws(() => Templates.parseImport(JSON.stringify({
    schemaVersion: 99, templates: [{ name: 'A', inputs: {} }]
  })), /newer version/);
});

test('unique names get a numeric suffix when needed', () => {
  assert.equal(Templates.uniqueName('Fit', []), 'Fit');
  assert.equal(Templates.uniqueName('Fit', ['Fit']), 'Fit (2)');
  assert.equal(Templates.uniqueName('Fit', ['Fit', 'Fit (2)']), 'Fit (3)');
});

test('export file name is date-stamped', () => {
  const name = Templates.exportFileName(new Date(2026, 9, 27, 12, 0, 0));
  assert.equal(name, 'bikegeo-templates-20261027.json');
});
