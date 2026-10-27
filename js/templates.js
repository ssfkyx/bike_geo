/*!
 * Bike Geo — template export / import helpers (pure, unit-tested).
 *
 * Templates live in the browser's localStorage. This module turns them into a
 * portable JSON document and validates imported documents, without touching
 * the DOM or the network.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BikeGeoTemplates = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  function copyInputs(inputs) {
    var out = {};
    Object.keys(inputs || {}).forEach(function (key) {
      out[key] = inputs[key];
    });
    return out;
  }

  function copyFitting(fitting) {
    var out = {};
    Object.keys(fitting || {}).forEach(function (key) {
      out[key] = fitting[key];
    });
    return out;
  }

  function createExport(templates, date) {
    return {
      app: 'Bike Geo',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: (date || new Date()).toISOString(),
      templates: (templates || []).map(function (template) {
        return {
          name: template.name,
          inputs: copyInputs(template.inputs),
          presetId: template.presetId || null,
          fitting: copyFitting(template.fitting)
        };
      })
    };
  }

  function exportText(templates, date) {
    return JSON.stringify(createExport(templates, date), null, 2);
  }

  function exportFileName(date) {
    var d = date || new Date();
    var stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('');
    return 'bikegeo-templates-' + stamp + '.json';
  }

  function parseImport(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('Not a valid JSON file');
    }

    var list = null;
    if (Array.isArray(data)) {
      list = data;
    } else if (data && Array.isArray(data.templates)) {
      list = data.templates;
      if (data.schemaVersion !== undefined && Number(data.schemaVersion) > SCHEMA_VERSION) {
        throw new Error('Template file is from a newer version');
      }
    }
    if (!list) throw new Error('No template list found in this file');

    var templates = [];
    var skipped = 0;
    list.forEach(function (item) {
      if (!item || typeof item.name !== 'string' || !item.name.trim() ||
          !item.inputs || typeof item.inputs !== 'object' || Array.isArray(item.inputs)) {
        skipped += 1;
        return;
      }
      templates.push({
        name: item.name.trim(),
        inputs: copyInputs(item.inputs),
        presetId: typeof item.presetId === 'string' ? item.presetId : null,
        fitting: (item.fitting && typeof item.fitting === 'object' && !Array.isArray(item.fitting))
          ? copyFitting(item.fitting)
          : {}
      });
    });
    if (!templates.length) throw new Error('No valid templates in this file');
    return { templates: templates, skipped: skipped };
  }

  function uniqueName(base, names) {
    if (names.indexOf(base) < 0) return base;
    var index = 2;
    var candidate;
    do {
      candidate = base + ' (' + index + ')';
      index += 1;
    } while (names.indexOf(candidate) >= 0);
    return candidate;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    createExport: createExport,
    exportText: exportText,
    exportFileName: exportFileName,
    parseImport: parseImport,
    uniqueName: uniqueName
  };
}));
