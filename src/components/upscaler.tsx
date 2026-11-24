"use client";

import { useEffect, useRef, useState } from "react";
import { download, formatTime, safeName } from "@/lib/project";
import { verifyVideo } from "@/lib/video";

type Fit = "pad" | "crop" | "stretch";
type Aspect = "source" | "16:9" | "9:16" | "1:1";
type QueueItem = { id: string; file: File; url: string };
const codecs = [
  { name: "WebM · VP9", video: "video/webm;codecs=vp9", audio: "video/webm;codecs=vp9,opus", extension: "webm" },
  { name: "WebM · VP8", video: "video/webm;codecs=vp8", audio: "video/webm;codecs=vp8,opus", extension: "webm" },
  { name: "MP4 · H.264", video: "video/mp4;codecs=avc1.42E01E", audio: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", extension: "mp4" },
  { name: "MP4 · H.265", video: "video/mp4;codecs=hvc1", audio: "video/mp4;codecs=hvc1,mp4a.40.2", extension: "mp4" },
];
function targetSize(edge: number, aspect: Aspect, width: number, height: number) {
  const ratio = aspect === "source" ? width / height : aspect === "16:9" ? 16 / 9 : aspect === "9:16" ? 9 / 16 : 1;
  const even = (number: number) => Math.max(2, Math.round(number / 2) * 2);
  const target = ratio >= 1 ? { width: even(edge * ratio), height: edge } : { width: edge, height: even(edge / ratio) };
  if (!Number.isFinite(ratio) || ratio <= 0 || target.width > 8192 || target.height > 8192 || target.width * target.height > 24 * 1024 * 1024) throw new Error("Output exceeds the safe canvas limit. Choose a smaller target or standard aspect.");
  return target;
}
function draw(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number, fit: Fit) {
  context.fillStyle = "#08080c"; context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  const scale = fit === "crop" ? Math.max(width / video.videoWidth, height / video.videoHeight) : Math.min(width / video.videoWidth, height / video.videoHeight);
  const w = fit === "stretch" ? width : video.videoWidth * scale, h = fit === "stretch" ? height : video.videoHeight * scale;
  context.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
}
function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video"); video.preload = "auto"; video.playsInline = true;
    const timer = setTimeout(() => { video.removeAttribute("src"); video.load(); reject(new Error("Timed out loading video.")); }, 15000);
    video.onloadedmetadata = () => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration) || video.duration <= 0) reject(new Error("Invalid video dimensions or duration.")); else resolve(video); };
    video.onerror = () => { clearTimeout(timer); reject(new Error("The browser could not decode this video.")); };
    video.src = url; video.load();
  });
}
export default function Upscaler({ notify }: { notify: (message: string) => void }) {
  const [queue, setQueue] = useState<QueueItem[]>([]), [selected, setSelected] = useState("");
  const [edge, setEdge] = useState(1080), [aspect, setAspect] = useState<Aspect>("source"), [fit, setFit] = useState<Fit>("pad");
  const [codec, setCodec] = useState(0), [fps, setFps] = useState<number | "source">("source"), [keep, setKeep] = useState(true);
  const [preset, setPreset] = useState("custom");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [status, setStatus] = useState("Select videos to begin.");
  const [metadata, setMetadata] = useState("Choose a video to inspect its browser-readable metadata.");
  const [supported, setSupported] = useState<boolean[]>(codecs.map(() => false));
  const queueRef = useRef(queue), videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const cancel = useRef(false), recorderRef = useRef<MediaRecorder | null>(null);
  useEffect(() => {
    const supportedCodecs = codecs.map(item => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(item.audio));
    setSupported(supportedCodecs); setCodec(Math.max(0, supportedCodecs.findIndex(Boolean)));
    return () => { cancel.current = true; if (recorderRef.current?.state === "recording") recorderRef.current.stop(); queueRef.current.forEach(item => URL.revokeObjectURL(item.url)); };
  }, []);
  const chosen = queue.find(item => item.id === selected);
  const refreshPreview = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    try {
      const target = targetSize(edge, aspect, video.videoWidth, video.videoHeight);
      const scale = Math.min(640 / target.width, 360 / target.height);
      canvas.width = Math.max(2, Math.round(target.width * scale)); canvas.height = Math.max(2, Math.round(target.height * scale));
      const ctx = canvas.getContext("2d"); if (ctx) draw(ctx, video, canvas.width, canvas.height, fit);
      const enlargement = Math.max(target.width / video.videoWidth, target.height / video.videoHeight);
      setMetadata(`Source ${video.videoWidth} × ${video.videoHeight} · ${formatTime(video.duration)}\nTarget ${target.width} × ${target.height}${enlargement > 2 ? ` · Warning: ${enlargement.toFixed(1)}× enlargement` : ""}`);
    } catch (error) { setMetadata(error instanceof Error ? error.message : "Invalid target dimensions."); }
  };
  useEffect(() => { refreshPreview(); });
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const additions: QueueItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video/") && !/\.(mp4|mov|mkv|webm|avi)$/i.test(file.name)) { notify(`${file.name}: unsupported video type.`); continue; }
      if (queueRef.current.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
      additions.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    }
    const next = [...queueRef.current, ...additions]; queueRef.current = next; setQueue(next);
    if (!selected && next.length) setSelected(next[0].id);
  };
  const process = async () => {
    if (busy || !queue.length || !supported[codec]) return;
    setBusy(true); cancel.current = false; let completed = 0, failed = 0;
    let audioContext: AudioContext;
    try { audioContext = new AudioContext(); await audioContext.resume(); }
    catch (error) { setBusy(false); notify(`Audio processing is unavailable: ${error instanceof Error ? error.message : "unknown error"}`); return; }
    for (const [index, item] of queueRef.current.entries()) {
      if (cancel.current) break;
      let video: HTMLVideoElement | null = null;
      try {
        setStatus(`Loading ${item.file.name}...`);
        video = await loadVideo(item.url);
        if (cancel.current) break;
        const target = targetSize(edge, aspect, video.videoWidth, video.videoHeight);
        if (keep && video.videoWidth >= target.width && video.videoHeight >= target.height) {
          download(item.file, safeName(item.file.name)); completed++; setProgress(Math.round((index + 1) / queue.length * 100)); continue;
        }
        const audioSource = audioContext.createMediaElementSource(video);
        const audioOutput = audioContext.createMediaStreamDestination();
        audioSource.connect(audioOutput);
        const output = document.createElement("canvas"); output.width = target.width; output.height = target.height;
        const context = output.getContext("2d");
        if (!context) { audioSource.disconnect(); audioOutput.stream.getTracks().forEach(track => track.stop()); throw new Error("Could not allocate output canvas."); }
        let canvasStream = output.captureStream(fps === "source" ? 0 : fps);
        let canvasTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
        const sourceFrames = fps === "source" && typeof video.requestVideoFrameCallback === "function" && typeof canvasTrack.requestFrame === "function";
        if (fps === "source" && !sourceFrames) { canvasStream.getTracks().forEach(track => track.stop()); canvasStream = output.captureStream(30); canvasTrack = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack; }
        const mimeType = codecs[codec].audio;
        if (!MediaRecorder.isTypeSupported(mimeType)) { audioSource.disconnect(); audioOutput.stream.getTracks().forEach(track => track.stop()); canvasStream.getTracks().forEach(track => track.stop()); throw new Error(`Browser does not support ${mimeType} with audio.`); }
        const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioOutput.stream.getAudioTracks()]);
        const recordingVideo = video;
        const blob = await new Promise<Blob>((resolve, reject) => {
          let recorder: MediaRecorder;
          try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: target.width * target.height >= 3840 * 2160 ? 24000000 : 8000000 }); }
          catch (error) { audioSource.disconnect(); audioOutput.stream.getTracks().forEach(track => track.stop()); canvasStream.getTracks().forEach(track => track.stop()); reject(error); return; }
          recorderRef.current = recorder;
          const chunks: Blob[] = []; let frame = 0, videoFrame = 0, settled = false;
          const cleanup = () => { cancelAnimationFrame(frame); if (videoFrame) recordingVideo.cancelVideoFrameCallback(videoFrame); recordingVideo.pause(); audioSource.disconnect(); audioOutput.stream.getTracks().forEach(track => track.stop()); canvasStream.getTracks().forEach(track => track.stop()); recorderRef.current = null; };
          const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          recorder.onerror = () => fail(new Error("The browser encoder failed."));
          recorder.onstop = () => { if (settled) return; settled = true; cleanup(); resolve(new Blob(chunks, { type: mimeType })); };
          recordingVideo.onended = () => { if (recorder.state === "recording") recorder.stop(); };
          const step = () => {
            if (recorder.state !== "recording") return;
            if (cancel.current) { recorder.stop(); return; }
            if (recordingVideo.readyState >= 2) { draw(context, recordingVideo, target.width, target.height, fit); if (sourceFrames) canvasTrack.requestFrame(); }
            setProgress(Math.floor((index + Math.min(1, recordingVideo.currentTime / recordingVideo.duration)) / queue.length * 100));
            setStatus(`Processing ${item.file.name}...`);
            if (sourceFrames) videoFrame = recordingVideo.requestVideoFrameCallback(step);
            else frame = requestAnimationFrame(step);
          };
          try { recorder.start(250); recordingVideo.muted = true; void recordingVideo.play().then(() => { recordingVideo.muted = false; step(); }).catch(error => fail(new Error(`Playback failed: ${error.message}`))); }
          catch (error) { fail(error instanceof Error ? error : new Error("Could not start recording.")); }
        });
        if (cancel.current) break;
        if (!blob.size) throw new Error("The encoder produced an empty video.");
        await verifyVideo(blob, target.width, target.height);
        download(blob, `${safeName(item.file.name).replace(/\.[^.]+$/, "")}-upscaled.${codecs[codec].extension}`);
        completed++;
      } catch (error) { failed++; notify(`${item.file.name}: ${error instanceof Error ? error.message : "Processing failed."}`); }
      finally { if (video) { video.pause(); video.removeAttribute("src"); video.load(); } }
    }
    try { await audioContext.close(); } catch (error) { notify(`Could not close audio processing: ${error instanceof Error ? error.message : "unknown error"}`); }
    if (!cancel.current && !failed) { setProgress(100); notify("Upscaling complete. Downloaded outputs are ready."); }
    setStatus(cancel.current ? `Cancelled after ${completed} file(s).` : `Finished: ${completed} completed, ${failed} failed.`);
    setBusy(false);
  };
  return <>
    <div className="section-heading"><div><h2>Video upscaler</h2><p>Fast browser-based resizing</p></div><span className="live-pill">FAST</span></div>
    <label className="button button-outline full-width">＋ Choose videos<input type="file" hidden multiple accept="video/*,.mp4,.mov,.mkv,.webm,.avi" disabled={busy} onChange={event => { addFiles(event.target.files); event.target.value = ""; }} /></label>
    <label className="field-label">BATCH QUEUE · {queue.length}</label>
    <select className="inspector-select" size={3} value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>{queue.map(item => <option key={item.id} value={item.id}>{item.file.name}</option>)}</select>
    <button className="button button-quiet" disabled={busy || !chosen} onClick={() => { if (!chosen) return; URL.revokeObjectURL(chosen.url); const next = queue.filter(item => item.id !== chosen.id); queueRef.current = next; setQueue(next); setSelected(next[0]?.id || ""); }}>Remove selected</button>
    <div className="upscaler-metadata">{metadata}</div>
    <div className="upscaler-fields">
      <label>Preset<select disabled={busy} value={preset} onChange={event => { const value = event.target.value; setPreset(value); if (value === "draft") { setEdge(720); setAspect("16:9"); setFit("pad"); setKeep(false); } else if (value === "youtube1080") { setEdge(1080); setAspect("16:9"); setFit("pad"); setKeep(false); } else if (value === "youtube4k") { setEdge(2160); setAspect("16:9"); setFit("pad"); setKeep(false); } else if (value === "archive") { setEdge(2160); setAspect("source"); setFit("pad"); setKeep(true); } }}><option value="custom">Custom</option><option value="draft">Fast draft · 720p</option><option value="youtube1080">YouTube 1080p</option><option value="youtube4k">YouTube 4K</option><option value="archive">Archive · source aspect</option></select></label>
      <label>Target<select disabled={busy} value={edge} onChange={event => { setEdge(Number(event.target.value)); setPreset("custom"); }}><option value="720">720p</option><option value="1080">1080p</option><option value="2160">4K</option></select></label>
      <label>Frame<select disabled={busy} value={aspect} onChange={event => { setAspect(event.target.value as Aspect); setPreset("custom"); }}><option value="source">Source</option><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
      <label>Fit<select disabled={busy} value={fit} onChange={event => { setFit(event.target.value as Fit); setPreset("custom"); }}><option value="pad">Pad</option><option value="crop">Crop</option><option value="stretch">Stretch</option></select></label>
      <label>Method<select disabled><option>Fast · browser resampling</option><option>Balanced · unavailable</option><option>Best · unavailable</option></select></label>
      <label>FPS<select disabled={busy} value={fps} onChange={event => setFps(event.target.value === "source" ? "source" : Number(event.target.value))}><option value="source">Match source (best effort)</option><option>24</option><option>30</option><option>60</option></select></label>
      <label>Codec<select disabled={busy} value={codec} onChange={event => setCodec(Number(event.target.value))}>{codecs.map((item, index) => <option disabled={!supported[index]} key={item.name} value={index}>{item.name}</option>)}</select></label>
      <label>Source policy<select disabled={busy} value={keep ? "keep" : "downscale"} onChange={event => { setKeep(event.target.value === "keep"); setPreset("custom"); }}><option value="keep">Keep larger source</option><option value="downscale">Downscale</option></select></label>
    </div>
    <div className="upscaler-notice">Fast mode uses browser resampling. Neural models, denoise, sharpening and frame-accurate processing are unavailable. Audio and timing are best effort.</div>
    <div className="upscaler-preview"><div><span>BEFORE</span><video ref={videoRef} src={chosen?.url} controls muted playsInline onLoadedData={refreshPreview} onTimeUpdate={refreshPreview} onError={() => setMetadata("The browser could not decode this video.")} /></div><div><span>AFTER</span><canvas ref={canvasRef} /></div></div>
    <div className="upscaler-job"><div><span>{status}</span><span>{progress}%</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div>
    <div className="upscaler-actions"><button className="button button-primary" disabled={busy || !queue.length || !supported[codec]} onClick={() => void process()}>Process batch</button><button className="button button-outline" disabled={!busy} onClick={() => { cancel.current = true; if (recorderRef.current?.state === "recording") recorderRef.current.stop(); }}>Cancel</button></div>
  </>;
}
