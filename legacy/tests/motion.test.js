(async () => {
  const { cropRect, interpolateTrack, buildPreset, cameraAt, concatChunks } =
    window.PulseframeMotion;
  const results = document.querySelector("#results");
  let passed = 0,
    failed = 0;
  function test(name, fn) {
    try {
      fn();
      passed++;
      results.insertAdjacentHTML(
        "beforeend",
        `<li class="pass">PASS ${name}</li>`,
      );
    } catch (error) {
      failed++;
      results.insertAdjacentHTML(
        "beforeend",
        `<li class="fail">FAIL ${name}: ${error.message}</li>`,
      );
    }
  }
  function assert(value, message) {
    if (!value) throw new Error(message);
  }
  function close(actual, expected, tolerance = 1e-6) {
    assert(
      Math.abs(actual - expected) <= tolerance,
      `expected ${actual} to equal ${expected}`,
    );
  }

  test("crop stays inside an image at all corners and extreme zoom", () => {
    const sizes = [
      [3840, 2160],
      [2160, 3840],
      [4096, 4096],
      [5000, 4000],
    ];
    const aspects = [
      [1920, 1080],
      [1080, 1920],
      [1000, 1000],
      [800, 1000],
    ];
    for (const [imageWidth, imageHeight] of sizes) {
      for (const [outputWidth, outputHeight] of aspects) {
        for (const zoom of [1, 1.01, 2, 20, 1000]) {
          for (const [cx, cy] of [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]) {
            const crop = cropRect(
              { cx, cy, zoom, rotation: 17 },
              imageWidth,
              imageHeight,
              outputWidth,
              outputHeight,
            );
            assert(
              crop.x >= -1e-7 && crop.y >= -1e-7,
              "crop starts outside the image",
            );
            assert(
              crop.x + crop.width <= imageWidth + 1e-7,
              "crop extends beyond image width",
            );
            assert(
              crop.y + crop.height <= imageHeight + 1e-7,
              "crop extends beyond image height",
            );
          }
        }
      }
    }
  });

  test("crop uses the source width and height independently", () => {
    const crop = cropRect(
      { cx: 0.5, cy: 0.5, zoom: 1 },
      4000,
      2000,
      1080,
      1920,
    );
    close(crop.width, 1125);
    close(crop.height, 2000);
  });

  test("linear keyframes interpolate endpoints and midpoint", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 10, v: 1 },
    ];
    close(interpolateTrack(keys, 0, "linear"), 0);
    close(interpolateTrack(keys, 5, "linear"), 0.5);
    close(interpolateTrack(keys, 10, "linear"), 1);
  });

  test("PCHIP stays monotone without overshooting its keyframes", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 2, v: 1 },
      { t: 5, v: 1.2 },
      { t: 8, v: 2 },
    ];
    let previous = -Infinity;
    for (let time = 0; time <= 8; time += 0.05) {
      const current = interpolateTrack(keys, time, "pchip");
      assert(
        current >= previous - 1e-8,
        "monotone keyframes produced a reversal",
      );
      assert(
        current >= -1e-8 && current <= 2 + 1e-8,
        "interpolation overshot a keyframe",
      );
      previous = current;
    }
  });

  test("hold, ease-in, and ease-out easing produce expected values", () => {
    const keys = [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
    ];
    close(interpolateTrack(keys, 0.5, "hold"), 0);
    close(interpolateTrack(keys, 0.5, "ease-in"), 0.25);
    close(interpolateTrack(keys, 0.5, "ease-out"), 0.75);
  });

  test("camera zoom interpolates in logarithmic space", () => {
    const motion = {
      duration: 10,
      easing: "linear",
      intensity: 1,
      appliedIntensity: 1,
      keyframes: {
        cx: [
          { t: 0, v: 0.5 },
          { t: 10, v: 0.5 },
        ],
        cy: [
          { t: 0, v: 0.5 },
          { t: 10, v: 0.5 },
        ],
        zoom: [
          { t: 0, v: 0 },
          { t: 10, v: Math.log(4) },
        ],
        rotation: [
          { t: 0, v: 0 },
          { t: 10, v: 0 },
        ],
      },
    };
    close(cameraAt(motion, 5).zoom, 2);
  });

  test("all motion presets produce finite, clamped camera values", () => {
    const names = [
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
    ];
    names.forEach((name) => {
      const motion = buildPreset(name, 12, 0.8, [
        [0.2, 0.3],
        [0.8, 0.7],
      ]);
      for (let time = 0; time <= 12; time += 0.25) {
        const camera = cameraAt(motion, time);
        assert(
          Number.isFinite(camera.cx) && camera.cx >= 0 && camera.cx <= 1,
          `${name} cx is out of bounds`,
        );
        assert(
          Number.isFinite(camera.cy) && camera.cy >= 0 && camera.cy <= 1,
          `${name} cy is out of bounds`,
        );
        assert(
          Number.isFinite(camera.zoom) && camera.zoom >= 1,
          `${name} zoom is invalid`,
        );
      }
    });
  });

  const blob = concatChunks(
    [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])],
    "video/webm",
  );
  const bytes = [...new Uint8Array(await blob.arrayBuffer())];
  if (blob.type !== "video/webm" || bytes.join(",") !== "1,2,3,4,5") {
    failed++;
    results.insertAdjacentHTML(
      "beforeend",
      '<li class="fail">FAIL chunk concatenation preserves type and byte order</li>',
    );
  } else {
    passed++;
    results.insertAdjacentHTML(
      "beforeend",
      '<li class="pass">PASS chunk concatenation preserves type and byte order</li>',
    );
  }
  document.querySelector("#summary").textContent =
    `${passed} passed · ${failed} failed`;
  document.title = `${failed ? "FAIL" : "PASS"} — Pulseframe motion tests`;
})();
