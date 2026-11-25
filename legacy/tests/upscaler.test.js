(async () => {
  const { targetDimensions, fitRect, parseFfprobe, concatChunks } =
    window.PulseframeUpscaler;
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
  function equal(actual, expected) {
    if (actual !== expected)
      throw new Error(`expected ${actual} to equal ${expected}`);
  }

  test("target presets create landscape, portrait, and square dimensions", () => {
    const landscape = targetDimensions(1080, "16:9", 1920, 1080);
    const portrait = targetDimensions(720, "9:16", 720, 1280);
    const square = targetDimensions(2160, "1:1", 4096, 4096);
    equal(landscape.width, 1920);
    equal(landscape.height, 1080);
    equal(portrait.width, 720);
    equal(portrait.height, 1280);
    equal(square.width, 2160);
    equal(square.height, 2160);
  });

  test("source aspect variant preserves its ratio and dimensions stay even", () => {
    const target = targetDimensions(1080, "source", 1440, 1080);
    equal(target.width, 1440);
    equal(target.height, 1080);
    assert(
      target.width % 2 === 0 && target.height % 2 === 0,
      "dimensions must be even",
    );
  });

  test("extreme source aspect ratios are rejected before oversized canvas allocation", () => {
    let rejected = false;
    try {
      targetDimensions(2160, "source", 8192, 200);
    } catch (error) {
      rejected = error instanceof RangeError;
    }
    assert(rejected, "unsafe source aspect should be rejected");
  });

  test("pad, crop, and stretch produce their expected output geometry", () => {
    const pad = fitRect(640, 480, 1280, 720, "pad");
    const crop = fitRect(640, 480, 1280, 720, "crop");
    const stretch = fitRect(640, 480, 1280, 720, "stretch");
    equal(pad.width, 960);
    equal(pad.x, 160);
    equal(crop.height, 960);
    equal(crop.y, -120);
    equal(stretch.width, 1280);
    equal(stretch.height, 720);
  });

  test("ffprobe JSON parsing reads video, audio, rational fps, and rotation", () => {
    const probe = parseFfprobe({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
          pix_fmt: "yuv420p",
          field_order: "progressive",
          color_range: "tv",
          color_space: "bt709",
          color_primaries: "bt709",
          color_transfer: "bt709",
          avg_frame_rate: "30000/1001",
          r_frame_rate: "30000/1001",
          duration: "12.5",
          tags: { rotate: "90" },
        },
        {
          codec_type: "audio",
          codec_name: "aac",
          sample_rate: "48000",
          channels: 2,
        },
      ],
      format: { duration: "12.5" },
    });
    equal(probe.width, 1920);
    equal(probe.height, 1080);
    equal(probe.codec, "h264");
    equal(probe.fps, 30000 / 1001);
    equal(probe.rotation, 90);
    equal(probe.audioStreams.length, 1);
    equal(probe.audioStreams[0].sampleRate, 48000);
    equal(probe.colorTransfer, "bt709");
    equal(probe.variableFrameRate, false);
  });

  const blob = concatChunks(
    [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4])],
    "video/webm",
  );
  const bytes = [...new Uint8Array(await blob.arrayBuffer())];
  if (blob.type !== "video/webm" || bytes.join(",") !== "1,2,3,4") {
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
  document.title = `${failed ? "FAIL" : "PASS"} — Pulseframe upscaler tests`;
})();
