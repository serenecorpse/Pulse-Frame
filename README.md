# Pulseframe

Pulseframe is a browser-based music-video editor built with Next.js, React, and TypeScript. The original standalone application, its examples, and its browser tests are preserved in [legacy](./legacy/).

## Run

Use Node.js 22.6 or newer:

```sh
npm install
npm run dev
```

Open http://localhost:3000. For a production build, run `npm run build` followed by `npm start`.

## Editing

Import images, audio, video, LRC, SBV, or text files in the Media panel. Select a timeline clip to edit its timing and properties. Select an image and apply a camera preset in Motion. Camera guides and graph dots are draggable; keyframe values and times can also be edited. The Text panel supports LRC, SBV, and plain lyrics.

Choose a lyric font and display effect in the Text panel: classic, fade, rise, pop, typewriter, or neon. Effects restart for each lyric cue and are included in exports; karaoke highlighting remains available for timed lyrics. Fonts use those installed on the device with browser fallbacks, so their appearance can vary by system.

Use **Layers** to select or hide clips and move footage forward or backward. The composition uses fixed stages: footage, Beat FX, equalizers, then text. Only footage can be reordered; effects cannot be moved between stages.

Drag clips on the timeline to move them, or drag their edge handles to trim them. Overlapping clips occupy separate rows. Click the ruler to seek. Snap aligns clip edges with the playhead and other clips; turn it off with **Snap** or hold Alt while dragging. Lyrics clips cannot be trimmed, split, or duplicated. Drag the selected layer's preview handle to reposition it; it snaps to the canvas center when snapping is enabled. Undo restores a completed drag.

The Effects panel has two groups of audio-reactive layers, placed at the playhead:

- **Equalizers** are drawn over the footage: Spectrum, Mirror bars, Radial bars, Circular, Waveform, Neon, Particles, Pulse, and Strings. Color, sensitivity, position, scale, and rotation are editable.
- **Beat FX** transform the image and video beneath them: Beat zoom, Shake, Glitch, RGB split, Hue shift, Color flash, Strobe, Duotone, Invert flash, VHS, Bloom, Vignette pulse, and Mirror. Equalizers and lyrics are drawn afterwards and stay unaffected. Position sets the focal point for Beat zoom and Vignette pulse.

Beats are detected from bass energy in the playing audio, so beat effects are mostly idle while paused or silent. Strobe and Invert flash fire on alternate beats to limit flash frequency, but they may still affect photosensitive viewers. Image and video clips also have a **beat pulse** animation.

Select **Strings** and choose Guitar, Veena / Sitar, or Harp in the Inspector. Each string reacts to nearby audio frequencies; the Veena mode also has faint sympathetic strings. String tint defaults to white, preserving the note colors. The visualization approximates frequency energy rather than detecting individual notes, and is included in video exports.

Projects autosave in browser local storage. **Project files and autosave contain settings and media references, not the media bytes.** Re-import media with the same filename and type after opening a project or reloading the page. Legacy Pulseframe JSON projects can be opened in the new editor. The original app can still be opened directly at [legacy/index.html](./legacy/index.html).

Export records the composition in real time using browser-supported encoders. The Upscale panel uses browser canvas resampling, supports batch processing and re-encodes captured audio. The resulting video is checked for decodability and expected dimensions before download. Exact timing, audio synchronization, source frame rate, color metadata, and audio stream-copy are not guaranteed. Codec support varies by browser. Keep the tab open during processing.

Image motion is deterministic camera movement, not generative AI. Neural upscaling, denoise/sharpen, FFmpeg processing, resumable jobs, depth estimation, and inpainting are not included. Large images and 4K output can require substantial device memory.

## Tests

```sh
npm run typecheck
npm run test:unit
npx playwright install chromium
npm run test:e2e
```

The browser tests include project restoration, autosave failure, video export, WAV extraction, and audio-preserving upscaling. To use an existing Chromium installation instead of Playwright's browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable path before running the browser tests. Tests that require an unsupported browser encoder are skipped.

The original browser-only tests and sample preview remain under [legacy/tests](./legacy/tests/) and [legacy/samples](./legacy/samples/).
