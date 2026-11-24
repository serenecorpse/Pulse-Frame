(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const Motion = window.PulseframeMotion;
  const Upscaler = window.PulseframeUpscaler;
  const Lyrics = window.PulseframeLyrics;
  const state = {
    assets: [], clips: [], effects: [], selectedId: null, duration: 30, zoom: 80,
    currentTime: 0, playing: false, muted: false, loop: false, raf: 0, audioCtx: null,
    analyser: null, audioSource: null, audioDestination: null, videoAudioSources: new Map(), frequencyData: null,
    timeData: null, beat: 0, beatAverage: 0, lastBeat: 0, history: [], undo: [],
    export: null, dirtyTimer: null, redo: [], pendingAssetIds: null, audioExtraction: null,
    motionAssetId: null, motionGuidesEnabled: true, draggingMotionFrame: null,
    upscaler: { files: [], selectedId: null, probedId: null, outputError: null, busy: false, cancelRequested: false, recorder: null, sourceStream: null, outputStream: null, frameRequest: 0, videoFrameRequest: 0, loadReject: null, loadToken: 0 }
  };
  const canvas = $("#previewCanvas");
  let ctx = canvas.getContext("2d", { alpha: false });
  let renderWidth = canvas.width;
  let renderHeight = canvas.height;
  const fileInput = $("#fileInput");
  const audio = new Audio();
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  const images = new Map();
  const imagePyramids = new Map();
  const videos = new Map();
  const upscaleVideo = $("#upscaleSourceVideo");
  const upscaleCanvas = $("#upscalePreviewCanvas");

  function toast(message, kind = "") {
    const item = document.createElement("div");
    item.className = `toast ${kind}`;
    item.textContent = message;
    $("#toastRegion").append(item);
    setTimeout(() => item.remove(), 3400);
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) seconds = 0;
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  function formatTimecode(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(whole / 3600)).padStart(2, "0")}:${String(Math.floor(whole / 60) % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}:${String(Math.floor((seconds % 1) * 30)).padStart(2, "0")}`;
  }
  function getAsset(id) { return state.assets.find(asset => asset.id === id); }
  function getClip(id) { return state.clips.find(clip => clip.id === id); }
  function selectedClip() { return getClip(state.selectedId); }
  function snapshot() {
    state.undo.push(JSON.stringify({ clips: state.clips, effects: state.effects }));
    if (state.undo.length > 35) state.undo.shift();
    state.redo = [];
    $("#undoButton").disabled = false;
    $("#redoButton").disabled = true;
  }
  function restoreSnapshot(value) {
    if (!value) return;
    const parsed = JSON.parse(value);
    state.clips = parsed.clips || [];
    state.effects = parsed.effects || [];
    state.selectedId = null;
    renderTimeline();
    updateInspector();
    renderFrame();
    markDirty();
  }
  function markDirty() {
    $("#saveState").textContent = "Unsaved changes";
    $("#saveState").style.color = "#d9b477";
    clearTimeout(state.dirtyTimer);
    state.dirtyTimer = setTimeout(() => {
      if (saveProject(false)) {
        $("#saveState").textContent = "All changes saved";
        $("#saveState").style.color = "";
      } else {
        $("#saveState").textContent = "Autosave failed";
      }
    }, 1000);
  }
  function niceName(name, max = 22) {
    if (name.length <= max) return name;
    const dot = name.lastIndexOf(".");
    const ext = dot > -1 ? name.slice(dot) : "";
    return name.slice(0, max - ext.length - 1) + "…" + ext;
  }
  function classify(file) {
    const type = file.type || "";
    if (type.startsWith("audio/")) return "audio";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("image/")) return "image";
    if (/\.(mp4|m4v|mov|mkv|webm|avi|mpeg|mpg)$/i.test(file.name)) return "video";
    if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return "audio";
    if (/\.(png|jpe?g|webp|gif)$/i.test(file.name)) return "image";
    if (/\.lrc$/i.test(file.name)) return "lyrics";
    if (/\.sbv$/i.test(file.name)) return "lyrics";
    if (/\.txt$/i.test(file.name)) return "text";
    return null;
  }
  function assetIcon(type) { return ({ audio: "♫", video: "▣", image: "▧", lyrics: "≡", text: "T" })[type] || "◈"; }
  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  async function importFiles(files) {
    const accepted = [...files].filter(file => classify(file));
    if (!accepted.length) { toast("Choose audio, video, image, LRC, SBV, or text files.", "error"); return; }
    for (const file of accepted) {
      const type = classify(file);
      const restored = state.pendingAssetIds?.find(item => item.name === file.name && item.type === type);
      const asset = { id: restored?.id || crypto.randomUUID(), file, name: file.name, type, url: URL.createObjectURL(file), size: file.size, duration: 0, text: "" };
      if (type === "lyrics" || type === "text") {
        try {
          asset.text = await file.text();
          $("#lyricsInput").value = asset.text;
          showPanel("textPanel");
          updateLyricsClip();
        } catch { URL.revokeObjectURL(asset.url); toast(`Couldn't read ${file.name}.`, "error"); continue; }
      } else if (type === "image") {
        const img = new Image();
        img.src = asset.url;
        try { await img.decode(); images.set(asset.id, img); } catch { URL.revokeObjectURL(asset.url); toast(`Couldn't load ${file.name}.`, "error"); continue; }
        if (img.naturalWidth > 8192 || img.naturalHeight > 8192) {
          images.delete(asset.id);
          URL.revokeObjectURL(asset.url);
          toast(`${file.name} exceeds the 8K image limit.`, "error");
          continue;
        }
        asset.duration = state.duration;
        const restoredClip = state.clips.find(clip => clip.assetId === asset.id && clip.motion);
        if (restoredClip) {
          try { imagePyramids.set(asset.id, Motion.buildPyramid(img)); }
          catch (error) { toast(`Couldn't prepare image levels: ${error.message}`, "error"); }
        }
      } else if (type === "video") {
        const vid = document.createElement("video");
        vid.crossOrigin = "anonymous";
        vid.muted = false;
        vid.src = asset.url;
        vid.preload = "metadata";
        try { await new Promise((resolve, reject) => { vid.onloadedmetadata = resolve; vid.onerror = reject; }); }
        catch { URL.revokeObjectURL(asset.url); toast(`Couldn't load ${file.name}.`, "error"); continue; }
        asset.duration = Math.max(.1, vid.duration || 10);
        videos.set(asset.id, vid);
        connectVideoAudio(asset.id, vid);
      } else if (type === "audio") {
        const probe = document.createElement("audio");
        probe.src = asset.url;
        probe.preload = "metadata";
        try {
          const duration = await new Promise((resolve, reject) => {
            probe.onloadedmetadata = () => resolve(probe.duration);
            probe.onerror = reject;
          });
          asset.duration = Number.isFinite(duration) ? duration : 30;
        } catch { asset.duration = 30; toast(`Duration metadata unavailable for ${file.name}.`); }
      }
      if (restored) state.pendingAssetIds = state.pendingAssetIds.filter(item => item !== restored);
      state.assets.push(asset);
      if (type === "audio" || type === "video" || type === "image") {
        const lane = type === "audio" ? "audio" : type;
        if (!state.clips.some(clip => clip.assetId === asset.id)) {
          state.clips.push({ id: crypto.randomUUID(), assetId: asset.id, name: file.name, lane, start: 0, duration: asset.duration || 10, x: canvas.width / 2, y: canvas.height / 2, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" });
        }
        if (type === "audio" && !audio.src) { audio.src = asset.url; audio.load(); }
      }
    }
    renderAssets();
    renderTimeline();
    updateInspector();
    renderFrame();
    if (state.assets.length) $("#previewPlaceholder").style.opacity = "0";
    setTimeout(() => { $("#previewPlaceholder").classList.toggle("hidden", state.assets.some(asset => asset.type === "image" || asset.type === "video" || asset.type === "audio")); }, 300);
    markDirty();
  }

  function renderAssets(filter = "all") {
    const list = $("#assetList");
    const visible = state.assets.filter(asset => filter === "all" || asset.type === filter || (filter === "image" && asset.type === "video"));
    $("#assetCount").textContent = `${state.assets.length} asset${state.assets.length === 1 ? "" : "s"} in this project`;
    updateMotionImageOptions();
    if (!visible.length) {
      list.innerHTML = `<div class="empty-assets"><span>◈</span><p>${state.assets.length ? "No files in this category." : "Your imported files<br>will show up here."}</p></div>`;
      return;
    }
    list.innerHTML = "";
    visible.forEach(asset => {
      const row = document.createElement("div");
      row.className = "asset-row";
      const thumb = document.createElement("div");
      thumb.className = "asset-thumb";
      if (asset.type === "image" && images.has(asset.id)) {
        const img = document.createElement("img"); img.src = asset.url; img.alt = ""; thumb.append(img);
      } else thumb.textContent = assetIcon(asset.type);
      const details = document.createElement("div"); details.className = "asset-details";
      const name = document.createElement("strong"); name.title = asset.name; name.textContent = niceName(asset.name);
      const meta = document.createElement("small"); meta.textContent = `${asset.type.toUpperCase()} · ${asset.duration ? formatTime(asset.duration) : formatSize(asset.size)}`;
      details.append(name, meta);
      if (asset.type === "video") {
        const extract = document.createElement("button");
        extract.className = "asset-extract";
        extract.textContent = "♫↓";
        extract.title = "Extract audio as WAV";
        extract.setAttribute("aria-label", `Extract audio from ${asset.name} as WAV`);
        extract.disabled = !!state.audioExtraction;
        extract.addEventListener("click", () => extractVideoAudio(asset));
        row.append(thumb, details, extract);
      }
      if (["audio", "video", "image"].includes(asset.type)) {
        const add = document.createElement("button"); add.className = "asset-add"; add.title = "Add another layer"; add.textContent = "+";
        add.addEventListener("click", () => addAssetClip(asset));
        if (asset.type !== "video") row.append(thumb, details);
        row.append(add);
      } else if (asset.type !== "video") row.append(thumb, details);
      const remove = document.createElement("button"); remove.className = "asset-remove"; remove.title = "Remove asset"; remove.textContent = "×";
      remove.addEventListener("click", () => removeAsset(asset.id));
      row.append(remove); list.append(row);
    });
  }
  function selectedUpscaleFile() {
    return state.upscaler.files.find(item => item.id === state.upscaler.selectedId) || null;
  }
  function renderUpscaleQueue() {
    const select = $("#upscaleQueue");
    const selectedId = state.upscaler.selectedId;
    select.replaceChildren();
    state.upscaler.files.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.file.name;
      select.append(option);
    });
    if (selectedId && state.upscaler.files.some(item => item.id === selectedId)) select.value = selectedId;
    $("#upscaleQueueCount").textContent = `${state.upscaler.files.length} file${state.upscaler.files.length === 1 ? "" : "s"}`;
    updateUpscalerControls();
  }
  function updateUpscalerControls() {
    const busy = state.upscaler.busy;
    $("#upscaleStartButton").disabled = busy || state.upscaler.files.length === 0 ||
      state.upscaler.probedId !== state.upscaler.selectedId || !!state.upscaler.outputError;
    $("#upscaleCancelButton").disabled = !busy;
    $("#upscaleBrowseButton").disabled = busy;
    $("#upscaleRemoveButton").disabled = busy || !state.upscaler.selectedId;
    $("#upscaleQueue").disabled = busy;
    upscaleVideo.controls = !busy;
    $$("#upscalerPanel .upscaler-fields select, #upscaleTarget, #upscaleAlready").forEach(input => { input.disabled = busy; });
  }
  async function loadUpscaleVideo(item) {
    if (upscaleVideo.dataset.fileId === item.id && upscaleVideo.readyState >= 1) return upscaleVideo;
    if (state.upscaler.loadReject) state.upscaler.loadReject(new Error("Video selection changed."));
    const token = ++state.upscaler.loadToken;
    upscaleVideo.pause();
    upscaleVideo.removeAttribute("src");
    upscaleVideo.load();
    upscaleVideo.dataset.fileId = item.id;
    await new Promise((resolve, reject) => {
      state.upscaler.loadReject = reject;
      upscaleVideo.onloadedmetadata = () => {
        if (token !== state.upscaler.loadToken) return;
        state.upscaler.loadReject = null;
        resolve();
      };
      upscaleVideo.onerror = () => {
        if (token !== state.upscaler.loadToken) return;
        state.upscaler.loadReject = null;
        reject(new Error("The browser couldn't decode this video. The file extension alone cannot confirm codec support."));
      };
      upscaleVideo.src = item.url;
      upscaleVideo.load();
    });
    if (!upscaleVideo.videoWidth || !upscaleVideo.videoHeight || !Number.isFinite(upscaleVideo.duration)) {
      throw new Error("The browser did not expose valid video dimensions and duration.");
    }
    return upscaleVideo;
  }
  function upscaleDimensions(video) {
    return Upscaler.targetDimensions($("#upscaleTarget").value, $("#upscaleAspect").value, video.videoWidth, video.videoHeight);
  }
  function upscaleMimeType(codec, includeAudio) {
    const types = {
      vp9: ["video/webm;codecs=vp9", "video/webm;codecs=vp9,opus"],
      vp8: ["video/webm;codecs=vp8", "video/webm;codecs=vp8,opus"],
      h264: ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1.42E01E,mp4a.40.2"],
      h265: ["video/mp4;codecs=hvc1", "video/mp4;codecs=hvc1,mp4a.40.2"]
    };
    return types[codec]?.[includeAudio ? 1 : 0] || "";
  }
  function configureUpscaleCodecs() {
    const select = $("#upscaleCodec");
    [...select.options].forEach(option => {
      const videoType = upscaleMimeType(option.value, false);
      const audioType = upscaleMimeType(option.value, true);
      const supported = !!window.MediaRecorder &&
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported(videoType) &&
        MediaRecorder.isTypeSupported(audioType);
      option.disabled = !supported;
      if (!supported) option.textContent = `${option.value.toUpperCase()} · unavailable in this browser`;
    });
    if (select.selectedOptions[0]?.disabled) {
      const available = [...select.options].find(option => !option.disabled);
      if (available) select.value = available.value;
    }
  }
  function drawUpscaleFrame(context, source, width, height) {
    context.save();
    context.fillStyle = "#08080c";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const rect = Upscaler.fitRect(source.videoWidth, source.videoHeight, width, height, $("#upscaleFit").value);
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
    context.restore();
  }
  function renderUpscalePreview() {
    if (upscaleVideo.readyState < 2 || !upscaleVideo.videoWidth) return;
    let dimensions;
    try { dimensions = upscaleDimensions(upscaleVideo); }
    catch { return; }
    const scale = Math.min(640 / dimensions.width, 640 / dimensions.height);
    const width = Math.max(2, Math.round(dimensions.width * scale / 2) * 2);
    const height = Math.max(2, Math.round(dimensions.height * scale / 2) * 2);
    if (upscaleCanvas.width !== width || upscaleCanvas.height !== height) {
      upscaleCanvas.width = width;
      upscaleCanvas.height = height;
    }
    const context = upscaleCanvas.getContext("2d");
    drawUpscaleFrame(context, upscaleVideo, width, height);
  }
  function updateUpscaleDetails() {
    const item = selectedUpscaleFile();
    if (!item || upscaleVideo.readyState < 1 || !upscaleVideo.videoWidth) {
      state.upscaler.outputError = null;
      $("#upscaleMetadata").textContent = "Choose a video to inspect its browser-readable metadata.";
      $("#upscaleNotice").textContent = "Fast mode uses high-quality browser resampling. Neural models, denoise/sharpen filters, and ffprobe are not installed; encoder availability is browser-dependent.";
      updateUpscalerControls();
      return;
    }
    const video = upscaleVideo;
    let target;
    try {
      target = upscaleDimensions(video);
      state.upscaler.outputError = null;
    } catch (error) {
      state.upscaler.outputError = error.message;
      $("#upscaleMetadata").textContent = error.message;
      $("#upscaleNotice").textContent = "Choose a standard aspect ratio or a smaller output target.";
      updateUpscalerControls();
      return;
    }
    const alreadyAtOrAbove = video.videoWidth >= target.width && video.videoHeight >= target.height;
    const scale = Math.max(target.width / video.videoWidth, target.height / video.videoHeight);
    const estimate = Math.max(1, Math.round(item.file.size * target.width * target.height / (video.videoWidth * video.videoHeight)));
    const metadata = [
      `Source: ${video.videoWidth} × ${video.videoHeight}`,
      `Duration: ${formatTime(video.duration)} · FPS: browser probe unavailable`,
      `Codec / color / interlace: browser probe unavailable`,
      "Hardware: browser-managed Canvas",
      `Target: ${target.width} × ${target.height}`,
      `Rough size: ${formatSize(estimate)} (content-dependent)`
    ];
    if (alreadyAtOrAbove) metadata.push("Source is already at or above the target.");
    $("#upscaleMetadata").textContent = metadata.join("\n");
    if (alreadyAtOrAbove) {
      $("#upscaleNotice").textContent = "This source already meets the target dimensions. Choose “Keep source as-is” or explicitly allow a downscale.";
    } else if (scale > 2) {
      $("#upscaleNotice").textContent = `Warning: this is a ${scale.toFixed(1)}× enlargement. Fine detail cannot be recovered by classical resampling.`;
    } else {
      $("#upscaleNotice").textContent = "Fast mode uses high-quality browser resampling. Neural models, denoise/sharpen filters, and ffprobe metadata are not available in this build.";
    }
    updateUpscalerControls();
  }
  function addUpscaleFiles(files) {
    const valid = [...files].filter(file => file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name));
    if (!valid.length) { toast("Choose MP4, MOV, MKV, WebM, or AVI videos.", "error"); return; }
    valid.forEach(file => {
      if (state.upscaler.files.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) return;
      state.upscaler.files.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
    });
    if (!state.upscaler.selectedId && state.upscaler.files.length) state.upscaler.selectedId = state.upscaler.files[0].id;
    renderUpscaleQueue();
    const item = selectedUpscaleFile();
    if (item) selectUpscaleFile(item.id);
  }
  async function selectUpscaleFile(id) {
    state.upscaler.selectedId = id || null;
    state.upscaler.probedId = null;
    state.upscaler.outputError = null;
    renderUpscaleQueue();
    const item = selectedUpscaleFile();
    if (!item) {
      upscaleVideo.pause();
      upscaleVideo.removeAttribute("src");
      upscaleVideo.load();
      $("#upscaleMetadata").textContent = "Choose a video to inspect its browser-readable metadata.";
      return;
    }
    try {
      await loadUpscaleVideo(item);
      if (state.upscaler.selectedId !== item.id) return;
      state.upscaler.probedId = item.id;
      updateUpscaleDetails();
      renderUpscalePreview();
      $("#upscaleStatus").textContent = `${item.file.name} is ready.`;
    } catch (error) {
      if (state.upscaler.selectedId !== item.id) return;
      state.upscaler.probedId = null;
      $("#upscaleMetadata").textContent = error.message;
      $("#upscaleStatus").textContent = "Video probe failed.";
      updateUpscalerControls();
      toast(`Couldn't inspect ${item.file.name}: ${error.message}`, "error");
    }
  }
  function setUpscaleProgress(percent, status) {
    const bounded = Math.max(0, Math.min(100, percent));
    $("#upscalePercent").textContent = `${Math.round(bounded)}%`;
    $("#upscaleProgressBar").style.width = `${bounded}%`;
    $("#upscaleStatus").textContent = status;
  }
  function verifyUpscaleOutput(blob, width, height) {
    const url = URL.createObjectURL(blob);
    const probe = document.createElement("video");
    probe.preload = "auto";
    probe.muted = true;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error("Timed out while validating the encoded video.")), 10000);
      const finish = error => {
        clearTimeout(timeout);
        probe.onloadeddata = null;
        probe.onerror = null;
        probe.removeAttribute("src");
        probe.load();
        URL.revokeObjectURL(url);
        if (error) reject(error);
        else resolve();
      };
      probe.onloadeddata = () => {
        if (probe.videoWidth !== width || probe.videoHeight !== height) {
          finish(new Error(`Encoded resolution is ${probe.videoWidth} × ${probe.videoHeight}, expected ${width} × ${height}.`));
        } else if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
          finish(new Error("The encoded video has no valid duration."));
        } else finish();
      };
      probe.onerror = () => finish(new Error("The browser couldn't decode the encoded output."));
      probe.src = url;
      probe.load();
    });
  }
  async function processUpscaleFile(item, index, total) {
    const video = await loadUpscaleVideo(item);
    if (state.upscaler.cancelRequested) return false;
    const target = upscaleDimensions(video);
    const alreadyAtOrAbove = video.videoWidth >= target.width && video.videoHeight >= target.height;
    if (alreadyAtOrAbove && $("#upscaleAlready").value === "keep") {
      downloadBlob(item.file, safeFileName(item.file.name));
      setUpscaleProgress(index / total * 100, `Kept ${item.file.name} as-is.`);
      return true;
    }
    const output = document.createElement("canvas");
    output.width = target.width;
    output.height = target.height;
    const context = output.getContext("2d");
    if (!context) throw new Error("This browser couldn't allocate the output canvas.");
    const sourceStream = video.captureStream?.() || video.mozCaptureStream?.();
    if (!sourceStream) throw new Error("This browser cannot capture the source audio. Processing was stopped to avoid silently dropping audio.");
    const fpsChoice = $("#upscaleFps").value;
    const fps = fpsChoice === "source" ? 30 : Number(fpsChoice);
    let outputStream = output.captureStream(fpsChoice === "source" ? 0 : fps);
    let outputVideoTrack = outputStream.getVideoTracks()[0];
    const captureSourceFrames = fpsChoice === "source" &&
      typeof video.requestVideoFrameCallback === "function" &&
      typeof outputVideoTrack?.requestFrame === "function";
    if (fpsChoice === "source" && !captureSourceFrames) {
      outputStream.getTracks().forEach(track => track.stop());
      outputStream = output.captureStream(fps);
      outputVideoTrack = outputStream.getVideoTracks()[0];
    }
    const audioTracks = sourceStream.getAudioTracks();
    audioTracks.forEach(track => outputStream.addTrack(track));
    const codec = $("#upscaleCodec").value;
    const mimeType = upscaleMimeType(codec, audioTracks.length > 0);
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mimeType)) {
      outputStream.getTracks().forEach(track => track.stop());
      sourceStream.getTracks().forEach(track => track.stop());
      throw new Error(`This browser doesn't support ${mimeType}. Choose another available encoder or use an FFmpeg backend.`);
    }
    let recorder;
    try {
      recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: target.width * target.height >= 3840 * 2160 ? 24_000_000 : 8_000_000 });
    } catch (error) {
      outputStream.getTracks().forEach(track => track.stop());
      sourceStream.getTracks().forEach(track => track.stop());
      throw new Error(`Couldn't initialize the browser encoder: ${error.message}`);
    }
    const chunks = [];
    const startedAt = performance.now();
    const batchOffset = index / total * 100;
    const batchSpan = 100 / total;
    let lastProgressUpdate = 0;
    video.pause();
    video.currentTime = 0;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        cancelAnimationFrame(state.upscaler.frameRequest);
        if (state.upscaler.videoFrameRequest && typeof video.cancelVideoFrameCallback === "function") {
          video.cancelVideoFrameCallback(state.upscaler.videoFrameRequest);
        }
        video.pause();
        video.onended = null;
        sourceStream.getTracks().forEach(track => track.stop());
        outputStream.getTracks().forEach(track => track.stop());
        state.upscaler.recorder = null;
        state.upscaler.sourceStream = null;
        state.upscaler.outputStream = null;
      };
      const finish = error => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) { reject(error); return; }
        if (state.upscaler.cancelRequested) { resolve(false); return; }
        const blob = Upscaler.concatChunks(chunks, mimeType);
        if (!blob.size) { reject(new Error("The encoder produced an empty video.")); return; }
        const extension = safeFileName(item.file.name).replace(/\.[^.]+$/, "");
        const outputExtension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
        verifyUpscaleOutput(blob, target.width, target.height).then(() => {
          downloadBlob(blob, `${extension}-upscaled.${outputExtension}`);
          resolve(true);
        }).catch(error => reject(new Error(`Encoded output validation failed: ${error.message}`)));
      };
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = event => finish(new Error(`Upscaling failed: ${event.error?.message || "browser encoder error"}`));
      recorder.onstop = () => finish(null);
      video.onended = () => { if (recorder.state === "recording") recorder.stop(); };
      const draw = () => {
        if (settled) return;
        if (state.upscaler.cancelRequested) {
          if (recorder.state === "recording") recorder.stop();
          return;
        }
        if (video.readyState >= 2) {
          drawUpscaleFrame(context, video, target.width, target.height);
          renderUpscalePreview();
          if (captureSourceFrames) outputVideoTrack.requestFrame();
        }
        const fraction = Math.min(1, video.currentTime / Math.max(video.duration, .1));
        const now = performance.now();
        if (now - lastProgressUpdate >= 250 || fraction >= 1) {
          const elapsed = (now - startedAt) / 1000;
          const eta = fraction > 0 ? Math.max(0, Math.round(elapsed * (1 - fraction) / fraction)) : 0;
          const percent = batchOffset + batchSpan * fraction;
          setUpscaleProgress(percent, `${item.file.name} · ${Math.round(fraction * 100)}% · ETA ${formatTime(eta)}`);
          lastProgressUpdate = now;
        }
        if (video.ended || video.currentTime >= video.duration) {
          if (recorder.state === "recording") recorder.stop();
          return;
        }
        if (!captureSourceFrames) state.upscaler.frameRequest = requestAnimationFrame(draw);
      };
      const onVideoFrame = () => {
        draw();
        if (!settled && !video.ended && !state.upscaler.cancelRequested) {
          state.upscaler.videoFrameRequest = video.requestVideoFrameCallback(onVideoFrame);
        }
      };
      state.upscaler.recorder = recorder;
      state.upscaler.sourceStream = sourceStream;
      state.upscaler.outputStream = outputStream;
      try { recorder.start(250); }
      catch (error) { finish(new Error(`Couldn't start browser recording: ${error.message}`)); return; }
      video.muted = true;
      const playback = video.play();
      video.muted = false;
      playback.then(() => {
        if (captureSourceFrames) state.upscaler.videoFrameRequest = video.requestVideoFrameCallback(onVideoFrame);
        else draw();
      }).catch(error => finish(new Error(`Couldn't play ${item.file.name} for processing: ${error.message}`)));
    });
  }
  async function processUpscaleBatch() {
    if (state.upscaler.busy || !state.upscaler.files.length) return;
    state.upscaler.busy = true;
    state.upscaler.cancelRequested = false;
    updateUpscalerControls();
    $("#upscaleEta").textContent = "Processing runs in real time; keep this tab visible.";
    const files = [...state.upscaler.files];
    let completed = 0;
    let failed = 0;
    for (let index = 0; index < files.length; index++) {
      if (state.upscaler.cancelRequested) break;
      try {
        const finished = await processUpscaleFile(files[index], index, files.length);
        if (!finished) break;
        completed++;
      } catch (error) {
        failed++;
        toast(`${files[index].file.name}: ${error.message}`, "error");
        $("#upscaleStatus").textContent = `${files[index].file.name} failed: ${error.message}`;
      }
    }
    const cancelled = state.upscaler.cancelRequested;
    state.upscaler.busy = false;
    state.upscaler.cancelRequested = false;
    updateUpscalerControls();
    if (!cancelled && completed + failed === files.length && failed === 0) setUpscaleProgress(100, "Batch complete. Downloaded outputs are ready.");
    else if (cancelled) $("#upscaleStatus").textContent = `Batch cancelled after ${completed} completed file${completed === 1 ? "" : "s"}.`;
    else if (failed) {
      setUpscaleProgress(100, `Batch finished: ${completed} completed, ${failed} failed.`);
    }
    else if ($("#upscaleStatus").textContent === "Select one or more videos to begin.") return;
    $("#upscaleEta").textContent = "Browser processing does not support resumable jobs.";
  }
  function cancelUpscaleBatch() {
    if (!state.upscaler.busy) return;
    state.upscaler.cancelRequested = true;
    upscaleVideo.pause();
    if (state.upscaler.recorder?.state === "recording") state.upscaler.recorder.stop();
    $("#upscaleStatus").textContent = "Cancelling after the current video…";
  }
  function removeUpscaleFile() {
    if (state.upscaler.busy) return;
    const item = selectedUpscaleFile();
    if (!item) return;
    URL.revokeObjectURL(item.url);
    state.upscaler.files = state.upscaler.files.filter(entry => entry.id !== item.id);
    state.upscaler.selectedId = state.upscaler.files[0]?.id || null;
    renderUpscaleQueue();
    selectUpscaleFile(state.upscaler.selectedId);
  }
  function addAssetClip(asset) {
    const lane = asset.type;
    if (!["audio", "video", "image"].includes(lane)) return;
    snapshot();
    const clip = { id: crypto.randomUUID(), assetId: asset.id, name: asset.name, lane, start: state.currentTime, duration: asset.duration || 10, x: canvas.width / 2, y: canvas.height / 2, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" };
    state.clips.push(clip);
    if (lane === "audio" && !audio.src) { audio.src = asset.url; audio.load(); }
    selectClip(clip.id);
    renderTimeline(); renderFrame(); markDirty();
  }
  function motionClip() {
    return state.clips.find(clip => clip.assetId === state.motionAssetId && clipLane(clip) === "image") || null;
  }
  function updateMotionImageOptions() {
    const select = $("#motionImageSelect");
    const previous = state.motionAssetId || select.value;
    const assets = state.assets.filter(asset => asset.type === "image" && images.has(asset.id));
    select.replaceChildren();
    if (!assets.length) {
      const option = document.createElement("option");
      option.value = ""; option.textContent = "Import an image to begin";
      select.append(option);
      state.motionAssetId = null;
      updateMotionPanel();
      return;
    }
    assets.forEach(asset => {
      const option = document.createElement("option");
      option.value = asset.id; option.textContent = asset.name;
      select.append(option);
    });
    const selected = assets.find(asset => asset.id === previous) || assets[0];
    state.motionAssetId = selected.id;
    select.value = selected.id;
    updateMotionPanel();
  }
  function updateMotionPanel() {
    const clip = motionClip();
    const enabled = !!clip;
    ["#motionPresetSelect", "#motionDuration", "#motionEasing", "#motionIntensity", "#applyMotionPreset", "#addMotionKeyframe", "#addMotionPoint"].forEach(selector => { $(selector).disabled = !state.motionAssetId; });
    $("#motionDuration").value = String(Math.max(1, Math.round(clip?.motion?.duration || clip?.duration || 12)));
    if (clip?.motion) {
      $("#motionPresetSelect").value = clip.motion.preset || "ken-burns";
      $("#motionEasing").value = clip.motion.easing || "pchip";
      $("#motionIntensity").value = Math.round((clip.motion.intensity ?? 0.65) * 100);
      $("#motionIntensityValue").textContent = `${$("#motionIntensity").value}%`;
    }
    $$(".motion-look input").forEach(input => {
      input.checked = !!clip?.motion?.look?.[input.dataset.look];
      input.disabled = !clip?.motion;
    });
    $("#motionKeyframeTrack").classList.toggle("hidden", !enabled || !clip.motion);
    $("#motionKeyframeList").classList.toggle("hidden", !enabled || !clip.motion);
    if (clip?.motion) renderMotionKeyframes(clip);
    updateMotionGuides();
  }
  function applyMotionPreset() {
    const asset = getAsset(state.motionAssetId);
    if (!asset || !images.has(asset.id)) { toast("Import and select an image before applying a camera move."); return; }
    let pyramid = imagePyramids.get(asset.id);
    if (!pyramid) {
      try { pyramid = Motion.buildPyramid(images.get(asset.id)); }
      catch (error) { toast(`Couldn't prepare image levels: ${error.message}`, "error"); return; }
    }
    let clip = motionClip();
    snapshot();
    if (!clip) {
      clip = { id: crypto.randomUUID(), assetId: asset.id, name: asset.name, lane: "image", start: state.currentTime, duration: 12, x: canvas.width / 2, y: canvas.height / 2, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" };
      state.clips.push(clip);
    }
    const duration = Math.max(1, Math.min(600, Number($("#motionDuration").value) || 12));
    const preset = $("#motionPresetSelect").value;
    const oldMotion = clip.motion;
    const points = oldMotion?.points || [];
    clip.duration = duration;
    clip.motion = Motion.buildPreset(preset, duration, Number($("#motionIntensity").value) / 100, points);
    clip.motion.easing = $("#motionEasing").value;
    clip.motion.intensity = Number($("#motionIntensity").value) / 100;
    clip.motion.appliedIntensity = Math.max(0.05, clip.motion.intensity);
    clip.motion.handheldLive = preset === "handheld";
    clip.motion.look = oldMotion?.look || { dim: false, vignette: false, grain: false, dust: false, pulse: false };
    clip.motion.points = points;
    imagePyramids.set(asset.id, pyramid);
    $("#previewPlaceholder").classList.add("hidden");
    renderTimeline(); updateMotionPanel(); renderFrame(); markDirty();
    toast(`${$("#motionPresetSelect").selectedOptions[0].textContent} applied to ${asset.name}.`, "success");
  }
  function setMotionKeyframe(clip, time, camera) {
    const motion = clip.motion;
    const t = Math.max(0, Math.min(motion.duration, time));
    const values = { cx: camera.cx, cy: camera.cy, zoom: Math.log(camera.zoom), rotation: camera.rotation };
    Object.keys(values).forEach(parameter => {
      const track = motion.keyframes[parameter];
      const key = track.find(item => Math.abs(item.t - t) < .001);
      if (key) key.v = values[parameter];
      else track.push({ t, v: values[parameter] });
      track.sort((a, b) => a.t - b.t);
    });
  }
  function addMotionKeyframe() {
    const clip = motionClip();
    if (!clip?.motion) { toast("Apply a camera preset before adding keyframes."); return; }
    const time = Math.max(0, Math.min(clip.motion.duration, state.currentTime - clip.start));
    snapshot();
    setMotionKeyframe(clip, time, Motion.cameraAt(clip.motion, time));
    renderMotionPanel(); renderFrame(); markDirty();
  }
  function addMotionPoint() {
    const clip = motionClip();
    if (!clip?.motion) { toast("Apply a camera preset before marking a point of interest."); return; }
    const time = Math.max(0, Math.min(clip.motion.duration, state.currentTime - clip.start));
    const camera = Motion.cameraAt(clip.motion, time);
    snapshot();
    const points = [...clip.motion.points, [camera.cx, camera.cy]];
    const look = clip.motion.look;
    const intensity = clip.motion.intensity;
    const appliedIntensity = clip.motion.appliedIntensity;
    toast(`Point of interest ${points.length} added.`, "success");
    if (clip.motion.preset === "detail-tour") {
      clip.motion = Motion.buildPreset("detail-tour", clip.motion.duration, clip.motion.intensity, points);
      clip.motion.points = points;
      clip.motion.look = look;
      clip.motion.intensity = intensity;
      clip.motion.appliedIntensity = appliedIntensity;
    }
    renderMotionPanel(); renderFrame(); markDirty();
  }
  function renderMotionPanel() {
    const clip = motionClip();
    if (clip?.motion) renderMotionKeyframes(clip);
    updateMotionGuides();
  }
  function motionValueY(parameter, value) {
    if (parameter === "cx") return 7 + (1 - value) * 11;
    if (parameter === "cy") return 27 + (1 - value) * 11;
    if (parameter === "zoom") return 47 + (1 - Math.min(1, value / Math.log(4))) * 11;
    return 67 + (Math.max(-30, Math.min(30, value)) / 30) * 11;
  }
  function renderMotionKeyframes(clip) {
    const motion = clip.motion;
    const track = $("#motionKeyframeTrack");
    const duration = Math.max(.001, motion.duration);
    const parameters = [["cx", "#f2cf89"], ["cy", "#76d6c6"], ["zoom", "#b397ff"], ["rotation", "#ee91aa"]];
    const svg = [`<line class="motion-track-line" x1="12" y1="22" x2="288" y2="22"/><line class="motion-track-line" x1="12" y1="42" x2="288" y2="42"/><line class="motion-track-line" x1="12" y1="62" x2="288" y2="62"/><line class="motion-track-line" x1="12" y1="82" x2="288" y2="82"/>`];
    const allKeys = new Set();
    parameters.forEach(([parameter, color]) => {
      const points = motion.keyframes[parameter] || [];
      points.forEach(point => allKeys.add(point.t));
      const coords = points.map(point => `${12 + point.t / duration * 276},${motionValueY(parameter, point.v)}`);
      if (coords.length > 1) svg.push(`<polyline points="${coords.join(" ")}" fill="none" stroke="${color}" stroke-opacity=".46" stroke-width="1"/>`);
      points.forEach((point, index) => {
        const x = 12 + point.t / duration * 276;
        const y = motionValueY(parameter, point.v);
        svg.push(`<circle class="motion-track-dot" data-param="${parameter}" data-index="${index}" cx="${x}" cy="${y}" r="3.2" fill="${color}"><title>${parameter} at ${point.t.toFixed(2)}s</title></circle>`);
      });
    });
    track.innerHTML = `${svg.join("")}<text x="12" y="9">cx</text><text x="12" y="29">cy</text><text x="12" y="49">zoom</text><text x="12" y="69">rotation</text>`;
    const times = [...allKeys].sort((a, b) => a - b);
    $("#motionKeyframeCount").textContent = String(times.length);
    const list = $("#motionKeyframeList");
    list.innerHTML = "";
    if (!times.length) {
      list.innerHTML = "<p>No keyframes yet.</p>";
      return;
    }
    times.forEach(time => {
      const row = document.createElement("div"); row.className = "motion-keyframe-row";
      const stamp = document.createElement("input"); stamp.type = "number"; stamp.min = "0"; stamp.max = String(motion.duration); stamp.step = ".1"; stamp.value = time.toFixed(1); stamp.title = "Keyframe time"; stamp.dataset.param = "time"; stamp.dataset.keyTime = String(time); row.append(stamp);
      [["cx", "cx"], ["cy", "cy"], ["zoom", "zoom"], ["rotation", "rot"]].forEach(([parameter, label]) => {
        const key = motion.keyframes[parameter].find(point => Math.abs(point.t - time) < .001);
        const input = document.createElement("input"); input.type = "number"; input.step = parameter === "zoom" ? ".01" : ".01"; input.title = label; input.dataset.param = parameter; input.dataset.keyTime = String(time);
        input.value = parameter === "zoom" ? Math.exp(key?.v ?? 0).toFixed(2) : (key?.v ?? 0).toFixed(2);
        row.append(input);
      });
      const remove = document.createElement("button"); remove.textContent = "×"; remove.title = "Delete keyframe"; remove.dataset.removeTime = String(time); row.append(remove);
      list.append(row);
    });
  }
  function updateMotionGuides() {
    const guides = $("#motionGuides");
    const clip = motionClip();
    const enabled = !!clip?.motion && state.motionGuidesEnabled && !$("#motionPanel").classList.contains("hidden");
    guides.classList.toggle("hidden", !enabled);
    if (!enabled) return;
    const image = images.get(clip.assetId);
    const width = image?.naturalWidth, height = image?.naturalHeight;
    if (!width || !height) return;
    ["start", "end"].forEach(frame => {
      const time = frame === "start" ? 0 : clip.motion.duration;
      const camera = motionCameraState(clip, image, time).camera;
      const rect = Motion.cropRect(camera, width, height, renderWidth, renderHeight);
      const node = $(`[data-camera-frame="${frame}"]`, guides);
      node.style.left = `${rect.x / width * 100}%`;
      node.style.top = `${rect.y / height * 100}%`;
      node.style.width = `${rect.width / width * 100}%`;
      node.style.height = `${rect.height / height * 100}%`;
    });
    guides.querySelectorAll(".motion-poi-marker").forEach(marker => marker.remove());
    const camera = motionCameraState(clip, image, state.currentTime - clip.start).camera;
    const visibleCrop = Motion.cropRect(camera, width, height, renderWidth, renderHeight);
    (clip.motion.points || []).forEach((point, index) => {
      const x = point[0] * width, y = point[1] * height;
      if (x < visibleCrop.x || x > visibleCrop.x + visibleCrop.width || y < visibleCrop.y || y > visibleCrop.y + visibleCrop.height) return;
      const marker = document.createElement("span");
      marker.className = "motion-poi-marker";
      marker.textContent = String(index + 1);
      marker.style.left = `${(x - visibleCrop.x) / visibleCrop.width * 100}%`;
      marker.style.top = `${(y - visibleCrop.y) / visibleCrop.height * 100}%`;
      guides.append(marker);
    });
  }
  function drawMotionLook(look, width, height, time) {
    if (look.dim) { ctx.fillStyle = "rgba(4,6,16,.18)"; ctx.fillRect(0, 0, width, height); }
    if (look.vignette) {
      const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .22, width / 2, height / 2, Math.max(width, height) * .72);
      gradient.addColorStop(0, "transparent"); gradient.addColorStop(1, "rgba(1,3,12,.62)");
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    }
    if (look.dust || look.grain) {
      let seed = Math.floor(time * 24 + 1) >>> 0;
      const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const count = look.dust ? 44 : 500;
      ctx.save();
      for (let i = 0; i < count; i++) {
        const x = random() * width, y = look.dust ? (random() * height + time * (8 + i % 8 * 2)) % height : random() * height;
        const radius = look.dust ? 1 + random() * 2.8 : random() * 1.1;
        ctx.globalAlpha = look.dust ? .17 + random() * .28 : .09;
        ctx.fillStyle = look.dust ? "#fff2dd" : (random() > .5 ? "#fff" : "#101525");
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
  function motionCameraState(clip, image, time) {
    let baseCamera = Motion.cameraAt(clip.motion, time);
    const pulse = clip.motion.look?.pulse ? 1 + Math.min(.035, state.beat / 255 * .035) : 1;
    baseCamera = { ...baseCamera, zoom: baseCamera.zoom * pulse };
    const crop = Motion.cropRect(baseCamera, image.naturalWidth, image.naturalHeight, renderWidth, renderHeight);
    const clipX = (clip.x ?? canvas.width / 2) / canvas.width * renderWidth;
    const clipY = (clip.y ?? canvas.height / 2) / canvas.height * renderHeight;
    const offsetX = -(clipX - renderWidth / 2) / renderWidth * crop.width / image.naturalWidth;
    const offsetY = -(clipY - renderHeight / 2) / renderHeight * crop.height / image.naturalHeight;
    const scale = Math.max(.1, (clip.scale ?? 100) / 100);
    return {
      baseCamera,
      offsetX,
      offsetY,
      pulse,
      scale,
      camera: { ...baseCamera, cx: baseCamera.cx + offsetX, cy: baseCamera.cy + offsetY, zoom: baseCamera.zoom * scale, rotation: baseCamera.rotation + (clip.rotation || 0) }
    };
  }
  function drawMotionClip(clip, image, time) {
    const { camera } = motionCameraState(clip, image, time);
    const pyramid = imagePyramids.get(clip.assetId);
    ctx.save(); ctx.globalAlpha = (clip.opacity ?? 100) / 100;
    Motion.drawCameraFrame(ctx, image, renderWidth, renderHeight, camera, pyramid);
    ctx.restore();
    if (clip.motion.look) drawMotionLook(clip.motion.look, renderWidth, renderHeight, time);
  }
  function moveMotionGuide(event) {
    const drag = state.draggingMotionFrame;
    const clip = motionClip();
    const image = clip && images.get(clip.assetId);
    if (!drag || !clip?.motion || !image) return;
    const frameTime = drag.frame === "start" ? 0 : clip.motion.duration;
    const motionState = motionCameraState(clip, image, frameTime);
    const camera = motionState.camera;
    const crop = Motion.cropRect(camera, image.naturalWidth, image.naturalHeight, renderWidth, renderHeight);
    const rect = $("#previewStage").getBoundingClientRect();
    const dx = (event.clientX - drag.x) / rect.width * crop.width / image.naturalWidth;
    const dy = (event.clientY - drag.y) / rect.height * crop.height / image.naturalHeight;
    drag.x = event.clientX; drag.y = event.clientY;
    setMotionKeyframe(clip, frameTime, {
      ...camera,
      cx: camera.cx + dx - motionState.offsetX,
      cy: camera.cy + dy - motionState.offsetY,
      zoom: camera.zoom / (motionState.scale * motionState.pulse),
      rotation: camera.rotation - (clip.rotation || 0)
    });
    updateMotionGuides(); renderFrame(); markDirty();
  }
  function moveMotionKeyframe(event) {
    const drag = state.draggingMotionFrame;
    const clip = motionClip();
    if (!drag || !clip?.motion) return;
    const svg = $("#motionKeyframeTrack");
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const position = point.matrixTransform(svg.getScreenCTM().inverse());
    const time = Math.max(0, Math.min(clip.motion.duration, (position.x - 12) / 276 * clip.motion.duration));
    const key = drag.key;
    if (!key) return;
    key.t = time;
    if (drag.parameter === "cx") key.v = Math.max(0, Math.min(1, 1 - (position.y - 7) / 11));
    else if (drag.parameter === "cy") key.v = Math.max(0, Math.min(1, 1 - (position.y - 27) / 11));
    else if (drag.parameter === "zoom") key.v = Math.log(Math.max(1, Math.min(4, Math.exp(Math.log(4) * (1 - (position.y - 47) / 11)))));
    else key.v = Math.max(-30, Math.min(30, (position.y - 67) / 11 * 30));
    const track = clip.motion.keyframes[drag.parameter];
    track.sort((a, b) => a.t - b.t);
    for (let index = 1; index < track.length; index++) {
      if (Math.abs(track[index].t - track[index - 1].t) < .001) {
        if (track[index] === key) track.splice(index - 1, 1);
        else track.splice(index, 1);
        index--;
      }
    }
    renderMotionKeyframes(clip); renderFrame(); markDirty();
  }
  function removeAsset(id) {
    const asset = getAsset(id);
    if (!asset) return;
    if (state.audioExtraction?.assetId === id) finishAudioExtraction({ message: "The source video was removed." }, true);
    state.clips = state.clips.filter(clip => clip.assetId !== id);
    state.assets = state.assets.filter(item => item.id !== id);
    const video = videos.get(id);
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    const videoAudioSource = state.videoAudioSources.get(id);
    if (videoAudioSource) {
      videoAudioSource.disconnect();
      state.videoAudioSources.delete(id);
    }
    images.delete(id); videos.delete(id);
    imagePyramids.delete(id);
    if (audio.src === asset.url) { pause(); audio.removeAttribute("src"); audio.load(); }
    if (asset.url) URL.revokeObjectURL(asset.url);
    if (state.selectedId && !getClip(state.selectedId)) state.selectedId = null;
    renderAssets(); renderTimeline(); updateInspector(); renderFrame(); markDirty();
  }
  function extractVideoAudio(asset) {
    if (state.audioExtraction) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) { toast("Audio extraction requires a browser with Web Audio support.", "error"); return; }

    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    const chunks = [];
    let context, source, processor, silence;
    try {
      context = new AudioContext();
      if (!context.createScriptProcessor) throw new Error("This browser doesn't support audio extraction.");
      source = context.createMediaElementSource(video);
      processor = context.createScriptProcessor(4096, 2, 2);
      silence = context.createGain();
      silence.gain.value = 0;
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);
    } catch (error) {
      if (context && context.state !== "closed") context.close().catch(closeError => toast(`Couldn't close audio processing: ${closeError.message}`, "error"));
      toast(`Couldn't prepare audio extraction: ${error.message}`, "error");
      return;
    }

    const extraction = { assetId: asset.id, video, context, source, processor, silence, chunks, frames: 0, peak: 0, finished: false, timer: 0, durationTimer: 0 };
    state.audioExtraction = extraction;
    $("#audioExtractName").textContent = asset.name;
    $("#audioExtractStatus").textContent = "Preparing video…";
    $("#audioExtractPercent").textContent = "0%";
    $("#audioExtractProgress").style.width = "0%";
    $("#audioExtractDialog").showModal();
    renderAssets();

    processor.onaudioprocess = event => {
      if (state.audioExtraction !== extraction || extraction.finished) return;
      const input = event.inputBuffer;
      const left = input.getChannelData(0).slice();
      const right = input.numberOfChannels > 1 ? input.getChannelData(1).slice() : left.slice();
      for (let i = 0; i < left.length; i++) {
        extraction.peak = Math.max(extraction.peak, Math.abs(left[i]), Math.abs(right[i]));
      }
      extraction.frames += left.length;
      if (44 + extraction.frames * 4 > 0xffffffff) {
        finishAudioExtraction({ message: "This video is too long to save as a standard WAV file." });
        return;
      }
      chunks.push({ left, right });
    };

    extraction.durationTimer = setTimeout(() => {
      finishAudioExtraction({ message: "Timed out while loading this video." });
    }, 15000);
    video.onerror = () => finishAudioExtraction({ message: "The video couldn't be decoded for audio extraction." });
    video.onloadedmetadata = () => {
      if (state.audioExtraction !== extraction) return;
      clearTimeout(extraction.durationTimer);
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        finishAudioExtraction({ message: "The video duration couldn't be read." });
        return;
      }
      extraction.duration = video.duration;
      $("#audioExtractStatus").textContent = "Extracting audio…";
      extraction.timer = setInterval(() => {
        const progress = Math.min(99, Math.floor(video.currentTime / video.duration * 100));
        $("#audioExtractPercent").textContent = `${progress}%`;
        $("#audioExtractProgress").style.width = `${progress}%`;
      }, 200);
    };
    video.onended = () => finishAudioExtraction();
    try {
      video.src = asset.url;
      video.load();
      video.play().catch(error => finishAudioExtraction({ message: `Video playback failed: ${error.message}` }));
      context.resume().catch(error => finishAudioExtraction({ message: `Couldn't start audio processing: ${error.message}` }));
    } catch (error) {
      finishAudioExtraction({ message: `Couldn't start audio extraction: ${error.message}` });
    }
  }
  function finishAudioExtraction(error = null, cancelled = false) {
    const extraction = state.audioExtraction;
    if (!extraction || extraction.finished) return;
    extraction.finished = true;
    state.audioExtraction = null;
    clearInterval(extraction.timer);
    clearTimeout(extraction.durationTimer);
    extraction.video.pause();
    extraction.video.onloadedmetadata = null;
    extraction.video.onerror = null;
    extraction.video.onended = null;
    extraction.processor.onaudioprocess = null;
    extraction.source.disconnect();
    extraction.processor.disconnect();
    extraction.silence.disconnect();
    if (extraction.video.src) extraction.video.removeAttribute("src");
    extraction.video.load();
    extraction.context.close().catch(closeError => toast(`Couldn't close audio processing: ${closeError.message}`, "error"));
    renderAssets();
    if ($("#audioExtractDialog").open) $("#audioExtractDialog").close();
    if (cancelled) {
      toast("Audio extraction cancelled.");
      return;
    }
    if (error) {
      toast(error.message, "error");
      return;
    }
    if (!extraction.frames || extraction.peak < 1e-7) {
      toast("No audio was detected in this video.", "error");
      return;
    }

    try {
      const dataSize = extraction.frames * 4;
      const buffer = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buffer);
      const write = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
      write(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); write(8, "WAVE");
      write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 2, true); view.setUint32(24, extraction.context.sampleRate, true);
      view.setUint32(28, extraction.context.sampleRate * 4, true); view.setUint16(32, 4, true);
      view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, dataSize, true);
      let offset = 44;
      extraction.chunks.forEach(chunk => {
        for (let i = 0; i < chunk.left.length; i++) {
          const left = Math.max(-1, Math.min(1, chunk.left[i]));
          const right = Math.max(-1, Math.min(1, chunk.right[i]));
          view.setInt16(offset, left < 0 ? left * 32768 : left * 32767, true);
          view.setInt16(offset + 2, right < 0 ? right * 32768 : right * 32767, true);
          offset += 4;
        }
      });
      const blob = new Blob([buffer], { type: "audio/wav" });
      const filename = `${assetBaseName(getAsset(extraction.assetId)?.name || "extracted-audio")}.wav`;
      const file = new File([blob], filename, { type: "audio/wav" });
      downloadBlob(blob, filename);
      importFiles([file]).then(
        () => toast("WAV extracted and added to your project.", "success"),
        error => toast(`WAV downloaded, but couldn't be added to the project: ${error.message}`, "error")
      );
    } catch (error) {
      toast(`Couldn't create the WAV file: ${error.message}`, "error");
    }
  }
  function assetBaseName(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-") || "extracted-audio";
  }
  function clipLane(clip) { return clip.lane || "image"; }
  function renderTimeline() {
    const duration = state.clips.length
      ? Math.max(10, ...state.clips.map(clip => clip.start + clip.duration))
      : 30;
    state.duration = duration;
    const lyricsClip = state.clips.find(clip => clip.isLyrics);
    if (lyricsClip) lyricsClip.duration = duration;
    const pxPerSecond = state.zoom / 10;
    const width = Math.max(900, duration * pxPerSecond);
    const tick = pxPerSecond * 5;
    $$(".timeline-ruler,.track-lane").forEach(el => {
      el.style.width = `${width}px`;
      el.style.setProperty("--tick-width", `${tick}px`);
    });
    const ruler = $("#timelineRuler");
    ruler.innerHTML = "";
    for (let second = 0; second <= duration; second += 5) {
      const mark = document.createElement("span"); mark.className = "ruler-tick"; mark.style.left = `${second * pxPerSecond}px`; mark.textContent = formatTime(second);
      ruler.append(mark);
    }
    $$(".track-lane").forEach(lane => { lane.innerHTML = ""; });
    state.clips.forEach(clip => {
      const lane = $(`[data-lane="${clipLane(clip)}"]`);
      if (!lane) return;
      const node = document.createElement("div");
      node.className = `timeline-clip clip-${clipLane(clip)}${clip.id === state.selectedId ? " selected" : ""}`;
      node.style.left = `${clip.start * pxPerSecond}px`;
      node.style.width = `${Math.max(38, clip.duration * pxPerSecond)}px`;
      node.textContent = `${assetIcon(clipLane(clip))}  ${niceName(clip.name || "Untitled", 18)}`;
      node.title = `${clip.name || clipLane(clip)} · ${formatTime(clip.duration)}`;
      node.draggable = true;
      node.addEventListener("click", event => { event.stopPropagation(); selectClip(clip.id); });
      node.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", clip.id));
      node.addEventListener("dragend", event => {
        const rect = lane.getBoundingClientRect();
        const next = Math.max(0, (event.clientX - rect.left + $("#timelineScroll").scrollLeft) / pxPerSecond);
        if (Math.abs(next - clip.start) > .05) { snapshot(); clip.start = next; renderTimeline(); markDirty(); }
      });
      lane.append(node);
    });
    updatePlayhead();
    $("#durationTime").textContent = formatTime(duration);
  }
  function selectClip(id) {
    state.selectedId = id;
    const clip = getClip(id);
    if (clip?.lane === "image" && clip.assetId) {
      state.motionAssetId = clip.assetId;
      updateMotionImageOptions();
    }
    renderTimeline();
    updateInspector();
    updateMotionPanel();
    renderFrame();
  }
  function updateInspector() {
    const clip = selectedClip();
    $("#inspectorEmpty").classList.toggle("hidden", !!clip);
    $("#inspectorContent").classList.toggle("hidden", !clip);
    if (!clip) return;
    $("#selectedLayerName").textContent = clip.name || clip.effect || "Text & lyrics";
    $("#selectedLayerType").textContent = `${clipLane(clip).toUpperCase()} LAYER`;
    $("#selectedLayerIcon").textContent = clipLane(clip) === "visualizer" ? "✳" : assetIcon(clipLane(clip));
    $("#posX").value = Math.round(clip.x ?? canvas.width / 2);
    $("#posY").value = Math.round(clip.y ?? canvas.height / 2);
    $("#scaleSlider").value = clip.scale ?? 100;
    $("#scaleValue").textContent = `${clip.scale ?? 100}%`;
    $("#rotationSlider").value = clip.rotation ?? 0;
    $("#rotationValue").textContent = `${clip.rotation ?? 0}°`;
    $("#opacitySlider").value = clip.opacity ?? 100;
    $("#opacityValue").textContent = `${clip.opacity ?? 100}%`;
    $("#clipStart").value = clip.start.toFixed(1);
    $("#clipDuration").value = clip.duration.toFixed(1);
    $("#animationSelect").value = clip.animation || "none";
    $("#layerVisibilityButton").textContent = clip.visible === false ? "⊘" : "◉";
    $("#visualizerSettings").classList.toggle("hidden", clipLane(clip) !== "visualizer");
    if (clipLane(clip) === "visualizer") {
      const effect = state.effects.find(item => item.id === clip.id);
      $("#sensitivitySlider").value = effect?.sensitivity ?? 70;
      $("#sensitivityValue").textContent = `${effect?.sensitivity ?? 70}%`;
      $("#effectColor").value = effect?.color || "#a78bfa";
    }
  }
  function updatePlayhead() {
    const x = 111 + state.currentTime * state.zoom / 10;
    $("#playhead").style.left = `${x}px`;
    $("#currentTime").textContent = formatTime(state.currentTime);
    $("#previewTimecode").textContent = formatTimecode(state.currentTime);
  }
  function setAspect(aspect) {
    const dimensions = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [900, 900], "4:5": [800, 1000] };
    const previousWidth = canvas.width, previousHeight = canvas.height;
    [canvas.width, canvas.height] = dimensions[aspect] || dimensions["16:9"];
    const ratio = canvas.width / canvas.height;
    $("#previewStage").style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    $("#previewStage").style.width = `min(100%, calc((100vh - 380px) * ${ratio}))`;
    $("#previewResolution").textContent = `${canvas.width} × ${canvas.height}`;
    state.clips.forEach(clip => {
      if (Number.isFinite(clip.x)) clip.x = clip.x / previousWidth * canvas.width;
      if (Number.isFinite(clip.y)) clip.y = clip.y / previousHeight * canvas.height;
    });
    updateInspector(); renderFrame(); markDirty();
  }
  function activeClips(lane) {
    return state.clips.filter(clip => clip.visible !== false && clipLane(clip) === lane && state.currentTime >= clip.start && state.currentTime <= clip.start + clip.duration);
  }
  function drawCover(source, width, height, clip) {
    const sourceWidth = source.videoWidth || source.naturalWidth || width;
    const sourceHeight = source.videoHeight || source.naturalHeight || height;
    if (!sourceWidth || !sourceHeight) return;
    const scale = Math.max(width / sourceWidth, height / sourceHeight) * ((clip.scale || 100) / 100);
    const dw = sourceWidth * scale, dh = sourceHeight * scale;
    const elapsed = state.currentTime - clip.start;
    const pulse = clip.animation === "pulse" ? 1 + (state.beat / 255) * .16 : clip.animation === "zoom" ? 1 + Math.min(.12, elapsed / Math.max(clip.duration, 1) * .12) : 1;
    const scaleX = width / canvas.width, scaleY = height / canvas.height;
    const float = clip.animation === "float" ? Math.sin(elapsed * 1.3) * 10 * scaleY : 0;
    ctx.save(); ctx.globalAlpha = (clip.opacity ?? 100) / 100;
    ctx.translate((clip.x ?? canvas.width / 2) * scaleX, (clip.y ?? canvas.height / 2) * scaleY + float);
    ctx.rotate((clip.rotation || 0) * Math.PI / 180);
    ctx.scale(pulse, pulse);
    ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  function drawVisualizers() {
    const active = activeClips("visualizer");
    active.forEach(clip => {
      const effect = state.effects.find(item => item.id === clip.id) || { type: clip.effect || "spectrum", color: "#a78bfa", sensitivity: 70 };
      const color = effect.color || "#a78bfa";
      const amount = Math.min(1.7, (state.beat / 128) * effect.sensitivity / 70);
      const cx = (clip.x ?? canvas.width / 2) / canvas.width * renderWidth, cy = (clip.y ?? canvas.height * .76) / canvas.height * renderHeight;
      ctx.save(); ctx.globalAlpha = (clip.opacity ?? 100) / 100; ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.5, renderWidth / 650); ctx.shadowColor = color; ctx.shadowBlur = (12 + amount * 12) * renderWidth / canvas.width;
      if (effect.type === "circular") {
        const bins = 72, radius = Math.min(renderWidth, renderHeight) * .19;
        ctx.beginPath();
        for (let i = 0; i <= bins; i++) {
          const index = Math.floor(i / bins * (state.frequencyData?.length || 1));
          const amp = state.frequencyData ? state.frequencyData[index] / 255 : .08;
          const a = i / bins * Math.PI * 2;
          const r = radius + amp * 85 * renderWidth / canvas.width * effect.sensitivity / 70;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, radius * .52 + amount * 6 * renderWidth / canvas.width, 0, Math.PI * 2); ctx.globalAlpha *= .12; ctx.fill();
      } else if (effect.type === "waveform") {
        const data = state.timeData, width = renderWidth * .78;
        ctx.beginPath();
        for (let i = 0; i < width; i += 2) {
          const idx = Math.floor(i / width * (data?.length || 1));
          const value = data ? (data[idx] - 128) / 128 : Math.sin(i / 18 + state.currentTime * 2) * .03;
          const y = cy + value * 85 * renderHeight / canvas.height * effect.sensitivity / 70;
          if (!i) ctx.moveTo(cx - width / 2 + i, y); else ctx.lineTo(cx - width / 2 + i, y);
        }
        ctx.stroke();
      } else if (effect.type === "particles") {
        for (let i = 0; i < 54; i++) {
          const seed = i * 127.1;
          const x = (Math.sin(seed) * .5 + .5) * renderWidth;
          const y = (Math.sin(seed * 1.43 + state.currentTime * (.2 + i % 4 * .08)) * .5 + .5) * renderHeight;
          const size = (1 + (Math.sin(seed + state.currentTime) + 1) * (.8 + amount * 1.5)) * renderWidth / canvas.width;
          ctx.globalAlpha = (clip.opacity ?? 100) / 100 * (.24 + (i % 5) * .1); ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
        }
      } else if (effect.type === "pulse") {
        const radius = Math.min(renderWidth, renderHeight) * (.28 + amount * .055);
        ctx.globalAlpha = (clip.opacity ?? 100) / 100 * .7; ctx.lineWidth = (2 + amount * 3) * renderWidth / canvas.width;
        ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha *= .22; ctx.beginPath(); ctx.arc(cx, cy, radius * .78, 0, Math.PI * 2); ctx.fill();
      } else {
        const scale = renderWidth / canvas.width, count = 64, gap = 4 * scale, bar = Math.max(2 * scale, Math.min(9 * scale, (renderWidth * .78) / count - gap));
        const total = count * (bar + gap) - gap, baseY = cy;
        for (let i = 0; i < count; i++) {
          const idx = Math.floor(i / count * (state.frequencyData?.length || 1));
          const value = state.frequencyData ? state.frequencyData[idx] / 255 : .03 + (Math.sin(i * 3 + state.currentTime * 2) + 1) * .03;
          const h = Math.max(3 * scale, value * renderHeight * .38 * effect.sensitivity / 70);
          const x = cx - total / 2 + i * (bar + gap);
          if (effect.type === "neon") {
            ctx.globalAlpha = (clip.opacity ?? 100) / 100 * .85;
            ctx.fillRect(x, baseY - h, bar, h);
          } else {
            const gradient = ctx.createLinearGradient(0, baseY - h, 0, baseY);
            gradient.addColorStop(0, "#f5a2e3"); gradient.addColorStop(.52, "#ad91ff"); gradient.addColorStop(1, "#55d9c0");
            ctx.fillStyle = gradient; ctx.globalAlpha = (clip.opacity ?? 100) / 100 * .9; ctx.fillRect(x, baseY - h, bar, h);
          }
        }
      }
      ctx.restore();
    });
  }
  function drawText() {
    const lyricLines = Lyrics.parseLyrics($("#lyricsInput").value);
    const synced = lyricLines.some(line => line.time !== null);
    const active = Lyrics.activeCueAtTime(lyricLines, state.currentTime);
    const textClips = activeClips("text").filter(clip => !clip.isLyrics);
    if (!active && !textClips.length) return;
    const y = renderHeight * .84;
    const text = active?.text || textClips[0].name || "Your text here";
    const size = Math.max(20 * renderWidth / canvas.width, renderWidth * .032);
    const lines = text.split(/\r?\n/);
    const lineHeight = size * 1.25;
    const firstLineY = y - (lines.length - 1) * lineHeight / 2;
    const drawLines = method => lines.forEach((line, index) => ctx[method](line, renderWidth / 2, firstLineY + index * lineHeight, renderWidth * .84));
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${size}px Manrope, sans-serif`;
    ctx.shadowColor = "#000"; ctx.shadowBlur = 14 * renderWidth / canvas.width; ctx.shadowOffsetY = 2 * renderHeight / canvas.height;
    ctx.lineWidth = Math.max(2, size * .08); ctx.strokeStyle = "#08080acc";
    drawLines("strokeText");
    const karaoke = $("#karaokeToggle").checked && synced;
    ctx.fillStyle = $("#lyricColor").value;
    if (karaoke && active) {
      ctx.fillStyle = "#bba2ff";
      const next = lyricLines.find(line => line.time !== null && line.time > state.currentTime);
      const interval = active.endTime !== null
        ? Math.max(.1, active.endTime - active.time)
        : next ? Math.max(.1, next.time - active.time) : 3;
      const progress = Math.min(1, Math.max(0, (state.currentTime - active.time) / interval));
      drawLines("fillText");
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = progress;
      ctx.fillStyle = "#fff";
      drawLines("fillText");
    } else drawLines("fillText");
    ctx.restore();
  }
  function renderFrame(targetCanvas = canvas) {
    const targetContext = targetCanvas.getContext("2d", { alpha: false });
    if (!targetContext) return;
    const previousContext = ctx, previousWidth = renderWidth, previousHeight = renderHeight;
    ctx = targetContext;
    renderWidth = targetCanvas.width;
    renderHeight = targetCanvas.height;
    try {
      if (state.playing || state.export) syncVideoPlayback(true);
      const w = renderWidth, h = renderHeight;
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#171329"); bg.addColorStop(.48, "#171721"); bg.addColorStop(1, "#101b22");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.globalAlpha = .12; ctx.fillStyle = "#a88bff";
      const glow = ctx.createRadialGradient(w * .5, h * .49, 0, w * .5, h * .49, Math.max(w, h) * .55);
      glow.addColorStop(0, "#a88bff"); glow.addColorStop(1, "transparent"); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h); ctx.restore();
      const videosActive = activeClips("video");
      videosActive.forEach(clip => {
        const video = videos.get(clip.assetId);
        if (video && Math.abs(video.currentTime - Math.max(0, state.currentTime - clip.start)) > .2 && video.readyState >= 2) {
          try { video.currentTime = Math.min(video.duration || 0, Math.max(0, state.currentTime - clip.start)); } catch {}
        }
        if (video?.readyState >= 2) drawCover(video, w, h, clip);
      });
      activeClips("image").forEach(clip => {
        const img = images.get(clip.assetId);
        if (img?.complete) {
          if (clip.motion) drawMotionClip(clip, img, state.currentTime - clip.start);
          else drawCover(img, w, h, clip);
        }
      });
      drawVisualizers(); drawText();
      if (targetCanvas === canvas) updateMotionGuides();
    } finally {
      ctx = previousContext;
      renderWidth = previousWidth;
      renderHeight = previousHeight;
    }
    if (targetCanvas === canvas && state.playing) {
      analyzeAudio();
      if (audio.src && !audio.paused && Number.isFinite(audio.duration)) state.currentTime = audio.currentTime;
      else {
        const clip = activeClips("video").find(item => !videos.get(item.assetId)?.paused);
        const video = clip && videos.get(clip.assetId);
        if (clip && video) state.currentTime = clip.start + video.currentTime;
        else state.currentTime = Math.min(state.duration, state.currentTime + 1 / 30);
      }
      updatePlayhead();
      if ((!audio.src || audio.paused) && state.currentTime >= state.duration) {
        if (state.loop) {
          state.currentTime = 0;
          syncVideoPlayback(true);
        } else pause();
      }
      state.raf = requestAnimationFrame(() => renderFrame());
    }
  }
  function analyzeAudio() {
    if (!state.analyser || !state.frequencyData) return;
    state.analyser.getByteFrequencyData(state.frequencyData);
    state.analyser.getByteTimeDomainData(state.timeData);
    const count = Math.max(1, Math.floor(state.frequencyData.length * .12));
    let bass = 0;
    for (let i = 0; i < count; i++) bass += state.frequencyData[i];
    bass /= count;
    state.history.push(bass);
    if (state.history.length > 28) state.history.shift();
    state.beatAverage = state.history.reduce((sum, value) => sum + value, 0) / state.history.length;
    const now = performance.now();
    if (bass > Math.max(110, state.beatAverage * 1.4) && now - state.lastBeat > 180) { state.beat = bass; state.lastBeat = now; }
    else state.beat *= .84;
  }
  function connectVideoAudio(id, video) {
    if (!state.audioCtx || state.videoAudioSources.has(id)) return;
    try {
      const source = state.audioCtx.createMediaElementSource(video);
      source.connect(state.analyser);
      state.videoAudioSources.set(id, source);
    } catch (error) {
      toast(`Couldn't route audio from ${getAsset(id)?.name || "video"}: ${error.message}`, "error");
    }
  }
  function syncVideoPlayback(shouldPlay) {
    const clipsByAsset = new Map(state.clips.filter(clip => clipLane(clip) === "video").map(clip => [clip.assetId, clip]));
    videos.forEach((video, id) => {
      const clip = clipsByAsset.get(id);
      const clipTime = clip ? state.currentTime - clip.start : -1;
      const mediaDuration = Number.isFinite(video.duration) ? video.duration : clip?.duration || 0;
      const playable = clip && clip.visible !== false && clipTime >= 0 &&
        clipTime < Math.min(clip.duration, mediaDuration);
      video.muted = state.muted || !!audio.src;
      video.volume = Number($("#volumeSlider").value);
      if (!shouldPlay || !playable) {
        if (!video.paused) video.pause();
        return;
      }
      const targetTime = Math.max(0, Math.min(mediaDuration, clipTime));
      if (Math.abs(video.currentTime - targetTime) > .25) video.currentTime = targetTime;
      if (video.paused) {
        video.play().catch(error => toast(`Couldn't play ${getAsset(id)?.name || "video"}: ${error.message}`, "error"));
      }
    });
  }
  function updatePlaybackVolumes() {
    const volume = Number($("#volumeSlider").value);
    audio.muted = state.muted;
    audio.volume = state.muted ? 0 : volume;
    videos.forEach(video => {
      video.muted = state.muted || !!audio.src;
      video.volume = volume;
    });
  }
  function ensureAudioGraph() {
    if (state.audioCtx) {
      if (state.audioCtx.state === "suspended") state.audioCtx.resume();
      videos.forEach((video, id) => connectVideoAudio(id, video));
      return;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Web Audio API is not supported in this browser.");
      state.audioCtx = new AudioContext();
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 1024;
      state.analyser.smoothingTimeConstant = .82;
      state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
      state.timeData = new Uint8Array(state.analyser.fftSize);
      state.audioDestination = state.audioCtx.createMediaStreamDestination();
      state.audioSource = state.audioCtx.createMediaElementSource(audio);
      state.audioSource.connect(state.analyser);
      state.analyser.connect(state.audioCtx.destination);
      state.analyser.connect(state.audioDestination);
      videos.forEach((video, id) => connectVideoAudio(id, video));
    } catch (error) { toast(error.message || "Couldn't initialize audio analysis.", "error"); }
  }
  function play() {
    ensureAudioGraph();
    if (state.currentTime >= state.duration) state.currentTime = 0;
    state.playing = true;
    $("#playButton").textContent = "Ⅱ";
    if (audio.src) {
      if (audio.ended || state.currentTime >= (audio.duration || Infinity)) { audio.currentTime = 0; state.currentTime = 0; }
      audio.currentTime = state.currentTime;
      updatePlaybackVolumes();
      audio.play().catch(error => toast(`Couldn't play audio: ${error.message}`, "error"));
    }
    syncVideoPlayback(true);
    cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(() => renderFrame());
  }
  function pause() {
    state.playing = false;
    audio.pause();
    syncVideoPlayback(false);
    $("#playButton").textContent = "▶";
    cancelAnimationFrame(state.raf);
    renderFrame();
  }
  function seek(time) {
    state.currentTime = Math.max(0, Math.min(state.duration, time));
    if (audio.src && Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, state.currentTime);
    syncVideoPlayback(state.playing);
    updatePlayhead(); renderFrame();
  }
  function addEffect(type) {
    snapshot();
    const id = crypto.randomUUID();
    const names = { spectrum: "Spectrum", circular: "Circular equalizer", waveform: "Audio waveform", neon: "Neon bars", particles: "Floating particles", pulse: "Beat pulse" };
    const clip = { id, name: names[type] || type, effect: type, lane: "visualizer", start: state.currentTime, duration: Math.max(8, state.duration - state.currentTime), x: canvas.width / 2, y: type === "circular" ? canvas.height / 2 : canvas.height * .76, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" };
    state.clips.push(clip);
    state.effects.push({ id, type, sensitivity: 70, color: type === "waveform" ? "#73d6c6" : "#a78bfa" });
    $("#previewPlaceholder").classList.add("hidden");
    selectClip(id); renderTimeline(); renderFrame(); markDirty();
    toast(`${clip.name} added to your timeline.`, "success");
  }
  function updateLyricsClip() {
    const text = $("#lyricsInput").value.trim();
    let clip = state.clips.find(item => item.lane === "text" && item.isLyrics);
    if (!text) {
      if (clip) { state.clips = state.clips.filter(item => item !== clip); renderTimeline(); }
      renderFrame(); markDirty(); return;
    }
    if (!clip) {
      clip = { id: crypto.randomUUID(), name: "Lyrics", lane: "text", start: 0, duration: state.duration, x: canvas.width / 2, y: canvas.height * .84, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none", isLyrics: true };
      state.clips.push(clip);
    }
    clip.name = "Lyrics";
    renderTimeline(); renderFrame(); markDirty();
  }
  function addTextClip() {
    snapshot();
    const clip = { id: crypto.randomUUID(), name: "Text layer", lane: "text", start: state.currentTime, duration: 5, x: canvas.width / 2, y: canvas.height * .74, scale: 100, rotation: 0, opacity: 100, visible: true, animation: "none" };
    state.clips.push(clip); $("#previewPlaceholder").classList.add("hidden"); selectClip(clip.id); renderTimeline(); markDirty();
    toast("Text layer added. Edit lyrics in the Text tab.");
  }
  function saveProject(download = true) {
    const project = {
      version: 1, name: $("#projectName").value, duration: state.duration,
      aspect: $("#aspectSelect").value, lyrics: $("#lyricsInput").value,
      karaoke: $("#karaokeToggle").checked, lyricColor: $("#lyricColor").value,
      assets: state.assets.map(({ id, name, type, size }) => ({ id, name, type, size })),
      clips: state.clips.map(({ id, assetId, name, lane, start, duration, x, y, scale, rotation, opacity, visible, animation, effect, isLyrics, motion }) => ({ id, assetId, name, lane, start, duration, x, y, scale, rotation, opacity, visible, animation, effect, isLyrics, motion })),
      effects: state.effects
    };
    let saved = true;
    try { localStorage.setItem("pulseframe-project", JSON.stringify(project)); }
    catch { saved = false; toast("Project settings couldn't be autosaved. Export a project file to keep your work.", "error"); }
    if (download) {
      const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
      downloadBlob(blob, `${safeFileName(project.name)}.pulseframe.json`);
      toast("Project configuration downloaded.", "success");
    }
    return saved;
  }
  function safeFileName(name) { return (name || "pulseframe-project").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").trim() || "pulseframe-project"; }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  async function loadProjectFile(file) {
    try {
      const project = JSON.parse(await file.text());
      if (!project || !Array.isArray(project.clips)) throw new Error("This file isn't a valid Pulseframe project.");
      state.clips = project.clips;
      state.effects = Array.isArray(project.effects) ? project.effects : [];
      state.pendingAssetIds = Array.isArray(project.assets)
        ? project.assets.map(asset => ({ ...asset }))
        : [];
      state.duration = project.duration || 30;
      $("#projectName").value = project.name || "Untitled project";
      $("#lyricsInput").value = project.lyrics || "";
      $("#karaokeToggle").checked = project.karaoke !== false;
      $("#lyricColor").value = project.lyricColor || "#ffffff";
      if (project.aspect) { $("#aspectSelect").value = project.aspect; setAspect(project.aspect); }
      const unresolved = state.clips.some(clip => clip.assetId && !getAsset(clip.assetId));
      if (unresolved) toast("Project settings loaded. Re-import its media files to restore linked clips.");
      renderTimeline(); updateInspector(); renderFrame(); markDirty();
      toast("Project configuration opened.", "success");
    } catch (error) { toast(`Couldn't open project: ${error.message}`, "error"); }
  }
  function openExport() {
    if (!state.clips.length && !state.assets.length) { toast("Import media or add a visualizer before exporting."); return; }
    $("#exportDialog").showModal();
  }
  function startExport() {
    if (!canvas.captureStream || !window.MediaRecorder) { toast("Video export isn't supported in this browser. Try a recent version of Chrome or Edge.", "error"); return; }
    ensureAudioGraph();
    const fps = Number($("#exportFps").value);
    const edge = Number($("#exportQuality").value);
    const aspect = canvas.width / canvas.height;
    const output = document.createElement("canvas");
    output.width = Math.round((aspect >= 1 ? edge * aspect : edge) / 2) * 2;
    output.height = Math.round((aspect >= 1 ? edge : edge / aspect) / 2) * 2;
    const videoStream = output.captureStream(fps);
    const audioTrack = state.audioDestination?.stream.getAudioTracks()[0];
    if (audioTrack) videoStream.addTrack(audioTrack);
    const mimeType = $("#exportFormat").value;
    if (!MediaRecorder.isTypeSupported(mimeType)) { toast("That export format isn't supported by this browser.", "error"); return; }
    let recorder;
    try { recorder = new MediaRecorder(videoStream, { mimeType, videoBitsPerSecond: edge >= 2160 ? 24_000_000 : edge >= 1440 ? 14_000_000 : edge >= 1080 ? 8_000_000 : 5_000_000, audioBitsPerSecond: 192_000 }); }
    catch (error) { toast(`Couldn't start export: ${error.message}`, "error"); return; }
    const chunks = [];
    const previousTime = state.currentTime;
    const wasPlaying = state.playing;
    pause();
    ensureAudioGraph();
    state.export = { recorder, output, videoStream, previousTime, wasPlaying, startTime: performance.now(), fps, cancelled: false };
    $("#exportProgress").classList.remove("hidden");
    $("#startExportButton").classList.add("hidden");
    $("#exportStatus").textContent = "Rendering composition…";
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = event => { finishExport(); toast(`Export failed: ${event.error?.message || "media recorder error"}`, "error"); };
    recorder.onstop = () => {
      const exp = state.export;
      if (!exp) return;
      const blob = Motion.concatChunks(chunks, mimeType);
      if (exp.cancelled) {
        finishExport();
        $("#exportDialog").close();
        resetExportDialog();
        toast("Export cancelled.");
        return;
      }
      finishExport();
      if (blob.size) {
        const extension = mimeType.includes("mp4") ? "mp4" : "webm";
        downloadBlob(blob, `${safeFileName($("#projectName").value)}.${extension}`);
        $("#exportStatus").textContent = "Export complete";
        $("#exportPercent").textContent = "100%";
        $("#progressBar").style.width = "100%";
        toast("Your video is ready to download.", "success");
        setTimeout(() => { if ($("#exportDialog").open) $("#exportDialog").close(); resetExportDialog(); }, 1200);
      } else toast("Export produced an empty video.", "error");
    };
    recorder.start(250);
    if (audio.src) {
      state.currentTime = 0; audio.currentTime = 0; audio.volume = state.muted ? 0 : Number($("#volumeSlider").value);
      audio.play().catch(error => toast(`Audio won't be included in the export: ${error.message}`, "error"));
    } else state.currentTime = 0;
    syncVideoPlayback(true);
    const renderExport = () => {
      if (!state.export || recorder.state !== "recording") return;
      const { startTime, output: outCanvas } = state.export;
      const elapsed = (performance.now() - startTime) / 1000;
      state.currentTime = audio.src && !audio.paused ? audio.currentTime : elapsed;
      syncVideoPlayback(true);
      analyzeAudio();
      renderFrame(outCanvas);
      const duration = Math.max(1, state.duration);
      const progress = Math.min(99, Math.round(state.currentTime / duration * 100));
      $("#exportPercent").textContent = `${progress}%`;
      $("#progressBar").style.width = `${progress}%`;
      const eta = progress > 0 ? Math.max(0, Math.round(elapsed * (100 - progress) / progress)) : 0;
      $("#exportEta").textContent = progress > 0 ? `ETA ${formatTime(eta)}` : "ETA —";
      if (state.currentTime >= duration) { recorder.stop(); return; }
      state.raf = requestAnimationFrame(renderExport);
    };
    state.raf = requestAnimationFrame(renderExport);
  }
  function finishExport() {
    const exp = state.export;
    if (!exp) return;
    cancelAnimationFrame(state.raf);
    audio.pause();
    syncVideoPlayback(false);
    exp.videoStream.getTracks().forEach(track => track.stop());
    state.export = null;
    seek(exp.previousTime);
    $("#exportStatus").textContent = "Export complete";
    $("#cancelExportButton").textContent = "Close";
  }
  function resetExportDialog() {
    $("#exportProgress").classList.add("hidden");
    $("#startExportButton").classList.remove("hidden");
    $("#cancelExportButton").textContent = "Cancel export";
    $("#progressBar").style.width = "0";
    $("#exportPercent").textContent = "0%";
    state.export = null;
  }

  $("#browseButton").addEventListener("click", () => fileInput.click());
  $("#placeholderImport").addEventListener("click", () => fileInput.click());
  $("#dropZone").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => { await importFiles(fileInput.files); fileInput.value = ""; });
  $("#upscaleBrowseButton").addEventListener("click", () => $("#upscaleFileInput").click());
  $("#upscaleFileInput").addEventListener("change", event => { addUpscaleFiles(event.target.files); event.target.value = ""; });
  $("#upscaleQueue").addEventListener("change", event => selectUpscaleFile(event.target.value));
  $("#upscaleRemoveButton").addEventListener("click", removeUpscaleFile);
  $("#upscaleStartButton").addEventListener("click", processUpscaleBatch);
  $("#upscaleCancelButton").addEventListener("click", cancelUpscaleBatch);
  $("#upscalePreset").addEventListener("change", event => {
    const presets = {
      draft: { target: "720", aspect: "source" },
      youtube1080: { target: "1080", aspect: "16:9" },
      youtube4k: { target: "2160", aspect: "16:9" },
      archive: { target: "2160", aspect: "source" }
    };
    const preset = presets[event.target.value];
    if (!preset) return;
    $("#upscaleTarget").value = preset.target;
    $("#upscaleAspect").value = preset.aspect;
    $("#upscaleAlready").value = "keep";
    $("#upscaleFit").value = "pad";
    updateUpscaleDetails();
    renderUpscalePreview();
  });
  ["upscaleTarget", "upscaleAspect", "upscaleFit", "upscaleAlready"].forEach(id => {
    $(`#${id}`).addEventListener("change", () => {
      $("#upscalePreset").value = "custom";
      updateUpscaleDetails();
      renderUpscalePreview();
    });
  });
  upscaleVideo.addEventListener("loadeddata", renderUpscalePreview);
  upscaleVideo.addEventListener("timeupdate", renderUpscalePreview);
  ["dragenter", "dragover"].forEach(type => $("#dropZone").addEventListener(type, event => { event.preventDefault(); $("#dropZone").classList.add("drag-over"); }));
  ["dragleave", "drop"].forEach(type => $("#dropZone").addEventListener(type, event => { event.preventDefault(); $("#dropZone").classList.remove("drag-over"); }));
  $("#dropZone").addEventListener("drop", event => importFiles(event.dataTransfer.files));
  $("#previewStage").addEventListener("dragover", event => event.preventDefault());
  $("#previewStage").addEventListener("drop", event => { event.preventDefault(); importFiles(event.dataTransfer.files); });
  $$(".sidebar-tab").forEach(tab => tab.addEventListener("click", () => showPanel(tab.dataset.panel)));
  function showPanel(id) {
    $$(".sidebar-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.panel === id));
    $$(".sidebar-content").forEach(panel => panel.classList.toggle("hidden", panel.id !== id));
    updateMotionGuides();
  }
  $$(".filter-chip").forEach(chip => chip.addEventListener("click", () => {
    $$(".filter-chip").forEach(item => item.classList.toggle("active", item === chip));
    renderAssets(chip.dataset.filter);
  }));
  $$(".effect-card").forEach(card => card.addEventListener("click", () => addEffect(card.dataset.effect)));
  $("#motionImageSelect").addEventListener("change", event => {
    state.motionAssetId = event.target.value || null;
    updateMotionPanel(); renderFrame();
  });
  $("#applyMotionPreset").addEventListener("click", applyMotionPreset);
  $("#addMotionKeyframe").addEventListener("click", addMotionKeyframe);
  $("#addMotionPoint").addEventListener("click", addMotionPoint);
  $("#motionIntensity").addEventListener("input", event => {
    $("#motionIntensityValue").textContent = `${event.target.value}%`;
    const clip = motionClip();
    if (clip?.motion) { clip.motion.intensity = Number(event.target.value) / 100; renderFrame(); markDirty(); }
  });
  $("#motionEasing").addEventListener("change", event => {
    const clip = motionClip();
    if (clip?.motion) { clip.motion.easing = event.target.value; renderMotionPanel(); renderFrame(); markDirty(); }
  });
  $("#motionDuration").addEventListener("change", event => {
    const clip = motionClip();
    if (!clip?.motion) return;
    const previous = clip.motion.duration, duration = Math.max(1, Math.min(600, Number(event.target.value) || previous));
    const factor = duration / previous;
    Object.values(clip.motion.keyframes).forEach(track => track.forEach(key => { key.t *= factor; }));
    clip.motion.duration = duration; clip.duration = duration;
    renderTimeline(); renderMotionPanel(); renderFrame(); markDirty();
  });
  $("#motionGuidesToggle").addEventListener("change", event => {
    state.motionGuidesEnabled = event.target.checked;
    updateMotionGuides();
  });
  $$(".motion-look input").forEach(input => input.addEventListener("change", () => {
    const clip = motionClip();
    if (!clip?.motion) { input.checked = false; toast("Apply a motion preset before adding a look effect."); return; }
    clip.motion.look[input.dataset.look] = input.checked;
    renderFrame(); markDirty();
  }));
  $("#motionGuides").addEventListener("pointerdown", event => {
    const guide = event.target.closest(".motion-guide");
    const clip = motionClip();
    if (!guide || !clip?.motion) return;
    event.preventDefault();
    snapshot();
    state.draggingMotionFrame = { frame: guide.dataset.cameraFrame, x: event.clientX, y: event.clientY };
    guide.setPointerCapture(event.pointerId);
  });
  $("#motionGuides").addEventListener("pointermove", moveMotionGuide);
  $("#motionGuides").addEventListener("pointerup", () => { state.draggingMotionFrame = null; });
  $("#motionGuides").addEventListener("pointercancel", () => { state.draggingMotionFrame = null; });
  $("#motionKeyframeTrack").addEventListener("pointerdown", event => {
    const dot = event.target.closest(".motion-track-dot");
    const clip = motionClip();
    if (!dot || !clip?.motion) return;
    event.preventDefault();
    const parameter = dot.dataset.param;
    const key = clip.motion.keyframes[parameter]?.[Number(dot.dataset.index)];
    if (!key) return;
    snapshot();
    state.draggingMotionFrame = { parameter, key };
    $("#motionKeyframeTrack").setPointerCapture(event.pointerId);
  });
  $("#motionKeyframeTrack").addEventListener("pointermove", moveMotionKeyframe);
  $("#motionKeyframeTrack").addEventListener("pointerup", () => { state.draggingMotionFrame = null; });
  $("#motionKeyframeTrack").addEventListener("pointercancel", () => { state.draggingMotionFrame = null; });
  $("#motionKeyframeList").addEventListener("change", event => {
    const input = event.target.closest("input");
    const clip = motionClip();
    if (!input || !clip?.motion) return;
    const oldTime = Number(input.dataset.keyTime);
    snapshot();
    if (input.dataset.param === "time") {
      const newTime = Math.max(0, Math.min(clip.motion.duration, Number(input.value) || 0));
      Object.values(clip.motion.keyframes).forEach(track => {
        const key = track.find(point => Math.abs(point.t - oldTime) < .001);
        if (key) key.t = newTime;
        track.sort((a, b) => a.t - b.t);
      });
    } else {
      const parameter = input.dataset.param;
      const track = clip.motion.keyframes[parameter];
      let key = track.find(point => Math.abs(point.t - oldTime) < .001);
      if (!key) {
        key = { t: oldTime, v: Motion.interpolateTrack(track, oldTime, clip.motion.easing) };
        track.push(key);
      }
      if (key) {
        const value = Number(input.value);
        key.v = parameter === "zoom" ? Math.log(Math.max(1, Number.isFinite(value) ? value : 1)) : Number.isFinite(value) ? value : 0;
        if (parameter === "cx" || parameter === "cy") key.v = Math.max(0, Math.min(1, key.v));
        if (parameter === "rotation") key.v = Math.max(-180, Math.min(180, key.v));
      }
      track.sort((a, b) => a.t - b.t);
    }
    renderMotionPanel(); renderFrame(); markDirty();
  });
  $("#motionKeyframeList").addEventListener("click", event => {
    const button = event.target.closest("button[data-remove-time]");
    const clip = motionClip();
    if (!button || !clip?.motion) return;
    const time = Number(button.dataset.removeTime);
    snapshot();
    Object.values(clip.motion.keyframes).forEach(track => {
      const index = track.findIndex(key => Math.abs(key.t - time) < .001);
      if (index >= 0) track.splice(index, 1);
    });
    renderMotionPanel(); renderFrame(); markDirty();
  });
  $("#playButton").addEventListener("click", () => state.playing ? pause() : play());
  $("#skipBackButton").addEventListener("click", () => seek(0));
  $("#skipForwardButton").addEventListener("click", () => {
    const next = state.clips.filter(clip => clip.start > state.currentTime + .1).sort((a, b) => a.start - b.start)[0];
    seek(next ? next.start : Math.min(state.duration, state.currentTime + 5));
  });
  $("#volumeSlider").addEventListener("input", () => { state.muted = false; updatePlaybackVolumes(); });
  $("#volumeButton").addEventListener("click", () => { state.muted = !state.muted; updatePlaybackVolumes(); $("#volumeButton").style.color = state.muted ? "#e28e92" : ""; });
  $("#loopButton").addEventListener("click", () => { state.loop = !state.loop; audio.loop = state.loop; $("#loopButton").style.color = state.loop ? "#b49aff" : ""; });
  $("#aspectSelect").addEventListener("change", event => setAspect(event.target.value));
  $("#fullscreenButton").addEventListener("click", () => {
    const target = $("#previewStage");
    if (!document.fullscreenElement) target.requestFullscreen?.().catch(() => toast("Fullscreen preview isn't available."));
    else document.exitFullscreen?.();
  });
  $("#fitButton").addEventListener("click", () => { setAspect($("#aspectSelect").value); });
  $("#timelineScroll").addEventListener("click", event => {
    if (event.target.closest(".timeline-clip")) return;
    const bodyRect = $("#timelineBody").getBoundingClientRect();
    const x = event.clientX - bodyRect.left + $("#timelineScroll").scrollLeft - 111;
    if (x >= 0) seek(x / (state.zoom / 10));
  });
  $("#zoomSlider").addEventListener("input", event => { state.zoom = Number(event.target.value); renderTimeline(); });
  $("#zoomInButton").addEventListener("click", () => { state.zoom = Math.min(140, state.zoom + 10); $("#zoomSlider").value = state.zoom; renderTimeline(); });
  $("#zoomOutButton").addEventListener("click", () => { state.zoom = Math.max(40, state.zoom - 10); $("#zoomSlider").value = state.zoom; renderTimeline(); });
  $("#splitButton").addEventListener("click", () => {
    const clip = selectedClip();
    if (!clip || state.currentTime <= clip.start || state.currentTime >= clip.start + clip.duration) { toast("Place the playhead inside a selected clip to split it."); return; }
    snapshot();
    const right = { ...clip, id: crypto.randomUUID(), start: state.currentTime, duration: clip.start + clip.duration - state.currentTime };
    clip.duration = state.currentTime - clip.start;
    state.clips.push(right);
    if (clip.lane === "visualizer") state.effects.push({ ...(state.effects.find(item => item.id === clip.id) || {}), id: right.id });
    selectClip(right.id); renderTimeline(); markDirty(); toast("Clip split at the playhead.", "success");
  });
  $("#duplicateButton").addEventListener("click", () => {
    const clip = selectedClip();
    if (!clip) { toast("Select a clip to duplicate."); return; }
    snapshot();
    const copy = { ...clip, id: crypto.randomUUID(), start: clip.start + clip.duration };
    state.clips.push(copy);
    const effect = state.effects.find(item => item.id === clip.id);
    if (effect) state.effects.push({ ...effect, id: copy.id });
    selectClip(copy.id); renderTimeline(); markDirty();
  });
  $("#deleteButton").addEventListener("click", () => {
    if (!selectedClip()) { toast("Select a clip to remove."); return; }
    snapshot();
    state.clips = state.clips.filter(clip => clip.id !== state.selectedId);
    state.effects = state.effects.filter(effect => effect.id !== state.selectedId);
    state.selectedId = null; renderTimeline(); updateInspector(); renderFrame(); markDirty();
  });
  $("#undoButton").disabled = true;
  $("#undoButton").addEventListener("click", () => {
    const previous = state.undo.pop();
  if (previous) {
    state.redo.push(JSON.stringify({ clips: state.clips, effects: state.effects }));
    restoreSnapshot(previous);
    $("#undoButton").disabled = !state.undo.length;
    $("#redoButton").disabled = !state.redo.length;
  }
  });
  $("#redoButton").disabled = true;
  $("#redoButton").addEventListener("click", () => {
  const next = state.redo.pop();
  if (next) {
    state.undo.push(JSON.stringify({ clips: state.clips, effects: state.effects }));
    restoreSnapshot(next);
    $("#undoButton").disabled = !state.undo.length;
    $("#redoButton").disabled = !state.redo.length;
  }
  });
  const bindClipField = (id, property, parse = Number, display = null) => {
    $(id).addEventListener("input", event => {
      const clip = selectedClip(); if (!clip) return;
      clip[property] = parse(event.target.value);
      if (display) display(clip[property]);
      if (property === "start" || property === "duration") renderTimeline();
      renderFrame(); markDirty();
    });
  };
  bindClipField("#posX", "x"); bindClipField("#posY", "y");
  bindClipField("#scaleSlider", "scale", Number, value => $("#scaleValue").textContent = `${value}%`);
  bindClipField("#rotationSlider", "rotation", Number, value => $("#rotationValue").textContent = `${value}°`);
  bindClipField("#opacitySlider", "opacity", Number, value => $("#opacityValue").textContent = `${value}%`);
  bindClipField("#clipStart", "start"); bindClipField("#clipDuration", "duration");
  $("#animationSelect").addEventListener("change", event => { const clip = selectedClip(); if (clip) { clip.animation = event.target.value; renderFrame(); markDirty(); } });
  $("#layerVisibilityButton").addEventListener("click", () => { const clip = selectedClip(); if (clip) { clip.visible = clip.visible === false; updateInspector(); renderFrame(); renderTimeline(); markDirty(); } });
  $("#resetTransformButton").addEventListener("click", () => {
    const clip = selectedClip(); if (!clip) return;
    clip.x = canvas.width / 2; clip.y = canvas.height / 2; clip.scale = 100; clip.rotation = 0; clip.opacity = 100;
    updateInspector(); renderFrame(); markDirty();
  });
  $("#sensitivitySlider").addEventListener("input", event => {
    const clip = selectedClip(); if (!clip) return;
    const effect = state.effects.find(item => item.id === clip.id); if (effect) effect.sensitivity = Number(event.target.value);
    $("#sensitivityValue").textContent = `${event.target.value}%`; renderFrame(); markDirty();
  });
  $("#effectColor").addEventListener("input", event => {
    const clip = selectedClip(); if (!clip) return;
    const effect = state.effects.find(item => item.id === clip.id); if (effect) effect.color = event.target.value;
    renderFrame(); markDirty();
  });
  let lyricsDebounce;
  $("#lyricsInput").addEventListener("input", () => { clearTimeout(lyricsDebounce); lyricsDebounce = setTimeout(updateLyricsClip, 300); });
  $("#lyricColor").addEventListener("input", () => { renderFrame(); markDirty(); });
  $("#karaokeToggle").addEventListener("change", () => { renderFrame(); markDirty(); });
  $("#addTextButton").addEventListener("click", addTextClip);
  $("#projectName").addEventListener("input", markDirty);
  $("#saveProjectButton").addEventListener("click", () => saveProject(true));
  $("#openProjectButton").addEventListener("click", () => $("#projectInput").click());
  $("#cancelAudioExtractButton").addEventListener("click", () => finishAudioExtraction(null, true));
  $("#audioExtractDialog").addEventListener("cancel", event => {
    event.preventDefault();
    finishAudioExtraction(null, true);
  });
  $("#exportButton").addEventListener("click", openExport);
  $("#startExportButton").addEventListener("click", startExport);
  $("#cancelExportButton").addEventListener("click", () => {
    if (state.export?.recorder.state === "recording") { state.export.cancelled = true; state.export.recorder.stop(); }
    else { $("#exportDialog").close(); resetExportDialog(); }
  });
  $("#exportDialog").addEventListener("close", () => { if (state.export?.recorder.state === "recording") state.export.recorder.stop(); resetExportDialog(); });
  $("#projectInput").addEventListener("change", async event => { const file = event.target.files[0]; if (file) await loadProjectFile(file); event.target.value = ""; });
  $("#saveProjectButton").addEventListener("contextmenu", event => { event.preventDefault(); $("#projectInput").click(); });
  window.addEventListener("keydown", event => {
    const target = event.target;
    if (target.matches("input,textarea,select,[contenteditable=true]")) return;
    if (event.code === "Space") { event.preventDefault(); state.playing ? pause() : play(); }
    if (event.code === "Delete" || event.code === "Backspace") $("#deleteButton").click();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveProject(true); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); (event.shiftKey ? $("#redoButton") : $("#undoButton")).click(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); $("#redoButton").click(); }
    if (event.code === "ArrowLeft") seek(state.currentTime - (event.shiftKey ? 1 : .1));
    if (event.code === "ArrowRight") seek(state.currentTime + (event.shiftKey ? 1 : .1));
  });
  window.addEventListener("beforeunload", () => {
    state.assets.forEach(asset => { if (asset.url) URL.revokeObjectURL(asset.url); });
    state.upscaler.files.forEach(item => URL.revokeObjectURL(item.url));
  });
  audio.addEventListener("ended", () => {
    if (state.loop) { audio.currentTime = 0; audio.play(); }
    else pause();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden && state.export) toast("Export is still running. Keep this tab open."); });
  configureUpscaleCodecs();
  try {
    const saved = localStorage.getItem("pulseframe-project");
    if (saved) {
      const project = JSON.parse(saved);
      if (Array.isArray(project.clips)) {
        state.clips = project.clips;
        state.effects = project.effects || [];
        state.pendingAssetIds = Array.isArray(project.assets) ? project.assets.map(asset => ({ ...asset })) : [];
        state.duration = project.duration || 30;
        $("#projectName").value = project.name || "Midnight memories";
        $("#lyricsInput").value = project.lyrics || "";
        $("#karaokeToggle").checked = project.karaoke !== false;
        $("#lyricColor").value = project.lyricColor || "#ffffff";
        if (project.aspect) { $("#aspectSelect").value = project.aspect; setAspect(project.aspect); }
        if (state.clips.length) $("#previewPlaceholder").classList.add("hidden");
        renderTimeline(); updateInspector();
        if (state.pendingAssetIds.length) toast("Re-import this project's media files to restore its saved clips.");
      }
    }
  } catch { toast("Saved project data couldn't be loaded.", "error"); }
  renderAssets(); renderTimeline(); renderFrame();
})();
