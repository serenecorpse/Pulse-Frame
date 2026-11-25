import type { Clip } from "./project";

export function layoutLane(clips: Clip[], pixelsPerSecond: number): Clip[][] {
  const rows: Clip[][] = [];
  const ends: number[] = [];
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    const left = clip.start * pixelsPerSecond;
    let row = ends.findIndex((end) => end + 2 <= left);
    if (row < 0) {
      row = rows.length;
      rows.push([]);
      ends.push(0);
    }
    rows[row].push(clip);
    ends[row] = left + Math.max(38, clip.duration * pixelsPerSecond);
  }
  return rows.length ? rows : [[]];
}

export function editClipTiming(
  clip: Clip,
  mode: "move" | "start" | "end",
  delta: number,
  sourceDuration?: number,
): Pick<Clip, "start" | "duration" | "offset"> {
  const offset = clip.offset ?? 0;
  if (mode === "move")
    return {
      start: Math.max(0, clip.start + delta),
      duration: clip.duration,
      offset,
    };
  if (mode === "start") {
    const tracksSource =
      clip.lane === "audio" || clip.lane === "video" || !!clip.motion;
    const minimum = tracksSource ? Math.max(-clip.start, -offset) : -clip.start;
    const change = Math.min(clip.duration - 0.1, Math.max(minimum, delta));
    return {
      start: clip.start + change,
      duration: clip.duration - change,
      offset: tracksSource ? offset + change : offset,
    };
  }
  const media = clip.lane === "audio" || clip.lane === "video";
  const maximum = media
    ? Math.max(
        clip.duration,
        sourceDuration === undefined ? clip.duration : sourceDuration - offset,
      )
    : Infinity;
  return {
    start: clip.start,
    duration: Math.max(0.1, Math.min(maximum, clip.duration + delta)),
    offset,
  };
}

export function snapDelta(
  clip: Clip,
  mode: "move" | "start" | "end",
  delta: number,
  targets: number[],
  tolerance: number,
): number {
  const edges =
    mode === "move"
      ? [clip.start, clip.start + clip.duration]
      : [mode === "start" ? clip.start : clip.start + clip.duration];
  let best = delta,
    distance = tolerance;
  for (const edge of edges)
    for (const target of targets) {
      const adjusted = target - edge;
      const difference = Math.abs(adjusted - delta);
      if (difference < distance) {
        distance = difference;
        best = adjusted;
      }
    }
  return best;
}
