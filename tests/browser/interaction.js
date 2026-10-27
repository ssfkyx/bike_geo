/* Interaction test through the Chrome DevTools Protocol.
 *
 * The pure unit tests cover geometry + renderer; this one drives the real page:
 * edit an input -> recompute -> redraw, hover -> highlight + dimension,
 * clamping, presets, and the multi-bike comparison flow (add / select / remove).
 * No extra dependencies (uses the Node global WebSocket and fetch).
 *
 * Start a browser with a debugging port first, or use:
 *   npm run test:browser
 */
'use strict';

const DEBUG_URL = process.env.CDP_URL || 'http://127.0.0.1:9333';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + name +
    (ok ? '' : '  actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected)));
}

async function main() {
  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(DEBUG_URL + '/json/list')).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch (err) { /* browser not up yet */ }
    await sleep(250);
  }
  const page = targets && targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target found at ' + DEBUG_URL);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('websocket failed'));
  });

  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result && response.result.exceptionDetails) {
      throw new Error('page exception: ' + JSON.stringify(response.result.exceptionDetails));
    }
    return response.result.result.value;
  };

  for (let i = 0; i < 40; i++) {
    if (await evaluate('document.readyState') === 'complete') break;
    await sleep(200);
  }

  /* ---------------------------------------------------------------- *
   * 1. Initial single-bike state
   * ---------------------------------------------------------------- */
  const initial = await evaluate(`(function () {
    return {
      rows: document.querySelectorAll('.row').length,
      inputs: document.querySelectorAll('.input-row').length,
      computed: document.querySelectorAll('.computed-row').length,
      fitRows: document.querySelectorAll('.fit-row').length,
      fitInputs: document.querySelectorAll('.fit-row input').length,
      fitOutputs: document.querySelectorAll('.fit-row output').length,
      fitParts: document.querySelectorAll('#drawing .part.fit').length,
      fitDerived: Array.from(document.querySelectorAll('.fit-row.fit-derived output'))
        .map((el) => el.textContent.trim()),
      parts: document.querySelectorAll('#drawing .part').length,
      tireBands: document.querySelectorAll('#drawing .part.tire').length,
      tireFill: getComputedStyle(document.querySelector('#drawing .part.tire')).fill,
      tireFillOpacity: getComputedStyle(document.querySelector('#drawing .part.tire')).fillOpacity,
      bikes: document.querySelectorAll('#drawing .bike').length,
      tabs: document.querySelectorAll('.bike-tab').length,
      addDisabled: document.getElementById('add-bike').disabled,
      compareDisabled: document.getElementById('view-compare').disabled,
      preset: document.getElementById('preset-select').value,
      frontCenterField: document.getElementById('field-frontCenter').value,
      ett: document.querySelector('.computed-row[data-key="effectiveTopTube"] .value').textContent,
      computedKeys: Array.from(document.querySelectorAll('.computed-row'))
        .slice(0, 3).map((row) => row.getAttribute('data-key')),
      badge: document.getElementById('stage-badge').textContent,
      legendHidden: document.getElementById('bike-legend').hidden
    };
  })()`);
  check('initial rows', initial.rows, 32);
  check('initial inputs', initial.inputs, 11);
  check('initial computed', initial.computed, 12);
  check('initial fitting rows', initial.fitRows, 9);
  check('initial fitting inputs', initial.fitInputs, 7);
  check('initial fitting outputs', initial.fitOutputs, 2);
  check('fitting starts blank', initial.fitDerived, ['\u2014', '\u2014']);
  check('initial scene parts', initial.parts, 17);
  check('no fitting overlay when blank', initial.fitParts, 0);
  check('initial tyre bands', initial.tireBands, 2);
  check('tyre band uses the bike colour', initial.tireFill, 'rgb(17, 24, 39)');
  check('tyre band is a light tint', initial.tireFillOpacity, '0.14');
  check('initial bikes drawn', initial.bikes, 1);
  check('initial bike tab', initial.tabs, 1);
  check('add bike enabled', initial.addDisabled, false);
  check('compare disabled with one bike', initial.compareDisabled, true);
  check('initial preset', initial.preset, 'tarmac');
  check('initial front center field', initial.frontCenterField, '574.5');
  check('initial effective top tube', initial.ett, '507.0');
  check('reach/stack/ratio lead the computed list', initial.computedKeys, ['reach', 'stack', 'stackReachRatio']);
  check('initial badge', initial.badge, '700C / 29" \u00b7 26 mm \u00b7 OD 674.0 mm');
  check('legend hidden with one bike', initial.legendHidden, true);

  /* ---------------------------------------------------------------- *
   * 1b. On-the-ground alignment toggle
   * ---------------------------------------------------------------- */
  const alignment = await evaluate(`(function () {
    const button = document.getElementById('align-toggle');
    const drawing = document.getElementById('drawing');
    const groundLine = () => document.querySelector('#drawing .part.ground');
    const before = {
      pressed: button.getAttribute('aria-pressed'),
      on: button.classList.contains('is-on'),
      groundY: groundLine().getAttribute('y1'),
      groundY2: groundLine().getAttribute('y2'),
      viewBox: drawing.getAttribute('viewBox')
    };
    button.click();
    const after = {
      pressed: button.getAttribute('aria-pressed'),
      on: button.classList.contains('is-on'),
      groundY: groundLine().getAttribute('y1'),
      groundY2: groundLine().getAttribute('y2'),
      viewBox: drawing.getAttribute('viewBox')
    };
    button.click();
    const restored = {
      pressed: button.getAttribute('aria-pressed'),
      groundY: groundLine().getAttribute('y1')
    };
    return { before, after, restored };
  })()`);
  check('alignment starts on the rear axle', [alignment.before.pressed, alignment.before.on], ['false', false]);
  check('axle mode keeps the ground at the tyre radius', [alignment.before.groundY, alignment.before.groundY2], ['337', '337']);
  check('on-the-ground toggles on', [alignment.after.pressed, alignment.after.on], ['true', true]);
  check('ground mode puts the ground line at y = 0', [alignment.after.groundY, alignment.after.groundY2], ['0', '0']);
  check('ground mode changes the view box', alignment.after.viewBox === alignment.before.viewBox, false);
  check('ground mode can be toggled off', [alignment.restored.pressed, alignment.restored.groundY], ['false', '337']);

  /* ---------------------------------------------------------------- *
   * 1c. Personal fitting area (optional data + bidirectional stem inputs)
   * ---------------------------------------------------------------- */
  const fitting = await evaluate(`(function () {
    const set = (key, value) => {
      const input = document.getElementById('fit-' + key);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('stemLength', 100);
    set('stemAngle', 6);
    const stem = {
      reach: document.getElementById('fit-stemReach').value,
      stack: document.getElementById('fit-stemStack').value,
      parts: document.querySelectorAll('#drawing .part[data-part="fit-stem"]').length
    };
    set('stemReach', 120);
    set('stemStack', 20);
    const toLength = {
      length: document.getElementById('fit-stemLength').value,
      angle: document.getElementById('fit-stemAngle').value
    };
    set('saddleHeight', 700);
    set('seatpostLength', 350);
    const saddle = {
      over: document.querySelector('.fit-row[data-key="seatpostOverFrame"] output').textContent,
      insert: document.querySelector('.fit-row[data-key="seatpostInsertLength"] output').textContent,
      seatpostParts: document.querySelectorAll('#drawing .part[data-part="fit-seatpost"]').length
    };
    set('crankLength', 172.5);
    const crank = {
      parts: document.querySelectorAll('#drawing .part[data-part="fit-crank"]').length,
      line: (function () {
        const line = document.querySelector('#drawing .part[data-part="fit-crank"]');
        return Math.round(Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')));
      })()
    };
    const row = document.querySelector('.fit-row[data-key="stemLength"]');
    row.dispatchEvent(new MouseEvent('mouseenter'));
    const hoverActive = Array.from(document.querySelectorAll('#drawing .part.is-active'))
      .map((el) => el.getAttribute('data-part')).sort();
    row.dispatchEvent(new MouseEvent('mouseleave'));
    return {
      stem: stem,
      toLength: toLength,
      saddle: saddle,
      crank: crank,
      hoverActive: hoverActive,
      fitParts: document.querySelectorAll('#drawing .part.fit').length
    };
  })()`);
  check('stem length/angle fills reach/stack', [fitting.stem.reach, fitting.stem.stack], ['99.45', '10.45']);
  check('stem pair draws its overlay', fitting.stem.parts, 1);
  check('stem reach/stack converts back', [fitting.toLength.length, fitting.toLength.angle], ['121.66', '9.46']);
  check('saddle height derives seatpost over frame', fitting.saddle.over, '253.0');
  check('seatpost length derives insert length', fitting.saddle.insert, '97.0');
  check('seatpost/saddle overlay drawn', fitting.saddle.seatpostParts, 1);
  check('crank line drawn downward', [fitting.crank.parts, fitting.crank.line], [1, 173]);
  check('all fitting overlays drawn', fitting.fitParts, 4);
  check('hover highlights fitting overlay', fitting.hoverActive, ['fit-stem']);

  /* ---------------------------------------------------------------- *
   * 1d. Save / load / delete a template (localStorage + fitting data)
   * ---------------------------------------------------------------- */
  const templates = await evaluate(`(async function () {
    window.prompt = function () { return 'Test Template'; };
    window.confirm = function () { return true; };
    const save = document.getElementById('template-save');
    const select = document.getElementById('template-select');
    const del = document.getElementById('template-delete');
    const exportBtn = document.getElementById('template-export');

    save.click();
    const saved = {
      options: Array.from(select.options).map((o) => o.value),
      value: select.value,
      deleteDisabled: del.disabled,
      stored: (function () {
        try {
          var raw = localStorage.getItem('bikegeo.templates.v1');
          var list = raw ? JSON.parse(raw) : [];
          var record = list.filter(function (t) { return t.name === 'Test Template'; })[0];
          return !!(record && record.fitting &&
            Math.abs(record.fitting.saddleHeight - 700) < 1e-9 &&
            Math.abs(record.fitting.stemLength - 121.655) < 0.01);
        } catch (err) { return 'error'; }
      })()
    };

    // Export: capture the generated download blob instead of writing a file.
    var blob = null;
    var downloadName = null;
    var origCreate = URL.createObjectURL;
    var origClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = function (value) { blob = value; return 'blob:test'; };
    HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
    exportBtn.click();
    var exportText = blob ? await blob.text() : '';
    URL.createObjectURL = origCreate;
    HTMLAnchorElement.prototype.click = origClick;
    var exportedDoc = JSON.parse(exportText);

    // Change values, then load the saved template.
    var fc = document.getElementById('field-frontCenter');
    fc.value = '600';
    fc.dispatchEvent(new Event('input', { bubbles: true }));
    var saddle = document.getElementById('fit-saddleHeight');
    saddle.value = '650';
    saddle.dispatchEvent(new Event('input', { bubbles: true }));
    select.value = 'Test Template';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    var loaded = {
      frontCenter: document.getElementById('field-frontCenter').value,
      saddleHeight: document.getElementById('fit-saddleHeight').value,
      over: document.querySelector('.fit-row[data-key="seatpostOverFrame"] output').textContent,
      insert: document.querySelector('.fit-row[data-key="seatpostInsertLength"] output').textContent
    };

    del.click();
    var deleted = {
      options: Array.from(select.options).map((o) => o.value),
      deleteDisabled: del.disabled
    };

    // Import the freshly exported file through the real file input.
    var dt = new DataTransfer();
    dt.items.add(new File([exportText], 'templates.json', { type: 'application/json' }));
    var fileInput = document.getElementById('template-import-input');
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function (resolve) { setTimeout(resolve, 250); });
    var imported = {
      options: Array.from(select.options).map((o) => o.value)
    };
    select.value = 'Test Template';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    var importedLoaded = {
      saddleHeight: document.getElementById('fit-saddleHeight').value,
      over: document.querySelector('.fit-row[data-key="seatpostOverFrame"] output').textContent,
      insert: document.querySelector('.fit-row[data-key="seatpostInsertLength"] output').textContent
    };
    del.click();
    var finalOptions = Array.from(select.options).map((o) => o.value);

    return {
      saved: saved,
      downloadName: downloadName,
      exported: {
        app: exportedDoc.app,
        schemaVersion: exportedDoc.schemaVersion,
        count: exportedDoc.templates.length,
        name: exportedDoc.templates[0].name,
        fitting: {
          stemLength: Math.round(exportedDoc.templates[0].fitting.stemLength * 100) / 100,
          saddleHeight: exportedDoc.templates[0].fitting.saddleHeight
        }
      },
      loaded: loaded,
      deleted: deleted,
      imported: imported,
      importedLoaded: importedLoaded,
      finalOptions: finalOptions
    };
  })()`);
  check('save template adds an option', templates.saved.options, ['', 'Test Template']);
  check('save template selects the new option', templates.saved.value, 'Test Template');
  check('delete is enabled after saving', templates.saved.deleteDisabled, false);
  check('template stores fitting data', templates.saved.stored, true);
  check('export builds a schema-versioned file', [templates.exported.app, templates.exported.schemaVersion], ['Bike Geo', 1]);
  check('export contains the template and fitting', [templates.exported.count, templates.exported.name, templates.exported.fitting.stemLength, templates.exported.fitting.saddleHeight],
    [1, 'Test Template', 121.66, 700]);
  check('export file is date-stamped', /^bikegeo-templates-\d{8}\.json$/.test(templates.downloadName), true);
  check('loading a template restores inputs and fitting',
    [templates.loaded.frontCenter, templates.loaded.saddleHeight, templates.loaded.over, templates.loaded.insert],
    ['574.5', '700', '253.0', '97.0']);
  check('deleting removes the template', templates.deleted.options, ['']);
  check('delete is disabled after removal', templates.deleted.deleteDisabled, true);
  check('import restores the template', templates.imported.options, ['', 'Test Template']);
  check('imported template restores fitting', [templates.importedLoaded.saddleHeight, templates.importedLoaded.over],
    ['700', '253.0']);
  check('imported template can be deleted', templates.finalOptions, ['']);

  /* Tire model: +1 mm width -> +2 mm outer diameter (700C x 26 -> 674). */
  const tyre = await evaluate(`(function () {
    const input = document.getElementById('field-tireWidth');
    input.value = '28';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const solved = window.BikeGeo.solve(Object.assign({}, window.BikeGeo.DEFAULTS, { tireWidth: 28 }));
    return {
      displayed: document.querySelector('.computed-row[data-key="tireOuterDiameter"] .value').textContent,
      expected: solved.tireOuterDiameter.toFixed(1),
      badge: document.getElementById('stage-badge').textContent
    };
  })()`);
  check('tire width drives the outer diameter', tyre.displayed, tyre.expected);
  check('tire OD badge updates', tyre.badge, '700C / 29" \u00b7 28 mm \u00b7 OD 678.0 mm');

  /* ---------------------------------------------------------------- *
   * 2. Tune -> recompute, hover -> highlight + dimension, clamp
   * ---------------------------------------------------------------- */
  const edited = await evaluate(`(function () {
    const input = document.getElementById('field-frontCenter');
    input.value = '600';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const solved = window.BikeGeo.solve(Object.assign({}, window.BikeGeo.DEFAULTS, { frontCenter: 600 }));
    const fmt = window.BikeGeoRender.fmt;
    return {
      reach: document.querySelector('.computed-row[data-key="reach"] .value').textContent,
      wheelbase: document.querySelector('.computed-row[data-key="wheelbase"] .value').textContent,
      expectedReach: fmt(solved.reach, 1),
      expectedWheelbase: fmt(solved.wheelbase, 1),
      preset: document.getElementById('preset-select').value,
      scene: document.querySelectorAll('#drawing .part').length
    };
  })()`);
  check('tuning recomputes reach', edited.reach, edited.expectedReach);
  check('tuning recomputes wheelbase', edited.wheelbase, edited.expectedWheelbase);
  check('tuning switches preset to custom', edited.preset, 'custom');
  check('tuning keeps the scene alive', edited.scene, 21);

  const hovered = await evaluate(`(function () {
    const row = document.querySelector('.computed-row[data-key="stack"]');
    row.dispatchEvent(new MouseEvent('mouseenter'));
    const active = Array.from(document.querySelectorAll('#drawing .part.is-active'))
      .map((el) => el.getAttribute('data-part')).sort();
    const annotation = document.querySelector('#drawing .annotations').innerHTML;
    const solved = window.BikeGeo.solve(Object.assign({}, window.BikeGeo.DEFAULTS, { frontCenter: 600 }));
    const expectedLabel = window.BikeGeoRender.fmt(solved.stack, 1) + ' mm';
    const inspecting = document.getElementById('drawing').getAttribute('class');
    row.dispatchEvent(new MouseEvent('mouseleave'));
    const cleared = document.querySelectorAll('#drawing .part.is-active').length;
    return { active, hasDimension: annotation.includes(expectedLabel), inspecting, cleared };
  })()`);
  check('hover highlights the stack lines', hovered.active, ['headtube', 'toptube']);
  check('hover draws the matching dimension', hovered.hasDimension, true);
  check('hover sets the focus state', hovered.inspecting, 'is-inspecting');
  check('hover clears on leave', hovered.cleared, 0);

  const clamped = await evaluate(`(function () {
    const input = document.getElementById('field-frontCenter');
    input.value = '5000';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const solved = window.BikeGeo.solve(Object.assign({}, window.BikeGeo.DEFAULTS, { frontCenter: 850 }));
    return {
      field: input.value,
      reach: document.querySelector('.computed-row[data-key="reach"] .value').textContent,
      expected: window.BikeGeoRender.fmt(solved.reach, 1)
    };
  })()`);
  check('out-of-range input is clamped on blur', clamped.field, '850');
  check('clamped value is redrawn', clamped.reach, clamped.expected);

  const presetA = await evaluate(`(function () {
    const select = document.getElementById('preset-select');
    select.value = 'crux';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      frontCenter: document.getElementById('field-frontCenter').value,
      tire: document.getElementById('field-tireWidth').value,
      badge: document.getElementById('stage-badge').textContent
    };
  })()`);
  check('preset fills bike A fields', [presetA.frontCenter, presetA.tire], ['594.1', '38']);
  check('preset updates the badge', presetA.badge, '700C / 29" \u00b7 38 mm \u00b7 OD 698.0 mm');;

  /* ---------------------------------------------------------------- *
   * 3. Add a second bike -> overlay + comparison table
   * ---------------------------------------------------------------- */
  const added = await evaluate(`(function () {
    document.getElementById('add-bike').click();
    return {
      tabs: document.querySelectorAll('.bike-tab').length,
      selectedTab: document.querySelector('.bike-tab.is-selected').getAttribute('data-index'),
      groups: document.querySelectorAll('#drawing .bike').length,
      hasBikeB: !!document.querySelector('#drawing .bike-1'),
      selectedGroup: document.querySelector('#drawing .bike.is-selected').getAttribute('class'),
      compareVisible: !document.getElementById('view-compare-body').hidden,
      compareLabel: document.getElementById('view-compare').textContent,
      compareDisabled: document.getElementById('view-compare').disabled,
      legendHidden: document.getElementById('bike-legend').hidden,
      legendItems: document.querySelectorAll('#bike-legend .legend-item').length,
      stackCells: Array.from(document.querySelectorAll('.cmp-row[data-key="stack"] .cmp-cell'))
        .map((el) => el.textContent.trim()),
      expectedStackCells: (function () {
        const R = window.BikeGeoRender;
        const presets = window.BikeGeo.PRESETS;
        const a = window.BikeGeo.solve(presets.filter((p) => p.id === 'crux')[0].inputs);
        const b = window.BikeGeo.solve(presets.filter((p) => p.id === 'tarmac')[0].inputs);
        const raw = Number((b.stack - a.stack).toFixed(1));
        const delta = Math.abs(raw) < 0.05 ? '\u00b10' : (raw > 0 ? '+' : '') + raw.toFixed(1);
        return [R.fmt(a.stack, 1), R.fmt(b.stack, 1) + delta];
      })(),
      odCells: Array.from(document.querySelectorAll('.cmp-row[data-key="tireOuterDiameter"] .cmp-cell'))
        .map((el) => el.textContent.trim()),
      hasFittingRows: !!document.querySelector('.cmp-row[data-key="stemLength"]'),
      fittingCells: Array.from(document.querySelectorAll('.cmp-row[data-key="stemLength"] .cmp-cell'))
        .map((el) => el.textContent.trim()),
      compareRows: document.querySelectorAll('.cmp-row[data-key]').length
    };
  })()`);
  check('add bike appends a tab', added.tabs, 2);
  check('added bike becomes selected', added.selectedTab, '1');
  check('two bikes are drawn', added.groups, 2);
  check('second bike has its own colour group', added.hasBikeB, true);
  check('selected bike is marked', added.selectedGroup.includes('bike-1'), true);
  check('add bike opens the compare view', added.compareVisible, true);
  check('compare tab label', added.compareLabel, 'Compare (2)');
  check('compare tab enabled', added.compareDisabled, false);
  check('legend appears with two bikes', [added.legendHidden, added.legendItems], [false, 2]);
  check('compare table has every parameter', added.compareRows, 32);
  check('compare stack values and delta', added.stackCells, added.expectedStackCells);
  check('compare tire outer diameter values', added.odCells, ['698.0', '674.0-24.0']);
  check('compare shows fitted data when present', added.hasFittingRows, true);
  check('compare shows blanks for unfitted bikes', added.fittingCells, ['121.7', '\u2014']);

  const compareHover = await evaluate(`(function () {
    const row = document.querySelector('.cmp-row[data-key="stack"]');
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const active = Array.from(document.querySelectorAll('#drawing .part.is-active'))
      .map((el) => el.getAttribute('data-part')).sort();
    const annotation = document.querySelector('#drawing .annotations').innerHTML;
    return {
      activeCount: active.length,
      hasParts: active.every((id) => id === 'headtube' || id === 'toptube'),
      annotationEmpty: annotation.trim() === ''
    };
  })()`);
  check('compare hover highlights both bikes', compareHover.activeCount, 4);
  check('compare hover highlights the right parts', compareHover.hasParts, true);
  check('compare view draws no dimension', compareHover.annotationEmpty, true);

  const compareFitting = await evaluate(`(function () {
    const set = (key, value) => {
      const input = document.getElementById('fit-' + key);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('stemLength', 100);
    set('stemAngle', 6);
    const cells = Array.from(document.querySelectorAll('.cmp-row[data-key="stemLength"] .cmp-cell'))
      .map((el) => el.textContent.trim());
    const row = document.querySelector('.cmp-row[data-key="stemLength"]');
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const active = Array.from(document.querySelectorAll('#drawing .part.is-active'))
      .map((el) => el.getAttribute('data-part'));
    return {
      cells: cells,
      activeCount: active.length,
      allStem: active.every((id) => id === 'fit-stem')
    };
  })()`);
  check('compare fitting values and delta', compareFitting.cells, ['121.7', '100.0-21.7']);
  check('hovering a fitting row highlights every bike', compareFitting.activeCount, 2);
  check('fitting hover highlights the stem overlays', compareFitting.allStem, true);

  /* ---------------------------------------------------------------- *
   * 4. Edit bike B while bike A stays untouched
   * ---------------------------------------------------------------- */
  const editB = await evaluate(`(function () {
    document.getElementById('view-params').click();
    const tab = document.querySelectorAll('.bike-tab')[1];
    tab.click();
    const presetId = document.getElementById('preset-select').value;
    const input = document.getElementById('field-frontCenter');
    const before = input.value;
    input.value = '580';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const presets = window.BikeGeo.PRESETS;
    const R = window.BikeGeoRender;
    const preset = presets.filter((p) => p.id === presetId)[0];
    const solved = window.BikeGeo.solve(Object.assign({}, preset.inputs, { frontCenter: 580 }));
    const a = window.BikeGeo.solve(presets.filter((p) => p.id === 'crux')[0].inputs);
    const raw = Number((solved.reach - a.reach).toFixed(1));
    const delta = Math.abs(raw) < 0.05 ? '\u00b10' : (raw > 0 ? '+' : '') + raw.toFixed(1);
    const cells = Array.from(document.querySelectorAll('.cmp-row[data-key="reach"] .cmp-cell'))
      .map((el) => el.textContent.trim());
    const selectedGroup = document.querySelector('#drawing .bike.is-selected').getAttribute('class');
    return {
      before,
      presetId,
      computedReach: document.querySelector('.computed-row[data-key="reach"] .value').textContent,
      expectedReach: R.fmt(solved.reach, 1),
      cells,
      expectedCells: [R.fmt(a.reach, 1), R.fmt(solved.reach, 1) + delta],
      selectedGroup,
      selectedTab: document.querySelector('.bike-tab.is-selected').getAttribute('data-index'),
      rowHover: (function () {
        const row = document.querySelector('.computed-row[data-key="stack"]');
        row.dispatchEvent(new MouseEvent('mouseenter'));
        const active = Array.from(document.querySelectorAll('#drawing .part.is-active'))
          .map((el) => el.getAttribute('data-part')).sort();
        const annotation = document.querySelector('#drawing .annotations').innerHTML;
        row.dispatchEvent(new MouseEvent('mouseleave'));
        return {
          activeCount: active.length,
          hasDimension: annotation.includes(R.fmt(solved.stack, 1) + ' mm')
        };
      })()
    };
  })()`);
  check('bike B is the next unused preset', editB.presetId, 'tarmac');
  check('bike B starts from its preset values', editB.before, '574.5');
  check('selecting bike B marks its tab', editB.selectedTab, '1');
  check('selecting bike B marks its group', editB.selectedGroup.includes('bike-1'), true);
  check('tuning bike B recomputes its reach', editB.computedReach, editB.expectedReach);
  check('tuning bike B updates the delta only', editB.cells, editB.expectedCells);
  check('hover with two bikes highlights both', editB.rowHover.activeCount, 4);
  check('hover dimension uses the selected bike', editB.rowHover.hasDimension, true);

  /* ---------------------------------------------------------------- *
   * 5. Remove bike B
   * ---------------------------------------------------------------- */
  const removed = await evaluate(`(function () {
    document.querySelectorAll('.bike-tab')[1].querySelector('.bike-remove').click();
    return {
      tabs: document.querySelectorAll('.bike-tab').length,
      groups: document.querySelectorAll('#drawing .bike').length,
      compareDisabled: document.getElementById('view-compare').disabled,
      paramsVisible: !document.getElementById('view-params-body').hidden,
      addDisabled: document.getElementById('add-bike').disabled,
      legendHidden: document.getElementById('bike-legend').hidden,
      frontCenterField: document.getElementById('field-frontCenter').value
    };
  })()`);
  check('removing bike B leaves one tab', removed.tabs, 1);
  check('removing bike B leaves one drawing', removed.groups, 1);
  check('compare is disabled again', removed.compareDisabled, true);
  check('parameters view is restored', removed.paramsVisible, true);
  check('add bike is enabled again', removed.addDisabled, false);
  check('legend hides again', removed.legendHidden, true);
  check('remaining bike is bike A', removed.frontCenterField, '594.1');

  try { await send('Browser.close'); } catch (err) { /* shutting down anyway */ }
  ws.close();
  console.log(failures === 0 ? 'ALL INTERACTION CHECKS PASSED' : failures + ' INTERACTION CHECK(S) FAILED');
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('INTERACTION TEST ERROR:', err.message);
  process.exitCode = 1;
});
