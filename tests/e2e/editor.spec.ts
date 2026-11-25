import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function audioPeak(page: Page, bytes: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const audio = new AudioContext();
    try {
      const decoded = await audio.decodeAudioData(data.buffer);
      return decoded
        .getChannelData(0)
        .reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    } finally {
      await audio.close();
    }
  }, bytes.toString("base64"));
}

test("legacy projects retain their media link after a failed import and retry", async ({
  page,
}) => {
  await page.goto("/");
  const project = {
    version: 1,
    name: "Restored",
    aspect: "16:9",
    assets: [{ id: "image-id", name: "photo.png", type: "image", size: 20 }],
    clips: [
      {
        id: "clip-id",
        assetId: "image-id",
        name: "photo.png",
        lane: "image",
        start: 0,
        duration: 10,
        x: 640,
        y: 360,
        scale: 100,
        rotation: 0,
        opacity: 100,
        visible: true,
        animation: "none",
      },
    ],
    effects: [],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByText("RE-IMPORT REQUIRED")).toBeVisible();
  const media = page.locator('input[accept^="audio/"]');
  await media.setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("photo.png:", { exact: false })).toBeVisible();
  await expect(page.getByText("RE-IMPORT REQUIRED")).toBeVisible();
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 10;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 10, 10);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await media.setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByText("1 assets in this session")).toBeVisible();
  await expect(page.getByText("RE-IMPORT REQUIRED")).toHaveCount(0);
  await page.locator(".clip-image").click();
  await page.getByRole("button", { name: "◉ Motion" }).click();
  await page.getByRole("button", { name: "Apply camera move" }).click();
  await expect(page.getByText("CAMERA KEYFRAMES")).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("pulseframe-project") || "{}",
        );
        return stored.clips?.[0]?.motion?.preset;
      }),
    )
    .toBe("ken-burns");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("pulseframe-project")!),
  );
  expect(stored.assets[0].id).toBe("image-id");
  expect(stored.clips).toHaveLength(1);
  expect(stored.clips[0].id).toBe("clip-id");
  const dot = page
    .locator('.motion-keyframe-track circle[data-parameter="cx"]')
    .first();
  await dot.scrollIntoViewIfNeeded();
  const bounds = await dot.boundingBox();
  if (!bounds) throw new Error("Keyframe graph is not visible.");
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 25,
    bounds.y + bounds.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("pulseframe-project")!).clips[0]
            .motion.keyframes.cx[0].t,
      ),
    )
    .toBeGreaterThan(0);
});

test("autosave reports storage errors", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
  });

  await page.getByLabel("Project name").fill("Unsaved work");
  await expect(page.getByText("Autosave failed")).toBeVisible();
  await expect(
    page.getByText("could not be autosaved", { exact: false }),
  ).toBeVisible();
});

test("the sidebar and inspector remain usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Spectrum", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Inspector" })).toBeVisible();
  await expect(page.getByText("VISUALIZER LAYER")).toBeVisible();
});

test("footage layers can be reordered, hidden, and positioned directly on the preview", async ({
  page,
}) => {
  await page.goto("/");
  const image = async (color: string) =>
    Buffer.from(
      await page.evaluate((color) => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 36;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png").split(",")[1];
      }, color),
      "base64",
    );
  await page.locator('input[accept^="audio/"]').setInputFiles([
    { name: "red.png", mimeType: "image/png", buffer: await image("#ff0000") },
    { name: "blue.png", mimeType: "image/png", buffer: await image("#0000ff") },
  ]);
  await expect(page.getByText("2 assets in this session")).toBeVisible();
  await expect(
    page.locator(".track-row").filter({ hasText: "Image" }),
  ).toHaveCount(2);
  const colorAtCenter = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".preview-stage canvas",
      )!;
      return Array.from(
        canvas.getContext("2d")!.getImageData(640, 360, 1, 1).data,
      ).slice(0, 3);
    });
  await expect.poll(colorAtCenter).toEqual([0, 0, 255]);
  await page.getByRole("button", { name: "▤ Layers" }).click();
  await page.getByRole("button", { name: "Move red.png forward" }).click();
  await expect.poll(colorAtCenter).toEqual([255, 0, 0]);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("pulseframe-project") || "{}",
          ).clips?.find((clip: { name: string }) => clip.name === "red.png")
            ?.layerOrder,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Hide red.png" }).click();
  await expect.poll(colorAtCenter).toEqual([0, 0, 255]);
  await page.getByRole("button", { name: "Show red.png" }).click();
  await page.getByRole("button", { name: /red.png 00:00/ }).click();
  const handle = page.getByRole("button", { name: "Move red.png on canvas" });
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Missing preview position handle");
  const before = Number(await page.getByLabel("Position X").inputValue());
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 50,
    bounds.y + bounds.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await page.getByLabel("Position X").inputValue()))
    .toBeGreaterThan(before);
  await page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(page.getByLabel("Position X")).toHaveValue(String(before));
  await expect
    .poll(async () =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("pulseframe-project") || "{}",
        ).clips?.find((clip: { name: string }) => clip.name === "red.png"),
      ),
    )
    .toMatchObject({ x: before, visible: true, layerOrder: 1 });
  await page.reload();
  await page.locator('input[accept^="audio/"]').setInputFiles([
    { name: "red.png", mimeType: "image/png", buffer: await image("#ff0000") },
    { name: "blue.png", mimeType: "image/png", buffer: await image("#0000ff") },
  ]);
  await expect(page.getByText("2 assets in this session")).toBeVisible();
  await expect.poll(colorAtCenter).toEqual([255, 0, 0]);
});

test("timeline trim handles preserve media offsets and undo", async ({
  page,
}) => {
  await page.goto("/");
  const project = {
    name: "Trim",
    aspect: "16:9",
    assets: [{ id: "video", name: "clip.mp4", type: "video", size: 1 }],
    clips: [
      {
        id: "clip",
        assetId: "video",
        name: "clip.mp4",
        lane: "video",
        start: 0,
        duration: 10,
        offset: 2,
        x: 640,
        y: 360,
        scale: 100,
        rotation: 0,
        opacity: 100,
        visible: true,
        animation: "none",
      },
    ],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole("button", { name: "⌁ Snap" }).click();
  const handle = page.locator(".clip-video .trim-start");
  const rect = await handle.boundingBox();
  if (!rect) throw new Error("Missing trim handle");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 16,
    rect.y + rect.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("pulseframe-project") || "{}")
            .clips?.[0]?.offset,
      ),
    )
    .toBeCloseTo(4, 1);
  await expect(page.getByLabel("Start")).toHaveValue("2");
  await expect(page.getByLabel("Duration")).toHaveValue("8");
  await page.getByRole("button", { name: "↶ Undo" }).click();
  await expect(page.getByLabel("Start")).toHaveValue("0");
  await expect(page.getByLabel("Duration")).toHaveValue("10");
});

function kickTrack(seconds = 4, rate = 48000): Buffer {
  const samples = seconds * rate,
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const sinceKick = (i / rate) % 0.5;
    buffer.writeInt16LE(
      Math.round(
        Math.sin(2 * Math.PI * 60 * sinceKick) *
          Math.exp(-sinceKick / 0.09) *
          0.9 *
          32767,
      ),
      44 + i * 2,
    );
  }
  return buffer;
}

test("lyric font and typewriter effect render, persist, and export", async ({
  page,
}) => {
  await page.goto("/");
  const project = {
    name: "Lyrics",
    aspect: "16:9",
    assets: [],
    lyrics: "[00:00.00]PULSE FRAME",
    lyricColor: "#ff0000",
    karaoke: false,
    clips: [
      {
        id: "lyrics",
        name: "Lyrics",
        lane: "text",
        start: 0,
        duration: 10,
        x: 640,
        y: 360,
        scale: 150,
        rotation: 0,
        opacity: 100,
        visible: true,
        animation: "none",
        isLyrics: true,
      },
    ],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: "lyrics.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole("button", { name: "T Text" }).click();
  await expect(page.getByLabel("Lyric font")).toHaveValue("classic");
  await expect(page.getByLabel("Lyric effect")).toHaveValue("classic");
  const redPixels = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".preview-stage canvas",
      )!;
      const pixels = canvas
        .getContext("2d")!
        .getImageData(200, 275, 880, 170).data;
      let count = 0,
        positionSum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 150 && pixels[i] > pixels[i + 1] * 2) {
          count++;
          positionSum += i;
        }
      }
      return { count, positionSum };
    });
  await expect.poll(async () => (await redPixels()).count).toBeGreaterThan(100);
  const classic = await redPixels();
  await page.getByLabel("Lyric font").selectOption("mono");
  await expect
    .poll(async () => (await redPixels()).positionSum)
    .not.toBe(classic.positionSum);
  const mono = await redPixels();
  await page.getByLabel("Lyric effect").selectOption("neon");
  await expect
    .poll(async () => (await redPixels()).positionSum)
    .not.toBe(mono.positionSum);
  for (const effect of ["fade", "rise", "pop", "typewriter"]) {
    await page.getByLabel("Lyric effect").selectOption("classic");
    await expect.poll(async () => (await redPixels()).count).toBe(mono.count);
    await page.getByLabel("Lyric effect").selectOption(effect);
    await expect.poll(async () => (await redPixels()).count).toBe(0);
  }
  const ruler = page.locator(".timeline-ruler");
  await ruler.click({ position: { x: 2, y: 5 } });
  await expect.poll(async () => (await redPixels()).count).toBeGreaterThan(100);
  expect((await redPixels()).count).toBeLessThan(mono.count);
  for (const effect of ["fade", "rise", "pop"]) {
    await page.getByLabel("Lyric effect").selectOption(effect);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const pixels = await redPixels();
    expect(pixels.count).toBeGreaterThan(0);
    expect(pixels.positionSum).not.toBe(mono.positionSum);
  }
  await page.getByLabel("Lyric effect").selectOption("typewriter");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem("pulseframe-project") || "{}",
        );
        return [saved.lyricFont, saved.lyricEffect];
      }),
    )
    .toEqual(["mono", "typewriter"]);
  await page.reload();
  await page.getByRole("button", { name: "T Text" }).click();
  await expect(page.getByLabel("Lyric font")).toHaveValue("mono");
  await expect(page.getByLabel("Lyric effect")).toHaveValue("typewriter");
  await ruler.click({ position: { x: 8, y: 5 } });
  await expect.poll(async () => (await redPixels()).count).toBeGreaterThan(100);
  await page.getByRole("button", { name: "↗ Export video" }).click();
  const dialog = page.getByRole("dialog", { name: "Export your video" });
  await dialog.getByLabel("Resolution").selectOption("720");
  const download = page.waitForEvent("download", { timeout: 35000 });
  await dialog.getByRole("button", { name: "Start export" }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  const count = await page.evaluate(
    async ({ base64, type }) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([data], { type }));
      try {
        const video = document.createElement("video");
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error("Cannot decode export"));
        });
        video.currentTime = 0.6;
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error("Cannot seek export"));
        });
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        const pixels = ctx.getImageData(200, 275, 880, 170).data;
        let red = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 120 && pixels[i] > pixels[i + 1] * 2) red++;
        return red;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    {
      base64: bytes.toString("base64"),
      type: file.suggestedFilename().endsWith(".mp4")
        ? "video/mp4"
        : "video/webm",
    },
  );
  expect(count).toBeGreaterThan(100);
});

test("all immersive visualizers render and can be removed", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as typeof window & { testSpectrum: boolean };
    state.testSpectrum = false;
    AnalyserNode.prototype.getByteFrequencyData = function (data) {
      data.fill(0);
      if (state.testSpectrum) {
        data.fill(240, 1, 7);
        data.fill(180, 7, 85);
        data.fill(200, 85, 400);
      }
    };
  });
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "✳ Effects" }).click();
  const pixels = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".preview-stage canvas",
      )!;
      const { data } = canvas
        .getContext("2d")!
        .getImageData(400, 120, 480, 480);
      const samples: number[] = [];
      for (let y = 0; y < 480; y += 3)
        for (let x = 0; x < 480; x += 3) {
          const index = (y * 480 + x) * 4;
          samples.push(data[index], data[index + 1], data[index + 2]);
        }
      return samples;
    });
  const baseline = await pixels();
  const difference = async () => {
    const current = await pixels();
    let changed = 0;
    for (let i = 0; i < current.length; i += 3)
      if (
        Math.abs(current[i] - baseline[i]) +
          Math.abs(current[i + 1] - baseline[i + 1]) +
          Math.abs(current[i + 2] - baseline[i + 2]) >
        25
      )
        changed++;
    return changed;
  };
  for (const effect of [
    "Plasma Orb",
    "Particle Swarm",
    "Wireframe Terrain",
    "Liquid Ink",
    "Kaleidoscope",
    "Ribbon Tunnel",
    "Polygon Shatter",
    "Feedback Tunnel",
    "Topographic Contours",
    "Audio Silhouette",
  ]) {
    await page.getByRole("button", { name: effect, exact: true }).click();
    await expect(
      page.getByText("Preview failed", { exact: false }),
    ).toHaveCount(0);
    await expect
      .poll(difference, {
        message: `${effect} should visibly render`,
        timeout: 10000,
      })
      .toBeGreaterThan(20);
    await page.waitForTimeout(600);
    const idle = await pixels();
    await page.evaluate(() => {
      (window as typeof window & { testSpectrum: boolean }).testSpectrum = true;
    });
    await expect
      .poll(
        async () => {
          const current = await pixels();
          let changed = 0;
          for (let i = 0; i < current.length; i += 3)
            if (
              Math.abs(current[i] - idle[i]) +
                Math.abs(current[i + 1] - idle[i + 1]) +
                Math.abs(current[i + 2] - idle[i + 2]) >
              25
            )
              changed++;
          return changed;
        },
        { message: `${effect} should respond to audio`, timeout: 5000 },
      )
      .toBeGreaterThan(20);
    await page.evaluate(() => {
      (window as typeof window & { testSpectrum: boolean }).testSpectrum =
        false;
    });
    await page.getByRole("button", { name: "Delete selected clip" }).click();
    await expect.poll(difference).toBe(0);
  }
});

function triangleGlb(external = false): Buffer {
  const vertices = Buffer.alloc(36);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, i) =>
    vertices.writeFloatLE(value, i * 4),
  );
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [
        {
          byteLength: vertices.length,
          ...(external ? { uri: "https://example.com/model.bin" } : {}),
        },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices.length }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [-1, -1, 0],
          max: [1, 1, 0],
        },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }),
  );
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const result = Buffer.alloc(12 + 8 + padded.length + 8 + vertices.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  const offset = 20 + padded.length;
  result.writeUInt32LE(vertices.length, offset);
  result.writeUInt32LE(0x004e4942, offset + 4);
  vertices.copy(result, offset + 8);
  return result;
}

test("custom silhouette models survive project reload and require re-import", async ({
  page,
}) => {
  await page.goto("/");
  const file = {
    name: "triangle.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(),
  };
  await page.locator('input[accept^="audio/"]').setInputFiles(file);
  await expect(page.getByText("1 assets in this session")).toBeVisible();
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page
    .getByRole("button", { name: "Audio Silhouette", exact: true })
    .click();
  const image = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".preview-stage canvas",
      )!;
      const pixels = canvas
        .getContext("2d")!
        .getImageData(400, 120, 480, 480).data;
      const values: number[] = [];
      for (let i = 0; i < pixels.length; i += 16)
        values.push(pixels[i], pixels[i + 1], pixels[i + 2]);
      return values;
    });
  await expect
    .poll(async () => (await image()).filter((value) => value > 100).length)
    .toBeGreaterThan(100);
  const builtIn = await image();
  const [modelId] = await page
    .getByLabel("Silhouette model")
    .selectOption({ label: "triangle.glb" });
  const changedPixels = async (baseline: number[]) => {
    const current = await image();
    return current.reduce(
      (sum, value, index) =>
        sum + (Math.abs(value - baseline[index]) > 15 ? 1 : 0),
      0,
    );
  };
  await expect.poll(() => changedPixels(builtIn)).toBeGreaterThan(100);
  const custom = await image();
  await page.getByLabel("Motion speed").fill("140");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem("pulseframe-project") || "{}",
        );
        const clip = saved.clips?.find(
          (item: { effect?: string }) => item.effect === "audio-silhouette",
        );
        return [clip?.modelAssetId, clip?.visualizerSpeed];
      }),
    )
    .toEqual([modelId, 140]);
  await page.reload();
  await page.locator(".clip-visualizer").click();
  await expect(
    page.getByText("RE-IMPORT REQUIRED", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Silhouette model")).toContainText(
    "triangle.glb (re-import required)",
  );
  await page.getByRole("button", { name: "↗ Export video" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start export" })
    .click();
  await expect(
    page.getByText("Re-import the missing project media before exporting."),
  ).toBeVisible();
  await page.locator('input[accept^="audio/"]').setInputFiles(file);
  await expect(
    page.getByText("RE-IMPORT REQUIRED", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Silhouette model")).toHaveValue(modelId);
  await expect.poll(() => changedPixels(custom)).toBe(0);
});

test("models with external resources are rejected", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[accept^="audio/"]').setInputFiles({
    name: "external.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(true),
  });
  await expect(
    page.getByText("GLB models must embed all resources.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("0 assets in this session")).toBeVisible();
});

test("the preview recovers after an unsupported WebGL visualizer is removed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        return type === "webgl2"
          ? null
          : Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Plasma Orb", exact: true }).click();
  await expect(
    page.getByText("Preview failed:", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete selected clip" }).click();
  await page.getByRole("button", { name: "Kaleidoscope", exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          ".preview-stage canvas",
        )!;
        const pixels = canvas
          .getContext("2d")!
          .getImageData(400, 120, 480, 480).data;
        let bright = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 80 && pixels[i + 2] > 80) bright++;
        return bright;
      }),
    )
    .toBeGreaterThan(100);
});

test("feedback history is cleared when seeking backwards", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page
    .getByRole("button", { name: "Feedback Tunnel", exact: true })
    .click();
  const ruler = page.locator(".timeline-ruler");
  await ruler.click({ position: { x: 32, y: 5 } });
  const snapshot = () =>
    page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const canvas = document.querySelector<HTMLCanvasElement>(
        ".preview-stage canvas",
      )!;
      const pixels = canvas
        .getContext("2d")!
        .getImageData(400, 120, 480, 480).data;
      const result: number[] = [];
      for (let i = 0; i < pixels.length; i += 32)
        result.push(pixels[i], pixels[i + 1], pixels[i + 2]);
      return result;
    });
  const initial = await snapshot();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await ruler.click({ position: { x: 32, y: 5 } });
  await expect.poll(snapshot).toEqual(initial);
});

test("3D, 2D, feedback and custom model visualizers appear in exports", async ({
  page,
}) => {
  test.setTimeout(80000);
  await page.goto("/");
  const clips = [
    ["plasma-orb", "#ff0000", 0],
    ["kaleidoscope", "#00ff00", 2],
    ["feedback-tunnel", "#00ffff", 4],
    ["audio-silhouette", "#0000ff", 6],
  ].map(([effect, color, start], index) => ({
    id: `effect-${index}`,
    name: String(effect),
    lane: "visualizer",
    start,
    duration: 2,
    x: 640,
    y: 360,
    scale: 100,
    rotation: 0,
    opacity: 100,
    visible: true,
    animation: "none",
    effect,
    color,
    ...(effect === "audio-silhouette" ? { modelAssetId: "model" } : {}),
  }));
  const project = {
    name: "Visualizers",
    aspect: "16:9",
    assets: [
      {
        id: "model",
        name: "triangle.glb",
        type: "model",
        size: triangleGlb().length,
      },
    ],
    clips,
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.locator('input[accept^="audio/"]').setInputFiles({
    name: "triangle.glb",
    mimeType: "model/gltf-binary",
    buffer: triangleGlb(),
  });
  await expect(page.getByText("1 assets in this session")).toBeVisible();
  await page.getByRole("button", { name: "↗ Export video" }).click();
  const dialog = page.getByRole("dialog", { name: "Export your video" });
  await dialog.getByLabel("Resolution").selectOption("720");
  const download = page.waitForEvent("download", { timeout: 50000 });
  await dialog.getByRole("button", { name: "Start export" }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  const counts = await page.evaluate(
    async ({ base64, type }) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([data], { type }));
      try {
        const video = document.createElement("video");
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error("Cannot decode export"));
        });
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        const counts: number[] = [];
        for (const [index, time] of [1, 3, 5, 7].entries()) {
          video.currentTime = time;
          await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error("Cannot seek export"));
          });
          ctx.drawImage(video, 0, 0);
          const pixels = ctx.getImageData(400, 120, 480, 480).data;
          let count = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            const [red, green, blue] = [
              pixels[i],
              pixels[i + 1],
              pixels[i + 2],
            ];
            if (
              index === 0 &&
              red > 70 &&
              red > green * 1.5 &&
              red > blue * 1.4
            )
              count++;
            if (
              index === 1 &&
              green > 70 &&
              green > red * 1.5 &&
              green > blue * 1.5
            )
              count++;
            if (
              index === 2 &&
              green > 55 &&
              blue > 55 &&
              green > red * 1.5 &&
              blue > red * 1.5
            )
              count++;
            if (
              index === 3 &&
              blue > 70 &&
              blue > red * 1.5 &&
              blue > green * 1.5
            )
              count++;
          }
          counts.push(count);
        }
        return counts;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    {
      base64: bytes.toString("base64"),
      type: file.suggestedFilename().endsWith(".mp4")
        ? "video/mp4"
        : "video/webm",
    },
  );
  expect(counts[0], `Plasma orb pixels: ${counts}`).toBeGreaterThan(30);
  expect(counts[1], `Kaleidoscope pixels: ${counts}`).toBeGreaterThan(30);
  expect(counts[2], `Feedback pixels: ${counts}`).toBeGreaterThan(30);
  expect(counts[3], `Silhouette pixels: ${counts}`).toBeGreaterThan(30);
});

test("string visualizer reacts to audio and retains its instrument after reload", async ({
  page,
}) => {
  await page.goto("/");
  const tone = kickTrack(5);
  for (let i = 0; i < 5 * 48000; i++)
    tone.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 196 * i) / 48000) * 0.7 * 32767),
      44 + i * 2,
    );
  await page.locator('input[accept^="audio/"]').setInputFiles({
    name: "tone.wav",
    mimeType: "audio/wav",
    buffer: tone,
  });
  await expect(page.getByText("1 assets in this session")).toBeVisible();
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Strings", exact: true }).click();
  await expect(page.getByLabel("Instrument")).toHaveValue("guitar");
  await page.waitForTimeout(100);
  const idle = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".preview-stage canvas",
    )!;
    return Array.from(
      canvas.getContext("2d")!.getImageData(400, 200, 400, 320).data,
    );
  });
  await page.locator(".play-button").click();
  await expect
    .poll(
      async () =>
        page.evaluate((baseline) => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            ".preview-stage canvas",
          )!;
          const pixels = canvas
            .getContext("2d")!
            .getImageData(400, 200, 400, 320).data;
          let changed = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (
              Math.abs(pixels[i] - baseline[i]) +
                Math.abs(pixels[i + 1] - baseline[i + 1]) +
                Math.abs(pixels[i + 2] - baseline[i + 2]) >
              50
            )
              changed++;
          return changed;
        }, idle),
      { timeout: 5000 },
    )
    .toBeGreaterThan(100);
  await page.locator(".play-button").click();
  await page.getByLabel("Instrument").selectOption("veena");
  await page.getByLabel("Instrument").selectOption("harp");
  for (const [aspect, width, height] of [
    ["16:9", 1280, 720],
    ["9:16", 720, 1280],
    ["1:1", 900, 900],
  ] as const) {
    await page.getByLabel("Canvas aspect ratio").selectOption(aspect);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            ".preview-stage canvas",
          )!;
          return [canvas.width, canvas.height];
        }),
      )
      .toEqual([width, height]);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const canvas = document.querySelector<HTMLCanvasElement>(
            ".preview-stage canvas",
          )!;
          const { width, height } = canvas,
            data = canvas
              .getContext("2d")!
              .getImageData(0, 0, width, height).data;
          let left = width,
            right = 0,
            top = height,
            bottom = 0,
            count = 0;
          for (let y = 0; y < height; y += 2)
            for (let x = 0; x < width; x += 2) {
              const i = (y * width + x) * 4;
              if (Math.max(data[i], data[i + 1], data[i + 2]) > 120) {
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
                count++;
              }
            }
          return (
            count > 100 &&
            left > width * 0.02 &&
            right < width * 0.98 &&
            top > height * 0.02 &&
            bottom < height * 0.98
          );
        }),
      )
      .toBe(true);
  }
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("pulseframe-project") || "{}",
          ).clips?.find(
            (clip: { effect?: string }) => clip.effect === "strings",
          )?.stringInstrument,
      ),
    )
    .toBe("harp");
  await page.reload();
  await page.locator(".clip-visualizer").click();
  await expect(page.getByLabel("Instrument")).toHaveValue("harp");
  await expect(page.getByText("Preview failed", { exact: false })).toHaveCount(
    0,
  );
});

test("string visualizer is present in exported video", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Strings", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Duration" }).fill("1");
  await page.getByRole("button", { name: "↗ Export video" }).click();
  const dialog = page.getByRole("dialog", { name: "Export your video" });
  await dialog.getByLabel("Resolution").selectOption("720");
  const download = page.waitForEvent("download", { timeout: 35000 });
  await dialog.getByRole("button", { name: "Start export" }).click();
  const file = await download;
  const bytes = await readFile(await file.path());
  const redPixels = await page.evaluate(
    async ({ base64, type }) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([data], { type }));
      try {
        const video = document.createElement("video");
        video.src = url;
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error("Cannot decode export"));
        });
        video.currentTime = 0.5;
        await new Promise<void>((resolve, reject) => {
          video.onseeked = () => resolve();
          video.onerror = () => reject(new Error("Cannot seek export"));
        });
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(video, 0, 0);
        const pixels = ctx.getImageData(400, 174, 480, 12).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 100 && pixels[i] > pixels[i + 1] * 1.3) count++;
        return count;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    {
      base64: bytes.toString("base64"),
      type: file.suggestedFilename().endsWith(".mp4")
        ? "video/mp4"
        : "video/webm",
    },
  );
  expect(redPixels).toBeGreaterThan(100);
});

test("beat effects react to kicks in the playing audio", async ({ page }) => {
  await page.goto("/");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#202020";
    ctx.fillRect(0, 0, 640, 360);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[accept^="audio/"]').setInputFiles([
    {
      name: "dark.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    },
    { name: "kicks.wav", mimeType: "audio/wav", buffer: kickTrack() },
  ]);
  await expect(page.getByText("2 assets in this session")).toBeVisible();
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Invert Flash", exact: true }).click();
  await page.locator(".play-button").click();
  const brightness = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
        ".preview-stage canvas",
      )!,
      ctx = canvas.getContext("2d")!,
      values: number[] = [];
    for (let i = 0; i < 100; i++) {
      const [r, g, b] = ctx.getImageData(
        canvas.width / 2,
        canvas.height / 2,
        1,
        1,
      ).data;
      values.push((r + g + b) / 3);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return values;
  });
  expect(Math.min(...brightness)).toBeLessThan(60);
  expect(Math.max(...brightness)).toBeGreaterThan(140);

  for (const name of [
    "Spectrum",
    "Mirror Bars",
    "Radial Bars",
    "Circular",
    "Waveform",
    "Neon",
    "Particles",
    "Pulse",
    "Beat Zoom",
    "Shake",
    "Glitch",
    "Rgb Split",
    "Hue Shift",
    "Color Flash",
    "Strobe",
    "Duotone",
    "Vhs",
    "Bloom",
    "Vignette Pulse",
    "Mirror",
  ])
    await page.getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(1500);
  await expect(page.getByText("Preview failed", { exact: false })).toHaveCount(
    0,
  );
  expect(await page.locator(".clip-visualizer").count()).toBe(21);
});

test("portrait previews retain their selected aspect ratio", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Canvas aspect ratio").selectOption("9:16");
  await expect
    .poll(async () => {
      const bounds = await page.locator(".preview-stage").boundingBox();
      return bounds ? bounds.width / bounds.height : 0;
    })
    .toBeCloseTo(9 / 16, 2);
});

test("invalid saved data is not overwritten by autosave", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("pulseframe-project", "{invalid"),
  );
  await page.goto("/");
  await expect(
    page.getByText("Autosave paused", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Project name").fill("Unsaved work");
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(() => localStorage.getItem("pulseframe-project")),
  ).toBe("{invalid");
});

test("splitting a media clip preserves the second clip's source offset", async ({
  page,
}) => {
  await page.goto("/");
  const project = {
    name: "Split",
    aspect: "16:9",
    assets: [{ id: "video", name: "clip.mp4", type: "video", size: 1 }],
    clips: [
      {
        id: "clip",
        assetId: "video",
        name: "clip.mp4",
        lane: "video",
        start: 0,
        duration: 10,
        x: 640,
        y: 360,
        scale: 100,
        rotation: 0,
        opacity: 100,
        visible: true,
        animation: "none",
      },
    ],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.locator(".clip-video").click();
  await page
    .locator(".track-lane")
    .nth(4)
    .click({ position: { x: 40, y: 15 } });
  await page.getByRole("button", { name: "⌁ Split" }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("pulseframe-project") || "{}").clips
            ?.length,
      ),
    )
    .toBe(2);
  const clips = await page.evaluate(
    () => JSON.parse(localStorage.getItem("pulseframe-project")!).clips,
  );
  expect(clips[0].duration).toBeCloseTo(5, 1);
  expect(clips[1].offset).toBeCloseTo(5, 1);
});

test("very long project timelines do not create an unbounded number of ruler ticks", async ({
  page,
}) => {
  await page.goto("/");
  const project = {
    name: "Long",
    aspect: "16:9",
    assets: [],
    clips: [
      {
        id: "text",
        name: "Long clip",
        lane: "text",
        start: 0,
        duration: 1000000000,
        x: 640,
        y: 360,
        scale: 100,
        rotation: 0,
        opacity: 100,
        visible: true,
        animation: "none",
      },
    ],
  };
  await page.locator('input[accept=".json,application/json"]').setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByText("Long clip")).toBeVisible();
  expect(await page.locator(".ruler-tick").count()).toBeLessThanOrEqual(501);
});

test("exports a decodable video at the requested dimensions", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "✳ Effects" }).click();
  await page.getByRole("button", { name: "Spectrum", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Duration" }).fill("1");
  await page.getByRole("button", { name: "↗ Export video" }).click();
  const dialog = page.getByRole("dialog", { name: "Export your video" });
  await dialog.getByLabel("Resolution").selectOption("720");
  const format = dialog.getByLabel("Format");
  const mp4 = format.locator("option").filter({ hasText: "MP4" });
  if (!(await mp4.isDisabled()))
    await format.selectOption({ label: "MP4 · H.264" });
  const downloaded = page.waitForEvent("download", { timeout: 35000 });
  await dialog.getByRole("button", { name: "Start export" }).click();
  const file = await downloaded;
  const bytes = await readFile(await file.path());
  expect(bytes.length).toBeGreaterThan(1000);
  const dimensions = await page.evaluate(
    async ({ base64, type }) => {
      const binary = atob(base64),
        data = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([data], { type }));
      try {
        const video = document.createElement("video");
        return await new Promise<{ width: number; height: number }>(
          (resolve, reject) => {
            video.onloadeddata = () =>
              resolve({ width: video.videoWidth, height: video.videoHeight });
            video.onerror = () => reject(new Error("Export cannot be decoded"));
            video.src = url;
          },
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    {
      base64: bytes.toString("base64"),
      type: file.suggestedFilename().endsWith(".mp4")
        ? "video/mp4"
        : "video/webm",
    },
  );
  expect(dimensions).toEqual({ width: 1280, height: 720 });
});

test("video extraction and upscaling preserve audible source audio", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "◈ Media" }).click();
  const mime = "video/mp4;codecs=avc1.42E01E,mp4a.40.2";
  test.skip(
    !(await page.evaluate((type) => MediaRecorder.isTypeSupported(type), mime)),
    "Browser lacks MP4 encoding with audio.",
  );
  const input = await page.evaluate(async (type) => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const audio = new AudioContext(),
      oscillator = audio.createOscillator(),
      output = audio.createMediaStreamDestination();
    oscillator.frequency.value = 440;
    oscillator.connect(output);
    oscillator.start();
    await audio.resume();
    const video = canvas.captureStream(30);
    const stream = new MediaStream([
      ...video.getVideoTracks(),
      ...output.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(stream, { mimeType: type });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.start();
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `hsl(${i * 4},80%,50%)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await new Promise((resolve) => setTimeout(resolve, 33));
    }
    recorder.stop();
    await stopped;
    oscillator.stop();
    video.getTracks().forEach((track) => track.stop());
    await audio.close();
    const blob = new Blob(chunks, { type: "video/mp4" });
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(blob);
    });
  }, mime);
  const inputFile = {
    name: "tone.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from(input, "base64"),
  };
  await page.locator('input[accept^="audio/"]').setInputFiles(inputFile);
  await expect(page.getByText("1 assets in this session")).toBeVisible();
  await page.getByRole("button", { name: "↗ Export video" }).click();
  const dialog = page.getByRole("dialog", { name: "Export your video" });
  await dialog.getByLabel("Resolution").selectOption("720");
  await dialog.getByLabel("Format").selectOption({ label: "MP4 · H.264" });
  const compositionDownload = page.waitForEvent("download", { timeout: 30000 });
  await dialog.getByRole("button", { name: "Start export" }).click();
  const composition = await compositionDownload;
  expect(
    await audioPeak(page, await readFile(await composition.path())),
  ).toBeGreaterThan(0.01);
  const extracted = page.waitForEvent("download");
  await page.getByTitle("Extract audio as WAV").click();
  expect((await extracted).suggestedFilename()).toBe("tone.wav");
  await expect(
    page.getByText("WAV extracted and added to your project."),
  ).toBeVisible();

  await page.getByRole("button", { name: "⇧ Upscale" }).click();
  await page
    .locator('.sidebar-content input[type="file"]')
    .setInputFiles(inputFile);
  await expect(page.locator(".upscaler-metadata")).toContainText(
    "Source 640 × 360",
  );
  await page.getByLabel("Target").selectOption("720");
  await page.getByLabel("Source policy").selectOption("downscale");
  await page.getByLabel("Codec").selectOption({ label: "MP4 · H.264" });
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.getByRole("button", { name: "Process batch" }).click();
  await page.getByRole("button", { name: "◈ Media" }).click();
  const result = await downloadPromise;
  await page.getByRole("button", { name: "⇧ Upscale" }).click();
  await expect(page.locator(".upscaler-job")).toContainText(
    "1 completed, 0 failed",
  );
  const output = await readFile(await result.path());
  expect(await audioPeak(page, output)).toBeGreaterThan(0.01);
});
