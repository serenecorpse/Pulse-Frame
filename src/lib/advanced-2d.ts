import type { AdvancedEffect, AdvancedFrame } from "./advanced-visualizers";

type Frame = AdvancedFrame;
const tau = Math.PI * 2;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function kaleidoscope(ctx: CanvasRenderingContext2D, f: Frame): void {
  const radius =
    Math.min(f.width, f.height) *
    (0.32 + f.audio.bass * 0.1 * f.sensitivity + f.audio.beat * 0.06);
  const segments =
    Math.round(clamp(6 + f.detail * 4 + f.audio.treble * 8, 6, 18) / 2) * 2;
  const angle = tau / segments;
  ctx.rotate(f.time * f.speed * (0.08 + f.audio.mid * 0.12));
  ctx.shadowBlur = (8 + 14 * f.audio.treble) * f.unit;
  for (let i = 0; i < segments; i++) {
    ctx.save();
    ctx.rotate(i * angle);
    if (i % 2) ctx.scale(1, -1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, -angle / 2, angle / 2);
    ctx.closePath();
    ctx.clip();
    for (let j = 1; j <= 5; j++) {
      const r = (radius * j) / 5;
      ctx.globalAlpha *= 0.87;
      ctx.beginPath();
      ctx.moveTo(r * 0.48, 0);
      ctx.lineTo(r, r * angle * 0.38);
      ctx.lineTo(r * 1.15, 0);
      ctx.lineTo(r, -r * angle * 0.38);
      ctx.closePath();
      ctx.stroke();
      if (j % 2 === 0) ctx.fill();
    }
    ctx.restore();
  }
}

function ribbons(ctx: CanvasRenderingContext2D, f: Frame): void {
  const size = Math.min(f.width, f.height);
  const count = Math.round(clamp(5 + f.detail * 5, 6, 14));
  const radius =
    size * (0.25 + 0.1 * f.audio.bass * f.sensitivity + 0.06 * f.audio.beat);
  ctx.shadowBlur = (10 + 20 * f.audio.treble) * f.unit;
  for (let i = 0; i < count; i++) {
    const angle = (tau * i) / count + f.time * f.speed * 0.14;
    const bend = Math.sin(f.time * f.speed + i) * (0.12 + f.audio.mid * 0.18);
    ctx.save();
    ctx.rotate(angle);
    ctx.globalAlpha *= 0.45 + (i % 3) * 0.17;
    ctx.beginPath();
    ctx.moveTo(radius * 0.12, -radius * 0.025);
    ctx.bezierCurveTo(
      radius * 0.28,
      radius * bend,
      radius * 0.62,
      radius * (bend + 0.08),
      radius * 1.35,
      radius * 0.16,
    );
    ctx.bezierCurveTo(
      radius * 0.65,
      radius * (bend + 0.15),
      radius * 0.3,
      radius * (bend + 0.04),
      radius * 0.12,
      radius * 0.025,
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function contours(ctx: CanvasRenderingContext2D, f: Frame): void {
  const columns = 44,
    rows = 30;
  const width = f.width * 0.82,
    height = f.height * 0.72;
  const dx = width / columns,
    dy = height / rows;
  const time = f.time * f.speed * 0.3;
  const values = new Float32Array((columns + 1) * (rows + 1));
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= columns; x++) {
      const nx = (x / columns) * 5 - 2.5,
        ny = (y / rows) * 4 - 2;
      const distance = Math.hypot(nx, ny);
      values[y * (columns + 1) + x] =
        Math.sin(nx * 1.5 + time + Math.cos(ny * 1.4 - time)) +
        Math.cos(ny * 1.7 - time * 0.7 + f.audio.mid * nx) +
        Math.sin(distance * 3 - time * 2) *
          (0.25 + f.audio.bass * f.sensitivity * 0.8) +
        (Number.isFinite(f.audio.sinceBeat)
          ? Math.cos(distance * 5 - f.audio.sinceBeat * 12) * f.audio.beat
          : 0);
    }
  const levels = Math.round(
    clamp(6 + f.detail * 4 + f.audio.treble * 4, 5, 18),
  );
  ctx.lineWidth = Math.max(f.unit, 1);
  ctx.shadowBlur = (3 + f.audio.treble * 8) * f.unit;
  for (let level = 0; level < levels; level++) {
    const threshold = -2.2 + (level * 4.4) / Math.max(1, levels - 1);
    ctx.beginPath();
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const index = y * (columns + 1) + x;
        const corners = [
          values[index],
          values[index + 1],
          values[index + columns + 2],
          values[index + columns + 1],
        ];
        const points: [number, number][] = [];
        const positions: [number, number][] = [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4,
            a = corners[edge],
            b = corners[next];
          if (a < threshold === b < threshold) continue;
          const ratio = (threshold - a) / (b - a);
          points.push([
            -width / 2 +
              (x +
                positions[edge][0] +
                (positions[next][0] - positions[edge][0]) * ratio) *
                dx,
            -height / 2 +
              (y +
                positions[edge][1] +
                (positions[next][1] - positions[edge][1]) * ratio) *
                dy,
          ]);
        }
        for (let p = 0; p + 1 < points.length; p += 2) {
          ctx.moveTo(points[p][0], points[p][1]);
          ctx.lineTo(points[p + 1][0], points[p + 1][1]);
        }
      }
    ctx.stroke();
  }
}

interface FeedbackState {
  current: HTMLCanvasElement;
  previous: HTMLCanvasElement;
  time: number;
}
const feedback = new WeakMap<HTMLCanvasElement, Map<string, FeedbackState>>();

export function pruneFeedback(
  canvas: HTMLCanvasElement,
  activeIds: Set<string>,
): void {
  const clips = feedback.get(canvas);
  if (!clips) return;
  for (const id of clips.keys()) if (!activeIds.has(id)) clips.delete(id);
}

function feedbackTunnel(ctx: CanvasRenderingContext2D, f: Frame): void {
  let clips = feedback.get(ctx.canvas);
  if (!clips) {
    clips = new Map();
    feedback.set(ctx.canvas, clips);
  }
  let state = clips.get(f.clipId);
  if (!state) {
    state = {
      current: document.createElement("canvas"),
      previous: document.createElement("canvas"),
      time: -Infinity,
    };
    clips.set(f.clipId, state);
  }
  const scale = Math.min(1, 960 / Math.max(f.width, f.height));
  const width = Math.max(1, Math.round(f.width * scale)),
    height = Math.max(1, Math.round(f.height * scale));
  const reset =
    state.current.width !== width ||
    state.current.height !== height ||
    f.time < state.time ||
    f.time - state.time > 0.25;
  if (reset) {
    state.current.width = state.previous.width = width;
    state.current.height = state.previous.height = height;
    state.time = -Infinity;
  }
  const advance = f.time !== state.time;
  {
    const buffer = state.current.getContext("2d");
    if (!buffer) throw new Error("Feedback canvas is not supported.");
    buffer.clearRect(0, 0, width, height);
    buffer.drawImage(ctx.canvas, 0, 0, width, height);
    if (Number.isFinite(state.time)) {
      const zoom =
        1.025 + f.audio.bass * f.sensitivity * 0.04 + f.audio.beat * 0.035;
      buffer.save();
      buffer.globalAlpha = clamp(0.7 * f.detail, 0.2, 0.95);
      buffer.translate(width / 2, height / 2);
      buffer.rotate((0.003 + f.audio.mid * 0.008) * f.speed);
      buffer.scale(zoom, zoom);
      buffer.drawImage(state.previous, -width / 2, -height / 2);
      if (f.audio.treble > 0.02) {
        const shift = f.audio.treble * f.sensitivity * width * 0.008;
        buffer.globalAlpha = f.audio.treble * 0.2;
        buffer.globalCompositeOperation = "screen";
        buffer.filter = "hue-rotate(35deg)";
        buffer.drawImage(state.previous, -width / 2 + shift, -height / 2);
        buffer.filter = "hue-rotate(-35deg)";
        buffer.drawImage(state.previous, -width / 2 - shift, -height / 2);
      }
      buffer.restore();
    }
    buffer.save();
    buffer.translate(width / 2, height / 2);
    buffer.rotate(f.time * f.speed * 0.12);
    buffer.strokeStyle = f.color;
    buffer.globalAlpha = 0.75 + f.audio.treble * 0.25;
    buffer.lineWidth = Math.max(2, width / 300);
    const radius =
      Math.min(width, height) * (0.12 + f.audio.bass * f.sensitivity * 0.04);
    buffer.strokeRect(-radius, -radius, radius * 2, radius * 2);
    buffer.restore();
    if (advance) {
      [state.current, state.previous] = [state.previous, state.current];
      state.time = f.time;
    }
  }
  ctx.drawImage(
    advance ? state.previous : state.current,
    -f.width / 2,
    -f.height / 2,
    f.width,
    f.height,
  );
}

export function drawAdvanced2D(
  ctx: CanvasRenderingContext2D,
  effect: AdvancedEffect,
  frame: Frame,
): boolean {
  switch (effect) {
    case "kaleidoscope":
      kaleidoscope(ctx, frame);
      return true;
    case "ribbon-tunnel":
      ribbons(ctx, frame);
      return true;
    case "topographic-contours":
      contours(ctx, frame);
      return true;
    case "feedback-tunnel":
      feedbackTunnel(ctx, frame);
      return true;
    default:
      return false;
  }
}
