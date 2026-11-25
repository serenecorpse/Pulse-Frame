import type { AudioFeatures } from "./audio-features";
import type { StringInstrument } from "./project";

export interface StringNote {
  label: string;
  frequency: number;
  color: string;
}

export const instrumentStrings: Record<
  StringInstrument,
  readonly StringNote[]
> = {
  guitar: [
    { label: "E2", frequency: 82, color: "#ff6b6b" },
    { label: "A2", frequency: 110, color: "#ff9b6b" },
    { label: "D3", frequency: 147, color: "#ffd93d" },
    { label: "G3", frequency: 196, color: "#9bff6b" },
    { label: "B3", frequency: 247, color: "#6bcbef" },
    { label: "E4", frequency: 330, color: "#6b8bff" },
  ],
  veena: [
    { label: "Sa (low)", frequency: 98, color: "#ff6b6b" },
    { label: "Pa", frequency: 147, color: "#ffb36b" },
    { label: "Sa (mid)", frequency: 196, color: "#ffd93d" },
    { label: "Pa (high)", frequency: 294, color: "#9bff6b" },
  ],
  harp: Array.from({ length: 12 }, (_, i) => ({
    label: `S${i + 1}`,
    frequency: 110 * 2 ** (i / 12),
    color: [
      "#ff6b6b",
      "#ff8c6b",
      "#ffb36b",
      "#ffd93d",
      "#d4ed58",
      "#9bff6b",
      "#6be3aa",
      "#6bcbef",
      "#6b9bef",
      "#867bf5",
      "#c17bef",
      "#f07bc6",
    ][i],
  })),
};

/** Interpolates the same logarithmic frequency bands used by the equalizers. */
export function stringLevel(audio: AudioFeatures, frequency: number): number {
  const top = Math.min(16000, audio.sampleRate / 2);
  if (!audio.bands.length || frequency < 32 || frequency > top || top <= 32)
    return 0;
  const position = Math.max(
    0,
    Math.min(
      audio.bands.length - 1,
      (Math.log(frequency / 32) / Math.log(top / 32)) * audio.bands.length -
        0.5,
    ),
  );
  const index = Math.floor(position),
    fraction = position - index;
  return (
    audio.bands[index] * (1 - fraction) +
    audio.bands[Math.min(index + 1, audio.bands.length - 1)] * fraction
  );
}

export function stringDisplacement(position: number, phase: number): number {
  if (position <= 0 || position >= 1) return 0;
  return (
    Math.sin(Math.PI * position) *
    (0.8 * Math.sin(phase + position * 10) +
      0.2 * Math.sin(phase * 2 + position * 20))
  );
}
