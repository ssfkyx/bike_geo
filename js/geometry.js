/*!
 * Bike Geo — parametric bicycle geometry solver.
 *
 * Works in the browser (window.BikeGeo) and in Node (module.exports), so the
 * exact same code is unit-tested and shipped.
 *
 * Coordinate system (world): x forward, y up, rear axle at the origin (0, 0).
 * The ground line is y = -tireRadius. All lengths are millimetres, angles
 * degrees. The solver takes the *necessary* inputs and compensates everything
 * else (front center, trail, effective top tube, fork offset, ...).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BikeGeo = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEG = Math.PI / 180;

  /* ------------------------------------------------------------------ *
   * Necessary inputs. Everything not listed here is derived.
   * ------------------------------------------------------------------ */
  var DEFAULTS = Object.freeze({
    bsd: 622,              // bead seat diameter, 622 = 700C / 29"
    tireWidth: 26,         // nominal width, used as tire height
    chainstay: 410,        // center (BB) to center (rear axle)
    bbDrop: 74,            // vertical drop of the BB below the axle line
    seatTubeLength: 447,   // BB center to top of the seat tube
    seatTubeAngle: 75.5,
    headTubeAngle: 71.75,
    headTubeLength: 102,
    frontCenter: 574.5,    // BB center -> front axle, straight-line
    forkOffset: 47.5,      // perpendicular distance, front axle -> steering axis
    forkLength: 385.4      // A2C along the steerer (rake ignored); see solve()
  });

  var INPUT_RULES = {
    bsd: { min: 200, max: 800, step: 1 },
    tireWidth: { min: 0, max: 120, step: 1 },
    chainstay: { min: 300, max: 700, step: 1 },
    bbDrop: { min: 0, max: 120, step: 1 },
    seatTubeLength: { min: 200, max: 700, step: 1 },
    seatTubeAngle: { min: 60, max: 90, step: 0.25 },
    headTubeAngle: { min: 50, max: 90, step: 0.25 },
    headTubeLength: { min: 40, max: 300, step: 1 },
    frontCenter: { min: 350, max: 850, step: 1 },
    forkOffset: { min: 0, max: 100, step: 0.5 },
    forkLength: { min: 300, max: 600, step: 1 }
  };

  var PRESETS = [
    {
      id: 'tarmac',
      label: 'Tarmac SL7 Comp \u201923 (49)',
      inputs: {
        bsd: 622, tireWidth: 26, chainstay: 410, bbDrop: 74,
        seatTubeLength: 447, seatTubeAngle: 75.5, headTubeAngle: 71.75,
        headTubeLength: 102, frontCenter: 574.5, forkOffset: 47.5, forkLength: 385.4
      }
    },
    {
      id: 'crux',
      label: 'CruX Expert \u201925 (49)',
      inputs: {
        bsd: 622, tireWidth: 38, chainstay: 425, bbDrop: 74,
        seatTubeLength: 466, seatTubeAngle: 75.5, headTubeAngle: 70.5,
        headTubeLength: 100, frontCenter: 594.1, forkOffset: 50, forkLength: 401.4
      }
    },
    {
      id: 'classic',
      label: 'Classic road (56)',
      inputs: {
        bsd: 622, tireWidth: 28, chainstay: 410, bbDrop: 70,
        seatTubeLength: 510, seatTubeAngle: 73.5, headTubeAngle: 73.25,
        headTubeLength: 160, frontCenter: 592.2, forkOffset: 48.4, forkLength: 366.3
      }
    },
    {
      id: 'gravel650',
      label: '650B gravel (47 mm)',
      inputs: {
        bsd: 584, tireWidth: 47, chainstay: 430, bbDrop: 70,
        seatTubeLength: 500, seatTubeAngle: 73.5, headTubeAngle: 71.5,
        headTubeLength: 130, frontCenter: 599.8, forkOffset: 45.9, forkLength: 412.7
      }
    }
  ];

  /* Baked-in drawing conventions (not "necessary" geometry, just how the
   * sketch is assembled from the solved points). */
  var DRAW = Object.freeze({
    ttSeatInset: 18,   // top tube joins this far below the seat tube top
    ssSeatInset: 34,   // seat stays join slightly below the top tube
    ttHeadInset: 14,   // top tube joins this far below the head tube top
    dtHeadFactor: 0.22 // down tube joins the head tube this far from its bottom
  });

  // Standover height is measured vertically from the ground to the top tube
  // at this horizontal distance in front of the BB center (Specialized method).
  var STANDOVER_OFFSET = 125;

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function readNumber(raw, key, fallback) {
    if (raw && typeof raw === 'object' && raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      var v = parseFloat(raw[key]);
      if (isFinite(v)) return v;
    }
    return fallback;
  }

  function dist(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }

  function scaled(p, s) {
    return { x: p.x * s, y: p.y * s };
  }

  /* ------------------------------------------------------------------ *
   * solve(rawInput) -> geometry model
   * ------------------------------------------------------------------ */
  function solve(rawInput) {
    var input = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      var value = readNumber(rawInput, key, DEFAULTS[key]);
      var rule = INPUT_RULES[key];
      input[key] = clamp(value, rule.min, rule.max);
    });

    var sta = input.seatTubeAngle * DEG;
    var hta = input.headTubeAngle * DEG;

    // Tire model: the outer diameter grows by 2 mm for every extra 1 mm of
    // cross-section width — one side of the tire on each side of the BSD.
    //   700C (622) + 26 mm  -> 674 mm OD
    //   650B (584) + 47 mm  -> 678 mm OD
    var tireRadius = input.bsd / 2 + input.tireWidth;
    var tireOuterDiameter = input.bsd + 2 * input.tireWidth;
    var groundY = -tireRadius;

    var rearAxle = { x: 0, y: 0 };

    // BB sits `chainstay` from the rear axle, `bbDrop` below the axle line.
    var chainstayHorizontal = Math.sqrt(Math.max(
      input.chainstay * input.chainstay - input.bbDrop * input.bbDrop, 1
    ));
    var bb = { x: chainstayHorizontal, y: -input.bbDrop };
    var bbHeight = tireRadius - input.bbDrop;

    // Front center (BB center -> front axle) plus BB drop fixes the front axle,
    // and therefore the wheelbase, relative to the rear axle.
    var frontCenter = input.frontCenter;
    var frontCenterHorizontal = Math.sqrt(Math.max(
      frontCenter * frontCenter - input.bbDrop * input.bbDrop, 1
    ));
    var frontAxle = { x: bb.x + frontCenterHorizontal, y: 0 };
    var wheelbase = frontAxle.x;

    // Unit directions (y up).
    var seatDir = { x: -Math.cos(sta), y: Math.sin(sta) };   // up the seat tube
    var steerDir = { x: -Math.cos(hta), y: Math.sin(hta) };  // up the head tube
    var steerDown = { x: Math.cos(hta), y: -Math.sin(hta) }; // down the steering axis
    var steerNormal = { x: Math.sin(hta), y: Math.cos(hta) }; // forward/up from the axis

    // The front axle sits `forkOffset` perpendicular from the steering axis.
    // `forkLength` is the axle-to-crown length measured along the steerer
    // (rake ignored). The real straight-line distance from the head-tube bottom
    // to the axle includes the rake component: sqrt(A2C^2 + rake^2).
    var forkOffset = input.forkOffset;
    var forkLength = input.forkLength;
    var forkLengthStraight = Math.sqrt(forkLength * forkLength + forkOffset * forkOffset);
    var axisFoot = {
      x: frontAxle.x - forkOffset * steerNormal.x,
      y: frontAxle.y - forkOffset * steerNormal.y
    };
    var alongAxis = Math.max(forkLength, 0);
    var htBottom = add(axisFoot, scaled(steerDir, alongAxis));
    var htTop = add(htBottom, scaled(steerDir, input.headTubeLength));

    var seatTop = add(bb, scaled(seatDir, input.seatTubeLength));
    var reach = htTop.x - bb.x;
    var stack = htTop.y - bb.y;

    // Steering axis meets the ground forward of the contact patch -> trail.
    var tGround = (groundY - htBottom.y) / steerDown.y;
    var steeringGroundX = htBottom.x + steerDown.x * tGround;
    var trail = steeringGroundX - frontAxle.x;

    // Mechanical trail: perpendicular distance from the contact patch to the
    // steering axis.
    var contact = { x: frontAxle.x, y: groundY };
    var toContact = { x: contact.x - htBottom.x, y: contact.y - htBottom.y };
    var mechanicalTrail = Math.abs(steerDir.x * toContact.y - steerDir.y * toContact.x);

    var effectiveTopTube = reach + stack / Math.tan(sta);

    // Sketch anchors for the tubes.
    var ttSeat = add(bb, scaled(seatDir, input.seatTubeLength - DRAW.ttSeatInset));
    var ssSeat = add(bb, scaled(seatDir, input.seatTubeLength - DRAW.ssSeatInset));
    var ttHead = add(htTop, scaled(steerDir, -DRAW.ttHeadInset));
    var dtHead = add(htBottom, scaled(steerDir, DRAW.dtHeadFactor * input.headTubeLength));

    // Standover height: vertical distance from the ground to the top tube,
    // measured at x = bb.x + STANDOVER_OFFSET.
    var standoverX = bb.x + STANDOVER_OFFSET;
    var ttRun = ttHead.x - ttSeat.x;
    var standoverT = ttRun === 0 ? 0 : (standoverX - ttSeat.x) / ttRun;
    standoverT = clamp(standoverT, 0, 1);
    var standoverPoint = {
      x: ttSeat.x + ttRun * standoverT,
      y: ttSeat.y + (ttHead.y - ttSeat.y) * standoverT
    };
    var standoverHeight = standoverPoint.y - groundY;

    // Rim line: inner edge of the tire.
    var rimRadius = Math.max(tireRadius - input.tireWidth, tireRadius * 0.55);

    return {
      input: input,
      tireRadius: tireRadius,
      tireOuterDiameter: tireOuterDiameter,
      rimRadius: rimRadius,
      groundY: groundY,
      rearAxle: rearAxle,
      frontAxle: frontAxle,
      bb: bb,
      seatTop: seatTop,
      htTop: htTop,
      htBottom: htBottom,
      seatDir: seatDir,
      steerDir: steerDir,
      steerDown: steerDown,
      chainstayHorizontal: chainstayHorizontal,
      bbHeight: bbHeight,
      wheelbase: wheelbase,
      frontCenter: frontCenter,
      frontCenterHorizontal: frontCenterHorizontal,
      reach: reach,
      stack: stack,
      effectiveTopTube: effectiveTopTube,
      forkOffset: forkOffset,
      forkLength: forkLength,
      forkLengthStraight: forkLengthStraight,
      trail: trail,
      mechanicalTrail: mechanicalTrail,
      stackReachRatio: stack / reach,
      standoverHeight: standoverHeight,
      standoverOffset: STANDOVER_OFFSET,
      standoverPoint: standoverPoint,
      steeringGroundX: steeringGroundX,
      anchors: {
        ttSeat: ttSeat,
        ssSeat: ssSeat,
        ttHead: ttHead,
        dtHead: dtHead
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Parameter catalogue: one row per displayed datum. `parts` lists the
   * drawing elements to highlight when the row is hovered.
   * ------------------------------------------------------------------ */
  var PARAMS = [
    // Necessary inputs -------------------------------------------------
    { group: 'input', key: 'bsd', label: 'Wheel BSD', unit: 'mm', precision: 0,
      hint: '622 = 700C / 29", 584 = 650B / 27.5", 559 = 26"',
      parts: ['wheel-rear', 'wheel-front'] },
    { group: 'input', key: 'tireWidth', label: 'Tire width', unit: 'mm', precision: 0,
      hint: 'Tire cross-section width = side-wall height. OD = BSD + 2 \u00d7 width, so +1 mm width = +2 mm OD',
      parts: ['wheel-rear', 'wheel-front', 'rim-rear', 'rim-front', 'tire-rear', 'tire-front'] },
    { group: 'input', key: 'chainstay', label: 'Chainstay length', unit: 'mm', precision: 0,
      parts: ['chainstay'] },
    { group: 'input', key: 'bbDrop', label: 'BB drop', unit: 'mm', precision: 0,
      parts: ['bbshell'] },
    { group: 'input', key: 'seatTubeLength', label: 'Seat tube length', unit: 'mm', precision: 0,
      parts: ['seattube'] },
    { group: 'input', key: 'seatTubeAngle', label: 'Seat tube angle', unit: '\u00b0', precision: 2,
      parts: ['seattube'] },
    { group: 'input', key: 'headTubeAngle', label: 'Head tube angle', unit: '\u00b0', precision: 2,
      parts: ['headtube', 'fork'] },
    { group: 'input', key: 'headTubeLength', label: 'Head tube length', unit: 'mm', precision: 0,
      parts: ['headtube'] },
    { group: 'input', key: 'frontCenter', label: 'Front center', unit: 'mm', precision: 1,
      hint: 'BB center -> front axle (straight-line). Wheelbase is derived from this.',
      parts: ['bbshell', 'hub-front'] },
    { group: 'input', key: 'forkOffset', label: 'Fork offset (rake)', unit: 'mm', precision: 1,
      hint: 'Perpendicular distance from the front axle to the steering axis',
      parts: ['fork', 'hub-front'] },
    { group: 'input', key: 'forkLength', label: 'Fork length (A2C)', unit: 'mm', precision: 1,
      hint: 'Axle-to-crown, measured along the steerer (rake ignored). The solver adds the rake component.',
      parts: ['fork'] },

    // Compensated / derived --------------------------------------------
    { group: 'computed', key: 'reach', label: 'Reach', unit: 'mm', precision: 1,
      parts: ['headtube', 'toptube'] },
    { group: 'computed', key: 'stack', label: 'Stack', unit: 'mm', precision: 1,
      parts: ['headtube', 'toptube'] },
    { group: 'computed', key: 'stackReachRatio', label: 'Stack / reach ratio', unit: ':1', precision: 2,
      parts: ['headtube'] },
    { group: 'computed', key: 'standoverHeight', label: 'Standover height', unit: 'mm', precision: 1,
      hint: 'Ground to top tube, measured 125 mm in front of the BB center (Specialized method)',
      parts: ['toptube'] },
    { group: 'computed', key: 'tireRadius', label: 'Tire outer radius', unit: 'mm', precision: 1,
      parts: ['wheel-rear', 'wheel-front', 'tire-rear', 'tire-front'] },
    { group: 'computed', key: 'tireOuterDiameter', label: 'Tire outer diameter', unit: 'mm', precision: 1,
      parts: ['wheel-rear', 'wheel-front', 'tire-rear', 'tire-front'] },
    { group: 'computed', key: 'bbHeight', label: 'BB height', unit: 'mm', precision: 1,
      parts: ['bbshell'] },
    { group: 'computed', key: 'chainstayHorizontal', label: 'Chainstay (horizontal)', unit: 'mm', precision: 1,
      parts: ['chainstay'] },
    { group: 'computed', key: 'frontCenterHorizontal', label: 'Front center (horizontal)', unit: 'mm', precision: 1,
      parts: ['bbshell', 'hub-front'] },
    { group: 'computed', key: 'effectiveTopTube', label: 'Effective top tube', unit: 'mm', precision: 1,
      parts: ['toptube'] },
    { group: 'computed', key: 'wheelbase', label: 'Wheelbase', unit: 'mm', precision: 1,
      parts: ['hub-rear', 'hub-front'] },
    { group: 'computed', key: 'trail', label: 'Trail', unit: 'mm', precision: 1,
      parts: ['headtube', 'hub-front', 'wheel-front'] },
    { group: 'computed', key: 'mechanicalTrail', label: 'Mechanical trail', unit: 'mm', precision: 1,
      parts: ['headtube', 'hub-front'] }
  ];

  /* ------------------------------------------------------------------ *
   * Personal fitting (optional data; never changes the frame geometry)
   *
   * Stem model: the stem leaves the top of the head tube and is measured from
   * the perpendicular to the steerer axis (0 deg = perpendicular, positive
   * angle rises along the steerer). With length L and angle a:
   *   stem reach = L * cos(a)   (perpendicular to the steerer)
   *   stem stack = L * sin(a)   (projection along the steerer)
   * The inverse conversion (reach + stack -> length + angle) is exact.
   *
   * Saddle height is measured along the seat tube from the BB center. With the
   * frame's seat tube length:
   *   seatpost over frame  = saddle height - seat tube length
   *   seatpost insert      = seatpost length - seatpost over frame
   * ------------------------------------------------------------------ */
  var EMPTY_FITTING = Object.freeze({
    stemBasis: 'lengthAngle',
    stemLength: null,
    stemAngle: null,
    stemReach: null,
    stemStack: null,
    spacerHeight: null,
    saddleHeight: null,
    seatpostLength: null,
    crankLength: null
  });

  var FITTING_RULES = {
    stemLength: { min: 0, max: 250, step: 1 },
    stemAngle: { min: -45, max: 45, step: 0.5 },
    stemReach: { min: 0, max: 250, step: 0.5 },
    stemStack: { min: -150, max: 150, step: 0.5 },
    spacerHeight: { min: 0, max: 120, step: 1 },
    saddleHeight: { min: 300, max: 1200, step: 1 },
    seatpostLength: { min: 100, max: 600, step: 1 },
    crankLength: { min: 100, max: 250, step: 0.5 }
  };

  var FITTING_FIELDS = [
    { group: 'stem', key: 'stemLength', label: 'Stem length', unit: 'mm', precision: 1,
      hint: 'From the top of the head tube along the stem', parts: ['fit-stem'] },
    { group: 'stem', key: 'stemAngle', label: 'Stem angle', unit: '\u00b0', precision: 1,
      hint: '0\u00b0 = perpendicular to the steerer; positive rises along the steerer',
      parts: ['fit-stem'] },
    { group: 'stem', key: 'stemReach', label: 'Stem reach', unit: 'mm', precision: 1,
      hint: 'Perpendicular distance from the stem end to the steerer axis',
      parts: ['fit-stem'] },
    { group: 'stem', key: 'stemStack', label: 'Stem stack', unit: 'mm', precision: 1,
      hint: 'Projection of the stem on the steerer axis',
      parts: ['fit-stem'] },
    { group: 'stem', key: 'spacerHeight', label: 'Spacer height', unit: 'mm', precision: 1,
      hint: 'Total spacer stack under the stem. Drawn in a lighter bike tint; the stem sits on top of it.',
      parts: ['fit-spacer'] },
    { group: 'saddle', key: 'saddleHeight', label: 'Saddle height', unit: 'mm', precision: 1,
      hint: 'BB center to saddle top, measured along the seat tube',
      parts: ['fit-seatpost', 'fit-saddle'] },
    { group: 'saddle', key: 'seatpostLength', label: 'Seatpost length', unit: 'mm', precision: 1,
      hint: 'Total seatpost length',
      parts: ['fit-seatpost'] },
    { group: 'saddle', key: 'seatpostOverFrame', label: 'Seatpost over frame', unit: 'mm', precision: 1,
      derived: true, hint: 'Saddle height - seat tube length',
      parts: ['fit-seatpost'] },
    { group: 'saddle', key: 'seatpostInsertLength', label: 'Seatpost insert length', unit: 'mm', precision: 1,
      derived: true, hint: 'Seatpost length - seatpost over frame',
      parts: ['fit-seatpost'] },
    { group: 'crank', key: 'crankLength', label: 'Crank length', unit: 'mm', precision: 1,
      hint: 'Drawn as a vertical line downward from the BB',
      parts: ['fit-crank'] }
  ];

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = parseFloat(value);
    return isFinite(n) ? n : null;
  }

  function clampFitting(raw) {
    var fitting = {};
    Object.keys(EMPTY_FITTING).forEach(function (key) {
      fitting[key] = EMPTY_FITTING[key];
    });
    Object.keys(FITTING_RULES).forEach(function (key) {
      var value = optionalNumber(raw && raw[key]);
      if (value !== null) {
        var rule = FITTING_RULES[key];
        fitting[key] = clamp(value, rule.min, rule.max);
      }
    });
    fitting.stemBasis = (raw && raw.stemBasis === 'reachStack') ? 'reachStack' : 'lengthAngle';
    return fitting;
  }

  function stemFromLengthAngle(length, angle) {
    var a = angle * DEG;
    return {
      length: length,
      angle: angle,
      reach: length * Math.cos(a),
      stack: length * Math.sin(a)
    };
  }

  function stemFromReachStack(reach, stack) {
    return {
      length: Math.sqrt(reach * reach + stack * stack),
      angle: Math.atan2(stack, reach) / DEG,
      reach: reach,
      stack: stack
    };
  }

  /* Resolves the stem inputs to one consistent set of four values. If the
   * active pair is incomplete, the other pair is cleared but the value the user
   * is typing is kept. */
  function syncStem(fitting) {
    var solved = null;
    if (fitting.stemBasis === 'reachStack') {
      if (fitting.stemReach !== null && fitting.stemStack !== null) {
        solved = stemFromReachStack(fitting.stemReach, fitting.stemStack);
      }
    } else if (fitting.stemLength !== null && fitting.stemAngle !== null) {
      solved = stemFromLengthAngle(fitting.stemLength, fitting.stemAngle);
    }

    if (solved) {
      fitting.stemLength = solved.length;
      fitting.stemAngle = solved.angle;
      fitting.stemReach = solved.reach;
      fitting.stemStack = solved.stack;
    } else if (fitting.stemBasis === 'reachStack') {
      fitting.stemLength = null;
      fitting.stemAngle = null;
    } else {
      fitting.stemReach = null;
      fitting.stemStack = null;
    }
    return fitting;
  }

  function solveFitting(raw, g) {
    var fitting = syncStem(clampFitting(raw));

    var seatpostOverFrame = fitting.saddleHeight !== null
      ? fitting.saddleHeight - g.input.seatTubeLength
      : null;
    var seatpostInsertLength = (seatpostOverFrame !== null && fitting.seatpostLength !== null)
      ? fitting.seatpostLength - seatpostOverFrame
      : null;

    var points = {
      stemClamp: add(g.htTop, scaled(g.steerDir, fitting.spacerHeight || 0)),
      spacerStart: g.htTop,
      spacerEnd: (fitting.spacerHeight || 0) > 0 ? add(g.htTop, scaled(g.steerDir, fitting.spacerHeight)) : null,
      stemEnd: null,
      saddleTop: null,
      seatpostTop: g.seatTop,
      crankEnd: null
    };
    if (fitting.stemLength !== null && fitting.stemAngle !== null) {
      var hta = g.input.headTubeAngle * DEG;
      var a = fitting.stemAngle * DEG;
      var up = { x: -Math.cos(hta), y: Math.sin(hta) };
      var perp = { x: Math.sin(hta), y: Math.cos(hta) };
      var dir = {
        x: Math.cos(a) * perp.x + Math.sin(a) * up.x,
        y: Math.cos(a) * perp.y + Math.sin(a) * up.y
      };
      points.stemEnd = {
        x: points.stemClamp.x + dir.x * fitting.stemLength,
        y: points.stemClamp.y + dir.y * fitting.stemLength
      };
    }
    if (fitting.saddleHeight !== null) {
      points.saddleTop = add(g.bb, scaled(g.seatDir, fitting.saddleHeight));
    }
    if (fitting.crankLength !== null) {
      points.crankEnd = { x: g.bb.x, y: g.bb.y - fitting.crankLength };
    }

    return {
      input: fitting,
      stemLength: fitting.stemLength,
      stemAngle: fitting.stemAngle,
      stemReach: fitting.stemReach,
      stemStack: fitting.stemStack,
      spacerHeight: fitting.spacerHeight,
      saddleHeight: fitting.saddleHeight,
      seatpostLength: fitting.seatpostLength,
      crankLength: fitting.crankLength,
      seatpostOverFrame: seatpostOverFrame,
      seatpostInsertLength: seatpostInsertLength,
      points: points
    };
  }

  function hasFittingData(raw) {
    if (!raw) return false;
    return ['stemLength', 'stemAngle', 'stemReach', 'stemStack', 'spacerHeight',
      'saddleHeight', 'seatpostLength', 'crankLength'].some(function (key) {
      return optionalNumber(raw[key]) !== null;
    });
  }

  function valueOf(key, g) {
    if (!g) return NaN;
    if (g.input && Object.prototype.hasOwnProperty.call(g.input, key)) return g.input[key];
    return g[key];
  }

  return {
    DEG: DEG,
    DEFAULTS: DEFAULTS,
    INPUT_RULES: INPUT_RULES,
    PRESETS: PRESETS,
    DRAW: DRAW,
    STANDOVER_OFFSET: STANDOVER_OFFSET,
    PARAMS: PARAMS,
    FITTING_FIELDS: FITTING_FIELDS,
    FITTING_RULES: FITTING_RULES,
    EMPTY_FITTING: EMPTY_FITTING,
    solve: solve,
    solveFitting: solveFitting,
    syncStem: syncStem,
    clampFitting: clampFitting,
    stemFromLengthAngle: stemFromLengthAngle,
    stemFromReachStack: stemFromReachStack,
    hasFittingData: hasFittingData,
    optionalNumber: optionalNumber,
    valueOf: valueOf,
    dist: dist
  };
}));
