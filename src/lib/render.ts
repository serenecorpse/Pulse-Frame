import { silentFeatures, type AudioFeatures } from "./audio-features";
import { activeCueAtTime, parseLyrics } from "./lyrics";
import { cameraAt, cameraCrop, drawCamera } from "./motion";
import {
  beatEffects,
  dimensions,
  durationOf,
  isBeatEffect,
  type Asset,
  type Clip,
  type EffectType,
  type Project,
} from "./project";

type Ctx = CanvasRenderingContext2D;
const silent = silentFeatures();
const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
const hash = (seed: number) => {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};

function rgb(hex: string | undefined): [number, number, number] {
  const match = /^#?([\da-f]{6})$/i.exec(hex || "");
  if (!match) return [167, 139, 250];
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
const rgba = (hex: string | undefined, alpha: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha)})`;
};
const lighten = (hex: string | undefined, amount: number, alpha = 1) => {
  const [r, g, b] = rgb(hex);
  const l = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgba(${l(r)},${l(g)},${l(b)},${clamp(alpha)})`;
};

const scratchCanvases: HTMLCanvasElement[] = [];
function scratch(
  index: number,
  width: number,
  height: number,
): [HTMLCanvasElement, Ctx] {
  let canvas = scratchCanvases[index];
  if (!canvas)
    canvas = scratchCanvases[index] = document.createElement("canvas");
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is not supported.");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return [canvas, ctx];
}
function snapshot(ctx: Ctx, index = 0): HTMLCanvasElement {
  const { width, height } = ctx.canvas,
    [canvas, copy] = scratch(index, width, height);
  copy.clearRect(0, 0, width, height);
  copy.drawImage(ctx.canvas, 0, 0);
  return canvas;
}
let filterSupport: boolean | undefined;
function supportsFilter(ctx: Ctx): boolean {
  if (filterSupport === undefined) {
    filterSupport = "filter" in CanvasRenderingContext2D.prototype;
    if (filterSupport) {
      ctx.save();
      ctx.filter = "hue-rotate(10deg)";
      filterSupport = ctx.filter === "hue-rotate(10deg)";
      ctx.restore();
    }
  }
  return filterSupport;
}

function rgbSplit(ctx: Ctx, offset: number, angle = 0): void {
  if (offset < 0.5) return;
  const { width: w, height: h } = ctx.canvas,
    source = snapshot(ctx, 0),
    [tinted, tint] = scratch(1, w, h);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  for (const [color, direction] of [
    ["#f00", -1],
    ["#0f0", 0],
    ["#00f", 1],
  ] as const) {
    tint.globalCompositeOperation = "source-over";
    tint.drawImage(source, 0, 0);
    tint.globalCompositeOperation = "multiply";
    tint.fillStyle = color;
    tint.fillRect(0, 0, w, h);
    ctx.drawImage(
      tinted,
      Math.cos(angle) * offset * direction,
      Math.sin(angle) * offset * direction,
    );
  }
  ctx.restore();
}

const stage: Record<(typeof beatEffects)[number], number> = {
  mirror: 0,
  "beat-zoom": 1,
  shake: 2,
  glitch: 3,
  "rgb-split": 3,
  vhs: 4,
  "hue-shift": 5,
  duotone: 5,
  bloom: 6,
  "color-flash": 7,
  "invert-flash": 7,
  strobe: 8,
  "vignette-pulse": 9,
};

function applyBeatEffect(
  ctx: Ctx,
  clip: Clip,
  time: number,
  audio: AudioFeatures,
  focusX: number,
  focusY: number,
): void {
  const { width: w, height: h } = ctx.canvas,
    unit = w / 1280;
  const k = (((clip.sensitivity ?? 70) / 70) * clip.opacity) / 100,
    color = clip.color;
  // Full-frame flashes fire on every other beat to stay under ~3 flashes per second.
  const flashBeat = audio.beatCount % 2 === 1;
  ctx.save();
  switch (clip.effect) {
    case "beat-zoom": {
      const zoom = 1 + (audio.bass * 0.04 + audio.beat * 0.11) * k;
      if (zoom > 1.0005) {
        const source = snapshot(ctx);
        ctx.translate(focusX, focusY);
        ctx.scale(zoom, zoom);
        ctx.translate(-focusX, -focusY);
        ctx.drawImage(source, 0, 0);
      }
      break;
    }
    case "shake": {
      const energy = audio.beat * 0.9 + audio.bass * 0.25,
        amplitude = energy * k * Math.min(w, h) * 0.022;
      if (amplitude < 0.3) break;
      const frame = Math.floor(time * 48),
        rotation = (hash(frame + 19.7) - 0.5) * energy * k * 0.02;
      const cover =
        1 +
        (2 * amplitude) / Math.min(w, h) +
        (Math.abs(rotation) * Math.max(w, h)) / Math.min(w, h);
      const source = snapshot(ctx);
      ctx.translate(
        w / 2 + (hash(frame) - 0.5) * 2 * amplitude,
        h / 2 + (hash(frame + 71.3) - 0.5) * 2 * amplitude,
      );
      ctx.rotate(rotation);
      ctx.scale(cover, cover);
      ctx.drawImage(source, -w / 2, -h / 2);
      break;
    }
    case "glitch": {
      const frame = Math.floor(time * 24),
        random = hash(frame * 0.37) < 0.03 + audio.level * 0.12;
      const amount =
        Math.max(audio.beat > 0.3 ? audio.beat : 0, random ? 0.5 : 0) * k;
      if (amount <= 0) break;
      rgbSplit(ctx, w * 0.012 * amount);
      const source = snapshot(ctx),
        slices = 4 + Math.floor(hash(frame + 3) * 8);
      for (let i = 0; i < slices; i++) {
        const y = hash(frame * 13 + i) * h,
          height = (0.01 + hash(frame * 7 + i) * 0.07) * h;
        ctx.drawImage(
          source,
          0,
          y,
          w,
          height,
          (hash(frame * 5 + i) - 0.5) * w * 0.12 * amount,
          y,
          w,
          height,
        );
      }
      ctx.globalCompositeOperation = "difference";
      for (let i = 0; i < 3; i++) {
        if (hash(frame * 3 + i * 11) > 0.5) continue;
        ctx.fillStyle = rgba(color, 0.6 * clamp(amount));
        ctx.fillRect(
          hash(frame + i * 17) * w,
          hash(frame + i * 29) * h,
          (0.05 + hash(frame + i) * 0.25) * w,
          (0.005 + hash(frame + i * 3) * 0.03) * h,
        );
      }
      break;
    }
    case "rgb-split":
      rgbSplit(
        ctx,
        (2 + audio.beat * 14 + audio.bass * 6) * k * unit,
        Math.sin(time * 0.7) * 0.6,
      );
      break;
    case "hue-shift": {
      const angle = time * 25 * k + audio.beatCount * 45 + audio.beat * 60 * k;
      if (supportsFilter(ctx)) {
        const source = snapshot(ctx);
        ctx.filter = `hue-rotate(${angle % 360}deg) saturate(${1 + 0.4 * k})`;
        ctx.drawImage(source, 0, 0);
      } else {
        ctx.globalCompositeOperation = "hue";
        ctx.globalAlpha = clamp(0.55 * k);
        ctx.fillStyle = `hsl(${angle % 360},90%,50%)`;
        ctx.fillRect(0, 0, w, h);
      }
      break;
    }
    case "color-flash":
      if (audio.beat > 0.01) {
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = rgba(color, audio.beat * 0.7 * k);
        ctx.fillRect(0, 0, w, h);
      }
      break;
    case "strobe":
      if (flashBeat && audio.beat > 0.55) {
        ctx.fillStyle = rgba(color, 0.85 * k);
        ctx.fillRect(0, 0, w, h);
      }
      break;
    case "invert-flash":
      if (flashBeat && audio.beat > 0.02) {
        ctx.globalCompositeOperation = "difference";
        ctx.fillStyle = `rgba(255,255,255,${clamp(audio.beat * k)})`;
        ctx.fillRect(0, 0, w, h);
      }
      break;
    case "duotone": {
      const [r, g, b] = rgb(color);
      ctx.globalCompositeOperation = "saturation";
      ctx.globalAlpha = clamp(k);
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = clamp(0.85 * k);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = clamp((0.35 + audio.bass * 0.4) * k);
      ctx.fillStyle = `rgb(${Math.round((255 - r) * 0.35)},${Math.round((255 - g) * 0.35)},${Math.round((255 - b) * 0.35)})`;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "vhs": {
      rgbSplit(ctx, Math.max(1, unit * 2) * (1.5 + audio.beat * 4) * k);
      const source = snapshot(ctx),
        frame = Math.floor(time * 30);
      for (let i = 0; i < 3; i++) {
        const y = ((time * 0.12 + i * 0.37) % 1) * h,
          band = h * 0.02;
        ctx.drawImage(
          source,
          0,
          y,
          w,
          band,
          (hash(frame + i * 9) - 0.5) * w * 0.02 * (1 + audio.beat * 3) * k,
          y,
          w,
          band,
        );
      }
      const [lines, line] = scratch(
        3,
        1,
        Math.max(2, Math.round((3 * h) / 720)),
      );
      line.clearRect(0, 0, 1, lines.height);
      line.fillStyle = "#000";
      line.fillRect(0, 0, 1, Math.max(1, Math.round(h / 720)));
      const pattern = ctx.createPattern(lines, "repeat");
      if (pattern) {
        ctx.globalAlpha = clamp(0.22 * k);
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, w, h);
      }
      const roll = ((time * 0.08) % 1) * h * 1.2 - h * 0.1,
        gradient = ctx.createLinearGradient(0, roll, 0, roll + h * 0.08);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.5, "rgba(255,255,255,.08)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = clamp(k);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, roll, w, h * 0.08);
      ctx.fillStyle = "rgba(255,255,255,.5)";
      for (let i = 0; i < 90; i++)
        ctx.fillRect(
          hash(i + frame * 97) * w,
          hash(i * 3 + frame * 89) * h,
          (1 + hash(i) * 6) * unit,
          unit,
        );
      break;
    }
    case "bloom": {
      const sw = Math.max(1, Math.round(w / 8)),
        sh = Math.max(1, Math.round(h / 8)),
        [small, glow] = scratch(2, sw, sh);
      glow.imageSmoothingEnabled = true;
      glow.imageSmoothingQuality = "high";
      glow.drawImage(ctx.canvas, 0, 0, sw, sh);
      glow.globalCompositeOperation = "multiply";
      glow.drawImage(small, 0, 0);
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = clamp((0.5 + audio.bass * 0.4 + audio.beat * 0.5) * k);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(small, 0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp((0.12 + audio.beat * 0.25) * k);
      ctx.drawImage(small, 0, 0, w, h);
      break;
    }
    case "vignette-pulse": {
      const strength = clamp(
        (0.45 + audio.bass * 0.35 + audio.beat * 0.25) * k,
        0,
        0.95,
      );
      const inner = Math.max(
          0.05,
          Math.min(w, h) * (0.32 - audio.beat * 0.1 * k),
        ),
        outer = Math.hypot(w, h) / 2;
      const gradient = ctx.createRadialGradient(
        focusX,
        focusY,
        inner,
        focusX,
        focusY,
        outer,
      );
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(0.7, rgba(color, strength * 0.35));
      gradient.addColorStop(1, `rgba(0,0,0,${strength})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case "mirror": {
      const source = snapshot(ctx);
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, 0, 0, w / 2, h, 0, 0, w / 2, h);
      break;
    }
  }
  ctx.restore();
}

function smoothPath(
  ctx: Ctx,
  points: [number, number][],
  closed = false,
): void {
  if (points.length < 2) return;
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  if (closed) {
    const start = mid(points[points.length - 1], points[0]);
    ctx.moveTo(start[0], start[1]);
    points.forEach((point, i) => {
      const end = mid(point, points[(i + 1) % points.length]);
      ctx.quadraticCurveTo(point[0], point[1], end[0], end[1]);
    });
    ctx.closePath();
  } else {
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      const end = mid(points[i], points[i + 1]);
      ctx.quadraticCurveTo(points[i][0], points[i][1], end[0], end[1]);
    }
    ctx.lineTo(points[points.length - 1][0], points[points.length - 1][1]);
  }
}
function bar(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(
      x,
      y,
      width,
      height,
      Math.min(radius, width / 2, Math.abs(height) / 2),
    );
    ctx.fill();
  } else ctx.fillRect(x, y, width, height);
}

function drawEqualizer(
  ctx: Ctx,
  clip: Clip,
  effect: EffectType,
  time: number,
  audio: AudioFeatures,
  waveform: Uint8Array | undefined,
  cx: number,
  cy: number,
  unit: number,
): void {
  const { width: w, height: h } = ctx.canvas,
    min = Math.min(w, h),
    sensitivity = (clip.sensitivity ?? 70) / 70,
    color = clip.color || "#a78bfa";
  const bands = audio.bands,
    idle = audio.level < 0.005;
  const level = (i: number, n: number, source: Float32Array = bands) => {
    if (idle) return 0.04;
    const position = (i / Math.max(1, n - 1)) * (source.length - 1),
      low = Math.floor(position),
      t = position - low;
    return clamp(
      source[low] * (1 - t) + source[Math.min(source.length - 1, low + 1)] * t,
    );
  };
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((clip.rotation * Math.PI) / 180);
  ctx.scale(clip.scale / 100, clip.scale / 100);
  ctx.globalAlpha = clip.opacity / 100;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, 2 * unit);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 * unit;
  switch (effect) {
    case "mirror-bars": {
      const n = 48,
        total = w * 0.7,
        slot = total / n,
        width = slot * 0.62,
        maxHeight = h * 0.2 * sensitivity;
      const gradient = ctx.createLinearGradient(0, -maxHeight, 0, maxHeight);
      gradient.addColorStop(0, lighten(color, 0.6));
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, lighten(color, 0.6));
      ctx.fillStyle = gradient;
      for (let i = 0; i < n; i++) {
        const height = Math.max(2 * unit, level(i, n) * maxHeight);
        bar(ctx, -total / 2 + i * slot, -height, width, height * 2, width / 2);
      }
      break;
    }
    case "radial-bars": {
      const n = 96,
        radius = min * 0.16 * (1 + audio.beat * 0.06 * sensitivity);
      ctx.rotate(time * 0.1 + audio.beat * 0.05);
      ctx.lineWidth = Math.max(1.5 * unit, ((2 * Math.PI * radius) / n) * 0.55);
      for (let i = 0; i < n; i++) {
        const mirrored = i < n / 2 ? i : n - 1 - i,
          length = 3 * unit + level(mirrored, n / 2) * min * 0.2 * sensitivity,
          angle = (i / n) * Math.PI * 2;
        ctx.strokeStyle = lighten(color, mirrored / n, 0.95);
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        ctx.lineTo(
          Math.cos(angle) * (radius + length),
          Math.sin(angle) * (radius + length),
        );
        ctx.stroke();
      }
      ctx.globalAlpha *= 0.4;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, unit);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.92, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "circular": {
      const n = 72,
        radius = min * 0.19 * (1 + audio.bass * 0.08 * sensitivity);
      const ring = (amplitude: number) =>
        Array.from({ length: n }, (_, i): [number, number] => {
          const mirrored = i < n / 2 ? i : n - 1 - i,
            angle = (i / n) * Math.PI * 2 - Math.PI / 2,
            r = radius + level(mirrored, n / 2) * h * amplitude * sensitivity;
          return [Math.cos(angle) * r, Math.sin(angle) * r];
        });
      const fill = ctx.createRadialGradient(
        0,
        0,
        radius * 0.6,
        0,
        0,
        radius * 1.6,
      );
      fill.addColorStop(0, rgba(color, 0));
      fill.addColorStop(1, rgba(color, 0.18));
      ctx.beginPath();
      smoothPath(ctx, ring(0.12), true);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha *= 0.5;
      ctx.beginPath();
      smoothPath(ctx, ring(0.05), true);
      ctx.stroke();
      break;
    }
    case "waveform": {
      const n = 160,
        width = w * 0.78,
        amplitude = h * 0.18 * sensitivity;
      const points = Array.from({ length: n }, (_, i): [number, number] => {
        const value =
          waveform?.length && !idle
            ? (waveform[Math.floor((i / n) * waveform.length)] - 128) / 128
            : Math.sin(i / 6 + time * 2) * 0.02;
        return [-width / 2 + (i / (n - 1)) * width, value * amplitude];
      });
      ctx.globalAlpha *= 0.35;
      ctx.lineWidth = Math.max(4, 6 * unit);
      ctx.beginPath();
      smoothPath(ctx, points);
      ctx.stroke();
      ctx.globalAlpha = clip.opacity / 100;
      ctx.lineWidth = Math.max(1.5, 2 * unit);
      ctx.strokeStyle = lighten(color, 0.35);
      ctx.beginPath();
      smoothPath(ctx, points);
      ctx.stroke();
      break;
    }
    case "neon": {
      const n = 48,
        width = w * 0.78,
        maxHeight = h * 0.3 * sensitivity;
      const top = Array.from({ length: n }, (_, i): [number, number] => [
        -width / 2 + (i / (n - 1)) * width,
        -level(i, n) * maxHeight,
      ]);
      const gradient = ctx.createLinearGradient(
        0,
        -maxHeight,
        0,
        maxHeight * 0.5,
      );
      gradient.addColorStop(0, rgba(color, 0.45));
      gradient.addColorStop(0.66, rgba(color, 0.05));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.beginPath();
      smoothPath(ctx, top);
      ctx.lineTo(width / 2, 0);
      ctx.lineTo(-width / 2, 0);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.save();
      ctx.scale(1, -0.45);
      ctx.globalAlpha *= 0.3;
      ctx.beginPath();
      smoothPath(ctx, top);
      ctx.stroke();
      ctx.restore();
      ctx.shadowBlur = 26 * unit;
      ctx.lineWidth = Math.max(3, 4 * unit);
      ctx.beginPath();
      smoothPath(ctx, top);
      ctx.stroke();
      ctx.shadowBlur = 6 * unit;
      ctx.lineWidth = Math.max(1, 1.2 * unit);
      ctx.strokeStyle = lighten(color, 0.8);
      ctx.beginPath();
      smoothPath(ctx, top);
      ctx.stroke();
      break;
    }
    case "particles": {
      const maxRadius = Math.hypot(w, h) * 0.55;
      for (let i = 0; i < 72; i++) {
        const angle = hash(i) * Math.PI * 2,
          phase = (time * (0.04 + hash(i + 0.5) * 0.1) + hash(i + 0.3)) % 1,
          energy = level(i % 64, 64);
        const radius =
          phase * maxRadius +
          audio.beat * 0.06 * maxRadius * (hash(i + 0.9) + 0.5) * sensitivity;
        ctx.globalAlpha =
          (clip.opacity / 100) *
          Math.sin(phase * Math.PI) *
          (0.5 + 0.5 * energy);
        ctx.beginPath();
        ctx.arc(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
          (1.5 + energy * 4 * sensitivity + audio.beat * 3) * unit,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    }
    case "pulse": {
      const base = min * 0.09,
        radius =
          base * (1 + (audio.bass * 0.45 + audio.beat * 0.25) * sensitivity);
      const orb = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.6);
      orb.addColorStop(0, lighten(color, 0.85, 0.95));
      orb.addColorStop(0.45, rgba(color, 0.75));
      orb.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = orb;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.6, 0, Math.PI * 2);
      ctx.fill();
      if (Number.isFinite(audio.sinceBeat) && audio.sinceBeat < 1.2) {
        ctx.globalAlpha = (clip.opacity / 100) * (1 - audio.sinceBeat / 1.2);
        ctx.beginPath();
        ctx.arc(0, 0, radius + audio.sinceBeat * min * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 3; i++) {
        const phase = (time * 0.35 + i / 3) % 1;
        ctx.globalAlpha =
          (clip.opacity / 100) * (1 - phase) * 0.35 * (0.4 + audio.level);
        ctx.beginPath();
        ctx.arc(0, 0, radius * (1.2 + phase * 2.2), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    default: {
      const n = 64,
        total = w * 0.7,
        slot = total / n,
        width = slot * 0.72,
        maxHeight = h * 0.38 * sensitivity;
      const gradient = ctx.createLinearGradient(0, 0, 0, -maxHeight);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, lighten(color, 0.65));
      for (let i = 0; i < n; i++) {
        const x = -total / 2 + i * slot,
          height = Math.max(3 * unit, level(i, n) * maxHeight);
        ctx.fillStyle = gradient;
        bar(ctx, x, -height, width, height, 2 * unit);
        if (!idle) {
          ctx.fillStyle = lighten(color, 0.8, 0.9);
          ctx.fillRect(
            x,
            -Math.max(3 * unit, level(i, n, audio.peaks) * maxHeight) -
              4 * unit,
            width,
            2 * unit,
          );
        }
      }
    }
  }
  ctx.restore();
}

export function renderScene(
  canvas: HTMLCanvasElement,
  project: Project,
  assets: Asset[],
  time: number,
  audio: AudioFeatures = silent,
  waveform?: Uint8Array,
): void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas rendering is not supported.");
  const w = canvas.width,
    h = canvas.height,
    [baseW, baseH] = dimensions[project.aspect],
    unit = w / baseW;
  const kick = audio.bass * 0.35 + audio.beat * 0.65;
  const background = ctx.createLinearGradient(0, 0, w, h);
  background.addColorStop(0, "#171329");
  background.addColorStop(0.48, "#171721");
  background.addColorStop(1, "#101b22");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const active = (lane: Clip["lane"]) =>
    project.clips.filter(
      (clip) =>
        clip.lane === lane &&
        clip.visible &&
        time >= clip.start &&
        time <
          clip.start + (clip.isLyrics ? durationOf(project) : clip.duration),
    );
  for (const clip of [...active("video"), ...active("image")]) {
    const asset = assets.find((item) => item.id === clip.assetId);
    const source = asset?.element;
    if (
      !source ||
      (source instanceof HTMLVideoElement && source.readyState < 2) ||
      source instanceof HTMLAudioElement
    )
      continue;
    const iw =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source.naturalWidth;
    const ih =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source.naturalHeight;
    if (!iw || !ih) continue;
    ctx.save();
    ctx.globalAlpha = clip.opacity / 100;
    if (clip.motion && source instanceof HTMLImageElement) {
      const camera = cameraAt(
        clip.motion,
        time - clip.start + (clip.offset || 0),
      );
      if (clip.motion.look?.pulse) camera.zoom *= 1 + kick * 0.06;
      const crop = cameraCrop(camera, iw, ih, w, h);
      camera.cx -= ((clip.x / baseW - 0.5) * crop.width) / iw;
      camera.cy -= ((clip.y / baseH - 0.5) * crop.height) / ih;
      camera.zoom *= Math.max(0.1, clip.scale / 100);
      camera.rotation += clip.rotation;
      drawCamera(ctx, source, w, h, camera);
      const look = clip.motion.look;
      if (look?.dim) {
        ctx.fillStyle = "#0005";
        ctx.fillRect(0, 0, w, h);
      }
      if (look?.vignette) {
        const vignette = ctx.createRadialGradient(
          w / 2,
          h / 2,
          Math.min(w, h) * 0.2,
          w / 2,
          h / 2,
          Math.max(w, h) * 0.7,
        );
        vignette.addColorStop(0, "transparent");
        vignette.addColorStop(1, "#000b");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
      }
      if (look?.grain || look?.dust) {
        const frame = Math.floor(time * 24);
        if (look.grain) {
          ctx.fillStyle = "#ffffff22";
          for (let i = 0; i < 250; i++)
            ctx.fillRect(
              hash(i + frame * 251) * w,
              hash(i + 999 + frame * 251) * h,
              Math.max(1, unit),
              Math.max(1, h / baseH),
            );
        }
        if (look.dust) {
          ctx.fillStyle = "#ffffff55";
          for (let i = 0; i < 24; i++) {
            ctx.beginPath();
            ctx.arc(
              hash(i + 81) * w,
              ((hash(i + 244) + time * 0.004 * ((i % 3) + 1)) % 1) * h,
              (1 + hash(i + 17) * 2) * unit,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          }
        }
      }
    } else {
      let scale = (Math.max(w / iw, h / ih) * clip.scale) / 100;
      if (clip.animation === "zoom")
        scale *= 1 + 0.12 * Math.min(1, (time - clip.start) / clip.duration);
      if (clip.animation === "pulse") scale *= 1 + kick * 0.12;
      const float =
        clip.animation === "float"
          ? (Math.sin((time - clip.start) * 1.3) * h) / 72
          : 0;
      ctx.translate((clip.x / baseW) * w, (clip.y / baseH) * h + float);
      ctx.rotate((clip.rotation * Math.PI) / 180);
      ctx.drawImage(
        source,
        (-iw * scale) / 2,
        (-ih * scale) / 2,
        iw * scale,
        ih * scale,
      );
    }
    ctx.restore();
  }
  const effectClips = active("visualizer");
  effectClips
    .filter((clip) => isBeatEffect(clip.effect))
    .sort(
      (a, b) =>
        stage[a.effect as (typeof beatEffects)[number]] -
        stage[b.effect as (typeof beatEffects)[number]],
    )
    .forEach((clip) =>
      applyBeatEffect(
        ctx,
        clip,
        time,
        audio,
        (clip.x / baseW) * w,
        (clip.y / baseH) * h,
      ),
    );
  for (const clip of effectClips)
    if (!isBeatEffect(clip.effect))
      drawEqualizer(
        ctx,
        clip,
        clip.effect ?? "spectrum",
        time,
        audio,
        waveform,
        (clip.x / baseW) * w,
        (clip.y / baseH) * h,
        unit,
      );
  const cues = parseLyrics(project.lyrics),
    cue = activeCueAtTime(cues, time);
  for (const clip of active("text")) {
    const text = clip.isLyrics ? cue?.text : clip.name;
    if (!text) continue;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = (Math.max(20, w * 0.032) * clip.scale) / 100;
    ctx.font = `700 ${size}px sans-serif`;
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.strokeStyle = "#08080acc";
    ctx.fillStyle = project.lyricColor;
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 14 * unit;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const y =
        (clip.y / baseH) * h + (i - (lines.length - 1) / 2) * size * 1.25;
      ctx.strokeText(line, (clip.x / baseW) * w, y, w * 0.84);
      ctx.fillText(line, (clip.x / baseW) * w, y, w * 0.84);
      if (
        clip.isLyrics &&
        project.karaoke &&
        cue?.time !== null &&
        cue?.time !== undefined
      ) {
        const next = cues.find(
          (item) => item.time !== null && item.time > time,
        );
        const end = cue.endTime ?? next?.time ?? cue.time + 3;
        const progress = Math.max(
          0,
          Math.min(1, (time - cue.time) / Math.max(0.1, end - cue.time)),
        );
        const textWidth = Math.min(w * 0.84, ctx.measureText(line).width);
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          (clip.x / baseW) * w - textWidth / 2,
          y - size,
          textWidth * progress,
          size * 2,
        );
        ctx.clip();
        ctx.fillStyle = "#bba2ff";
        ctx.fillText(line, (clip.x / baseW) * w, y, w * 0.84);
        ctx.restore();
      }
    });
    ctx.restore();
  }
}
