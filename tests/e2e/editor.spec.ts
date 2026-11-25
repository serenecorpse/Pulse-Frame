import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function audioPeak(page: Page, bytes: Buffer): Promise<number> {
  return page.evaluate(async base64 => {
    const data = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const audio = new AudioContext();
    try {
      const decoded = await audio.decodeAudioData(data.buffer);
      return decoded.getChannelData(0).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    } finally { await audio.close(); }
  }, bytes.toString("base64"));
}

test("legacy projects retain their media link after a failed import and retry", async ({ page }) => {
  await page.goto("/");
  const project = {
    version: 1, name: "Restored", aspect: "16:9", assets: [{ id: "image-id", name: "photo.png", type: "image", size: 20 }],
    clips: [{ id: "clip-id", assetId: "image-id", name: "photo.png", lane: "image", start: 0, duration: 10, x: 640, y: 360, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" }],
    effects: [],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: "project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByText("RE-IMPORT REQUIRED")).toBeVisible();
  const media = page.locator('input[accept^="audio/"]');
  await media.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
  await expect(page.getByText("photo.png:", { exact: false })).toBeVisible();
  await expect(page.getByText("RE-IMPORT REQUIRED")).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 10;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "red"; ctx.fillRect(0, 0, 10, 10);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await media.setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await expect(page.getByText("1 assets in this session")).toBeVisible();
  await expect(page.getByText("RE-IMPORT REQUIRED")).toHaveCount(0);
  await page.locator(".clip-image").click();
  await page.getByRole("button", { name: "◉ Motion" }).click();
  await page.getByRole("button", { name: "Apply camera move" }).click();
  await expect(page.getByText("CAMERA KEYFRAMES")).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("pulseframe-project") || "{}");
    return stored.clips?.[0]?.motion?.preset;
  })).toBe("ken-burns");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pulseframe-project")!));
  expect(stored.assets[0].id).toBe("image-id");
  expect(stored.clips).toHaveLength(1);
  expect(stored.clips[0].id).toBe("clip-id");
  const dot = page.locator('.motion-keyframe-track circle[data-parameter="cx"]').first();
  await dot.scrollIntoViewIfNeeded();
  const bounds = await dot.boundingBox();
  if (!bounds) throw new Error("Keyframe graph is not visible.");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 25, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("pulseframe-project")!).clips[0].motion.keyframes.cx[0].t)).toBeGreaterThan(0);
});

test("autosave reports storage errors", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });

  await page.getByLabel("Project name").fill("Unsaved work");
  await expect(page.getByText("Autosave failed")).toBeVisible();
  await expect(page.getByText("could not be autosaved", { exact: false })).toBeVisible();
});

test("the sidebar and inspector remain usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Spectrum", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inspector" })).toBeVisible();
  await expect(page.getByText("VISUALIZER LAYER")).toBeVisible();
});

function kickTrack(seconds = 4, rate = 48000): Buffer {
  const samples = seconds * rate, buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const sinceKick = (i / rate) % .5;
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 60 * sinceKick) * Math.exp(-sinceKick / .09) * .9 * 32767), 44 + i * 2);
  }
  return buffer;
}

test("beat effects react to kicks in the playing audio", async ({ page }) => {
  await page.goto("/");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#202020"; ctx.fillRect(0, 0, 640, 360);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[accept^="audio/"]').setInputFiles([
    { name: "dark.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
    { name: "kicks.wav", mimeType: "audio/wav", buffer: kickTrack() },
  ]);
  await expect(page.getByText("2 assets in this session")).toBeVisible();
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Invert Flash", exact: true }).click();
  await page.locator(".play-button").click();
  const brightness = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(".preview-stage canvas")!, ctx = canvas.getContext("2d")!, values: number[] = [];
    for (let i = 0; i < 100; i++) {
      const [r, g, b] = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      values.push((r + g + b) / 3);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return values;
  });
  expect(Math.min(...brightness)).toBeLessThan(60);
  expect(Math.max(...brightness)).toBeGreaterThan(140);

  for (const name of ["Spectrum", "Mirror Bars", "Radial Bars", "Circular", "Waveform", "Neon", "Particles", "Pulse", "Beat Zoom", "Shake", "Glitch", "Rgb Split", "Hue Shift", "Color Flash", "Strobe", "Duotone", "Vhs", "Bloom", "Vignette Pulse", "Mirror"])
    await page.getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(1500);
  await expect(page.getByText("Preview failed", { exact: false })).toHaveCount(0);
  expect(await page.locator(".clip-visualizer").count()).toBe(21);
});

test("portrait previews retain their selected aspect ratio", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Canvas aspect ratio").selectOption("9:16");
  await expect.poll(async () => {
    const bounds = await page.locator(".preview-stage").boundingBox();
    return bounds ? bounds.width / bounds.height : 0;
  }).toBeCloseTo(9 / 16, 2);
});

test("invalid saved data is not overwritten by autosave", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pulseframe-project", "{invalid"));
  await page.goto("/");
  await expect(page.getByText("Autosave paused", { exact: true })).toBeVisible();
  await page.getByLabel("Project name").fill("Unsaved work");
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => localStorage.getItem("pulseframe-project"))).toBe("{invalid");
});

test("splitting a media clip preserves the second clip's source offset", async ({ page }) => {
  await page.goto("/");
  const project = {
    name: "Split", aspect: "16:9", assets: [{ id: "video", name: "clip.mp4", type: "video", size: 1 }],
    clips: [{ id: "clip", assetId: "video", name: "clip.mp4", lane: "video", start: 0, duration: 10, x: 640, y: 360, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" }],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: "project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.locator(".clip-video").click();
  await page.locator(".track-lane").nth(4).click({ position: { x: 40, y: 15 } });
  await page.getByRole("button", { name: "⌁ Split" }).click();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("pulseframe-project") || "{}").clips?.length)).toBe(2);
  const clips = await page.evaluate(() => JSON.parse(localStorage.getItem("pulseframe-project")!).clips);
  expect(clips[0].duration).toBeCloseTo(5, 1);
  expect(clips[1].offset).toBeCloseTo(5, 1);
});

test("very long project timelines do not create an unbounded number of ruler ticks", async ({ page }) => {
  await page.goto("/");
  const project = {
    name: "Long", aspect: "16:9", assets: [],
    clips: [{ id: "text", name: "Long clip", lane: "text", start: 0, duration: 1000000000, x: 640, y: 360, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" }],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({ name: "project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByText("Long clip")).toBeVisible();
  expect(await page.locator(".ruler-tick").count()).toBeLessThanOrEqual(501);
});

test("exports a decodable video at the requested dimensions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Spectrum", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Duration" }).fill("1");
  await page.getByRole("button", { name: "↗ Export video" }).click();
  const dialog = page.getByRole("dialog", { name: "Export your video" });
  await dialog.getByLabel("Resolution").selectOption("720");
  const format = dialog.getByLabel("Format");
  const mp4 = format.locator("option").filter({ hasText: "MP4" });
  if (!await mp4.isDisabled()) await format.selectOption({ label: "MP4 · H.264" });
  const downloaded = page.waitForEvent("download", { timeout: 35000 });
  await dialog.getByRole("button", { name: "Start export" }).click();
  const file = await downloaded;
  const bytes = await readFile(await file.path());
  expect(bytes.length).toBeGreaterThan(1000);
  const dimensions = await page.evaluate(async ({ base64, type }) => {
    const binary = atob(base64), data = Uint8Array.from(binary, char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([data], { type }));
    try {
      const video = document.createElement("video");
      return await new Promise<{ width: number; height: number }>((resolve, reject) => {
        video.onloadeddata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
        video.onerror = () => reject(new Error("Export cannot be decoded"));
        video.src = url;
      });
    } finally { URL.revokeObjectURL(url); }
  }, { base64: bytes.toString("base64"), type: file.suggestedFilename().endsWith(".mp4") ? "video/mp4" : "video/webm" });
  expect(dimensions).toEqual({ width: 1280, height: 720 });
});

test("video extraction and upscaling preserve audible source audio", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "◈ Media" }).click();
  const mime = "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
  test.skip(!await page.evaluate(type => MediaRecorder.isTypeSupported(type), mime), "Browser lacks MP4 encoding with audio.");
  const input = await page.evaluate(async type => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const audio = new AudioContext(), oscillator = audio.createOscillator(), output = audio.createMediaStreamDestination();
    oscillator.frequency.value = 440; oscillator.connect(output); oscillator.start(); await audio.resume();
    const video = canvas.captureStream(30);
    const stream = new MediaStream([...video.getVideoTracks(), ...output.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, { mimeType: type });
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
    recorder.start();
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `hsl(${i * 4},80%,50%)`; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise(resolve => setTimeout(resolve, 33));
    }
    recorder.stop(); await stopped;
    oscillator.stop(); video.getTracks().forEach(track => track.stop()); await audio.close();
    const blob = new Blob(chunks, { type: "video/mp4" });
    return await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(blob); });
  }, mime);
  const inputFile = { name: "tone.mp4", mimeType: "video/mp4", buffer: Buffer.from(input, "base64") };
  await page.locator('input[accept^="audio/"]').setInputFiles(inputFile);
  await expect(page.getByText("1 assets in this session")).toBeVisible();
  await page.getByRole("button", { name: "↗ Export video" }).click();
  const dialog = page.getByRole("dialog", { name: "Export your video" });
  await dialog.getByLabel("Resolution").selectOption("720");
  await dialog.getByLabel("Format").selectOption({ label: "MP4 · H.264" });
  const compositionDownload = page.waitForEvent("download", { timeout: 30000 });
  await dialog.getByRole("button", { name: "Start export" }).click();
  const composition = await compositionDownload;
  expect(await audioPeak(page, await readFile(await composition.path()))).toBeGreaterThan(.01);
  const extracted = page.waitForEvent("download");
  await page.getByTitle("Extract audio as WAV").click();
  expect((await extracted).suggestedFilename()).toBe("tone.wav");
  await expect(page.getByText("WAV extracted and added to your project.")).toBeVisible();

  await page.getByRole("button", { name: "⇧ Upscale" }).click();
  await page.locator('.sidebar-content input[type="file"]').setInputFiles(inputFile);
  await expect(page.locator(".upscaler-metadata")).toContainText("Source 640 × 360");
  await page.getByLabel("Target").selectOption("720");
  await page.getByLabel("Source policy").selectOption("downscale");
  await page.getByLabel("Codec").selectOption({ label: "MP4 · H.264" });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.getByRole("button", { name: "Process batch" }).click();
  await page.getByRole("button", { name: "◈ Media" }).click();
  const result = await downloadPromise;
  await page.getByRole("button", { name: "⇧ Upscale" }).click();
  await expect(page.locator(".upscaler-job")).toContainText("1 completed, 0 failed");
  const output = await readFile(await result.path());
  expect(await audioPeak(page, output)).toBeGreaterThan(.01);
});
