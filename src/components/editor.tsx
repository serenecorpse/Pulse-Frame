"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { buildPreset, cameraAt, cameraCrop, interpolateTrack, type Easing, type MotionPreset } from "@/lib/motion";
import { allEffects, beatEffects, classify, dimensions, download, durationOf, equalizerEffects, formatTime, initialProject, isBeatEffect, safeName, type Aspect, type Asset, type AssetInfo, type Clip, type EffectType, type Lane, type Project } from "@/lib/project";
import { renderScene } from "@/lib/render";
import { BeatTracker } from "@/lib/audio-features";
import { verifyVideo } from "@/lib/video";
import { extractAudio } from "@/lib/extract-audio";
import Upscaler from "./upscaler";
import MotionGraph from "./motion-graph";

type Panel = "media" | "effects" | "text" | "motion" | "upscale";
const panels: { id: Panel; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "◈" }, { id: "effects", label: "Effects", icon: "✳" },
  { id: "text", label: "Text", icon: "T" }, { id: "motion", label: "Motion", icon: "◉" },
  { id: "upscale", label: "Upscale", icon: "⇧" },
];
const presets: MotionPreset[] = ["ken-burns", "pan-left", "pan-right", "pan-up", "pan-down", "diagonal", "orbit", "dolly", "reveal", "detail-tour", "handheld", "breathing"];
const effectInfo: Record<EffectType, { icon: string; description: string; color: string }> = {
  "spectrum": { icon: "▁▃▆▃", description: "Frequency bars with falling peak caps", color: "#a78bfa" },
  "mirror-bars": { icon: "▃█▃", description: "Bars mirrored around a center line", color: "#7dd3fc" },
  "radial-bars": { icon: "✺", description: "Bars radiating from a rotating ring", color: "#f0abfc" },
  "circular": { icon: "◯", description: "Smooth ring that bulges with the spectrum", color: "#a78bfa" },
  "waveform": { icon: "∿", description: "Oscilloscope trace of the audio signal", color: "#6ee7b7" },
  "neon": { icon: "⌇", description: "Glowing spectrum curve with reflection", color: "#22d3ee" },
  "particles": { icon: "⁘", description: "Particles that burst outward on beats", color: "#c4b5fd" },
  "pulse": { icon: "◉", description: "Bass-driven orb with beat shock rings", color: "#fb7185" },
  "beat-zoom": { icon: "⤢", description: "Punches the image in on every kick", color: "#a78bfa" },
  "shake": { icon: "≋", description: "Camera vibration driven by beats and bass", color: "#a78bfa" },
  "glitch": { icon: "▚", description: "Slice displacement and color tearing on beats", color: "#35f0ff" },
  "rgb-split": { icon: "◐", description: "Chromatic aberration that widens on beats", color: "#a78bfa" },
  "hue-shift": { icon: "◑", description: "Cycles colors over time and jumps on beats", color: "#a78bfa" },
  "color-flash": { icon: "✦", description: "Soft wash of the effect color on beats", color: "#ff4fd8" },
  "strobe": { icon: "☼", description: "Hard flash on alternate beats. May affect photosensitive viewers.", color: "#ffffff" },
  "duotone": { icon: "◧", description: "Two-tone color grade that breathes with bass", color: "#ffb347" },
  "invert-flash": { icon: "◩", description: "Inverts colors on alternate beats. May affect photosensitive viewers.", color: "#ffffff" },
  "vhs": { icon: "▤", description: "Scanlines, tracking jitter, and color bleed", color: "#a78bfa" },
  "bloom": { icon: "✹", description: "Highlight glow that swells with the music", color: "#a78bfa" },
  "vignette-pulse": { icon: "◎", description: "Edges darken and close in on beats", color: "#3b0764" },
  "mirror": { icon: "⫴", description: "Mirrors the left half of the frame", color: "#a78bfa" },
};
const exportFormats = [
  { name: "WebM · VP9", mime: "video/webm;codecs=vp9,opus", extension: "webm" },
  { name: "WebM · VP8", mime: "video/webm;codecs=vp8,opus", extension: "webm" },
  { name: "MP4 · H.264", mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4" },
];
const lanes: Lane[] = ["video", "image", "visualizer", "text", "audio"];
const pretty = (value: string) => value.replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());
const storageKey = "pulseframe-project";

function readProject(value: unknown): Project {
  if (!value || typeof value !== "object") throw new Error("This is not a valid Pulseframe project.");
  const project = value as Record<string, unknown>;
  if (!Array.isArray(project.clips) || !Array.isArray(project.assets)) throw new Error("This project is missing its clips or media list.");
  const aspect: Aspect = typeof project.aspect === "string" && project.aspect in dimensions ? project.aspect as Aspect : "16:9";
  const [width, height] = dimensions[aspect];
  const number = (input: unknown, fallback: number) => typeof input === "number" && Number.isFinite(input) ? input : fallback;
  const savedEffects = Array.isArray(project.effects) ? project.effects : [];
  const assets: AssetInfo[] = project.assets.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("The project contains an invalid media entry.");
    const asset = item as Record<string, unknown>;
    if (typeof asset.id !== "string" || typeof asset.name !== "string" || !["audio", "video", "image", "lyrics", "text"].includes(String(asset.type))) throw new Error("The project contains an invalid media entry.");
    return { id: asset.id, name: asset.name, type: asset.type as AssetInfo["type"], size: number(asset.size, 0) };
  });
  const clips: Clip[] = project.clips.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("The project contains an invalid clip.");
    const saved = item as Record<string, unknown>;
    if (typeof saved.id !== "string" || !lanes.includes(saved.lane as Lane)) throw new Error("The project contains an invalid clip.");
    const effect = savedEffects.find((entry: unknown) => entry && typeof entry === "object" && (entry as Record<string, unknown>).id === saved.id) as Record<string, unknown> | undefined;
    const animation: Clip["animation"] = ["none", "pulse", "float", "zoom"].includes(String(saved.animation)) ? saved.animation as Clip["animation"] : "none";
    const effectName = saved.effect ?? effect?.type;
    const clip: Clip = {
      id: saved.id, name: typeof saved.name === "string" ? saved.name : "Layer", lane: saved.lane as Lane,
      assetId: typeof saved.assetId === "string" ? saved.assetId : undefined,
      start: Math.max(0, number(saved.start, 0)), duration: Math.max(.1, number(saved.duration, 10)),
      offset: Math.max(0, number(saved.offset, 0)),
      x: number(saved.x, width / 2), y: number(saved.y, height / 2), scale: number(saved.scale, 100),
      rotation: number(saved.rotation, 0), opacity: number(saved.opacity, 100), visible: saved.visible !== false, animation,
      effect: allEffects.includes(effectName as EffectType) ? effectName as EffectType : undefined,
      color: typeof (saved.color ?? effect?.color) === "string" ? (saved.color ?? effect?.color) as string : undefined,
      sensitivity: number(saved.sensitivity ?? effect?.sensitivity, 70), isLyrics: saved.isLyrics === true,
    };
    if (!Number.isFinite(clip.start + clip.duration)) throw new Error(`Invalid timing on ${clip.name}.`);
    if (saved.motion !== undefined) {
      if (!saved.motion || typeof saved.motion !== "object") throw new Error(`Invalid motion on ${clip.name}.`);
      const motion = saved.motion as Record<string, unknown>;
      if (!motion.keyframes || typeof motion.keyframes !== "object") throw new Error(`Invalid keyframes on ${clip.name}.`);
      const tracks = motion.keyframes as Record<string, unknown>;
      const preset = presets.includes(motion.preset as MotionPreset) ? motion.preset as MotionPreset : "ken-burns";
      const parsed = buildPreset(preset, Math.max(.1, number(motion.duration, clip.duration)), number(motion.intensity, .65));
      for (const key of ["cx", "cy", "zoom", "rotation"] as const) {
        const track = tracks[key];
        if (!Array.isArray(track)) throw new Error(`Invalid ${key} keyframes on ${clip.name}.`);
        parsed.keyframes[key] = track.map((entry: unknown) => {
          if (!entry || typeof entry !== "object") throw new Error(`Invalid ${key} keyframes on ${clip.name}.`);
          const point = entry as Record<string, unknown>;
          if (typeof point.t !== "number" || !Number.isFinite(point.t) || typeof point.v !== "number" || !Number.isFinite(point.v)) throw new Error(`Invalid ${key} keyframes on ${clip.name}.`);
          return { t: point.t, v: point.v };
        });
      }
      if (["pchip", "linear", "hold", "ease-in", "ease-out", "ease-in-out"].includes(String(motion.easing))) parsed.easing = motion.easing as Easing;
      parsed.appliedIntensity = number(motion.appliedIntensity, parsed.intensity || .65);
      if (Array.isArray(motion.points)) parsed.points = motion.points.filter((point: unknown): point is [number, number] => Array.isArray(point) && point.length === 2 && point.every(value => typeof value === "number" && Number.isFinite(value)));
      if (motion.look && typeof motion.look === "object") {
        const look = motion.look as Record<string, unknown>;
        parsed.look = { dim: look.dim === true, vignette: look.vignette === true, grain: look.grain === true, dust: look.dust === true, pulse: look.pulse === true };
      }
      clip.motion = parsed;
    }
    return clip;
  });
  return {
    version: 1, name: typeof project.name === "string" ? project.name : "Untitled project", aspect,
    lyrics: typeof project.lyrics === "string" ? project.lyrics : "",
    karaoke: project.karaoke !== false, lyricColor: typeof project.lyricColor === "string" ? project.lyricColor : "#ffffff",
    assets, clips,
  };
}

async function loadAsset(file: File, id: string): Promise<Asset> {
  const type = classify(file);
  if (!type) throw new Error(`${file.name}: unsupported file type.`);
  const url = URL.createObjectURL(file);
  const asset: Asset = { id, name: file.name, type, size: file.size, url, duration: 0 };
  try {
    if (type === "image") {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error("Image exceeds the 8K limit.");
      asset.element = image; asset.duration = 30;
    } else if (type === "video" || type === "audio") {
      const element = document.createElement(type);
      element.preload = "auto"; element.src = url;
      await new Promise<void>((resolve, reject) => {
        element.onloadedmetadata = () => resolve();
        element.onerror = () => reject(new Error("The browser could not decode this file."));
      });
      if (!Number.isFinite(element.duration) || element.duration <= 0) throw new Error("The browser could not read the media duration.");
      asset.element = element; asset.duration = element.duration;
    }
    return asset;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(`${file.name}: ${error instanceof Error ? error.message : "Could not load file."}`);
  }
}

function makeClip(asset: Asset, aspect: Aspect, time = 0): Clip {
  const [width, height] = dimensions[aspect];
  return { id: crypto.randomUUID(), assetId: asset.id, name: asset.name, lane: asset.type as Lane, start: time,
    duration: asset.duration || 10, x: width / 2, y: height / 2, scale: 100, rotation: 0, opacity: 100,
    visible: true, animation: "none" };
}

export default function Editor() {
  const [project, setProject] = useState<Project>(initialProject);
  const [assets, setAssets] = useState<Asset[]>([]);
  const projectRef = useRef(project), assetsRef = useRef(assets);
  const canvasRef = useRef<HTMLCanvasElement>(null), stageRef = useRef<HTMLDivElement>(null), inputRef = useRef<HTMLInputElement>(null), projectInputRef = useRef<HTMLInputElement>(null);
  const audioContext = useRef<AudioContext | null>(null), analyser = useRef<AnalyserNode | null>(null), destination = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sources = useRef(new Map<string, MediaElementAudioSourceNode>());
  const timeRef = useRef(0), frameRef = useRef(0), playingRef = useRef(false), exportRef = useRef<MediaRecorder | null>(null);
  const cancelExportRef = useRef<(() => void) | null>(null);
  const extractionRef = useRef<AbortController | null>(null);
  const guideDrag = useRef<{ id: string; frame: "start" | "end"; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<Panel>("media"), [selected, setSelected] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0), [playing, setPlaying] = useState(false), [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(.8), [muted, setMuted] = useState(false);
  const [filter, setFilter] = useState("all"), [zoom, setZoom] = useState(80);
  const [preset, setPreset] = useState<MotionPreset>("ken-burns"), [easing, setEasing] = useState<Easing>("pchip");
  const [guides, setGuides] = useState(true);
  const [motionDuration, setMotionDuration] = useState(12), [intensity, setIntensity] = useState(.65);
  const [ready, setReady] = useState(false), [saveStatus, setSaveStatus] = useState("All changes saved");
  const [autosaveBlocked, setAutosaveBlocked] = useState(false);
  const [message, setMessage] = useState(""), [exporting, setExporting] = useState(false), [exportProgress, setExportProgress] = useState(0);
  const [quality, setQuality] = useState(1080), [fps, setFps] = useState(30);
  const [exportFormat, setExportFormat] = useState(exportFormats[0].mime), [supportedFormats, setSupportedFormats] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [extraction, setExtraction] = useState<{ name: string; progress: number } | null>(null);
  const undo = useRef<Project[]>([]), redo = useRef<Project[]>([]);
  const [beatTracker] = useState(() => new BeatTracker());
  const duration = durationOf(project), clip = project.clips.find(item => item.id === selected);
  const pixelsPerSecond = Math.min(zoom / 10, 30000000 / duration);
  const timelineWidth = Math.max(900, duration * pixelsPerSecond);
  const tickInterval = Math.max(5, Math.ceil(duration / 2500) * 5);

  const notify = useCallback((text: string) => { setMessage(text); }, []);
  const update = useCallback((next: Project, history = true) => {
    if (history) { undo.current = [...undo.current.slice(-34), projectRef.current]; redo.current = []; }
    projectRef.current = next;
    setProject(next);
  }, []);
  const updateClip = useCallback((id: string, patch: Partial<Clip>, history = true) => {
    update({ ...projectRef.current, clips: projectRef.current.clips.map(item => item.id === id ? { ...item, ...patch } : item) }, history);
  }, [update]);
  const goTo = useCallback((seconds: number) => {
    timeRef.current = Math.max(0, Math.min(durationOf(projectRef.current), seconds));
    setCurrentTime(timeRef.current);
    for (const asset of assetsRef.current) {
      if (!(asset.element instanceof HTMLMediaElement)) continue;
      const active = projectRef.current.clips.find(item => item.assetId === asset.id && timeRef.current >= item.start && timeRef.current < item.start + item.duration);
      if (active && Number.isFinite(asset.element.duration)) asset.element.currentTime = Math.min(asset.element.duration, Math.max(0, timeRef.current - active.start + (active.offset || 0)));
    }
  }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const restored = readProject(JSON.parse(saved));
        projectRef.current = restored; setProject(restored);
        if (restored.assets.length) notify("Re-import this project's media files to restore its saved clips.");
      }
    } catch (error) { setAutosaveBlocked(true); notify(`Saved project could not be loaded; autosave is paused to protect it: ${error instanceof Error ? error.message : "invalid data"}`); }
    setReady(true);
    const supported = exportFormats.filter(format => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(format.mime));
    setSupportedFormats(supported.map(format => format.mime));
    if (supported.length) setExportFormat(supported[0].mime);
    return () => {
      cancelAnimationFrame(frameRef.current);
      assetsRef.current.forEach(asset => URL.revokeObjectURL(asset.url));
      extractionRef.current?.abort();
      cancelExportRef.current?.();
      void audioContext.current?.close();
    };
  }, [notify]);
  useEffect(() => {
    if (!ready) return;
    if (autosaveBlocked) { setSaveStatus("Autosave paused"); return; }
    setSaveStatus("Unsaved changes");
    const timer = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(project)); setSaveStatus("All changes saved"); }
      catch { setSaveStatus("Autosave failed"); notify("Project settings could not be autosaved. Save a project file to keep your work."); }
    }, 1000);
    return () => clearTimeout(timer);
  }, [project, ready, autosaveBlocked, notify]);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => {
    const motion = projectRef.current.clips.find(item => item.id === selected)?.motion;
    if (motion) { setPreset(motion.preset); setEasing(motion.easing); setMotionDuration(motion.duration); setIntensity(motion.intensity); }
  }, [selected]);

  const connectAudio = useCallback(async () => {
    if (!audioContext.current) {
      const context = new AudioContext();
      audioContext.current = context;
      analyser.current = context.createAnalyser();
      analyser.current.fftSize = 2048;
      analyser.current.smoothingTimeConstant = .5;
      destination.current = context.createMediaStreamDestination();
      analyser.current.connect(context.destination);
      analyser.current.connect(destination.current);
    }
    if (audioContext.current.state === "suspended") await audioContext.current.resume();
    for (const asset of assetsRef.current) {
      if (asset.element instanceof HTMLMediaElement && !sources.current.has(asset.id)) {
        const source = audioContext.current.createMediaElementSource(asset.element);
        source.connect(analyser.current!); sources.current.set(asset.id, source);
      }
    }
  }, []);
  useEffect(() => {
    if (!audioContext.current) return;
    void connectAudio().catch(error => notify(`Could not connect audio: ${error instanceof Error ? error.message : "unknown error"}`));
  }, [assets, connectAudio, notify]);
  const syncMedia = useCallback((time: number, running: boolean) => {
    const p = projectRef.current;
    const hasAudio = p.clips.some(item => item.lane === "audio" && time >= item.start && time < item.start + item.duration && assetsRef.current.some(asset => asset.id === item.assetId));
    for (const asset of assetsRef.current) {
      const media = asset.element;
      if (!(media instanceof HTMLMediaElement)) continue;
      const active = p.clips.find(item => item.assetId === asset.id && item.visible && time >= item.start && time < item.start + item.duration);
      media.volume = muted ? 0 : volume;
      media.muted = muted || (asset.type === "video" && hasAudio);
      if (!active || !running || time - active.start + (active.offset || 0) >= media.duration) { if (!media.paused) media.pause(); continue; }
      const desired = Math.max(0, time - active.start + (active.offset || 0));
      if (Math.abs(media.currentTime - desired) > .25) media.currentTime = desired;
      if (media.paused) void media.play().catch(error => notify(`Could not play ${asset.name}: ${error.message}`));
    }
  }, [muted, volume, notify]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready || exporting) return;
    let previous = performance.now();
    const draw = (now: number) => {
      if (playingRef.current) {
        timeRef.current += (now - previous) / 1000;
        if (timeRef.current >= durationOf(projectRef.current)) {
          if (loop) timeRef.current = 0;
          else { timeRef.current = durationOf(projectRef.current); playingRef.current = false; setPlaying(false); }
        }
        setCurrentTime(timeRef.current);
      }
      const elapsed = (now - previous) / 1000;
      previous = now;
      syncMedia(timeRef.current, playingRef.current);
      let data: Uint8Array | undefined, waveform: Uint8Array | undefined;
      if (analyser.current) { const samples = new Uint8Array(analyser.current.frequencyBinCount), timeSamples = new Uint8Array(analyser.current.fftSize); analyser.current.getByteFrequencyData(samples); analyser.current.getByteTimeDomainData(timeSamples); data = samples; waveform = timeSamples; }
      const features = beatTracker.update(data, audioContext.current?.sampleRate ?? 48000, elapsed);
      try { renderScene(canvas, projectRef.current, assetsRef.current, timeRef.current, features, waveform); }
      catch (error) { playingRef.current = false; setPlaying(false); notify(`Preview failed: ${error instanceof Error ? error.message : "rendering error"}`); return; }
      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [ready, loop, syncMedia, exporting, beatTracker]);

  const importFiles = async (files: FileList | File[]) => {
    let success = true;
    for (const file of Array.from(files)) {
      const type = classify(file);
      if (!type) { success = false; notify(`${file.name}: unsupported file type.`); continue; }
      const existing = projectRef.current.assets.find(item => item.name === file.name && item.type === type && !assetsRef.current.some(asset => asset.id === item.id));
      try {
        const asset = await loadAsset(file, existing?.id || crypto.randomUUID());
        if (type === "image") asset.duration = durationOf(projectRef.current);
        let text: string | null = null;
        if (type === "text" || type === "lyrics") {
          try { text = await file.text(); }
          catch (error) { URL.revokeObjectURL(asset.url); throw error; }
        }
        const nextAssets = [...assetsRef.current, asset];
        assetsRef.current = nextAssets; setAssets(nextAssets);
        const info: AssetInfo = { id: asset.id, name: asset.name, type: asset.type, size: asset.size };
        const p = projectRef.current;
        let next: Project = { ...p, assets: existing ? p.assets : [...p.assets, info] };
        if (type === "text" || type === "lyrics") {
          const [w, h] = dimensions[p.aspect];
          const lyricsClip = p.clips.find(item => item.isLyrics);
          next = { ...next, lyrics: text ?? "", clips: lyricsClip ? p.clips : [...p.clips, { id: crypto.randomUUID(), name: "Lyrics", lane: "text", start: 0, duration: durationOf(p), x: w / 2, y: h * .84, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none", isLyrics: true }] };
          setPanel("text");
        } else if (!p.clips.some(item => item.assetId === asset.id)) {
          next.clips = [...p.clips, makeClip(asset, p.aspect)];
        }
        update(next);
      } catch (error) { success = false; notify(error instanceof Error ? error.message : `Could not import ${file.name}.`); }
    }
    return success;
  };
  const removeAsset = (id: string) => {
    const asset = assetsRef.current.find(item => item.id === id);
    if (asset) { if (asset.element instanceof HTMLMediaElement) asset.element.pause(); URL.revokeObjectURL(asset.url); }
    sources.current.get(id)?.disconnect(); sources.current.delete(id);
    const nextAssets = assetsRef.current.filter(item => item.id !== id);
    assetsRef.current = nextAssets; setAssets(nextAssets);
    update({ ...projectRef.current, assets: projectRef.current.assets.filter(item => item.id !== id), clips: projectRef.current.clips.filter(item => item.assetId !== id) });
    setSelected(null);
  };
  const extract = async (asset: Asset) => {
    if (extractionRef.current) return;
    const controller = new AbortController();
    extractionRef.current = controller;
    setExtraction({ name: asset.name, progress: 0 });
    try {
      const blob = await extractAudio(asset.url, controller.signal, progress => setExtraction({ name: asset.name, progress }));
      const name = `${safeName(asset.name.replace(/\.[^.]+$/, ""))}.wav`;
      download(blob, name);
      const imported = await importFiles([new File([blob], name, { type: "audio/wav" })]);
      if (imported) notify("WAV extracted and added to your project.");
      else notify("WAV downloaded, but could not be added to the project.");
    } catch (error) {
      notify(error instanceof DOMException && error.name === "AbortError" ? "Audio extraction cancelled." : `Audio extraction failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally { extractionRef.current = null; setExtraction(null); }
  };
  const changeAspect = (aspect: Aspect) => {
    const [oldW, oldH] = dimensions[projectRef.current.aspect], [w, h] = dimensions[aspect];
    update({ ...projectRef.current, aspect, clips: projectRef.current.clips.map(item => ({ ...item, x: item.x / oldW * w, y: item.y / oldH * h })) });
  };
  const moveGuide = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = guideDrag.current;
    const active = projectRef.current.clips.find(item => item.id === drag?.id);
    const image = assetsRef.current.find(asset => asset.id === active?.assetId)?.element;
    const stage = canvasRef.current?.parentElement;
    if (!drag || !active?.motion || !(image instanceof HTMLImageElement) || !stage) return;
    const motion = structuredClone(active.motion), time = drag.frame === "start" ? 0 : motion.duration;
    const camera = cameraAt(motion, time), [width, height] = dimensions[projectRef.current.aspect];
    const crop = cameraCrop(camera, image.naturalWidth, image.naturalHeight, width, height), rect = stage.getBoundingClientRect();
    const ratio = motion.intensity / Math.max(.001, motion.appliedIntensity);
    if (ratio <= .001) { notify("Increase motion intensity before dragging the guide."); return; }
    const dx = (event.clientX - drag.x) / rect.width * crop.width / image.naturalWidth / ratio;
    const dy = (event.clientY - drag.y) / rect.height * crop.height / image.naturalHeight / ratio;
    for (const [parameter, delta] of [["cx", dx], ["cy", dy]] as const) {
      const points = motion.keyframes[parameter], existing = points.find(point => Math.abs(point.t - time) < .001);
      const value = Math.max(0, Math.min(1, interpolateTrack(points, time, motion.easing) + delta));
      if (existing) existing.v = value; else points.push({ t: time, v: value });
    }
    drag.x = event.clientX; drag.y = event.clientY;
    updateClip(active.id, { motion }, false);
  };
  const play = useCallback(async () => {
    if (playingRef.current) { playingRef.current = false; setPlaying(false); return; }
    try { await connectAudio(); }
    catch (error) { notify(`Audio initialization failed: ${error instanceof Error ? error.message : "unknown error"}`); return; }
    if (timeRef.current >= durationOf(projectRef.current)) goTo(0);
    playingRef.current = true; setPlaying(true);
  }, [connectAudio, goTo, notify]);
  const addEffect = (effect: EffectType) => {
    const [w, h] = dimensions[project.aspect], id = crypto.randomUUID();
    const lowered = effect === "spectrum" || effect === "waveform" || effect === "neon";
    const item: Clip = { id, name: pretty(effect), lane: "visualizer", start: currentTime, duration: Math.max(8, duration - currentTime), x: w / 2, y: lowered ? h * .76 : h / 2, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none", effect, color: effectInfo[effect].color, sensitivity: 70 };
    update({ ...project, clips: [...project.clips, item] }); setSelected(id);
  };
  const updateLyrics = (text: string) => {
    const p = projectRef.current, existing = p.clips.find(item => item.isLyrics), [w, h] = dimensions[p.aspect];
    let clips = p.clips;
    if (!text.trim()) clips = clips.filter(item => !item.isLyrics);
    else if (!existing) clips = [...clips, { id: crypto.randomUUID(), name: "Lyrics", lane: "text", start: 0, duration: durationOf(p), x: w / 2, y: h * .84, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none", isLyrics: true }];
    update({ ...p, lyrics: text, clips });
  };
  const save = () => { download(new Blob([JSON.stringify(projectRef.current, null, 2)], { type: "application/json" }), `${safeName(project.name)}.pulseframe.json`); notify("Project configuration downloaded."); };
  const undoChange = () => { const previous = undo.current.pop(); if (previous) { redo.current.push(projectRef.current); update(previous, false); } };
  const redoChange = () => { const next = redo.current.pop(); if (next) { undo.current.push(projectRef.current); update(next, false); } };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        const current = projectRef.current;
        download(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }), `${safeName(current.name)}.pulseframe.json`);
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches("input,textarea,select") || target.isContentEditable)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        const previous = event.shiftKey ? redo.current.pop() : undo.current.pop();
        if (previous) { (event.shiftKey ? undo.current : redo.current).push(projectRef.current); update(previous, false); }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); const next = redo.current.pop(); if (next) { undo.current.push(projectRef.current); update(next, false); }
      } else if (event.code === "Space" && !exportRef.current) { event.preventDefault(); void play(); }
      else if (event.code === "ArrowLeft") { event.preventDefault(); goTo(timeRef.current - (event.shiftKey ? 1 : .1)); }
      else if (event.code === "ArrowRight") { event.preventDefault(); goTo(timeRef.current + (event.shiftKey ? 1 : .1)); }
      else if ((event.code === "Delete" || event.code === "Backspace") && selected) {
        event.preventDefault(); update({ ...projectRef.current, clips: projectRef.current.clips.filter(item => item.id !== selected) }); setSelected(null);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [selected, play, goTo, update]);
  const openProject = async (file: File) => {
    try {
      const next = readProject(JSON.parse(await file.text()));
      playingRef.current = false; setPlaying(false);
      assetsRef.current.forEach(asset => { if (asset.element instanceof HTMLMediaElement) asset.element.pause(); URL.revokeObjectURL(asset.url); });
      sources.current.forEach(source => source.disconnect()); sources.current.clear();
      assetsRef.current = []; setAssets([]); update(next); setAutosaveBlocked(false); setSelected(null); goTo(0);
      if (next.assets.length) notify("Project opened. Re-import its media files to restore the saved clips.");
    } catch (error) { notify(`Could not open project: ${error instanceof Error ? error.message : "invalid file"}`); }
  };
  const startExport = async () => {
    if (!projectRef.current.clips.length || exportRef.current) return;
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { notify("Video export is not supported by this browser."); return; }
    const format = exportFormats.find(item => item.mime === exportFormat);
    if (!format || !MediaRecorder.isTypeSupported(format.mime)) { notify("The selected video encoder is not supported by this browser."); return; }
    const mimeType = format.mime;
    const missing = projectRef.current.clips.some(item => item.assetId && !assetsRef.current.some(asset => asset.id === item.assetId));
    if (missing) { notify("Re-import the missing project media before exporting."); return; }
    try { await connectAudio(); }
    catch (error) { notify(`Audio initialization failed: ${error instanceof Error ? error.message : "unknown error"}`); return; }
    const output = document.createElement("canvas");
    const [w, h] = dimensions[projectRef.current.aspect], ratio = w / h;
    output.width = Math.round((ratio >= 1 ? quality * ratio : quality) / 2) * 2;
    output.height = Math.round((ratio >= 1 ? quality : quality / ratio) / 2) * 2;
    const videoStream = output.captureStream(fps);
    const stream = new MediaStream([...videoStream.getVideoTracks(), ...(destination.current?.stream.getAudioTracks() || [])]);
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: quality >= 2160 ? 24000000 : quality >= 1440 ? 14000000 : quality >= 1080 ? 8000000 : 5000000, audioBitsPerSecond: 192000 }); }
    catch (error) { videoStream.getTracks().forEach(track => track.stop()); notify(`Could not start export: ${error instanceof Error ? error.message : "encoder error"}`); return; }
    const chunks: Blob[] = [], previousTime = timeRef.current, wasPlaying = playingRef.current;
    let cancelled = false, failed = false, exportFrame = 0;
    playingRef.current = false; setPlaying(false); setExporting(true); setExportProgress(0); exportRef.current = recorder;
    cancelExportRef.current = () => { cancelled = true; if (recorder.state !== "inactive") recorder.stop(); };
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { failed = true; notify("Video recording failed."); };
    recorder.onstop = async () => {
      cancelAnimationFrame(exportFrame);
      syncMedia(timeRef.current, false);
      videoStream.getTracks().forEach(track => track.stop());
      exportRef.current = null; cancelExportRef.current = null;
      goTo(previousTime); playingRef.current = wasPlaying; setPlaying(wasPlaying);
      try {
        if (!cancelled && !failed) {
          const blob = new Blob(chunks, { type: mimeType });
          if (!blob.size) throw new Error("Export produced an empty video.");
          setExportProgress(100);
          await verifyVideo(blob, output.width, output.height);
          download(blob, `${safeName(projectRef.current.name)}.${format.extension}`);
          setExportOpen(false); notify("Your video is ready to download.");
        } else if (cancelled) notify("Export cancelled.");
      } catch (error) {
        notify(`Export validation failed: ${error instanceof Error ? error.message : "invalid video"}`);
      } finally { setExporting(false); setExportProgress(0); }
    };
    try { recorder.start(250); }
    catch (error) {
      exportRef.current = null; cancelExportRef.current = null; setExporting(false);
      videoStream.getTracks().forEach(track => track.stop());
      playingRef.current = wasPlaying; setPlaying(wasPlaying);
      notify(`Could not start export: ${error instanceof Error ? error.message : "encoder error"}`); return;
    }
    goTo(0);
    const start = performance.now(), total = durationOf(projectRef.current), exportTracker = new BeatTracker();
    let previousFrame = start;
    const draw = (now: number) => {
      if (recorder.state !== "recording") return;
      timeRef.current = Math.min(total, (now - start) / 1000);
      setCurrentTime(timeRef.current); setExportProgress(Math.min(99, Math.floor(timeRef.current / total * 100)));
      syncMedia(timeRef.current, true);
      let data: Uint8Array | undefined, waveform: Uint8Array | undefined;
      if (analyser.current) { const samples = new Uint8Array(analyser.current.frequencyBinCount), timeSamples = new Uint8Array(analyser.current.fftSize); analyser.current.getByteFrequencyData(samples); analyser.current.getByteTimeDomainData(timeSamples); data = samples; waveform = timeSamples; }
      const features = exportTracker.update(data, audioContext.current?.sampleRate ?? 48000, (now - previousFrame) / 1000);
      previousFrame = now;
      try { renderScene(output, projectRef.current, assetsRef.current, timeRef.current, features, waveform); }
      catch (error) { failed = true; notify(`Could not render export: ${error instanceof Error ? error.message : "rendering error"}`); recorder.stop(); return; }
      if (timeRef.current >= total) recorder.stop();
      else exportFrame = requestAnimationFrame(draw);
    };
    exportFrame = requestAnimationFrame(draw);
  };

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Pulseframe home"><span className="brand-mark">◈</span><span>pulseframe<span className="brand-studio"> / studio</span></span></a>
      <div className="project-name"><span className="live-dot" /><input aria-label="Project name" value={project.name} onChange={event => update({ ...project, name: event.target.value })} /><span className="save-state">{saveStatus}</span></div>
      <div className="top-actions">
        <button className="button button-quiet" onClick={undoChange}>↶ Undo</button>
        <button className="button button-quiet" onClick={redoChange}>↷ Redo</button>
        <button className="button button-quiet" onClick={() => projectInputRef.current?.click()}>Open project</button>
        <button className="button button-quiet" onClick={save}>Save project</button>
        <button className="button button-primary" onClick={() => setExportOpen(true)}>↗ Export video</button>
      </div>
    </header>
    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-tabs">{panels.map(item => <button key={item.id} className={`sidebar-tab ${panel === item.id ? "active" : ""}`} onClick={() => setPanel(item.id)}>{item.icon} <span>{item.label}</span></button>)}</div>
        <section className="sidebar-content">
          {panel === "media" && <>
            <div className="section-heading"><div><h2>Your media</h2><p>{assets.length} assets in this session</p></div><button className="icon-button" onClick={() => inputRef.current?.click()}>＋</button></div>
            <button className="upload-zone" onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importFiles(event.dataTransfer.files); }}><span className="upload-symbol">↑</span><strong>Drop your files here</strong><span>or <u>browse to upload</u></span><small>Audio, video, images &amp; lyrics</small></button>
            <div className="media-filters">{["all", "audio", "video", "image"].map(item => <button key={item} className={`filter-chip ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>{pretty(item)}</button>)}</div>
            <div className="asset-list">{project.assets.filter(item => filter === "all" || item.type === filter).map(item => {
              const asset = assets.find(entry => entry.id === item.id);
              return <div className="asset-row" key={item.id}><div className="asset-thumb">◈</div><div className="asset-details"><strong title={item.name}>{item.name}</strong><small>{asset ? item.type.toUpperCase() : "RE-IMPORT REQUIRED"}</small></div>
                {asset?.type === "video" && <button className="asset-extract" title="Extract audio as WAV" disabled={!!extraction} onClick={() => void extract(asset)}>♫↓</button>}
                {asset && ["image", "audio", "video"].includes(asset.type) && <button className="asset-add" title="Add another layer" onClick={() => { const next = makeClip(asset, project.aspect, currentTime); update({ ...project, clips: [...project.clips, next] }); setSelected(next.id); }}>＋</button>}
                <button className="asset-remove" title="Remove asset" onClick={() => removeAsset(item.id)}>×</button></div>;
            })}</div>
          </>}
          {panel === "effects" && <><div className="section-heading"><div><h2>Effects library</h2><p>Audio-reactive layers, added at the playhead</p></div></div>
            {([["EQUALIZERS", "Drawn over your footage", equalizerEffects], ["BEAT FX", "Transform the image and video beneath", beatEffects]] as const).map(([title, subtitle, list]) => <div className="effect-group" key={title}><span className="group-label">{title} <small>{subtitle}</small></span><div className="effect-grid">{list.map(effect => <button className="effect-card" key={effect} title={effectInfo[effect].description} onClick={() => addEffect(effect)}><span className="effect-preview" aria-hidden="true">{effectInfo[effect].icon}</span>{pretty(effect)}</button>)}</div></div>)}</>}
          {panel === "text" && <><div className="section-heading"><div><h2>Lyrics &amp; text</h2><p>Words that move with music</p></div></div><label className="field-label" htmlFor="lyrics">LYRICS <span>Paste LRC, SBV, or plain text</span></label><textarea id="lyrics" className="lyrics-input" value={project.lyrics} onChange={event => updateLyrics(event.target.value)} />
            <div className="field-row"><label htmlFor="lyricColor">Text color</label><input id="lyricColor" type="color" value={project.lyricColor} onChange={event => update({ ...project, lyricColor: event.target.value })} /></div>
            <label className="toggle-row"><span><strong>Karaoke highlight</strong><small>Highlight the active lyric</small></span><input type="checkbox" checked={project.karaoke} onChange={event => update({ ...project, karaoke: event.target.checked })} /><i /></label>
            <button className="button button-outline full-width" onClick={() => { const [w, h] = dimensions[project.aspect]; const item: Clip = { id: crypto.randomUUID(), name: "Text layer", lane: "text", start: currentTime, duration: 5, x: w / 2, y: h * .74, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" }; update({ ...project, clips: [...project.clips, item] }); setSelected(item.id); }}>＋ Add text layer</button></>}
          {panel === "motion" && <><div className="section-heading"><div><h2>Image to motion</h2><p>Select an image clip on the timeline</p></div></div>
            <label className="field-label" htmlFor="motionPreset">CAMERA PRESET</label><select className="inspector-select" id="motionPreset" value={preset} onChange={event => setPreset(event.target.value as MotionPreset)}>{presets.map(item => <option key={item} value={item}>{pretty(item)}</option>)}</select>
            <div className="motion-fields"><label>Duration <input type="number" min="1" max="600" value={motionDuration} onChange={event => setMotionDuration(Number(event.target.value))} /></label><label>Easing<select value={easing} onChange={event => { const next = event.target.value as Easing; setEasing(next); if (clip?.motion) updateClip(clip.id, { motion: { ...clip.motion, easing: next } }); }}>{["pchip", "linear", "hold", "ease-in", "ease-out", "ease-in-out"].map(item => <option key={item}>{item}</option>)}</select></label></div>
            <label className="slider-label"><span>Intensity {Math.round(intensity * 100)}%</span><input type="range" min="0" max="100" value={intensity * 100} onChange={event => { const next = Number(event.target.value) / 100; setIntensity(next); if (clip?.motion) updateClip(clip.id, { motion: { ...clip.motion, intensity: next } }); }} /></label>
            <button className="button button-primary full-width" disabled={!clip || clip.lane !== "image"} onClick={() => { if (!clip || !Number.isFinite(motionDuration) || motionDuration < 1 || motionDuration > 600) { notify("Choose a motion duration between 1 and 600 seconds."); return; } const motion = buildPreset(preset, motionDuration, intensity, clip.motion?.points); motion.easing = easing; motion.look = clip.motion?.look; updateClip(clip.id, { motion, duration: motionDuration }); }}>Apply camera move</button>
            {clip?.motion && <><label className="toggle-row"><span><strong>Safe-area guides</strong><small>Drag the start and end frames</small></span><input type="checkbox" checked={guides} onChange={event => setGuides(event.target.checked)} /><i /></label><p className="group-label">CAMERA KEYFRAMES</p>
              <MotionGraph motion={clip.motion} onStart={() => { undo.current = [...undo.current.slice(-34), projectRef.current]; redo.current = []; }} onChange={motion => updateClip(clip.id, { motion }, false)} />
              {(["cx", "cy", "zoom", "rotation"] as const).map(parameter => <div key={parameter} className="keyframe-row"><strong>{parameter}</strong>{clip.motion!.keyframes[parameter].map((point, index) => <div key={index} className="keyframe-control"><label>Time<input aria-label={`${parameter} keyframe ${index + 1} time`} type="number" min="0" max={clip.motion!.duration} step=".1" value={point.t} onChange={event => { const motion = structuredClone(clip.motion!); motion.keyframes[parameter][index].t = Math.max(0, Math.min(motion.duration, Number(event.target.value))); updateClip(clip.id, { motion }); }} /></label><label>Value<input aria-label={`${parameter} keyframe ${index + 1} value`} type="number" step=".01" value={parameter === "zoom" ? Math.exp(point.v) : point.v} onChange={event => { const motion = structuredClone(clip.motion!); motion.keyframes[parameter][index].v = parameter === "zoom" ? Math.log(Math.max(1, Number(event.target.value))) : Number(event.target.value); updateClip(clip.id, { motion }); }} /></label><button aria-label={`Delete ${parameter} keyframe ${index + 1}`} disabled={clip.motion!.keyframes[parameter].length <= 1} onClick={() => { const motion = structuredClone(clip.motion!); motion.keyframes[parameter].splice(index, 1); updateClip(clip.id, { motion }); }}>×</button></div>)}</div>)}
              <button className="button button-outline full-width" onClick={() => { const motion = structuredClone(clip.motion!); const time = Math.max(0, Math.min(motion.duration, currentTime - clip.start)); const camera = cameraAt(motion, time); for (const parameter of ["cx", "cy", "zoom", "rotation"] as const) { const value = parameter === "zoom" ? Math.log(camera.zoom) : camera[parameter]; const existing = motion.keyframes[parameter].find(point => Math.abs(point.t - time) < .001); if (existing) existing.v = value; else motion.keyframes[parameter].push({ t: time, v: value }); } updateClip(clip.id, { motion }); }}>＋ Keyframe at playhead</button>
              <button className="button button-outline full-width" onClick={() => { const motion = structuredClone(clip.motion!); const camera = cameraAt(motion, currentTime - clip.start); motion.points.push([camera.cx, camera.cy]); if (motion.preset === "detail-tour") { const next = buildPreset("detail-tour", motion.duration, motion.intensity, motion.points); next.easing = motion.easing; next.look = motion.look; updateClip(clip.id, { motion: next }); } else updateClip(clip.id, { motion }); }}>＋ Point of interest</button>
              <div className="motion-look"><span className="group-label">LOOK</span>{(["dim", "vignette", "grain", "dust", "pulse"] as const).map(look => <label key={look}><input type="checkbox" checked={!!clip.motion?.look?.[look]} onChange={event => { const motion = structuredClone(clip.motion!); motion.look = { ...motion.look, [look]: event.target.checked }; updateClip(clip.id, { motion }); }} />{pretty(look)}</label>)}</div></>}
          </>}
          <div hidden={panel !== "upscale"}><Upscaler notify={notify} /></div>
        </section>
      </aside>
      <section className="center-column">
        <div className="preview-toolbar"><div className="preview-title">● PREVIEW <span className="preview-live">LIVE</span></div><div className="preview-tools"><select aria-label="Canvas aspect ratio" value={project.aspect} onChange={event => changeAspect(event.target.value as Aspect)}>{Object.keys(dimensions).map(item => <option key={item}>{item}</option>)}</select><button className="small-tool" title="Fullscreen preview" aria-label="Fullscreen preview" onClick={() => { if (!stageRef.current?.requestFullscreen) { notify("Fullscreen is not supported by this browser."); return; } void stageRef.current.requestFullscreen().catch(error => notify(`Could not enter fullscreen: ${error.message}`)); }}>⛶</button></div></div>
        <div className="preview-stage-wrap"><div ref={stageRef} className="preview-stage" style={{ aspectRatio: project.aspect.replace(":", " / "), width: "auto", height: `min(100cqh, calc(100cqw * ${dimensions[project.aspect][1] / dimensions[project.aspect][0]}))` }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void importFiles(event.dataTransfer.files); }}><canvas ref={canvasRef} width={dimensions[project.aspect][0]} height={dimensions[project.aspect][1]} />
          {panel === "motion" && guides && clip?.motion && (() => {
            const image = assets.find(asset => asset.id === clip.assetId)?.element;
            if (!(image instanceof HTMLImageElement)) return null;
            const motion = clip.motion, [w, h] = dimensions[project.aspect];
            return <div className="motion-guides">{(["start", "end"] as const).map(frame => {
              const rect = cameraCrop(cameraAt(motion, frame === "start" ? 0 : motion.duration), image.naturalWidth, image.naturalHeight, w, h);
              return <div key={frame} className={`motion-guide motion-guide-${frame}`} style={{ left: `${rect.x / image.naturalWidth * 100}%`, top: `${rect.y / image.naturalHeight * 100}%`, width: `${rect.width / image.naturalWidth * 100}%`, height: `${rect.height / image.naturalHeight * 100}%` }}
                onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); guideDrag.current = { id: clip.id, frame, x: event.clientX, y: event.clientY }; undo.current = [...undo.current.slice(-34), projectRef.current]; redo.current = []; }}
                onPointerMove={moveGuide} onPointerUp={() => { guideDrag.current = null; }} onPointerCancel={() => { guideDrag.current = null; }}><span>{frame.toUpperCase()}</span></div>;
            })}</div>;
          })()}
          {!project.clips.length && <div className="preview-placeholder"><div className="placeholder-orbit">♫</div><h2>Your next visual starts here.</h2><p>Drop in a track, then bring it to life.</p><button className="button button-primary" onClick={() => inputRef.current?.click()}>＋ Import your media</button></div>}
          <div className="preview-overlay"><span>{dimensions[project.aspect].join(" × ")}</span><span>{formatTime(currentTime)}</span></div></div></div>
        <div className="transport"><div className="transport-side"><button className="transport-icon" onClick={() => goTo(0)}>|◀</button><button className="play-button" onClick={() => void play()}>{playing ? "Ⅱ" : "▶"}</button><button className="transport-icon" onClick={() => goTo(duration)}>▶|</button><span className="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span></div><div className="transport-side"><button className="transport-icon" onClick={() => setMuted(!muted)}>{muted ? "⊘" : "◖"}</button><input aria-label="Volume" type="range" min="0" max="1" step=".01" value={volume} onChange={event => setVolume(Number(event.target.value))} /><button className="transport-icon" onClick={() => setLoop(!loop)} style={{ color: loop ? "#b49aff" : undefined }}>⟳</button></div></div>
        <div className="timeline-panel"><div className="timeline-toolbar"><div className="timeline-heading"><strong>Timeline</strong><span className="timeline-subtitle">Arrange your composition</span></div><div className="timeline-actions">
          <button className="timeline-action" onClick={() => { if (!clip || currentTime <= clip.start || currentTime >= clip.start + clip.duration) return; const first = { ...clip, duration: currentTime - clip.start }; const second = { ...clip, id: crypto.randomUUID(), start: currentTime, duration: clip.start + clip.duration - currentTime, offset: (clip.offset || 0) + currentTime - clip.start }; update({ ...project, clips: project.clips.flatMap(item => item.id === clip.id ? [first, second] : [item]) }); }}>⌁ Split</button>
          <button className="timeline-action" onClick={() => { if (!clip) return; const copy = { ...structuredClone(clip), id: crypto.randomUUID(), start: clip.start + clip.duration }; update({ ...project, clips: [...project.clips, copy] }); setSelected(copy.id); }}>▣</button>
          <button className="timeline-action" onClick={() => { if (!clip) return; update({ ...project, clips: project.clips.filter(item => item.id !== clip.id) }); setSelected(null); }}>⌫</button>
          <input type="range" aria-label="Timeline zoom" min="40" max="140" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></div></div>
          <div className="timeline-scroll"><div className="timeline-ruler-row"><div className="track-label-spacer" /><div className="timeline-ruler" style={{ width: timelineWidth }}>{Array.from({ length: Math.floor(duration / tickInterval) + 1 }, (_, i) => <span className="ruler-tick" key={i} style={{ left: i * tickInterval * pixelsPerSecond }}>{formatTime(i * tickInterval)}</span>)}</div></div>
            <div className="timeline-body"><div className="playhead" style={{ left: 111 + currentTime * pixelsPerSecond }}><span /></div>{lanes.map(lane => <div className="track-row" key={lane}><div className="track-label">{pretty(lane)}</div><div className="track-lane" style={{ width: timelineWidth }} onClick={event => goTo((event.clientX - event.currentTarget.getBoundingClientRect().left) / pixelsPerSecond)}>{project.clips.filter(item => item.lane === lane).map(item => <div key={item.id} draggable onDragEnd={event => { const rect = event.currentTarget.parentElement?.getBoundingClientRect(); if (rect && event.clientX) updateClip(item.id, { start: Math.max(0, (event.clientX - rect.left) / pixelsPerSecond) }); }} className={`timeline-clip clip-${lane} ${selected === item.id ? "selected" : ""}`} style={{ left: item.start * pixelsPerSecond, width: Math.max(38, item.duration * pixelsPerSecond) }} onClick={event => { event.stopPropagation(); setSelected(item.id); }}>{item.name}</div>)}</div></div>)}</div></div></div>
      </section>
      <aside className="inspector"><div className="inspector-heading"><h2>Inspector</h2></div>{!clip ? <div className="inspector-empty"><strong>Nothing selected</strong><p>Select a layer in your timeline to see its properties.</p></div> : <div className="inspector-content">
        <div className="selected-layer"><div><strong>{clip.name}</strong><small>{clip.lane.toUpperCase()} LAYER</small></div><button className="visibility-button" onClick={() => updateClip(clip.id, { visible: !clip.visible })}>{clip.visible ? "◉" : "⊘"}</button></div>
        <div className="inspector-section"><div className="inspector-section-title"><span>TRANSFORM</span><button className="reset-button" onClick={() => { const [width, height] = dimensions[project.aspect]; updateClip(clip.id, { x: width / 2, y: height / 2, scale: 100, rotation: 0, opacity: 100 }); }}>Reset</button></div><div className="control-grid">{(["x", "y"] as const).map(key => <label key={key}>Position {key.toUpperCase()}<input type="number" value={clip[key]} onChange={event => updateClip(clip.id, { [key]: Number(event.target.value) })} /></label>)}</div>
          {(["scale", "rotation", "opacity"] as const).map(key => <label key={key} className="slider-label"><span>{pretty(key)} <b>{clip[key]}</b></span><input type="range" min={key === "rotation" ? -180 : key === "scale" ? 10 : 0} max={key === "rotation" ? 180 : key === "scale" ? 250 : 100} value={clip[key]} onChange={event => updateClip(clip.id, { [key]: Number(event.target.value) })} /></label>)}</div>
        <div className="inspector-section"><div className="inspector-section-title">CLIP TIMING</div><div className="control-grid">{(["start", "duration"] as const).map(key => <label key={key}>{pretty(key)}<input type="number" step=".1" min={key === "duration" ? .1 : 0} value={clip[key]} onChange={event => updateClip(clip.id, { [key]: Math.max(key === "duration" ? .1 : 0, Number(event.target.value)) })} /></label>)}</div></div>
        {(clip.lane === "image" || clip.lane === "video") && <div className="inspector-section"><label>Animation<select className="inspector-select" value={clip.animation} onChange={event => updateClip(clip.id, { animation: event.target.value as Clip["animation"] })}>        <option value="none">none</option><option value="pulse">beat pulse</option><option value="float">float</option><option value="zoom">zoom</option></select></label></div>}
        {clip.lane === "text" && !clip.isLyrics && <label>Text<input value={clip.name} onChange={event => updateClip(clip.id, { name: event.target.value })} /></label>}
                {clip.lane === "visualizer" && <div className="inspector-section">{clip.effect && <p className="effect-description">{effectInfo[clip.effect].description}{isBeatEffect(clip.effect) && " Position sets the focal point for zoom and vignette."}</p>}<label>Effect color <input type="color" value={clip.color || "#a78bfa"} onChange={event => updateClip(clip.id, { color: event.target.value })} /></label><label className="slider-label"><span>{isBeatEffect(clip.effect) ? "Intensity" : "Sensitivity"} <b>{clip.sensitivity ?? 70}</b></span><input type="range" min="10" max="150" value={clip.sensitivity ?? 70} onChange={event => updateClip(clip.id, { sensitivity: Number(event.target.value) })} /></label></div>}
      </div>}</aside>
    </main>
    <input ref={inputRef} type="file" hidden multiple accept="audio/*,video/*,image/*,.lrc,.sbv,.txt" onChange={event => { if (event.target.files) void importFiles(event.target.files); event.target.value = ""; }} />
    <input ref={projectInputRef} type="file" hidden accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void openProject(file); event.target.value = ""; }} />
    {message && <div className="toast-region" aria-live="polite"><div className="toast" onClick={() => setMessage("")}>{message} <button aria-label="Dismiss">×</button></div></div>}
    {extraction && <div className="modal-backdrop"><div className="export-dialog" role="dialog" aria-modal="true" aria-label="Extract audio"><h2>Extract audio</h2><p>{extraction.name} · {extraction.progress}%</p><p>Keep this tab open while the video is decoded.</p><button className="button button-outline full-width" onClick={() => extractionRef.current?.abort()}>Cancel extraction</button></div></div>}
    {exportOpen && <div className="modal-backdrop"><div className="export-dialog" role="dialog" aria-modal="true" aria-label="Export your video"><button className="dialog-close" onClick={() => setExportOpen(false)} disabled={exporting}>×</button><h2>Export your video</h2><p className="dialog-description">Render your composition as a video.</p><div className="export-options"><label>Format<select value={exportFormat} onChange={event => setExportFormat(event.target.value)}>{exportFormats.map(format => <option key={format.mime} value={format.mime} disabled={!supportedFormats.includes(format.mime)}>{format.name}</option>)}</select></label><label>Resolution<select value={quality} onChange={event => setQuality(Number(event.target.value))}><option value="720">720p</option><option value="1080">1080p</option><option value="1440">1440p</option><option value="2160">4K</option></select></label><label>Frame rate<select value={fps} onChange={event => setFps(Number(event.target.value))}><option>24</option><option>30</option><option>60</option></select></label></div>
      <p>{exporting ? `Rendering ${exportProgress}%` : "Keep this tab open while your video renders."}</p>
      <button className="button button-primary full-width" disabled={exporting || !project.clips.length} onClick={() => void startExport()}>Start export</button>
      {exporting && <button className="button button-outline full-width" onClick={() => cancelExportRef.current?.()}>Cancel export</button>}
    </div></div>}
  </div>;
}
