import { activeCueAtTime, parseLyrics } from "./lyrics";
import { cameraAt, cameraCrop, drawCamera } from "./motion";
import { dimensions, durationOf, type Asset, type Clip, type Project } from "./project";

export function renderScene(canvas: HTMLCanvasElement, project: Project, assets: Asset[], time: number, frequency?: Uint8Array, waveform?: Uint8Array): void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas rendering is not supported.");
  const w = canvas.width, h = canvas.height, [baseW, baseH] = dimensions[project.aspect];
  const background = ctx.createLinearGradient(0, 0, w, h);
  background.addColorStop(0, "#171329"); background.addColorStop(.48, "#171721"); background.addColorStop(1, "#101b22");
  ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
  const active = (lane: Clip["lane"]) => project.clips.filter(clip => clip.lane === lane && clip.visible && time >= clip.start && time < clip.start + (clip.isLyrics ? durationOf(project) : clip.duration));
  for (const clip of [...active("video"), ...active("image")]) {
    const asset = assets.find(item => item.id === clip.assetId);
    const source = asset?.element;
    if (!source || (source instanceof HTMLVideoElement && source.readyState < 2) || source instanceof HTMLAudioElement) continue;
    const iw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
    const ih = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
    if (!iw || !ih) continue;
    ctx.save(); ctx.globalAlpha = clip.opacity / 100;
    if (clip.motion && source instanceof HTMLImageElement) {
      const camera = cameraAt(clip.motion, time - clip.start + (clip.offset || 0));
      if (clip.motion.look?.pulse && frequency?.length) camera.zoom *= 1 + frequency[0] / 255 * .04;
      const crop = cameraCrop(camera, iw, ih, w, h);
      camera.cx -= (clip.x / baseW - .5) * crop.width / iw;
      camera.cy -= (clip.y / baseH - .5) * crop.height / ih;
      camera.zoom *= Math.max(.1, clip.scale / 100);
      camera.rotation += clip.rotation;
      drawCamera(ctx, source, w, h, camera);
      const look = clip.motion.look;
      if (look?.dim) { ctx.fillStyle = "#0005"; ctx.fillRect(0, 0, w, h); }
      if (look?.vignette) {
        const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .2, w / 2, h / 2, Math.max(w, h) * .7);
        vignette.addColorStop(0, "transparent"); vignette.addColorStop(1, "#000b");
        ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
      }
      if (look?.grain || look?.dust) {
        const frame = Math.floor(time * 24);
        const noise = (seed: number) => { const n = Math.sin(seed * 127.1) * 43758.5453; return n - Math.floor(n); };
        if (look.grain) {
          ctx.fillStyle = "#ffffff22";
          for (let i = 0; i < 250; i++) ctx.fillRect(noise(i + frame * 251) * w, noise(i + 999 + frame * 251) * h, Math.max(1, w / 1280), Math.max(1, h / 720));
        }
        if (look.dust) {
          ctx.fillStyle = "#ffffff55";
          for (let i = 0; i < 24; i++) { ctx.beginPath(); ctx.arc(noise(i + 81) * w, (noise(i + 244) + time * .004 * (i % 3 + 1)) % 1 * h, (1 + noise(i + 17) * 2) * w / 1280, 0, Math.PI * 2); ctx.fill(); }
        }
      }
    } else {
      let scale = Math.max(w / iw, h / ih) * clip.scale / 100;
      if (clip.animation === "zoom") scale *= 1 + .12 * Math.min(1, (time - clip.start) / clip.duration);
      if (clip.animation === "pulse" && frequency?.length) scale *= 1 + frequency[0] / 255 * .16;
      const float = clip.animation === "float" ? Math.sin((time - clip.start) * 1.3) * h / 72 : 0;
      ctx.translate(clip.x / baseW * w, clip.y / baseH * h + float);
      ctx.rotate(clip.rotation * Math.PI / 180);
      ctx.drawImage(source, -iw * scale / 2, -ih * scale / 2, iw * scale, ih * scale);
    }
    ctx.restore();
  }
  for (const clip of active("visualizer")) {
    const cx = clip.x / baseW * w, cy = clip.y / baseH * h, sensitivity = (clip.sensitivity ?? 70) / 70;
    ctx.save(); ctx.globalAlpha = clip.opacity / 100; ctx.strokeStyle = clip.color || "#a78bfa";
    ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = Math.max(2, w / 650);
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12 * w / baseW;
    const sample = (i: number, n: number) => frequency?.length ? frequency[Math.floor(i / n * frequency.length)] / 255 : .05;
    if (clip.effect === "circular" || clip.effect === "pulse") {
      const radius = Math.min(w, h) * .19;
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const angle = i / 72 * Math.PI * 2;
        const r = radius + sample(i, 72) * h * .12 * sensitivity;
        const x = cx + Math.cos(angle) * r, y = cy + Math.sin(angle) * r;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    } else if (clip.effect === "waveform") {
      ctx.beginPath();
      for (let i = 0; i < 128; i++) {
        const x = cx - w * .39 + i / 127 * w * .78;
        const value = waveform?.length ? (waveform[Math.floor(i / 128 * waveform.length)] - 128) / 128 : Math.sin(i / 5 + time * 2) * .03;
        const y = cy + value * h * .15 * sensitivity;
        if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (clip.effect === "particles") {
      for (let i = 0; i < 54; i++) {
        const x = (Math.sin(i * 127.1) * .5 + .5) * w;
        const y = (Math.sin(i * 181.65 + time * (.2 + i % 4 * .08)) * .5 + .5) * h;
        ctx.beginPath(); ctx.arc(x, y, (1 + sample(i, 54) * 3) * w / baseW, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      for (let i = 0; i < 64; i++) {
        const barWidth = w * .008, gap = w * .003, height = Math.max(3, sample(i, 64) * h * .38 * sensitivity);
        ctx.fillRect(cx - 64 * (barWidth + gap) / 2 + i * (barWidth + gap), cy - height, barWidth, height);
      }
    }
    ctx.restore();
  }
  const cues = parseLyrics(project.lyrics), cue = activeCueAtTime(cues, time);
  for (const clip of active("text")) {
    const text = clip.isLyrics ? cue?.text : clip.name;
    if (!text) continue;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const size = Math.max(20, w * .032) * clip.scale / 100;
    ctx.font = `700 ${size}px sans-serif`; ctx.lineWidth = Math.max(2, size * .08);
    ctx.strokeStyle = "#08080acc"; ctx.fillStyle = project.lyricColor;
    ctx.shadowColor = "#000"; ctx.shadowBlur = 14 * w / baseW;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const y = clip.y / baseH * h + (i - (lines.length - 1) / 2) * size * 1.25;
      ctx.strokeText(line, clip.x / baseW * w, y, w * .84);
      ctx.fillText(line, clip.x / baseW * w, y, w * .84);
      if (clip.isLyrics && project.karaoke && cue?.time !== null && cue?.time !== undefined) {
        const next = cues.find(item => item.time !== null && item.time > time);
        const end = cue.endTime ?? next?.time ?? cue.time + 3;
        const progress = Math.max(0, Math.min(1, (time - cue.time) / Math.max(.1, end - cue.time)));
        const textWidth = Math.min(w * .84, ctx.measureText(line).width);
        ctx.save(); ctx.beginPath(); ctx.rect(clip.x / baseW * w - textWidth / 2, y - size, textWidth * progress, size * 2); ctx.clip();
        ctx.fillStyle = "#bba2ff"; ctx.fillText(line, clip.x / baseW * w, y, w * .84); ctx.restore();
      }
    });
    ctx.restore();
  }
}
