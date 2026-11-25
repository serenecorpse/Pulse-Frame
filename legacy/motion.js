(function (root) {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback) =>
    Number.isFinite(value) ? value : fallback;

  function cropSize(imageWidth, imageHeight, outputWidth, outputHeight, zoom) {
    if (
      ![imageWidth, imageHeight, outputWidth, outputHeight, zoom].every(
        (value) => Number.isFinite(value) && value > 0,
      )
    ) {
      throw new RangeError(
        "Image, output, and zoom dimensions must be positive finite numbers.",
      );
    }
    const aspect = outputWidth / outputHeight;
    let width, height;
    if (imageWidth / imageHeight > aspect) {
      height = imageHeight;
      width = height * aspect;
    } else {
      width = imageWidth;
      height = width / aspect;
    }
    return {
      width: Math.min(imageWidth, width / zoom),
      height: Math.min(imageHeight, height / zoom),
    };
  }

  function cropRect(
    camera,
    imageWidth,
    imageHeight,
    outputWidth,
    outputHeight,
  ) {
    const angle = (finite(camera.rotation, 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(angle)),
      s = Math.abs(Math.sin(angle));
    const aspect = outputWidth / outputHeight;
    const rotationCoverage = Math.max(c + s / aspect, c + s * aspect);
    const crop = cropSize(
      imageWidth,
      imageHeight,
      outputWidth,
      outputHeight,
      Math.max(1, finite(camera.zoom, 1)) * rotationCoverage,
    );
    const cx = clamp(
      finite(camera.cx, 0.5),
      crop.width / (2 * imageWidth),
      1 - crop.width / (2 * imageWidth),
    );
    const cy = clamp(
      finite(camera.cy, 0.5),
      crop.height / (2 * imageHeight),
      1 - crop.height / (2 * imageHeight),
    );
    return {
      x: cx * imageWidth - crop.width / 2,
      y: cy * imageHeight - crop.height / 2,
      width: crop.width,
      height: crop.height,
      cx,
      cy,
    };
  }

  function easingValue(t, easing) {
    const x = clamp(t, 0, 1);
    if (easing === "hold") return x < 1 ? 0 : 1;
    if (easing === "linear") return x;
    if (easing === "ease-in") return x * x;
    if (easing === "ease-out") return 1 - (1 - x) * (1 - x);
    if (easing === "ease-in-out") return x * x * (3 - 2 * x);
    return x;
  }

  function pchipSlope(previous, current, next) {
    const leftWidth = current.t - previous.t;
    const rightWidth = next.t - current.t;
    const leftSlope = (current.v - previous.v) / leftWidth;
    const rightSlope = (next.v - current.v) / rightWidth;
    if (
      leftSlope === 0 ||
      rightSlope === 0 ||
      Math.sign(leftSlope) !== Math.sign(rightSlope)
    )
      return 0;
    const w1 = 2 * rightWidth + leftWidth;
    const w2 = rightWidth + 2 * leftWidth;
    return (w1 + w2) / (w1 / leftSlope + w2 / rightSlope);
  }

  function interpolateTrack(points, time, easing = "pchip") {
    if (!Array.isArray(points) || !points.length) return 0;
    const sorted = points
      .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
      .slice()
      .sort((a, b) => a.t - b.t);
    const keys = [];
    sorted.forEach((point) => {
      if (keys.length && Math.abs(keys[keys.length - 1].t - point.t) < 1e-8)
        keys[keys.length - 1] = point;
      else keys.push(point);
    });
    if (!keys.length) return 0;
    if (keys.length === 1 || time <= keys[0].t) return keys[0].v;
    const last = keys[keys.length - 1];
    if (time >= last.t) return last.v;
    let index = 0;
    while (index < keys.length - 2 && time > keys[index + 1].t) index++;
    const a = keys[index],
      b = keys[index + 1];
    const duration = b.t - a.t;
    if (duration <= 0) return b.v;
    const t = (time - a.t) / duration;
    if (easing !== "pchip") return a.v + (b.v - a.v) * easingValue(t, easing);
    const before = keys[Math.max(0, index - 1)];
    const after = keys[Math.min(keys.length - 1, index + 2)];
    const slopeA =
      index === 0 ? (b.v - a.v) / duration : pchipSlope(before, a, b);
    const slopeB =
      index + 2 >= keys.length
        ? (b.v - a.v) / duration
        : pchipSlope(a, b, after);
    const t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * a.v +
      (t3 - 2 * t2 + t) * duration * slopeA +
      (-2 * t3 + 3 * t2) * b.v +
      (t3 - t2) * duration * slopeB
    );
  }

  function motionFromPath(
    path,
    duration,
    easing = "pchip",
    preset = "ken-burns",
  ) {
    const keyframes = { cx: [], cy: [], zoom: [], rotation: [] };
    path.forEach(([t, cx, cy, zoom, rotation = 0]) => {
      keyframes.cx.push({ t, v: clamp(cx, 0, 1) });
      keyframes.cy.push({ t, v: clamp(cy, 0, 1) });
      keyframes.zoom.push({ t, v: Math.log(Math.max(1, zoom)) });
      keyframes.rotation.push({ t, v: rotation });
    });
    return { preset, duration, easing, keyframes, points: [] };
  }

  function buildPreset(name, duration = 10, intensity = 0.65, points = []) {
    const d = Math.max(0.1, finite(duration, 10));
    const i = clamp(finite(intensity, 0.65), 0, 1.5);
    const a = clamp(i / 0.65, 0, 2);
    const center = [0.5, 0.5];
    let path;
    switch (name) {
      case "pan-left":
        path = [
          [0, 0.57, 0.5, 1.34, 0],
          [d, 0.43, 0.5, 1.34, 0],
        ];
        break;
      case "pan-right":
        path = [
          [0, 0.43, 0.5, 1.34, 0],
          [d, 0.57, 0.5, 1.34, 0],
        ];
        break;
      case "pan-up":
        path = [
          [0, 0.5, 0.57, 1.34, 0],
          [d, 0.5, 0.43, 1.34, 0],
        ];
        break;
      case "pan-down":
        path = [
          [0, 0.5, 0.43, 1.34, 0],
          [d, 0.5, 0.57, 1.34, 0],
        ];
        break;
      case "diagonal":
        path = [
          [0, 0.43, 0.43, 1.3, 0],
          [d, 0.57, 0.57, 1.3, 0],
        ];
        break;
      case "orbit":
        path = Array.from({ length: 17 }, (_, index) => {
          const t = (d * index) / 16,
            angle = (index / 16) * Math.PI * 2;
          return [
            t,
            center[0] + Math.cos(angle) * 0.035 * a,
            center[1] + Math.sin(angle) * 0.035 * a,
            1.14,
            0,
          ];
        });
        break;
      case "dolly":
        path = [
          [0, 0.47, 0.5, 1.65, 0],
          [d, 0.53, 0.5, 1.08, 0],
        ];
        break;
      case "reveal":
        path = [
          [0, 0.5, 0.5, 2.2, 0],
          [d, 0.5, 0.5, 1, 0],
        ];
        break;
      case "detail-tour": {
        const tour = (
          points.length
            ? points
            : [
                [0.35, 0.4],
                [0.65, 0.4],
                [0.62, 0.63],
              ]
        ).slice(0, 12);
        path = [[0, tour[0][0], tour[0][1], 1.85, 0]];
        tour.forEach((point, index) =>
          path.push([
            (d * (index + 1)) / tour.length,
            point[0],
            point[1],
            1.85,
            0,
          ]),
        );
        break;
      }
      case "handheld":
        path = [
          [0, 0.5, 0.5, 1.12, 0],
          [d, 0.5, 0.5, 1.12, 0],
        ];
        break;
      case "breathing":
        path = Array.from({ length: 9 }, (_, index) => [
          (d * index) / 8,
          0.5,
          0.5,
          1.12 + 0.045 * a * (0.5 - 0.5 * Math.cos((index / 8) * Math.PI * 4)),
          0,
        ]);
        break;
      case "ken-burns":
      default:
        path = [
          [0, 0.47, 0.53, 1, 0],
          [d, 0.54, 0.47, 1 + 0.32 * a, 0],
        ];
    }
    return motionFromPath(path, d, "pchip", name);
  }

  function cameraAt(motion, time) {
    const tracks = motion.keyframes || {};
    const t = clamp(
      finite(time, 0),
      0,
      Math.max(0, finite(motion.duration, time)),
    );
    const easing = motion.easing || "pchip";
    let cx = interpolateTrack(tracks.cx, t, easing);
    let cy = interpolateTrack(tracks.cy, t, easing);
    let logZoom = interpolateTrack(tracks.zoom, t, easing);
    let rotation = interpolateTrack(tracks.rotation, t, easing);
    const intensity = clamp(finite(motion.intensity, 0.65), 0, 1.5);
    const baseIntensity = Math.max(
      0.001,
      finite(motion.appliedIntensity, intensity || 0.65),
    );
    const intensityRatio = clamp(intensity / baseIntensity, 0, 2);
    cx = 0.5 + (cx - 0.5) * intensityRatio;
    cy = 0.5 + (cy - 0.5) * intensityRatio;
    logZoom *= intensityRatio;
    rotation *= intensityRatio;
    const zoom = Math.exp(logZoom);
    if (motion.preset === "handheld" && motion.handheldLive) {
      const intensity = clamp(motion.intensity ?? 0.65, 0, 1.5) / 0.65;
      cx +=
        (Math.sin(t * 2.2) + 0.42 * Math.sin(t * 3.4 + 1.1)) *
        0.008 *
        intensity;
      cy +=
        (Math.sin(t * 2.8 + 0.4) + 0.3 * Math.sin(t * 3.1)) * 0.007 * intensity;
    }
    return {
      cx: clamp(cx, 0, 1),
      cy: clamp(cy, 0, 1),
      zoom: Math.max(1, zoom),
      rotation,
    };
  }

  function buildPyramid(image, scales = [1, 2 / 3, 1 / 2]) {
    const width = image.naturalWidth || image.videoWidth || image.width;
    const height = image.naturalHeight || image.videoHeight || image.height;
    if (!width || !height)
      throw new RangeError("Cannot build an image pyramid for an empty image.");
    return scales.map((scale) => {
      if (scale === 1) return { image, scaleX: 1, scaleY: 1 };
      const level = document.createElement("canvas");
      level.width = Math.max(1, Math.round(width * scale));
      level.height = Math.max(1, Math.round(height * scale));
      let levelContext;
      try {
        levelContext = level.getContext("2d", { colorSpace: "srgb-linear" });
      } catch {}
      const linearWorkingCopy =
        levelContext?.getContextAttributes?.().colorSpace === "srgb-linear";
      if (!levelContext) levelContext = level.getContext("2d");
      levelContext.imageSmoothingEnabled = true;
      levelContext.imageSmoothingQuality = "high";
      levelContext.drawImage(image, 0, 0, level.width, level.height);
      return {
        image: level,
        scaleX: level.width / width,
        scaleY: level.height / height,
        linearWorkingCopy,
      };
    });
  }

  function drawCameraFrame(
    context,
    image,
    outputWidth,
    outputHeight,
    camera,
    pyramid = null,
  ) {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const crop = cropRect(
      camera,
      imageWidth,
      imageHeight,
      outputWidth,
      outputHeight,
    );
    const idealX = outputWidth / crop.width;
    const idealY = outputHeight / crop.height;
    const levels = pyramid?.length
      ? pyramid
      : [{ image, scaleX: 1, scaleY: 1 }];
    const level = levels.reduce(
      (best, candidate) => {
        const distance =
          Math.abs(Math.log(candidate.scaleX / idealX)) +
          Math.abs(Math.log(candidate.scaleY / idealY));
        return distance < best.distance ? { level: candidate, distance } : best;
      },
      { level: levels[0], distance: Infinity },
    ).level;
    context.save();
    context.translate(outputWidth / 2, outputHeight / 2);
    context.rotate((finite(camera.rotation, 0) * Math.PI) / 180);
    context.drawImage(
      level.image,
      crop.x * level.scaleX,
      crop.y * level.scaleY,
      crop.width * level.scaleX,
      crop.height * level.scaleY,
      -outputWidth / 2,
      -outputHeight / 2,
      outputWidth,
      outputHeight,
    );
    context.restore();
    return crop;
  }

  function concatChunks(chunks, mimeType = "video/webm") {
    return new Blob(chunks, { type: mimeType });
  }

  const api = {
    clamp,
    cropSize,
    cropRect,
    easingValue,
    interpolateTrack,
    buildPreset,
    cameraAt,
    buildPyramid,
    drawCameraFrame,
    concatChunks,
  };
  root.PulseframeMotion = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
