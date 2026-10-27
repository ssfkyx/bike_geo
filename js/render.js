/*!
 * Bike Geo — SVG line-art renderer.
 *
 * Pure string output: render(svgEl, options) rebuilds the drawing for one to
 * three bikes (each in its own colour) and — when a parameter row is hovered —
 * adds the matching dimension annotation for the selected bike while
 * highlighting that part on every bike.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./geometry.js'));
  } else {
    root.BikeGeoRender = factory(root.BikeGeo);
  }
}(typeof self !== 'undefined' ? self : this, function (Geo) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Bike A / B / C strokes for comparison overlays: black, baby blue,
   * vivid orange — maximum contrast against the light dotted paper. */
  var BIKE_COLORS = ['#111827', '#4FA8E8', '#F97316'];

  function fmt(value, precision) {
    if (!isFinite(value)) return '\u2014';
    var p = precision === undefined ? 0 : precision;
    return Number(value).toFixed(p);
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function n(value) {
    return (Math.round(value * 100) / 100).toString();
  }

  /* SVG arc subpath for a full circle (used for the tyre band). */
  function circleSubpath(cx, cy, r) {
    return 'M' + n(cx - r) + ' ' + n(cy) +
      'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(2 * r) + ' 0' +
      'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(-2 * r) + ' 0Z';
  }

  function annulusPath(cx, cy, outer, inner) {
    return circleSubpath(cx, cy, outer) + circleSubpath(cx, cy, inner);
  }

  /* ------------------------------------------------------------------ *
   * Scene: bike parts in world coordinates
   * ------------------------------------------------------------------ */
  function buildParts(g) {
    var R = g.tireRadius;
    var rim = g.rimRadius;
    var hub = Math.max(R * 0.022, 5);
    var bbShell = Math.max(R * 0.07, 16);

    return [
      { id: 'ground', type: 'line', a: { x: g.rearAxle.x - R - 70, y: g.groundY },
        b: { x: g.frontAxle.x + R + 70, y: g.groundY }, cls: 'part ground' },

      /* The tyre band between the outer tyre circle and the rim circle is
       * filled with a light tint of the bike colour so overlapping bikes stay
       * easy to tell apart. */
      { id: 'tire-rear', type: 'annulus', c: g.rearAxle, rOuter: R, rInner: rim, cls: 'part tire' },
      { id: 'tire-front', type: 'annulus', c: g.frontAxle, rOuter: R, rInner: rim, cls: 'part tire' },

      { id: 'wheel-rear', type: 'circle', c: g.rearAxle, r: R, cls: 'part wheel' },
      { id: 'wheel-front', type: 'circle', c: g.frontAxle, r: R, cls: 'part wheel' },
      { id: 'rim-rear', type: 'circle', c: g.rearAxle, r: rim, cls: 'part rim' },
      { id: 'rim-front', type: 'circle', c: g.frontAxle, r: rim, cls: 'part rim' },

      { id: 'chainstay', type: 'line', a: g.rearAxle, b: g.bb, cls: 'part frame' },
      { id: 'seatstay', type: 'line', a: g.rearAxle, b: g.anchors.ssSeat, cls: 'part frame' },
      { id: 'seattube', type: 'line', a: g.bb, b: g.seatTop, cls: 'part frame' },
      { id: 'toptube', type: 'line', a: g.anchors.ttSeat, b: g.anchors.ttHead, cls: 'part frame' },
      { id: 'downtube', type: 'line', a: g.bb, b: g.anchors.dtHead, cls: 'part frame' },
      { id: 'headtube', type: 'line', a: g.htBottom, b: g.htTop, cls: 'part frame' },
      { id: 'fork', type: 'line', a: g.htBottom, b: g.frontAxle, cls: 'part frame' },

      { id: 'bbshell', type: 'circle', c: g.bb, r: bbShell, cls: 'part frame' },
      { id: 'hub-rear', type: 'circle', c: g.rearAxle, r: hub, cls: 'part hub' },
      { id: 'hub-front', type: 'circle', c: g.frontAxle, r: hub, cls: 'part hub' }
    ];
  }

  function serializeParts(list, activeParts) {
    var active = activeParts || [];
    return list.map(function (p) {
      var cls = p.cls + (active.indexOf(p.id) >= 0 ? ' is-active' : '');
      if (p.type === 'line') {
        return '<line class="' + cls + '" data-part="' + p.id + '" vector-effect="non-scaling-stroke"' +
          ' x1="' + n(p.a.x) + '" y1="' + n(-p.a.y) + '"' +
          ' x2="' + n(p.b.x) + '" y2="' + n(-p.b.y) + '"/>';
      }
      if (p.type === 'annulus') {
        return '<path class="' + cls + '" data-part="' + p.id + '" vector-effect="non-scaling-stroke"' +
          ' fill-rule="evenodd" d="' + annulusPath(p.c.x, -p.c.y, p.rOuter, p.rInner) + '"/>';
      }
      return '<circle class="' + cls + '" data-part="' + p.id + '" vector-effect="non-scaling-stroke"' +
        ' cx="' + n(p.c.x) + '" cy="' + n(-p.c.y) + '" r="' + n(p.r) + '"/>';
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * Alignment helpers
   *
   * By default the sketch is drawn with the rear axle at the origin, so bikes
   * overlay axle-to-axle. "ground" mode shifts each bike up by its tyre radius
   * so every bike stands on the same ground line instead.
   * ------------------------------------------------------------------ */
  function shiftGeometry(g, dy) {
    if (!dy) return g;
    function moved(point) { return { x: point.x, y: point.y + dy }; }
    var shifted = Object.assign({}, g);
    shifted.rearAxle = moved(g.rearAxle);
    shifted.frontAxle = moved(g.frontAxle);
    shifted.bb = moved(g.bb);
    shifted.seatTop = moved(g.seatTop);
    shifted.htTop = moved(g.htTop);
    shifted.htBottom = moved(g.htBottom);
    shifted.groundY = g.groundY + dy;
    shifted.anchors = {
      ttSeat: moved(g.anchors.ttSeat),
      ssSeat: moved(g.anchors.ssSeat),
      ttHead: moved(g.anchors.ttHead),
      dtHead: moved(g.anchors.dtHead)
    };
    return shifted;
  }

  function alignGeometries(input, align) {
    var bikes = Array.isArray(input) ? input : [input];
    var mode = align === 'ground' ? 'ground' : 'axle';
    return bikes.map(function (g) {
      return mode === 'ground' ? shiftGeometry(g, g.tireRadius) : g;
    });
  }

  /* ------------------------------------------------------------------ *
   * Personal fitting parts (optional stem / saddle / crank overlays)
   * ------------------------------------------------------------------ */
  function shiftFitting(fitting, dy) {
    if (!fitting || !fitting.points || !dy) return fitting;
    function moved(point) { return point ? { x: point.x, y: point.y + dy } : null; }
    var shifted = Object.assign({}, fitting);
    shifted.points = {
      stemClamp: moved(fitting.points.stemClamp),
      stemEnd: moved(fitting.points.stemEnd),
      saddleTop: moved(fitting.points.saddleTop),
      seatpostTop: moved(fitting.points.seatpostTop),
      crankEnd: moved(fitting.points.crankEnd)
    };
    return shifted;
  }

  function buildFittingParts(g, fitting) {
    if (!fitting || !fitting.points) return [];
    var points = fitting.points;
    var parts = [];

    if (points.stemEnd) {
      parts.push({
        id: 'fit-stem', type: 'line',
        a: points.stemClamp, b: points.stemEnd, cls: 'part fit stem'
      });
    }
    if (points.saddleTop) {
      if (fitting.seatpostOverFrame !== null && fitting.seatpostOverFrame > 0) {
        parts.push({
          id: 'fit-seatpost', type: 'line',
          a: points.seatpostTop, b: points.saddleTop, cls: 'part fit'
        });
      }
      parts.push({
        id: 'fit-saddle', type: 'line',
        a: { x: points.saddleTop.x - 38, y: points.saddleTop.y },
        b: { x: points.saddleTop.x + 38, y: points.saddleTop.y },
        cls: 'part fit saddle'
      });
    }
    if (points.crankEnd) {
      parts.push({
        id: 'fit-crank', type: 'line',
        a: g.bb, b: points.crankEnd, cls: 'part fit crank'
      });
    }
    return parts;
  }

  function fittingPoints(fitting) {
    if (!fitting || !fitting.points) return [];
    var points = fitting.points;
    return [points.stemClamp, points.stemEnd, points.saddleTop,
      points.seatpostTop, points.crankEnd].filter(Boolean);
  }

  /* ------------------------------------------------------------------ *
   * View box: union bounds of every bike, plus room for dimensions
   * ------------------------------------------------------------------ */
  function viewBoxFor(input, extraPoints) {
    var bikes = Array.isArray(input) ? input : [input];
    if (!bikes.length) throw new Error('viewBoxFor needs at least one geometry');

    var minX = Infinity;
    var maxX = -Infinity;
    var minScreenY = Infinity;
    var maxScreenY = -Infinity;

    bikes.forEach(function (g) {
      var R = g.tireRadius;
      minX = Math.min(minX, -R);
      maxX = Math.max(maxX, g.frontAxle.x + R);
      // Highest content (screen y grows downwards): wheel tops and frame tops.
      minScreenY = Math.min(minScreenY,
        -(g.rearAxle.y + R),
        -(g.frontAxle.y + R),
        -g.seatTop.y,
        -g.htTop.y,
        -g.anchors.ttSeat.y,
        -g.anchors.ssSeat.y);
      // Lowest content: the ground line the wheels stand on.
      maxScreenY = Math.max(maxScreenY, -g.groundY);
    });

    (extraPoints || []).forEach(function (point) {
      if (!point) return;
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minScreenY = Math.min(minScreenY, -point.y);
      maxScreenY = Math.max(maxScreenY, -point.y);
    });

    var left = minX - 90;
    var top = minScreenY - 80;
    var width = (maxX - minX) + 180;
    var height = (maxScreenY + 165) - top;
    return { x: left, y: top, w: width, h: height };
  }

  /* ------------------------------------------------------------------ *
   * Annotation context + primitives
   * ------------------------------------------------------------------ */
  function makeContext(g, box) {
    var unit = box.w / 1000;
    return {
      g: g,
      box: box,
      fs: Math.max(box.w * 0.0138, 14 * unit),
      fsTag: Math.max(box.w * 0.0118, 12 * unit),
      arrow: box.w * 0.0052,
      P: function (p) { return [p.x, -p.y]; },
      fmt: fmt
    };
  }

  function line(a, b, cls) {
    return { k: 'line', a: a, b: b, cls: cls || 'dim-line' };
  }

  function guide(a, b) {
    return { k: 'line', a: a, b: b, cls: 'dim-ext' };
  }

  function poly(points, cls) {
    return { k: 'poly', pts: points, cls: cls || 'dim-line' };
  }

  function label(at, text, anchor, cls) {
    return { k: 'label', at: at, text: text, anchor: anchor || 'middle', cls: cls || 'dim-label' };
  }

  function tag(ctx, at, text, anchor) {
    var fs = ctx.fsTag;
    var width = text.length * fs * 0.58 + fs * 1.15;
    var height = fs * 1.72;
    var x = at[0] - (anchor === 'start' ? 0 : anchor === 'end' ? width : width / 2);
    return { k: 'tag', x: x, y: at[1] - height / 2, w: width, h: height, text: text, fs: fs };
  }

  function arrowHead(ctx, tip, dir) {
    var a = ctx.arrow;
    var back = [-dir[0], -dir[1]];
    var angle = 0.46;
    var c = Math.cos(angle), s = Math.sin(angle);
    var r1 = [back[0] * c - back[1] * s, back[0] * s + back[1] * c];
    var r2 = [back[0] * c + back[1] * s, -back[0] * s + back[1] * c];
    return poly([
      [tip[0] + r1[0] * a, tip[1] + r1[1] * a],
      tip,
      [tip[0] + r2[0] * a, tip[1] + r2[1] * a]
    ], 'dim-arrow');
  }

  /* Linear dimension between two screen points, offset along the normal.
   * opts.flip puts the value label on the other side of the dimension line
   * (useful when the default side is occupied by a tube). */
  function dim(ctx, p1, p2, offset, text, opts) {
    opts = opts || {};
    var dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 1e-6)) return [];
    var ux = dx / len, uy = dy / len;
    var nx = -uy, ny = ux;
    var a1 = [p1[0] + nx * offset, p1[1] + ny * offset];
    var a2 = [p2[0] + nx * offset, p2[1] + ny * offset];
    var ext = ctx.arrow * 1.2;
    var out = [
      guide(p1, [a1[0] + nx * ext, a1[1] + ny * ext]),
      guide(p2, [a2[0] + nx * ext, a2[1] + ny * ext]),
      line(a1, a2, 'dim-line'),
      arrowHead(ctx, a1, [ux, uy]),
      arrowHead(ctx, a2, [-ux, -uy])
    ];
    var mid = [(a1[0] + a2[0]) / 2, (a1[1] + a2[1]) / 2];
    var gap = ctx.fs * 0.95 * (opts.flip ? -1 : 1);
    var vertical = Math.abs(uy) > 0.7;
    out.push({
      k: 'label',
      at: [mid[0] + nx * gap, mid[1] + ny * gap],
      text: text,
      anchor: 'middle',
      rotate: vertical
    });
    return out;
  }

  /* Angle arc at a vertex, from angle a1 to a2 (radians, screen space). */
  function angleArc(ctx, vertex, a1, a2, radius, text) {
    var diff = a2 - a1;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    var steps = 26;
    var pts = [];
    for (var i = 0; i <= steps; i++) {
      var ang = a1 + diff * (i / steps);
      pts.push([vertex[0] + Math.cos(ang) * radius, vertex[1] + Math.sin(ang) * radius]);
    }
    var midAng = a1 + diff / 2;
    var lr = radius + ctx.fs * 1.5;
    return [
      poly(pts, 'dim-arc'),
      label([vertex[0] + Math.cos(midAng) * lr, vertex[1] + Math.sin(midAng) * lr], text)
    ];
  }

  function ray(vertex, angle, length) {
    return line(vertex, [vertex[0] + Math.cos(angle) * length, vertex[1] + Math.sin(angle) * length], 'dim-guide');
  }

  /* Foot of the perpendicular from a world point to the steering axis. */
  function steeringFoot(g, worldPoint) {
    var u = g.steerDir;
    var dx = worldPoint.x - g.htBottom.x;
    var dy = worldPoint.y - g.htBottom.y;
    var t = dx * u.x + dy * u.y;
    return { x: g.htBottom.x + u.x * t, y: g.htBottom.y + u.y * t };
  }

  function seatAxisXAtStack(g) {
    var sta = g.input.seatTubeAngle * Math.PI / 180;
    return g.bb.x - g.stack / Math.tan(sta);
  }

  /* ------------------------------------------------------------------ *
   * Annotations per parameter key
   * ------------------------------------------------------------------ */
  function annotationFor(key, g, ctx) {
    var P = ctx.P;
    var R = g.tireRadius;
    var bb = P(g.bb);
    var rear = P(g.rearAxle);
    var front = P(g.frontAxle);
    var seatTop = P(g.seatTop);
    var htTop = P(g.htTop);
    var htBottom = P(g.htBottom);
    var groundScreen = -g.groundY;
    var sta = g.input.seatTubeAngle * Math.PI / 180;
    var hta = g.input.headTubeAngle * Math.PI / 180;

    switch (key) {
      case 'wheelbase':
        return dim(ctx, [rear[0], groundScreen], [front[0], groundScreen], 72,
          fmt(g.wheelbase, 1) + ' mm');

      case 'chainstay':
        return dim(ctx, rear, bb, 48, fmt(g.input.chainstay, 0) + ' mm');

      case 'bbDrop':
        return [guide([0, 0], [bb[0], 0])].concat(
          dim(ctx, [bb[0], 0], [bb[0], bb[1]], -58, fmt(g.input.bbDrop, 0) + ' mm', { flip: true })
        );

      case 'seatTubeLength':
        return dim(ctx, bb, seatTop, -52, fmt(g.input.seatTubeLength, 0) + ' mm');

      case 'seatTubeAngle': {
        var seatDir = [seatTop[0] - bb[0], seatTop[1] - bb[1]];
        var seatAng = Math.atan2(seatDir[1], seatDir[0]);
        return [ray(bb, Math.PI, ctx.fs * 7)].concat(
          angleArc(ctx, bb, Math.PI, seatAng, ctx.fs * 3.3, fmt(g.input.seatTubeAngle, 2) + '\u00b0')
        );
      }

      case 'headTubeAngle': {
        var downDir = [htBottom[0] - htTop[0], htBottom[1] - htTop[1]];
        var downAng = Math.atan2(downDir[1], downDir[0]);
        return [
          ray(htBottom, 0, ctx.fs * 7),
          line(htBottom, P({ x: g.steeringGroundX, y: g.groundY }), 'dim-guide')
        ].concat(
          angleArc(ctx, htBottom, 0, downAng, ctx.fs * 3.3, fmt(g.input.headTubeAngle, 2) + '\u00b0')
        );
      }

      case 'headTubeLength':
        return dim(ctx, htBottom, htTop, 62, fmt(g.input.headTubeLength, 0) + ' mm');

      case 'reach': {
        var corner = [bb[0], htTop[1]];
        return [
          guide(bb, corner)
        ].concat(dim(ctx, corner, htTop, 38, fmt(g.reach, 1) + ' mm', { flip: true }));
      }

      case 'stack': {
        var topCorner = [bb[0], htTop[1]];
        return [guide(bb, topCorner)].concat(
          dim(ctx, bb, topCorner, -50, fmt(g.stack, 1) + ' mm')
        );
      }

      case 'forkOffset': {
        var foot = steeringFoot(g, g.frontAxle);
        var footS = P(foot);
        var axisGround = P({ x: g.steeringGroundX, y: g.groundY });
        return [
          line(htBottom, axisGround, 'dim-guide'),
          line(front, footS, 'dim-line'),
          tag(ctx, [(front[0] + footS[0]) / 2 + ctx.fs * 0.4, (front[1] + footS[1]) / 2],
            'Rake ' + fmt(g.forkOffset, 1) + ' mm', 'start')
        ];
      }

      case 'trail': {
        var axisGroundS = P({ x: g.steeringGroundX, y: g.groundY });
        return [
          line(htBottom, axisGroundS, 'dim-guide'),
          guide(front, [front[0], groundScreen])
        ].concat(dim(ctx, [front[0], groundScreen], [axisGroundS[0], groundScreen], 46,
          fmt(g.trail, 1) + ' mm'));
      }

      case 'mechanicalTrail': {
        var foot2 = steeringFoot(g, { x: g.frontAxle.x, y: g.groundY });
        var contactS = [front[0], groundScreen];
        var foot2S = P(foot2);
        return [
          line(htBottom, P({ x: g.steeringGroundX, y: g.groundY }), 'dim-guide'),
          line(contactS, foot2S, 'dim-line'),
          tag(ctx, [(contactS[0] + foot2S[0]) / 2, (contactS[1] + foot2S[1]) / 2 - ctx.fs * 0.7],
            'Mech. trail ' + fmt(g.mechanicalTrail, 1) + ' mm')
        ];
      }

      case 'frontCenter':
        return [
          line(bb, front, 'dim-guide'),
          tag(ctx, [(bb[0] + front[0]) / 2, (bb[1] + front[1]) / 2 - ctx.fs * 1.1],
            'Front center ' + fmt(g.frontCenter, 1) + ' mm')
        ];

      case 'frontCenterHorizontal':
        return [tag(ctx, [front[0], front[1] - R - ctx.fs * 1.2],
          'FC horiz. ' + fmt(g.frontCenterHorizontal, 1) + ' mm')];

      case 'effectiveTopTube': {
        var seatX = seatAxisXAtStack(g);
        return dim(ctx, [seatX, htTop[1]], htTop, -34,
          fmt(g.effectiveTopTube, 1) + ' mm', { flip: true });
      }

      case 'tireRadius': {
        var p = [front[0] + Math.cos(-Math.PI / 4) * R, front[1] + Math.sin(-Math.PI / 4) * R];
        return [
          line(front, p, 'dim-line'),
          tag(ctx, [p[0] + ctx.fs * 0.5, p[1] - ctx.fs * 0.9], 'R ' + fmt(g.tireRadius, 1) + ' mm', 'start')
        ];
      }

      case 'tireOuterDiameter': {
        var leftEdge = [front[0] - R, front[1]];
        var rightEdge = [front[0] + R, front[1]];
        return dim(ctx, leftEdge, rightEdge, 30,
          '\u00d8 ' + fmt(g.tireOuterDiameter, 1) + ' mm');
      }

      case 'bbHeight':
        return dim(ctx, bb, [bb[0], groundScreen], -58, fmt(g.bbHeight, 1) + ' mm');

      case 'chainstayHorizontal': {
        var csMid = [(rear[0] + bb[0]) / 2, (rear[1] + bb[1]) / 2];
        return [guide([rear[0], 0], [bb[0], 0]), tag(ctx, [csMid[0], csMid[1] + ctx.fs * 0.9],
          'Chainstay horiz. ' + fmt(g.chainstayHorizontal, 1) + ' mm')];
      }

      case 'forkLength':
        return [
          tag(ctx, [(htBottom[0] + front[0]) / 2, (htBottom[1] + front[1]) / 2 + ctx.fs * 0.4],
            'Fork ' + fmt(g.forkLength, 1) + ' mm', 'start')
        ];

      case 'stackReachRatio':
        return [tag(ctx, [htTop[0] + ctx.fs * 2.2, htTop[1] - ctx.fs * 0.4],
          'S/R ' + fmt(g.stackReachRatio, 2) + ':1', 'start')];

      case 'bsd':
        return [tag(ctx, [front[0], front[1] - R - ctx.fs * 1.3],
          'BSD ' + fmt(g.input.bsd, 0) + ' mm')];

      case 'tireWidth':
        return [tag(ctx, [front[0], front[1] - R - ctx.fs * 1.3],
          'Tire ' + fmt(g.input.tireWidth, 0) + ' mm')];

      default:
        return [];
    }
  }

  /* ------------------------------------------------------------------ *
   * Serialization
   * ------------------------------------------------------------------ */
  function serializeAnnotations(list, ctx) {
    var labelSize = ctx ? ctx.fs : 24;
    return list.map(function (p) {
      if (p.k === 'line') {
        return '<line class="' + p.cls + '" vector-effect="non-scaling-stroke" x1="' + n(p.a[0]) + '" y1="' + n(p.a[1]) +
          '" x2="' + n(p.b[0]) + '" y2="' + n(p.b[1]) + '"/>';
      }
      if (p.k === 'poly') {
        var pts = p.pts.map(function (q) { return n(q[0]) + ',' + n(q[1]); }).join(' ');
        return '<polyline class="' + p.cls + '" vector-effect="non-scaling-stroke" points="' + pts + '"/>';
      }
      if (p.k === 'label') {
        var cls = p.cls || 'dim-label';
        var rotate = p.rotate
          ? ' transform="rotate(-90 ' + n(p.at[0]) + ' ' + n(p.at[1]) + ')"'
          : '';
        return '<text class="' + cls + '" x="' + n(p.at[0]) + '" y="' + n(p.at[1]) +
          '" text-anchor="' + p.anchor + '" style="font-size:' + n(labelSize) + 'px"' + rotate + '>' +
          esc(p.text) + '</text>';
      }
      if (p.k === 'tag') {
        var tx = p.x + p.w / 2;
        var ty = p.y + p.h / 2 + p.fs * 0.35;
        return '<g class="dim-tag">' +
          '<rect x="' + n(p.x) + '" y="' + n(p.y) + '" width="' + n(p.w) + '" height="' + n(p.h) +
          '" rx="' + n(p.fs * 0.32) + '" ry="' + n(p.fs * 0.32) + '"/>' +
          '<text x="' + n(tx) + '" y="' + n(ty) + '" text-anchor="middle" style="font-size:' +
          n(p.fs) + 'px">' + esc(p.text) + '</text></g>';
      }
      return '';
    }).join('');
  }

  /* ------------------------------------------------------------------ *
   * Public render
   *
   * options = {
   *   bikes: [{ g, colorIndex, selected }],   // one to three entries
   *   activeKey: string | null,               // hovered parameter
   *   showAnnotation: boolean                 // draw the selected bike's dim
   * }
   * ------------------------------------------------------------------ */
  function render(svgEl, options) {
    options = options || {};
    var source = options.bikes || [];
    if (!source.length) return null;

    var align = options.align === 'ground' ? 'ground' : 'axle';
    var entries = source.map(function (entry) {
      var dy = align === 'ground' ? entry.g.tireRadius : 0;
      return {
        g: dy ? shiftGeometry(entry.g, dy) : entry.g,
        fitting: dy ? shiftFitting(entry.fitting, dy) : entry.fitting,
        colorIndex: entry.colorIndex,
        selected: entry.selected
      };
    });

    var geometries = entries.map(function (entry) { return entry.g; });
    var extraPoints = [];
    entries.forEach(function (entry) {
      extraPoints = extraPoints.concat(fittingPoints(entry.fitting));
    });
    var box = viewBoxFor(geometries, extraPoints);

    var selected = entries.filter(function (entry) { return entry.selected; })[0] || entries[0];
    var ctx = makeContext(selected.g, box);

    var param = null;
    if (options.activeKey) {
      var catalogues = [Geo.PARAMS];
      if (Geo.FITTING_FIELDS) catalogues.push(Geo.FITTING_FIELDS);
      for (var c = 0; c < catalogues.length && !param; c++) {
        for (var i = 0; i < catalogues[c].length; i++) {
          if (catalogues[c][i].key === options.activeKey) { param = catalogues[c][i]; break; }
        }
      }
    }
    var activeParts = (param && param.parts) || [];

    // Selected bike is drawn last so it stays readable on top.
    var order = entries.slice().sort(function (a, b) {
      return (a.selected === b.selected) ? 0 : (a.selected ? 1 : -1);
    });
    var scene = order.map(function (entry) {
      var cls = 'bike bike-' + entry.colorIndex + (entry.selected ? ' is-selected' : '');
      return '<g class="' + cls + '">' +
        serializeParts(buildParts(entry.g), activeParts) +
        serializeParts(buildFittingParts(entry.g, entry.fitting), activeParts) +
        '</g>';
    }).join('');

    var annotations = (options.showAnnotation !== false && param)
      ? annotationFor(options.activeKey, selected.g, ctx)
      : [];

    if (options.activeKey) {
      svgEl.setAttribute('class', 'is-inspecting');
    } else {
      svgEl.removeAttribute('class');
    }
    svgEl.setAttribute('viewBox', [box.x, box.y, box.w, box.h].join(' '));
    svgEl.innerHTML =
      '<g class="scene">' + scene + '</g>' +
      '<g class="annotations">' + serializeAnnotations(annotations, ctx) + '</g>';

    return { box: box, geometryCount: entries.length, align: align };
  }

  /* ------------------------------------------------------------------ *
   * Standalone SVG export
   * ------------------------------------------------------------------ */
  var EXPORT_CSS = [
    '.bike-0{--bike:#111827}.bike-1{--bike:#4FA8E8}.bike-2{--bike:#F97316}',
    '.part{fill:none;stroke:var(--bike,#111827);stroke-width:2.1px;stroke-linecap:round;stroke-linejoin:round}',
    '.part.wheel{stroke-width:2.2px}',
    '.part.rim{stroke-width:1.3px;opacity:.62}',
    '.part.tire{fill:var(--bike,#111827);fill-opacity:.14;stroke:none}',
    '.part.hub{fill:var(--bike,#111827);stroke:none}',
    '.part.ground{stroke:var(--bike,#111827);stroke-width:1.1px;stroke-dasharray:9 9;opacity:.5}',
    '.part.fit{stroke-width:1.6px;opacity:.82}',
    '.part.fit.saddle{stroke-width:2.4px;opacity:.92}',
    '.part.is-active{stroke-width:4.2px}',
    'text{font-family:ui-monospace,Consolas,monospace}',
    '.dim-line{fill:none;stroke:#d9480f;stroke-width:1.2px}',
    '.dim-ext{fill:none;stroke:#c2cad4;stroke-width:1px;stroke-dasharray:5 5}',
    '.dim-guide{fill:none;stroke:#e8590c;stroke-width:1px;stroke-dasharray:6 6;opacity:.6}',
    '.dim-arc{fill:none;stroke:#d9480f;stroke-width:1.2px}',
    '.dim-arrow{fill:#d9480f;stroke:none}',
    '.dim-label{fill:#b5460f;font-weight:560;paint-order:stroke;stroke:#f8f9fb;stroke-width:3px;stroke-linejoin:round}',
    '.dim-tag rect{fill:#fff8f3;stroke:#f0b795;stroke-width:1px}',
    '.dim-tag text{fill:#a83f0c;font-weight:620;paint-order:stroke;stroke:#fff8f3;stroke-width:2.5px;stroke-linejoin:round}'
  ].join('');

  /* Wrap the rendered scene markup into a self-contained SVG file: dotted
   * paper background included, styles inlined, no external references. */
  function standaloneSvg(innerMarkup, box) {
    var viewBox = [box.x, box.y, box.w, box.h].join(' ');
    var rect = 'x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '"';
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '">' +
      '<defs><pattern id="bikegeo-dots" width="20" height="20" patternUnits="userSpaceOnUse">' +
      '<circle cx="10" cy="10" r="0.9" fill="#c9d1da"/></pattern></defs>' +
      '<rect ' + rect + ' fill="#f8f9fb"/>' +
      '<rect ' + rect + ' fill="url(#bikegeo-dots)"/>' +
      '<style>' + EXPORT_CSS + '</style>' +
      innerMarkup +
      '</svg>';
  }

  return {
    render: render,
    buildParts: buildParts,
    buildFittingParts: buildFittingParts,
    viewBoxFor: viewBoxFor,
    annotationFor: annotationFor,
    serializeAnnotations: serializeAnnotations,
    standaloneSvg: standaloneSvg,
    alignGeometries: alignGeometries,
    shiftGeometry: shiftGeometry,
    fmt: fmt,
    makeContext: makeContext,
    BIKE_COLORS: BIKE_COLORS
  };
}));
