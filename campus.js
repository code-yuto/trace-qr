(() => {
  const canvas = document.getElementById("campus");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context is not available");

  const INK = "13, 13, 13";
  const PAPER = "213, 215, 212";
  const SPLIT = 0.52;
  const PITCH = 0.5;
  const TURN_PER_MS = (Math.PI * 2) / 60000;
  // data-still: a print, so no motion and a finer bitmap.
  const still = canvas.dataset.still !== undefined || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Campus metres (x east, y north, z up) -> scene (x right, y up, z toward the viewer at yaw 0).
  const toScene = ([x, y], z, c) => [x - c[0], z, -(y - c[1])];

  const loopSegments = (loops, z, c, out) => {
    for (const loop of loops) {
      loop.forEach((p, i) => out.push([toScene(p, z, c), toScene(loop[(i + 1) % loop.length], z, c)]));
    }
  };

  // Same layers as the /log trace view: every floor faint, roofs and corner edges stronger.
  const buildLayers = (data) => {
    const points = data.buildings.flatMap((b) => b.footprint.flat());
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const floors = [];
    const frame = [];
    for (const b of data.buildings) {
      for (const f of b.floors) loopSegments(f.outlines.length ? f.outlines : b.footprint, f.z, c, floors);
      const top = b.floors.at(-1);
      loopSegments(top && top.outlines.length ? top.outlines : b.footprint, b.roofZ, c, frame);
      loopSegments(b.footprint, 0, c, frame);
      for (const loop of b.footprint) for (const p of loop) frame.push([toScene(p, 0, c), toScene(p, b.roofZ, c)]);
    }
    const radius = Math.max(...points.map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
    const height = Math.max(...data.buildings.map((b) => b.roofZ));
    const [sx, sy, sz] = data.shibalab;
    return { layers: [{ segments: floors, alpha: 0.2 }, { segments: frame, alpha: 0.45 }], radius, height, mark: toScene([sx, sy], sz, c) };
  };

  const start = (model) => {
    let w = 0, h = 0;

    const project = (p, yaw, view) => {
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const x = p[0] * cos - p[2] * sin;
      const z = p[0] * sin + p[2] * cos;
      const y = p[1] - model.height * 0.4;
      const up = y * Math.cos(PITCH) - z * Math.sin(PITCH);
      const depth = view.dist - (z * Math.cos(PITCH) + y * Math.sin(PITCH));
      const k = view.scale * view.dist / depth;
      return [view.cx + x * k, view.cy - up * k];
    };

    // Wide screens: to the right of the QR, astride the split. Tall screens: under the QR.
    const layoutBox = (splitY) => {
      if (w / h >= 1.25) {
        const qr = document.querySelector(".center").getBoundingClientRect();
        const left = qr.right + 14;
        return { cx: (left + w) / 2, cy: splitY, w: (w - left) * 0.6, h: h * 0.3 };
      }
      const text = document.querySelector("h1").getBoundingClientRect();
      const top = text.bottom + 16;
      return { cx: w / 2, cy: (top + h) / 2 + 8, w: w * (still ? 0.75 : 0.6), h: Math.max(60, (h - top) * (still ? 0.7 : 0.5)) };
    };

    const stroke = (segments, yaw, view) => {
      ctx.beginPath();
      for (const [a, b] of segments) {
        const pa = project(a, yaw, view), pb = project(b, yaw, view);
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
      }
      ctx.stroke();
    };

    // The campus straddles the split, drawn in ink over the paper and in paper over the ink.
    const draw = (t) => {
      const yaw = 0.42 + (still ? 0 : t * TURN_PER_MS);
      const splitY = h * SPLIT;
      const box = layoutBox(splitY);
      const scale = Math.min(box.w / (2 * model.radius), box.h / (2 * model.radius * Math.sin(PITCH) + model.height * Math.cos(PITCH)));
      const view = { cx: box.cx, cy: box.cy, scale, dist: model.radius * 7 };
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      const pulse = (t % 2400) / 2400;
      const m = project(model.mark, yaw, view);
      for (const [rgb, y0, y1] of [[INK, 0, splitY], [PAPER, splitY, h]]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y0, w, y1 - y0);
        ctx.clip();
        for (const layer of model.layers) {
          ctx.strokeStyle = `rgba(${rgb}, ${layer.alpha})`;
          stroke(layer.segments, yaw, view);
        }
        // ShibaLab: a dot with a ring spreading from it.
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.fillRect(m[0] - 3, m[1] - 3, 6, 6);
        ctx.strokeStyle = `rgba(${rgb}, ${still ? 0.8 : 1 - pulse})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(m[0], m[1], 6 + (still ? 6 : pulse * 22), 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.restore();
      }
    };

    const resize = () => {
      const dpr = canvas.dataset.still !== undefined ? 6 : window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now());
    };

    window.addEventListener("resize", resize);
    resize();
    if (!still) {
      const loop = (t) => { draw(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  };

  fetch("campus.json")
    .then((res) => {
      if (!res.ok) throw new Error(`campus.json: HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => start(buildLayers(data)))
    .catch((err) => console.error("Failed to draw the campus:", err));
})();
