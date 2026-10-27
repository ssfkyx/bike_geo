/*!
 * Bike Geo — online geometry source registry (extension point).
 *
 * The app ships with *no* online data source enabled. A source is a small
 * adapter object registered here; enabling real import later means filling in
 * fetchGeometry() without touching the solver, renderer or UI.
 *
 * Adapter contract
 * ----------------
 *   {
 *     id: string,                        // stable key, e.g. "bikeinsights"
 *     label: string,                     // display name
 *     status: "available" | "planned",
 *     fetchGeometry(args) -> Promise<{   // args: whatever the UI passes
 *       name?: string,                   // bike label for the preset slot
 *       inputs: {                        // partial set of the necessary inputs
 *         bsd?, tireWidth?, chainstay?, bbDrop?,
 *         seatTubeLength?, seatTubeAngle?, headTubeAngle?,
 *         headTubeLength?, frontCenter?, forkOffset?, forkLength?
 *       },
 *       meta?: object                     // source url, size, build, ...
 *     }>
 *   }
 *
 * Only the inputs a source can publish need to be returned; the solver clamps
 * and compensates everything else. Importing therefore degrades gracefully.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BikeGeoData = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var adapters = Object.create(null);

  function register(adapter) {
    if (!adapter || typeof adapter.id !== 'string' || !adapter.id.trim()) {
      throw new Error('A data source adapter needs a non-empty string id');
    }
    if (typeof adapter.fetchGeometry !== 'function') {
      throw new Error('Data source "' + adapter.id + '" needs a fetchGeometry(args) function');
    }
    adapters[adapter.id] = adapter;
    return adapter;
  }

  function list() {
    return Object.keys(adapters).map(function (id) { return adapters[id]; });
  }

  function get(id) {
    return adapters[id] || null;
  }

  function fetchGeometry(id, args) {
    var adapter = adapters[id];
    if (!adapter) {
      return Promise.reject(new Error('Unknown geometry data source: ' + id));
    }
    return Promise.resolve()
      .then(function () { return adapter.fetchGeometry(args || {}); })
      .then(function (result) {
        if (!result || typeof result !== 'object' || typeof result.inputs !== 'object' || result.inputs === null) {
          throw new Error('Data source "' + id + '" returned no inputs object');
        }
        return result;
      });
  }

  /* Reserved adapter: Bike Insights import is deliberately not implemented in
   * v1. Keeping it registered documents the intended integration point and
   * lets the UI show it as "planned" instead of pretending the feature does
   * not exist. */
  register({
    id: 'bikeinsights',
    label: 'Bike Insights',
    status: 'planned',
    fetchGeometry: function () {
      return Promise.reject(new Error(
        'Bike Insights import is reserved for a future version. ' +
        'Implement fetchGeometry() in js/datasource.js to enable it.'
      ));
    }
  });

  return {
    register: register,
    list: list,
    get: get,
    fetchGeometry: fetchGeometry
  };
}));
