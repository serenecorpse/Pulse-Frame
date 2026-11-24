((root) => {
  "use strict";

  const TARGET_HEIGHTS = { "720": 720, "1080": 1080, "2160": 2160 };

  function even(value) {
    return Math.max(2, Math.round(value / 2) * 2);
  }

  function targetDimensions(target, aspect, sourceWidth, sourceHeight) {
    const height = TARGET_HEIGHTS[String(target)];
    if (!height) throw new RangeError("Choose 720p, 1080p, or 4K.");
    const sourceRatio = Number(sourceWidth) > 0 && Number(sourceHeight) > 0
      ? Number(sourceWidth) / Number(sourceHeight)
      : 16 / 9;
    const ratios = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 };
    const ratio = aspect === "source" ? sourceRatio : ratios[aspect];
    if (!Number.isFinite(ratio) || ratio <= 0) throw new RangeError("Choose a supported aspect ratio.");
    const dimensions = ratio >= 1
      ? { width: even(height * ratio), height }
      : { width: height, height: even(height / ratio) };
    if (dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 24 * 1024 * 1024) {
      throw new RangeError("The chosen source-aspect output exceeds the browser's safe canvas limit. Choose a standard aspect ratio or a smaller target.");
    }
    return dimensions;
  }

  function fitRect(sourceWidth, sourceHeight, targetWidth, targetHeight, mode = "pad") {
    if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(value => Number.isFinite(value) && value > 0)) {
      throw new RangeError("Video dimensions must be positive numbers.");
    }
    if (mode === "stretch") return { x: 0, y: 0, width: targetWidth, height: targetHeight };
    if (!["pad", "crop"].includes(mode)) throw new RangeError("Choose pad, crop, or stretch.");
    const scale = mode === "crop"
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
  }

  function parseRate(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parts = String(value).split("/");
    const numerator = Number(parts[0]);
    const denominator = parts.length > 1 ? Number(parts[1]) : 1;
    const rate = numerator / denominator;
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  function parseFfprobe(input) {
    const data = typeof input === "string" ? JSON.parse(input) : input;
    const streams = Array.isArray(data?.streams) ? data.streams : [];
    const video = streams.find(stream => stream.codec_type === "video");
    if (!video) throw new TypeError("ffprobe output contains no video stream.");
    const sideData = Array.isArray(video.side_data_list) ? video.side_data_list : [];
    const rotation = Number(video.tags?.rotate ?? sideData.find(item => item.rotation !== undefined)?.rotation ?? 0);
    const duration = Number(video.duration ?? data.format?.duration);
    const averageFps = parseRate(video.avg_frame_rate);
    const nominalFps = parseRate(video.r_frame_rate);
    return {
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      codec: video.codec_name || null,
      pixelFormat: video.pix_fmt || null,
      fieldOrder: video.field_order || null,
      colorRange: video.color_range || null,
      colorSpace: video.color_space || null,
      colorPrimaries: video.color_primaries || null,
      colorTransfer: video.color_transfer || null,
      rotation: Number.isFinite(rotation) ? rotation : 0,
      fps: averageFps || nominalFps,
      averageFps,
      nominalFps,
      variableFrameRate: averageFps && nominalFps ? Math.abs(averageFps - nominalFps) > 0.01 : null,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      audioStreams: streams.filter(stream => stream.codec_type === "audio").map(stream => ({
        codec: stream.codec_name || null,
        sampleRate: Number(stream.sample_rate) || null,
        channels: Number(stream.channels) || null
      }))
    };
  }

  function concatChunks(chunks, mimeType = "video/webm") {
    return new Blob(chunks, { type: mimeType });
  }

  root.PulseframeUpscaler = { targetDimensions, fitRect, parseRate, parseFfprobe, concatChunks };
})(window);
