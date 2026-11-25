(() => {
  const Motion = window.PulseframeMotion;
  const canvas = document.querySelector("#sampleCanvas");
  const context = canvas.getContext("2d");
  const image = new Image();
  const duration = 10;
  let motion = Motion.buildPreset("ken-burns", duration, 0.65);
  let startTime = performance.now();
  let recording = false;
  let chunks = [];
  let recorder;

  function renderAt(time) {
    Motion.drawCameraFrame(
      context,
      image,
      canvas.width,
      canvas.height,
      Motion.cameraAt(motion, time),
    );
  }
  function loop(now) {
    const time = ((now - startTime) / 1000) % duration;
    renderAt(time);
    requestAnimationFrame(loop);
  }
  image.onload = () => {
    document.querySelector("#sampleStatus").textContent =
      `Loaded ${image.naturalWidth} × ${image.naturalHeight} image. The canvas is the same deterministic camera renderer used by the editor.`;
    renderAt(0);
    requestAnimationFrame(loop);
  };
  image.onerror = () => {
    document.querySelector("#sampleStatus").textContent =
      "The sample image couldn't be loaded.";
  };
  image.src = "./4k-landscape.svg";
  document
    .querySelector("#samplePreset")
    .addEventListener("change", (event) => {
      motion = Motion.buildPreset(event.target.value, duration, 0.65);
      startTime = performance.now();
    });
  document.querySelector("#restartButton").addEventListener("click", () => {
    startTime = performance.now();
  });
  document
    .querySelector("#exportSampleButton")
    .addEventListener("click", () => {
      if (recording) return;
      if (!canvas.captureStream || !window.MediaRecorder) {
        document.querySelector("#sampleStatus").textContent =
          "WebM recording isn't supported in this browser.";
        return;
      }
      const mimeType = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) {
        document.querySelector("#sampleStatus").textContent =
          "No supported WebM encoder was found.";
        return;
      }
      chunks = [];
      recorder = new MediaRecorder(canvas.captureStream(30), { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = (event) => {
        recording = false;
        document.querySelector("#sampleStatus").textContent =
          `Sample export failed: ${event.error?.message || "media recorder error"}`;
      };
      recorder.onstop = () => {
        recording = false;
        const blob = Motion.concatChunks(chunks, mimeType);
        if (!blob.size) {
          document.querySelector("#sampleStatus").textContent =
            "Sample export produced an empty file.";
          return;
        }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "stillwater-4k-motion.webm";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 3000);
        document.querySelector("#sampleStatus").textContent =
          "Sample render downloaded as stillwater-4k-motion.webm.";
      };
      startTime = performance.now();
      recording = true;
      recorder.start(250);
      document.querySelector("#sampleStatus").textContent =
        "Rendering a 10-second, 30 fps WebM sample…";
      setTimeout(() => {
        if (recording && recorder.state === "recording") recorder.stop();
      }, duration * 1000);
    });
})();
