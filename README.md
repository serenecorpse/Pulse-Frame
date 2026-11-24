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

Import images, audio, video, LRC, SBV, or text files in the Media panel. Select a timeline clip to edit its timing and properties. Add visualizers from Effects, or select an image and apply a camera preset in Motion. Camera guides and graph dots are draggable; keyframe values and times can also be edited. The Text panel supports LRC, SBV, and plain lyrics.

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
