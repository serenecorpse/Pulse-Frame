import test from "node:test";
import assert from "node:assert/strict";
import { activeCueAtTime, parseLyrics } from "../src/lib/lyrics.ts";
import {
  buildPreset,
  cameraAt,
  cameraCrop,
  interpolateTrack,
} from "../src/lib/motion.ts";
import {
  BeatTracker,
  logBands,
  silentFeatures,
} from "../src/lib/audio-features.ts";
import {
  instrumentStrings,
  stringDisplacement,
  stringLevel,
} from "../src/lib/strings.ts";

test("string frequencies follow the corresponding logarithmic audio bands", () => {
  const audio = silentFeatures();
  const position = Math.round(
    (Math.log(196 / 32) / Math.log(16000 / 32)) * audio.bands.length - 0.5,
  );
  audio.bands[position] = 1;
  assert.ok(stringLevel(audio, 196) > 0.5);
  assert.equal(stringLevel(audio, 330), 0);
  assert.equal(stringLevel(audio, 20000), 0);
  audio.sampleRate = 16000;
  assert.equal(stringLevel(audio, 9000), 0);
});

test("instrument strings stay anchored and can vibrate between their endpoints", () => {
  assert.deepEqual(
    Object.values(instrumentStrings).map((notes) => notes.length),
    [6, 4, 12],
  );
  for (const phase of [0, 1, 2]) {
    assert.equal(stringDisplacement(0, phase), 0);
    assert.equal(stringDisplacement(1, phase), 0);
  }
  assert.notEqual(stringDisplacement(0.5, 0), stringDisplacement(0.5, 1));
});

function spectrum(bass: number, rest = 60): Uint8Array {
  const data = new Uint8Array(512).fill(rest);
  for (let i = 1; i <= 3; i++) data[i] = bass;
  return data;
}

test("beat tracker detects kicks at 120 BPM and ignores a sustained bass tone", () => {
  const kicks = new BeatTracker(),
    steady = new BeatTracker();
  const onsets: number[] = [];
  let previous = 0;
  for (let frame = 0; frame < 240; frame++) {
    const time = frame / 60,
      kicking = time % 0.5 < 0.05;
    const features = kicks.update(spectrum(kicking ? 230 : 70), 48000, 1 / 60);
    if (features.beatCount > previous) onsets.push(time);
    previous = features.beatCount;
    steady.update(spectrum(230), 48000, 1 / 60);
  }
  assert.ok(
    onsets.length >= 7 && onsets.length <= 8,
    `expected 7–8 beats, got ${onsets.length}`,
  );
  for (const onset of onsets)
    assert.ok(onset % 0.5 < 0.06, `beat at ${onset}s is not on a kick`);
  assert.equal(steady.update(spectrum(230), 48000, 1 / 60).beatCount, 0);
});

test("beat envelope decays without audio and bass maps to the lowest bands", () => {
  const tracker = new BeatTracker();
  for (let i = 0; i < 30; i++) tracker.update(spectrum(70), 48000, 1 / 60);
  assert.ok(tracker.update(spectrum(240), 48000, 1 / 60).beat > 0.4);
  for (let i = 0; i < 60; i++) tracker.update(undefined, 48000, 1 / 60);
  assert.ok(tracker.update(undefined, 48000, 1 / 60).beat < 0.01);
  const bands = logBands(spectrum(255, 0), 48000);
  assert.ok(bands[0] > 0.9 && bands[bands.length - 1] === 0);
});

test("SBV preserves multi-line captions and respects cue end times", () => {
  const cues = parseLyrics(
    "0:00:02.500,0:00:04.000\nHello\nworld\n\n0:00:05.000,0:00:06.000\nLater",
  );
  assert.equal(cues[0].text, "Hello\nworld");
  assert.equal(activeCueAtTime(cues, 2.5)?.text, "Hello\nworld");
  assert.equal(activeCueAtTime(cues, 4), null);
});

test("LRC and plain text timing remain supported", () => {
  const cues = parseLyrics("[00:02.00]First\n[00:05.00]Second");
  assert.equal(activeCueAtTime(cues, 4)?.text, "First");
  assert.equal(activeCueAtTime(cues, 5)?.text, "Second");
  assert.equal(activeCueAtTime(parseLyrics("One\nTwo"), 4)?.text, "Two");
});

test("camera interpolation handles duplicate keyframes and hold easing", () => {
  const track = [
    { t: 0, v: 0 },
    { t: 5, v: 1 },
    { t: 5, v: 2 },
    { t: 10, v: 3 },
  ];
  assert.equal(interpolateTrack(track, 5, "linear"), 2);
  assert.equal(interpolateTrack(track, 2, "hold"), 0);
  assert.equal(interpolateTrack(track, 10, "hold"), 3);
});

test("all camera presets produce finite, bounded camera values", () => {
  for (const name of [
    "ken-burns",
    "pan-left",
    "pan-right",
    "pan-up",
    "pan-down",
    "diagonal",
    "orbit",
    "dolly",
    "reveal",
    "detail-tour",
    "handheld",
    "breathing",
  ] as const) {
    const motion = buildPreset(name, 10, 0.65);
    for (const time of [0, 5, 10]) {
      const camera = cameraAt(motion, time);
      assert.ok(
        camera.cx >= 0 && camera.cx <= 1 && camera.cy >= 0 && camera.cy <= 1,
      );
      assert.ok(
        Number.isFinite(camera.zoom) &&
          camera.zoom >= 1 &&
          Number.isFinite(camera.rotation),
      );
    }
  }
});

test("rotated camera crops stay within a non-square source", () => {
  for (const cx of [0, 1])
    for (const cy of [0, 1]) {
      const crop = cameraCrop(
        { cx, cy, zoom: 1.2, rotation: 30 },
        4000,
        2500,
        1080,
        1920,
      );
      assert.ok(crop.x >= 0 && crop.y >= 0);
      assert.ok(
        crop.x + crop.width <= 4000 + 1e-8 &&
          crop.y + crop.height <= 2500 + 1e-8,
      );
    }
});
