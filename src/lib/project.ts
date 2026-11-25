import type { Motion } from "./motion";

export type Lane = "audio" | "video" | "image" | "visualizer" | "text";
export type AssetType = "audio" | "video" | "image" | "lyrics" | "text";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export const equalizerEffects = ["spectrum", "mirror-bars", "radial-bars", "circular", "waveform", "neon", "particles", "pulse"] as const;
export const beatEffects = ["beat-zoom", "shake", "glitch", "rgb-split", "hue-shift", "color-flash", "strobe", "duotone", "invert-flash", "vhs", "bloom", "vignette-pulse", "mirror"] as const;
export type EffectType = typeof equalizerEffects[number] | typeof beatEffects[number];
export const allEffects: readonly EffectType[] = [...equalizerEffects, ...beatEffects];
export function isBeatEffect(effect: EffectType | undefined): boolean {
  return !!effect && (beatEffects as readonly string[]).includes(effect);
}
export interface AssetInfo { id: string; name: string; type: AssetType; size: number }
export interface Asset extends AssetInfo {
  url: string;
  duration: number;
  element?: HTMLImageElement | HTMLVideoElement | HTMLAudioElement;
}
export interface Clip {
  id: string;
  name: string;
  lane: Lane;
  assetId?: string;
  start: number;
  duration: number;
  offset?: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  animation: "none" | "pulse" | "float" | "zoom";
  effect?: EffectType;
  color?: string;
  sensitivity?: number;
  isLyrics?: boolean;
  motion?: Motion;
}
export interface Project {
  version: 1;
  name: string;
  aspect: Aspect;
  lyrics: string;
  karaoke: boolean;
  lyricColor: string;
  assets: AssetInfo[];
  clips: Clip[];
}

export const initialProject: Project = {
  version: 1, name: "Midnight memories", aspect: "16:9", lyrics: "",
  karaoke: true, lyricColor: "#ffffff", assets: [], clips: [],
};
export const dimensions: Record<Aspect, [number, number]> = {
  "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [900, 900], "4:5": [800, 1000],
};
export function durationOf(project: Project): number {
  return project.clips.length ? Math.max(10, ...project.clips.map(clip => clip.start + clip.duration)) : 30;
}
export function formatTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function classify(file: File): AssetType | null {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) return "image";
  if (file.type.startsWith("video/") || /\.(mp4|m4v|mov|mkv|webm|avi|mpeg|mpg)$/i.test(file.name)) return "video";
  if (file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return "audio";
  if (/\.lrc$|\.sbv$/i.test(file.name)) return "lyrics";
  if (/\.txt$/i.test(file.name)) return "text";
  return null;
}
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim() || "pulseframe";
}
