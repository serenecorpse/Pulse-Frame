import type { AudioFeatures } from "./audio-features";

export const advancedEffects = [
  "plasma-orb",
  "particle-swarm",
  "wireframe-terrain",
  "liquid-ink",
  "kaleidoscope",
  "ribbon-tunnel",
  "polygon-shatter",
  "feedback-tunnel",
  "topographic-contours",
  "audio-silhouette",
] as const;
export type AdvancedEffect = (typeof advancedEffects)[number];

export interface AdvancedFrame {
  width: number;
  height: number;
  time: number;
  audio: AudioFeatures;
  sensitivity: number;
  color: string;
  unit: number;
  detail: number;
  speed: number;
  clipId: string;
}

export function isAdvancedEffect(
  value: string | undefined,
): value is AdvancedEffect {
  return advancedEffects.some((effect) => effect === value);
}
