# Pulseframe — Image to Motion

Pulseframe includes a browser-native, deterministic image-motion workflow. It moves a virtual camera across still images; it does not use generative AI.

## Try it

1. Open `index.html` in a recent browser.
2. Import one or more PNG, JPEG, or WebP images (images up to 8192 px on either edge are accepted).
3. Choose **Motion** in the left sidebar, select an image, choose a preset, set the duration and easing, and apply the camera move.
4. Drag the outlined start and end frames over the preview. Use **＋ Keyframe** at the playhead, or drag the keyframe dots / edit their values.
5. Choose an aspect ratio in the preview toolbar and export at 720p, 1080p, 1440p, or 4K using a supported WebM encoder.

Preview and export share the same scene-rendering path. Export draws directly at the selected output dimensions, choosing image-pyramid levels for that resolution instead of enlarging the preview canvas.

Camera keyframes use normalized image coordinates and logarithmic zoom. The camera crop is clamped independently in source X and Y, including rotation safety margins. PCHIP interpolation is the default; linear, ease-in, ease-out, ease-in/out, and hold are available. The renderer creates full, 2/3, and 1/2 image levels, selecting the closest level for the current crop and output size. Browsers that support the `srgb-linear` canvas color space use it for the downsampled levels; other browsers fall back to their native color-managed 2D canvas.

Presets include Ken Burns, directional pans, diagonal drift, orbit, dolly, reveal, detail tour, handheld, and breathing. Detail tours use the **＋ Point of interest** control. Optional looks include dimming, vignette, deterministic film grain, floating dust, and audio-reactive zoom pulse. Project autosave and exported project configurations preserve motion tracks.

## Tests and examples

- Open `tests/motion.test.html` to run browser unit tests for crop clamping, interpolation, presets, and chunk concatenation.
- `example-presets.json` contains reusable preset settings.
- `samples/stillwater-4k-motion.mp4` is a playable 10-second H.264/AAC sample rendered from the bundled 3840 × 2160 image.
- Open `samples/motion-preview.html` for a live motion preview of the same image and an on-demand WebM export.

## Browser limitations

This is a client-side editing feature. Input decoding, `AudioContext`, canvas color management, and video encoding depend on browser support. Composition export is WebM through `MediaRecorder`; FFmpeg chunk-resume/muxing, depth estimation, image inpainting, and GPU shaders are not provided. Large source images and 4K canvas recording need substantial device memory. The app preserves camera settings but does not embed imported media bytes in saved project files.

## Video upscaler

The **Upscale** panel accepts MP4, MOV, MKV, WebM, and AVI filenames, then validates actual decodability and reads dimensions/duration through the browser video decoder; extensions are not treated as proof of codec support. It provides 720p, 1080p, 4K, source/16:9/9:16/square framing, pad/crop/stretch, a greater-than-2× warning, keep-as-is/downscale handling, a sequential batch queue, and before/after frame previews. Presets cover Fast draft, YouTube 1080p, YouTube 4K, and a source-aspect 4K archive target.

Only **Fast** is implemented: browser Canvas high-quality resampling. At startup, the app checks `MediaRecorder` support and enables the available WebM VP8/VP9 and/or MP4 H.264/H.265 choices; actual encoder initialization can still fail on some devices. The app verifies that output decodes at the requested dimensions before downloading it. This validation does not guarantee source-matched duration, frame rate, audio sync, metadata/color tags, or stream-copy audio: browser recording re-encodes captured media and is best-effort. FFmpeg chunked processing, resumable jobs, and neural methods are not included. Unavailable codecs and denoise/sharpen controls are disabled rather than simulated.

**Model support/install:** no neural models or inference runtime are bundled or supported by this browser-only build. Balanced and Best remain disabled. Adding them requires a connected processing backend (for example FFmpeg plus ONNX Runtime/ncnn and compatible video models); installing weights alone will not enable those options. The `parseFfprobe` helper accepts ffprobe JSON for metadata parsing/tests, but the app does not execute ffprobe.

Open `tests/upscaler.test.html` for aspect-ratio, fit-mode, ffprobe-JSON, and chunk-concatenation tests. Import `samples/stillwater-4k-motion.mp4` as a repeatable comparison source; the panel shows its decoded source frame beside the selected output-size preview.

## Lyrics and video audio

The Text panel accepts LRC, YouTube SBV (`start,end` timestamp pairs), and plain-text lyrics. SBV cues honor both their start and end times and can contain multiline captions. Video clips play their embedded audio during preview and composition export, synchronized to the clip timeline; when a separate audio asset is present, that audio remains the soundtrack and video audio is muted. Browser decoding and playback support still depends on the source codec.

Open `tests/lyrics.test.html` to test SBV, LRC, and plain-text parsing.
