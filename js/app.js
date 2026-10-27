/*
 * Bike Geo — UI wiring.
 *
 * One function, done well: input the necessary geometry for up to three bikes.
 * The solver compensates everything else and the frames are drawn on top of
 * each other in Bike A / B / C colours. Hovering a parameter highlights the
 * matching line on every bike and draws the selected bike's dimension.
 */
(function () {
  'use strict';

  var Geo = window.BikeGeo;
  var Render = window.BikeGeoRender;

  var MAX_BIKES = 3;
  var LETTERS = ['A', 'B', 'C'];

  var BSD_LABELS = {
    622: '700C / 29"',
    584: '650B / 27.5"',
    571: '650C',
    559: '26"',
    507: '24"',
    406: '20"'
  };

  var el = {
    svg: document.getElementById('drawing'),
    preset: document.getElementById('preset-select'),
    inputs: document.getElementById('inputs-list'),
    computed: document.getElementById('computed-list'),
    badge: document.getElementById('stage-badge'),
    legend: document.getElementById('bike-legend'),
    exportBtn: document.getElementById('export-svg'),
    importBtn: document.getElementById('import-url'),
    toast: document.getElementById('toast'),
    inputCount: document.getElementById('input-count'),
    computedCount: document.getElementById('computed-count'),
    tabs: document.getElementById('bike-tabs'),
    addBike: document.getElementById('add-bike'),
    viewParams: document.getElementById('view-params'),
    viewCompare: document.getElementById('view-compare'),
    paramsBody: document.getElementById('view-params-body'),
    compareBody: document.getElementById('view-compare-body'),
    compareTable: document.getElementById('compare-table'),
    compareCount: document.getElementById('compare-count'),
    alignToggle: document.getElementById('align-toggle'),
    templateSave: document.getElementById('template-save'),
    templateSelect: document.getElementById('template-select'),
    templateDelete: document.getElementById('template-delete'),
    templateExport: document.getElementById('template-export'),
    templateImport: document.getElementById('template-import'),
    templateImportInput: document.getElementById('template-import-input'),
    fittingStem: document.getElementById('fitting-stem'),
    fittingSaddle: document.getElementById('fitting-saddle'),
    fittingCrank: document.getElementById('fitting-crank')
  };

  var state = {
    bikes: [createBike(presetById('tarmac') || Geo.PRESETS[0])],
    selected: 0,
    activeKey: null,
    view: 'params',
    grounded: false,
    box: null,
    rowByKey: Object.create(null),
    fittingRefs: Object.create(null),
    solved: [],
    solvedFitting: []
  };

  var toastTimer = null;
  var TEMPLATE_KEY = 'bikegeo.templates.v1';
  var templates = readTemplates();

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function presetById(id) {
    for (var i = 0; i < Geo.PRESETS.length; i++) {
      if (Geo.PRESETS[i].id === id) return Geo.PRESETS[i];
    }
    return null;
  }

  function createBike(preset) {
    return {
      inputs: Object.assign({}, preset.inputs),
      presetId: preset.id,
      fitting: emptyFitting()
    };
  }

  function emptyFitting() {
    return Geo.clampFitting(null);
  }

  function cloneFitting(fitting) {
    return Geo.clampFitting(fitting || null);
  }

  function currentBike() {
    return state.bikes[state.selected];
  }

  function currentGeometry() {
    return state.solved[state.selected];
  }

  function letter(index) {
    return LETTERS[index] || '?';
  }

  function bikeTitle(bike, index) {
    var preset = presetById(bike.presetId);
    return 'Bike ' + letter(index) + ' \u2014 ' + (preset ? preset.label : 'Custom geometry');
  }

  function wheelLabel(bsd) {
    return BSD_LABELS[bsd] || (bsd + ' mm BSD');
  }

  function clampInput(key, value) {
    var rule = Geo.INPUT_RULES[key];
    if (!rule) return value;
    return Math.min(rule.max, Math.max(rule.min, value));
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDelta(delta, precision) {
    var p = precision === undefined ? 0 : precision;
    var rounded = Number(delta.toFixed(p));
    if (Math.abs(rounded) < Math.pow(10, -p) / 2) return '\u00b10';
    return (rounded > 0 ? '+' : '') + rounded.toFixed(p);
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.classList.remove('is-visible');
    }, 2600);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      link.remove();
    }, 0);
  }

  /* ------------------------------------------------------------------ *
   * Render pipeline
   * ------------------------------------------------------------------ */
  function renderDrawing() {
    var entries = state.solved.map(function (g, index) {
      return {
        g: g,
        fitting: state.solvedFitting[index],
        colorIndex: index,
        selected: index === state.selected
      };
    });
    var result = Render.render(el.svg, {
      bikes: entries,
      activeKey: state.activeKey,
      showAnnotation: state.view === 'params',
      align: state.grounded ? 'ground' : 'axle'
    });
    if (result) state.box = result.box;
  }

  function updateComputed() {
    var g = currentGeometry();
    if (!g) return;
    Geo.PARAMS.forEach(function (param) {
      if (param.group !== 'computed') return;
      var ref = state.rowByKey[param.key];
      if (!ref || !ref.valueEl) return;
      ref.valueEl.textContent = Render.fmt(Geo.valueOf(param.key, g), param.precision);
    });
  }

  /* ------------------------------------------------------------------ *
   * Personal fitting (optional; never feeds back into the frame geometry)
   * ------------------------------------------------------------------ */
  function fittingDisplayValue(value) {
    if (value === null || value === undefined || !isFinite(value)) return '';
    return String(Math.round(value * 100) / 100);
  }

  function updateFittingValues() {
    var solved = state.solvedFitting[state.selected];
    Geo.FITTING_FIELDS.forEach(function (field) {
      if (!field.derived) return;
      var ref = state.fittingRefs[field.key];
      if (!ref || !ref.valueEl) return;
      var value = solved ? solved[field.key] : null;
      if (value === null || value === undefined || !isFinite(value)) {
        ref.valueEl.textContent = '\u2014';
        ref.valueEl.classList.add('is-missing');
        ref.valueEl.classList.remove('is-negative');
      } else {
        ref.valueEl.textContent = Render.fmt(value, field.precision);
        ref.valueEl.classList.remove('is-missing');
        ref.valueEl.classList.toggle('is-negative', value < 0);
      }
    });
  }

  function syncFittingInputs() {
    var fitting = currentBike().fitting;
    Geo.FITTING_FIELDS.forEach(function (field) {
      if (field.derived) return;
      var ref = state.fittingRefs[field.key];
      if (!ref || !ref.input) return;
      ref.input.value = fittingDisplayValue(fitting[field.key]);
    });
  }

  function refreshFittingInputs(exceptKey) {
    var fitting = currentBike().fitting;
    Geo.FITTING_FIELDS.forEach(function (field) {
      if (field.derived || field.key === exceptKey) return;
      var ref = state.fittingRefs[field.key];
      if (!ref || !ref.input) return;
      ref.input.value = fittingDisplayValue(fitting[field.key]);
    });
  }

  function solveFittingAll() {
    state.solvedFitting = state.bikes.map(function (bike, index) {
      return Geo.solveFitting(bike.fitting, state.solved[index]);
    });
  }

  function applyFittingChange() {
    solveFittingAll();
    renderDrawing();
    updateFittingValues();
    updateCompareTable();
    updateRowStates();
  }

  function updateBadge() {
    var g = currentGeometry();
    if (!g) return;
    var prefix = state.bikes.length > 1 ? 'Bike ' + letter(state.selected) + ' \u00b7 ' : '';
    el.badge.textContent = prefix + wheelLabel(g.input.bsd) + ' \u00b7 ' +
      Render.fmt(g.input.tireWidth, 0) + ' mm \u00b7 OD ' +
      Render.fmt(g.tireOuterDiameter, 1) + ' mm';
  }

  function updateAlignButton() {
    el.alignToggle.setAttribute('aria-pressed', state.grounded ? 'true' : 'false');
    el.alignToggle.classList.toggle('is-on', state.grounded);
    el.alignToggle.title = state.grounded
      ? 'Bikes stand on the ground line — click to align by the rear axle'
      : 'Bikes are aligned by the rear axle — click to stand them on the ground line';
  }

  function updateRowStates() {
    var rows = document.querySelectorAll('.row[data-key], .cmp-row[data-key]');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('is-active', rows[i].getAttribute('data-key') === state.activeKey);
    }
  }

  function updateTabs() {
    el.tabs.innerHTML = state.bikes.map(function (bike, index) {
      var selected = index === state.selected;
      var removable = state.bikes.length > 1;
      return '<div class="bike-tab bike-' + index + (selected ? ' is-selected' : '') +
        '" role="tab" tabindex="0" data-index="' + index + '"' +
        ' aria-selected="' + (selected ? 'true' : 'false') + '"' +
        ' title="' + esc(bikeTitle(bike, index)) + '">' +
        '<span class="bike-dot" aria-hidden="true"></span>' +
        '<span class="bike-letter">' + letter(index) + '</span>' +
        (removable
          ? '<button type="button" class="bike-remove" data-remove="' + index + '"' +
            ' title="Remove bike ' + letter(index) + '" aria-label="Remove bike ' + letter(index) + '">\u00d7</button>'
          : '') +
        '</div>';
    }).join('');

    el.addBike.disabled = state.bikes.length >= MAX_BIKES;
    el.addBike.title = state.bikes.length >= MAX_BIKES
      ? 'Maximum of 3 bikes'
      : 'Add a bike to compare (max 3)';
  }

  function updateLegend() {
    if (state.bikes.length < 2) {
      el.legend.hidden = true;
      el.legend.innerHTML = '';
      return;
    }
    el.legend.hidden = false;
    el.legend.innerHTML = state.bikes.map(function (bike, index) {
      var preset = presetById(bike.presetId);
      return '<span class="legend-item bike-' + index + '">' +
        '<span class="bike-dot" aria-hidden="true"></span>' +
        '<strong>' + letter(index) + '</strong>' +
        '<span class="legend-name">' + esc(preset ? preset.label : 'Custom geometry') + '</span>' +
        '</span>';
    }).join('');
  }

  function updateView() {
    var multi = state.bikes.length >= 2;
    if (!multi) state.view = 'params';

    el.viewParams.classList.toggle('is-selected', state.view === 'params');
    el.viewCompare.classList.toggle('is-selected', state.view === 'compare');
    el.viewParams.setAttribute('aria-selected', state.view === 'params' ? 'true' : 'false');
    el.viewCompare.setAttribute('aria-selected', state.view === 'compare' ? 'true' : 'false');

    el.paramsBody.hidden = state.view !== 'params';
    el.compareBody.hidden = state.view !== 'compare';

    el.viewCompare.disabled = !multi;
    el.viewCompare.textContent = multi ? 'Compare (' + state.bikes.length + ')' : 'Compare';
  }

  function updateCompareTable() {
    var multi = state.bikes.length >= 2;
    el.compareCount.textContent = multi ? state.bikes.length + ' bikes' : '';
    if (!multi) {
      el.compareTable.innerHTML = '';
      return;
    }

    var html = '<div class="cmp-row cmp-head" aria-hidden="true"><span class="cmp-label"></span>';
    state.bikes.forEach(function (bike, index) {
      html += '<span class="cmp-cell bike-' + index + '">' +
        '<span class="bike-dot"></span>' + letter(index) + '</span>';
    });
    html += '</div>';

    var base = state.solved[0];
    Geo.PARAMS.forEach(function (param) {
      html += '<div class="cmp-row" data-key="' + param.key + '">' +
        '<span class="cmp-label">' + esc(param.label) + ' <em>' + esc(param.unit) + '</em></span>';
      var baseValue = Geo.valueOf(param.key, base);
      state.bikes.forEach(function (bike, index) {
        var value = Geo.valueOf(param.key, state.solved[index]);
        var delta = index > 0
          ? '<span class="cmp-delta">' + formatDelta(value - baseValue, param.precision) + '</span>'
          : '';
        html += '<span class="cmp-cell bike-' + index + '">' +
          Render.fmt(value, param.precision) + delta + '</span>';
      });
      html += '</div>';
    });

    var anyFitting = state.bikes.some(function (bike) {
      return Geo.hasFittingData(bike.fitting);
    });
    if (anyFitting) {
      html += '<div class="cmp-row cmp-divider"><span class="cmp-label">Personal fitting</span>' +
        state.bikes.map(function () {
          return '<span class="cmp-cell"></span>';
        }).join('') + '</div>';
      Geo.FITTING_FIELDS.forEach(function (field) {
        html += '<div class="cmp-row" data-key="' + field.key + '">' +
          '<span class="cmp-label">' + esc(field.label) + ' <em>' + esc(field.unit) + '</em></span>';
        var baseFitting = state.solvedFitting[0];
        var baseValue = baseFitting ? baseFitting[field.key] : null;
        state.bikes.forEach(function (bike, index) {
          var solved = state.solvedFitting[index];
          var value = solved ? solved[field.key] : null;
          var missing = value === null || value === undefined || !isFinite(value);
          var delta = '';
          if (index > 0 && !missing && baseValue !== null && baseValue !== undefined) {
            delta = '<span class="cmp-delta">' + formatDelta(value - baseValue, field.precision) + '</span>';
          }
          html += '<span class="cmp-cell bike-' + index + (missing ? ' is-missing' : '') + '">' +
            (missing ? '\u2014' : Render.fmt(value, field.precision)) + delta + '</span>';
        });
        html += '</div>';
      });
    }
    el.compareTable.innerHTML = html;
  }

  function syncPresetSelect() {
    var bike = currentBike();
    el.preset.value = bike.presetId || 'custom';
  }

  function syncInputFields() {
    var bike = currentBike();
    Geo.PARAMS.forEach(function (param) {
      if (param.group !== 'input') return;
      var ref = state.rowByKey[param.key];
      if (ref && ref.input) ref.input.value = bike.inputs[param.key];
    });
  }

  function apply() {
    state.solved = state.bikes.map(function (bike) { return Geo.solve(bike.inputs); });
    solveFittingAll();
    updateView();
    renderDrawing();
    updateComputed();
    updateFittingValues();
    updateBadge();
    updateTabs();
    updateLegend();
    updateCompareTable();
    syncPresetSelect();
    syncFittingInputs();
    updateRowStates();
  }

  /* ------------------------------------------------------------------ *
   * Hover / focus highlighting
   * ------------------------------------------------------------------ */
  function setActive(key) {
    if (state.activeKey === key) return;
    state.activeKey = key;
    updateRowStates();
    renderDrawing();
  }

  function clearActive(key) {
    if (state.activeKey !== key) return;
    state.activeKey = null;
    updateRowStates();
    renderDrawing();
  }

  /* ------------------------------------------------------------------ *
   * Templates: named copies of one bike's inputs, stored in this browser
   * ------------------------------------------------------------------ */
  function readTemplates() {
    try {
      var raw = window.localStorage.getItem(TEMPLATE_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.filter(function (template) {
        return template && typeof template.name === 'string' &&
          template.inputs && typeof template.inputs === 'object';
      }).map(function (template) {
        return {
          name: template.name,
          inputs: template.inputs,
          presetId: template.presetId || null,
          fitting: cloneFitting(template.fitting)
        };
      });
    } catch (err) {
      return [];
    }
  }

  function storeTemplates() {
    try {
      window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
      return true;
    } catch (err) {
      return false;
    }
  }

  function rebuildTemplateSelect(selectedName) {
    var options = ['<option value="">Templates\u2026</option>'];
    templates.forEach(function (template) {
      options.push('<option value="' + esc(template.name) + '">' + esc(template.name) + '</option>');
    });
    el.templateSelect.innerHTML = options.join('');
    var keep = selectedName && templates.some(function (template) {
      return template.name === selectedName;
    });
    el.templateSelect.value = keep ? selectedName : '';
    el.templateDelete.disabled = !el.templateSelect.value;
  }

  function resetTemplateSelection() {
    el.templateSelect.value = '';
    el.templateDelete.disabled = true;
  }

  function suggestTemplateName() {
    var preset = presetById(currentBike().presetId);
    return preset ? preset.label : 'Bike ' + letter(state.selected);
  }

  function saveTemplate() {
    var name = window.prompt('Save the selected bike as a template:', suggestTemplateName());
    if (name === null) return;
    name = String(name).trim();
    if (!name) {
      toast('Template name is required');
      return;
    }
    var existing = -1;
    templates.forEach(function (template, index) {
      if (template.name === name) existing = index;
    });
    if (existing >= 0 && !window.confirm('Overwrite template "' + name + '"?')) return;

    var record = {
      name: name,
      inputs: Object.assign({}, currentBike().inputs),
      presetId: currentBike().presetId,
      fitting: cloneFitting(currentBike().fitting)
    };
    if (existing >= 0) templates[existing] = record;
    else templates.push(record);

    var persisted = storeTemplates();
    rebuildTemplateSelect(name);
    toast(persisted ? 'Template "' + name + '" saved' : 'Template saved for this session only');
  }

  function loadTemplate(name) {
    var record = null;
    templates.forEach(function (template) {
      if (template.name === name) record = template;
    });
    if (!record) {
      resetTemplateSelection();
      return;
    }

    var bike = currentBike();
    bike.inputs = {};
    Object.keys(Geo.DEFAULTS).forEach(function (key) {
      var value = parseFloat(record.inputs[key]);
      bike.inputs[key] = isFinite(value) ? value : Geo.DEFAULTS[key];
    });
    bike.presetId = presetById(record.presetId) ? record.presetId : null;
    bike.fitting = cloneFitting(record.fitting);

    syncInputFields();
    syncFittingInputs();
    apply();
    el.templateSelect.value = name;
    el.templateDelete.disabled = false;
    toast('Template "' + name + '" loaded');
  }

  function deleteTemplate() {
    var name = el.templateSelect.value;
    if (!name) return;
    if (!window.confirm('Delete template "' + name + '"?')) return;
    templates = templates.filter(function (template) { return template.name !== name; });
    storeTemplates();
    rebuildTemplateSelect();
    toast('Template deleted');
  }

  function exportTemplates() {
    if (!templates.length) {
      toast('No templates to export');
      return;
    }
    download(window.BikeGeoTemplates.exportFileName(),
      window.BikeGeoTemplates.exportText(templates), 'application/json');
    toast('Exported ' + templates.length + ' template(s)');
  }

  function importTemplatesFromText(text) {
    var parsed;
    try {
      parsed = window.BikeGeoTemplates.parseImport(text);
    } catch (err) {
      toast('Import failed: ' + err.message);
      return;
    }

    var names = templates.map(function (template) { return template.name; });
    var added = 0;
    var overwritten = 0;
    var renamed = 0;

    parsed.templates.forEach(function (incoming) {
      var existing = -1;
      templates.forEach(function (template, index) {
        if (template.name === incoming.name) existing = index;
      });
      if (existing < 0) {
        templates.push(incoming);
        names.push(incoming.name);
        added += 1;
        return;
      }
      var overwrite = window.confirm('Template "' + incoming.name +
        '" already exists. Overwrite? (Cancel keeps both)');
      if (overwrite) {
        templates[existing] = incoming;
        overwritten += 1;
      } else {
        var unique = window.BikeGeoTemplates.uniqueName(incoming.name, names);
        incoming.name = unique;
        templates.push(incoming);
        names.push(unique);
        renamed += 1;
      }
    });

    var persisted = storeTemplates();
    rebuildTemplateSelect();
    var details = [];
    if (added) details.push(added + ' new');
    if (overwritten) details.push(overwritten + ' replaced');
    if (renamed) details.push(renamed + ' renamed');
    toast('Imported ' + parsed.templates.length + ' template(s)' +
      (details.length ? ' (' + details.join(', ') + ')' : '') +
      (persisted ? '' : ' \u00b7 session only'));
  }

  function importTemplatesFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      importTemplatesFromText(String(reader.result || ''));
    };
    reader.onerror = function () {
      toast('Could not read that file');
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ *
   * Bike management
   * ------------------------------------------------------------------ */
  function selectBike(index) {
    if (index === state.selected || !state.bikes[index]) return;
    state.selected = index;
    state.activeKey = null;
    syncInputFields();
    syncFittingInputs();
    apply();
    resetTemplateSelection();
  }

  function addBike() {
    if (state.bikes.length >= MAX_BIKES) return;

    var usedPresets = state.bikes.map(function (bike) { return bike.presetId; });
    var preset = Geo.PRESETS.filter(function (candidate) {
      return usedPresets.indexOf(candidate.id) === -1;
    })[0];

    if (preset) {
      state.bikes.push(createBike(preset));
    } else {
      state.bikes.push({
        inputs: Object.assign({}, currentBike().inputs),
        presetId: null,
        fitting: cloneFitting(currentBike().fitting)
      });
    }

    state.selected = state.bikes.length - 1;
    state.activeKey = null;
    state.view = 'compare';
    syncInputFields();
    syncFittingInputs();
    apply();
    resetTemplateSelection();
    toast('Added Bike ' + letter(state.selected) + (preset ? ' \u00b7 ' + preset.label : ' (copy)'));
  }

  function removeBike(index) {
    if (state.bikes.length <= 1) return;
    var removed = letter(index);
    state.bikes.splice(index, 1);
    if (state.selected === index) {
      state.selected = Math.min(index, state.bikes.length - 1);
    } else if (state.selected > index) {
      state.selected -= 1;
    }
    state.activeKey = null;
    syncInputFields();
    syncFittingInputs();
    apply();
    resetTemplateSelection();
    toast('Removed Bike ' + removed);
  }

  /* ------------------------------------------------------------------ *
   * Panel construction
   * ------------------------------------------------------------------ */
  function buildPresetSelect() {
    var fragment = document.createDocumentFragment();
    Geo.PRESETS.forEach(function (preset) {
      var option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      fragment.appendChild(option);
    });
    var custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom';
    fragment.appendChild(custom);

    el.preset.appendChild(fragment);
  }

  function buildInputRow(param) {
    var row = document.createElement('div');
    row.className = 'row input-row';
    row.dataset.key = param.key;
    row.tabIndex = 0;

    var label = document.createElement('label');
    label.className = 'row-label';
    label.htmlFor = 'field-' + param.key;
    label.textContent = param.label;

    var wrap = document.createElement('span');
    wrap.className = 'row-value';

    var input = document.createElement('input');
    input.type = 'number';
    input.id = 'field-' + param.key;
    input.setAttribute('inputmode', 'decimal');
    input.value = currentBike().inputs[param.key];
    var rule = Geo.INPUT_RULES[param.key];
    input.min = rule.min;
    input.max = rule.max;
    input.step = rule.step;
    input.setAttribute('aria-label', param.label + ' (' + param.unit + ')');
    if (param.hint) input.title = param.hint;

    var unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = param.unit;

    wrap.appendChild(input);
    wrap.appendChild(unit);
    row.appendChild(label);
    row.appendChild(wrap);

    input.addEventListener('input', function () {
      var raw = parseFloat(input.value);
      if (!isFinite(raw)) {
        row.classList.add('is-invalid');
        return;
      }
      row.classList.remove('is-invalid');
      var bike = currentBike();
      bike.inputs[param.key] = raw;
      bike.presetId = null;
      apply();
    });

    input.addEventListener('change', function () {
      var parsed = parseFloat(input.value);
      var bike = currentBike();
      if (!isFinite(parsed)) {
        input.value = bike.inputs[param.key];
      } else {
        var clamped = clampInput(param.key, parsed);
        bike.inputs[param.key] = clamped;
        input.value = clamped;
      }
      row.classList.remove('is-invalid');
      apply();
    });

    return { row: row, input: input, valueEl: null };
  }

  function buildComputedRow(param) {
    var row = document.createElement('div');
    row.className = 'row computed-row';
    row.dataset.key = param.key;
    row.tabIndex = 0;

    var label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = param.label;

    var value = document.createElement('output');
    value.className = 'value';

    var unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = param.unit;

    var wrap = document.createElement('span');
    wrap.className = 'row-value';
    wrap.appendChild(value);
    wrap.appendChild(unit);

    row.appendChild(label);
    row.appendChild(wrap);

    return { row: row, input: null, valueEl: value };
  }

  function wireRowHighlight(row, param) {
    row.addEventListener('mouseenter', function () { setActive(param.key); });
    row.addEventListener('mouseleave', function () {
      if (!row.contains(document.activeElement)) clearActive(param.key);
    });
    row.addEventListener('focusin', function () { setActive(param.key); });
    row.addEventListener('focusout', function (event) {
      if (!row.contains(event.relatedTarget)) clearActive(param.key);
    });
  }

  function handleFittingInput(field, input, row, clamp) {
    var raw = input.value.trim();
    var fitting = currentBike().fitting;
    if (raw === '') {
      fitting[field.key] = null;
    } else {
      var value = parseFloat(raw);
      if (!isFinite(value)) {
        row.classList.add('is-invalid');
        return;
      }
      if (clamp) {
        var rule = Geo.FITTING_RULES[field.key];
        if (rule) value = Math.min(rule.max, Math.max(rule.min, value));
        input.value = fittingDisplayValue(value);
      }
      fitting[field.key] = value;
    }
    row.classList.remove('is-invalid');

    if (field.key.indexOf('stem') === 0) {
      fitting.stemBasis = (field.key === 'stemLength' || field.key === 'stemAngle')
        ? 'lengthAngle' : 'reachStack';
      Geo.syncStem(fitting);
      refreshFittingInputs(field.key);
    }
    applyFittingChange();
  }

  function buildFittingInputRow(field) {
    var row = document.createElement('div');
    row.className = 'row fit-row';
    row.dataset.key = field.key;
    row.tabIndex = 0;

    var label = document.createElement('label');
    label.className = 'row-label';
    label.htmlFor = 'fit-' + field.key;
    label.textContent = field.label;

    var wrap = document.createElement('span');
    wrap.className = 'row-value';

    var input = document.createElement('input');
    input.type = 'number';
    input.id = 'fit-' + field.key;
    input.placeholder = '\u2014';
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('aria-label', field.label + ' (optional, ' + field.unit + ')');
    var rule = Geo.FITTING_RULES[field.key];
    if (rule) {
      input.min = rule.min;
      input.max = rule.max;
      input.step = rule.step;
    }
    if (field.hint) input.title = field.hint;

    var unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = field.unit;

    wrap.appendChild(input);
    wrap.appendChild(unit);
    row.appendChild(label);
    row.appendChild(wrap);

    input.addEventListener('input', function () {
      handleFittingInput(field, input, row, false);
    });
    input.addEventListener('change', function () {
      handleFittingInput(field, input, row, true);
    });

    return { row: row, input: input, valueEl: null };
  }

  function buildFittingOutputRow(field) {
    var row = document.createElement('div');
    row.className = 'row fit-row fit-derived';
    row.dataset.key = field.key;
    row.tabIndex = 0;

    var label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = field.label;

    var value = document.createElement('output');
    value.className = 'fit-value is-missing';
    value.textContent = '\u2014';

    var unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = field.unit;

    var wrap = document.createElement('span');
    wrap.className = 'row-value';
    wrap.appendChild(value);
    wrap.appendChild(unit);

    row.appendChild(label);
    row.appendChild(wrap);

    return { row: row, input: null, valueEl: value };
  }

  function buildFittingRows() {
    Geo.FITTING_FIELDS.forEach(function (field) {
      var target = field.group === 'stem' ? el.fittingStem
        : (field.group === 'saddle' ? el.fittingSaddle : el.fittingCrank);
      var built = field.derived ? buildFittingOutputRow(field) : buildFittingInputRow(field);
      target.appendChild(built.row);
      state.fittingRefs[field.key] = built;
      wireRowHighlight(built.row, field);
    });
  }

  function buildRows() {
    var inputCount = 0;
    var computedCount = 0;

    Geo.PARAMS.forEach(function (param) {
      var built;
      if (param.group === 'input') {
        built = buildInputRow(param);
        el.inputs.appendChild(built.row);
        inputCount += 1;
      } else {
        built = buildComputedRow(param);
        el.computed.appendChild(built.row);
        computedCount += 1;
      }
      state.rowByKey[param.key] = built;
      wireRowHighlight(built.row, param);
    });

    el.inputCount.textContent = inputCount;
    el.computedCount.textContent = computedCount;
  }

  /* ------------------------------------------------------------------ *
   * SVG export
   * ------------------------------------------------------------------ */
  function exportSvg() {
    var box = state.box || Render.viewBoxFor(state.solved);
    var source = Render.standaloneSvg(el.svg.innerHTML, box);
    download('bike-geo.svg', source, 'image/svg+xml');
    toast('Drawing exported as SVG');
  }

  /* ------------------------------------------------------------------ *
   * Events + init
   * ------------------------------------------------------------------ */
  function setView(view) {
    if (view === 'compare' && state.bikes.length < 2) return;
    state.view = view;
    state.activeKey = null;
    updateRowStates();
    renderDrawing();
    updateView();
  }

  function wireEvents() {
    el.preset.addEventListener('change', function () {
      var preset = presetById(el.preset.value);
      if (!preset) return;
      var bike = currentBike();
      bike.inputs = Object.assign({}, preset.inputs);
      bike.presetId = preset.id;
      syncInputFields();
      apply();
      resetTemplateSelection();
    });

    el.exportBtn.addEventListener('click', exportSvg);

    el.importBtn.addEventListener('click', function () {
      toast('Online import is reserved for a future version (see js/datasource.js)');
    });

    el.addBike.addEventListener('click', addBike);

    el.alignToggle.addEventListener('click', function () {
      state.grounded = !state.grounded;
      updateAlignButton();
      renderDrawing();
      toast(state.grounded ? 'Aligned by the ground line' : 'Aligned by the rear axle');
    });

    el.templateSave.addEventListener('click', saveTemplate);
    el.templateSelect.addEventListener('change', function () {
      if (el.templateSelect.value) {
        loadTemplate(el.templateSelect.value);
      } else {
        el.templateDelete.disabled = true;
      }
    });
    el.templateDelete.addEventListener('click', deleteTemplate);
    el.templateExport.addEventListener('click', exportTemplates);
    el.templateImport.addEventListener('click', function () {
      el.templateImportInput.click();
    });
    el.templateImportInput.addEventListener('change', function () {
      importTemplatesFile(el.templateImportInput.files && el.templateImportInput.files[0]);
      el.templateImportInput.value = '';
    });

    el.tabs.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove]');
      if (remove) {
        removeBike(parseInt(remove.getAttribute('data-remove'), 10));
        return;
      }
      var tab = event.target.closest('.bike-tab');
      if (tab) selectBike(parseInt(tab.getAttribute('data-index'), 10));
    });

    el.tabs.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target.closest('[data-remove]')) return;
      var tab = event.target.closest('.bike-tab');
      if (!tab) return;
      event.preventDefault();
      selectBike(parseInt(tab.getAttribute('data-index'), 10));
    });

    el.viewParams.addEventListener('click', function () { setView('params'); });
    el.viewCompare.addEventListener('click', function () { setView('compare'); });

    el.compareTable.addEventListener('mouseover', function (event) {
      var row = event.target.closest('.cmp-row[data-key]');
      if (row) setActive(row.getAttribute('data-key'));
    });
    el.compareTable.addEventListener('mouseleave', function () {
      if (state.activeKey) clearActive(state.activeKey);
    });
  }

  /* Deep links: ?preset=crux&compare=crux,classic&param=stack */
  function applyUrlState() {
    var params = new URLSearchParams(window.location.search);

    var preset = presetById(params.get('preset'));
    if (preset) {
      state.bikes[0] = createBike(preset);
      state.selected = 0;
      syncInputFields();
    }

    var compare = params.get('compare');
    if (compare) {
      compare.split(',').forEach(function (id) {
        var candidate = presetById(id.trim());
        if (!candidate || state.bikes.length >= MAX_BIKES) return;
        var already = state.bikes.some(function (bike) { return bike.presetId === candidate.id; });
        if (!already) state.bikes.push(createBike(candidate));
      });
      if (state.bikes.length > 1) {
        state.view = 'compare';
        state.selected = 0;
      }
    }

    var view = params.get('view');
    if (view === 'compare' && state.bikes.length > 1) state.view = 'compare';
    if (view === 'params') state.view = 'params';

    if (params.get('align') === 'ground') state.grounded = true;

    updateAlignButton();
    apply();

    var activeKey = params.get('param');
    var knownKeys = Geo.PARAMS.concat(Geo.FITTING_FIELDS);
    if (activeKey && knownKeys.some(function (param) { return param.key === activeKey; })) {
      setActive(activeKey);
    }
  }

  function init() {
    buildPresetSelect();
    buildRows();
    buildFittingRows();
    rebuildTemplateSelect();
    wireEvents();
    applyUrlState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
