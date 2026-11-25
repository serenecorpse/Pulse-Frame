export async function extractAudio(
  url: string,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<Blob> {
  const context = new AudioContext();
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.src = url;
  const source = context.createMediaElementSource(video);
  const processor = context.createScriptProcessor(4096, 2, 2);
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(processor);
  processor.connect(silence);
  silence.connect(context.destination);
  const chunks: { left: Float32Array; right: Float32Array }[] = [];
  let frames = 0,
    peak = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(
        () => finish(new Error("Timed out loading the video.")),
        15000,
      );
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () =>
        finish(new DOMException("Audio extraction cancelled.", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        if (!Number.isFinite(video.duration) || video.duration <= 0)
          finish(new Error("Could not read the video duration."));
      };
      video.ontimeupdate = () => {
        if (Number.isFinite(video.duration))
          progress(
            Math.min(
              99,
              Math.floor((video.currentTime / video.duration) * 100),
            ),
          );
      };
      video.onerror = () =>
        finish(new Error("The browser could not decode the video."));
      video.onended = () => finish();
      processor.onaudioprocess = (event) => {
        const left = event.inputBuffer.getChannelData(0).slice();
        const right =
          event.inputBuffer.numberOfChannels > 1
            ? event.inputBuffer.getChannelData(1).slice()
            : left.slice();
        frames += left.length;
        if (44 + frames * 4 > 0xffffffff) {
          finish(
            new Error("Video is too long to save as a standard WAV file."),
          );
          return;
        }
        for (let i = 0; i < left.length; i++)
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
        chunks.push({ left, right });
      };
      void context
        .resume()
        .then(() => video.play())
        .catch((error) =>
          finish(new Error(`Could not play video: ${error.message}`)),
        );
    });
    if (!frames || peak < 1e-7)
      throw new Error("No audio was detected in this video.");
    const dataSize = frames * 4,
      buffer = new ArrayBuffer(44 + dataSize),
      view = new DataView(buffer);
    const write = (offset: number, text: string) =>
      [...text].forEach((character, i) =>
        view.setUint8(offset + i, character.charCodeAt(0)),
      );
    write(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, context.sampleRate, true);
    view.setUint32(28, context.sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (const chunk of chunks)
      for (let i = 0; i < chunk.left.length; i++) {
        const left = Math.max(-1, Math.min(1, chunk.left[i])),
          right = Math.max(-1, Math.min(1, chunk.right[i]));
        view.setInt16(offset, left < 0 ? left * 32768 : left * 32767, true);
        view.setInt16(
          offset + 2,
          right < 0 ? right * 32768 : right * 32767,
          true,
        );
        offset += 4;
      }
    return new Blob([buffer], { type: "audio/wav" });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silence.disconnect();
    await context.close();
  }
}
