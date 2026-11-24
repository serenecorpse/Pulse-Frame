export type Easing = "pchip" | "linear" | "hold" | "ease-in" | "ease-out" | "ease-in-out";
export type MotionPreset = "ken-burns" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "diagonal" | "orbit" | "dolly" | "reveal" | "detail-tour" | "handheld" | "breathing";
export type MotionParameter = "cx" | "cy" | "zoom" | "rotation";
export interface Keyframe { t: number; v: number }
export interface Motion {
  preset: MotionPreset;
  duration: number;
  easing: Easing;
  intensity: number;
  appliedIntensity: number;
  keyframes: Record<MotionParameter, Keyframe[]>;
  points: [number, number][];
  look?: Partial<Record<"dim" | "vignette" | "grain" | "dust" | "pulse", boolean>>;
}
export interface Camera { cx: number; cy: number; zoom: number; rotation: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
type ImageLevel = { image: HTMLImageElement | HTMLCanvasElement; scaleX: number; scaleY: number };
const pyramids = new WeakMap<HTMLImageElement, ImageLevel[]>();

function imageLevels(image: HTMLImageElement): ImageLevel[] {
  const cached = pyramids.get(image);
  if (cached) return cached;
  const levels: ImageLevel[] = [{ image, scaleX: 1, scaleY: 1 }];
  for (const scale of [2 / 3, 1 / 2]) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not allocate image pyramid.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    levels.push({ image: canvas, scaleX: canvas.width / image.naturalWidth, scaleY: canvas.height / image.naturalHeight });
  }
  pyramids.set(image, levels);
  return levels;
}

export function interpolateTrack(points: Keyframe[], time: number, easing: Easing): number {
  const sorted = points.filter(point => Number.isFinite(point.t) && Number.isFinite(point.v)).slice().sort((a, b) => a.t - b.t);
  const keys: Keyframe[] = [];
  for (const point of sorted) {
    if (keys.length && Math.abs(keys[keys.length - 1].t - point.t) < 1e-8) keys[keys.length - 1] = point;
    else keys.push(point);
  }
  if (!keys.length) return 0;
  if (time <= keys[0].t) return keys[0].v;
  if (time >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
  let index = 0;
  while (time > keys[index + 1].t) index++;
  const a = keys[index], b = keys[index + 1], duration = b.t - a.t;
  let t = (time - a.t) / duration;
  if (easing !== "pchip") {
    if (easing === "hold") t = 0;
    else if (easing === "ease-in") t *= t;
    else if (easing === "ease-out") t = 1 - (1 - t) ** 2;
    else if (easing === "ease-in-out") t = t * t * (3 - 2 * t);
    return a.v + (b.v - a.v) * t;
  }
  const slope = (prev: Keyframe, current: Keyframe, next: Keyframe) => {
    const leftWidth = current.t - prev.t, rightWidth = next.t - current.t;
    const left = (current.v - prev.v) / leftWidth, right = (next.v - current.v) / rightWidth;
    if (!left || !right || Math.sign(left) !== Math.sign(right)) return 0;
    const w1 = 2 * rightWidth + leftWidth, w2 = rightWidth + 2 * leftWidth;
    return (w1 + w2) / (w1 / left + w2 / right);
  };
  const slopeA = index === 0 ? (b.v - a.v) / duration : slope(keys[index - 1], a, b);
  const slopeB = index + 2 >= keys.length ? (b.v - a.v) / duration : slope(a, b, keys[index + 2]);
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a.v + (t ** 3 - 2 * t ** 2 + t) * duration * slopeA
    + (-2 * t ** 3 + 3 * t ** 2) * b.v + (t ** 3 - t ** 2) * duration * slopeB;
}

export function buildPreset(preset: MotionPreset, duration: number, intensity: number, points: [number, number][] = []): Motion {
  const d = Math.max(0.1, duration), a = clamp(intensity / 0.65, 0, 2);
  type Step = [number, number, number, number, number];
  let path: Step[];
  switch (preset) {
    case "pan-left": path = [[0, .57, .5, 1.34, 0], [d, .43, .5, 1.34, 0]]; break;
    case "pan-right": path = [[0, .43, .5, 1.34, 0], [d, .57, .5, 1.34, 0]]; break;
    case "pan-up": path = [[0, .5, .57, 1.34, 0], [d, .5, .43, 1.34, 0]]; break;
    case "pan-down": path = [[0, .5, .43, 1.34, 0], [d, .5, .57, 1.34, 0]]; break;
    case "diagonal": path = [[0, .43, .43, 1.3, 0], [d, .57, .57, 1.3, 0]]; break;
    case "dolly": path = [[0, .47, .5, 1.65, 0], [d, .53, .5, 1.08, 0]]; break;
    case "reveal": path = [[0, .5, .5, 2.2, 0], [d, .5, .5, 1, 0]]; break;
    case "orbit": path = Array.from({ length: 17 }, (_, i) => [d * i / 16, .5 + Math.cos(i / 16 * Math.PI * 2) * .035 * a, .5 + Math.sin(i / 16 * Math.PI * 2) * .035 * a, 1.14, 0]); break;
    case "breathing": path = Array.from({ length: 9 }, (_, i) => [d * i / 8, .5, .5, 1.12 + .045 * a * (.5 - .5 * Math.cos(i / 8 * Math.PI * 4)), 0]); break;
    case "handheld": path = [[0, .5, .5, 1.12, 0], [d, .5, .5, 1.12, 0]]; break;
    case "detail-tour": {
      const tour = (points.length ? points : [[.35, .4], [.65, .4], [.62, .63]] as [number, number][]).slice(0, 12);
      path = [[0, tour[0][0], tour[0][1], 1.85, 0], ...tour.map((point, index): Step => [d * (index + 1) / tour.length, point[0], point[1], 1.85, 0])];
      break;
    }
    default: path = [[0, .47, .53, 1, 0], [d, .54, .47, 1 + .32 * a, 0]];
  }
  const keyframes: Motion["keyframes"] = { cx: [], cy: [], zoom: [], rotation: [] };
  for (const [t, cx, cy, zoom, rotation] of path) {
    keyframes.cx.push({ t, v: clamp(cx, 0, 1) });
    keyframes.cy.push({ t, v: clamp(cy, 0, 1) });
    keyframes.zoom.push({ t, v: Math.log(Math.max(1, zoom)) });
    keyframes.rotation.push({ t, v: rotation });
  }
  return { preset, duration: d, easing: "pchip", intensity, appliedIntensity: intensity || .65, keyframes, points };
}

export function cameraAt(motion: Motion, time: number): Camera {
  const t = clamp(time, 0, motion.duration), ratio = clamp(motion.intensity / Math.max(.001, motion.appliedIntensity), 0, 2);
  let cx = .5 + (interpolateTrack(motion.keyframes.cx, t, motion.easing) - .5) * ratio;
  let cy = .5 + (interpolateTrack(motion.keyframes.cy, t, motion.easing) - .5) * ratio;
  if (motion.preset === "handheld") {
    cx += (Math.sin(t * 2.2) + .42 * Math.sin(t * 3.4 + 1.1)) * .008 * ratio;
    cy += (Math.sin(t * 2.8 + .4) + .3 * Math.sin(t * 3.1)) * .007 * ratio;
  }
  return { cx: clamp(cx, 0, 1), cy: clamp(cy, 0, 1), zoom: Math.max(1, Math.exp(interpolateTrack(motion.keyframes.zoom, t, motion.easing) * ratio)), rotation: interpolateTrack(motion.keyframes.rotation, t, motion.easing) * ratio };
}

export function cameraCrop(camera: Camera, iw: number, ih: number, width: number, height: number) {
  const aspect = width / height;
  const radians = camera.rotation * Math.PI / 180, c = Math.abs(Math.cos(radians)), s = Math.abs(Math.sin(radians));
  const coverage = Math.max(c + s / aspect, c + s * aspect);
  const cropWidth = Math.min(iw, (iw / ih > aspect ? ih * aspect : iw) / (Math.max(1, camera.zoom) * coverage));
  const cropHeight = Math.min(ih, (iw / ih > aspect ? ih : iw / aspect) / (Math.max(1, camera.zoom) * coverage));
  const x = clamp(camera.cx, cropWidth / (2 * iw), 1 - cropWidth / (2 * iw)) * iw - cropWidth / 2;
  const y = clamp(camera.cy, cropHeight / (2 * ih), 1 - cropHeight / (2 * ih)) * ih - cropHeight / 2;
  return { x, y, width: cropWidth, height: cropHeight };
}

export function drawCamera(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, camera: Camera): void {
  const { x, y, width: cropWidth, height: cropHeight } = cameraCrop(camera, image.naturalWidth, image.naturalHeight, width, height);
  const radians = camera.rotation * Math.PI / 180;
  const idealX = width / cropWidth, idealY = height / cropHeight;
  const levels = imageLevels(image);
  const level = levels.reduce((best, candidate) => {
    const distance = Math.abs(Math.log(candidate.scaleX / idealX)) + Math.abs(Math.log(candidate.scaleY / idealY));
    return distance < best.distance ? { level: candidate, distance } : best;
  }, { level: levels[0], distance: Infinity }).level;
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.drawImage(level.image, x * level.scaleX, y * level.scaleY, cropWidth * level.scaleX, cropHeight * level.scaleY, -width / 2, -height / 2, width, height);
  context.restore();
}
