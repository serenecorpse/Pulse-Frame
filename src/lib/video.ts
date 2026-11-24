export async function verifyVideo(blob: Blob, width: number, height: number): Promise<void> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Timed out validating the encoded video.")), 15000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        video.onloadeddata = null; video.onerror = null;
        if (error) reject(error); else resolve();
      };
      video.onloadeddata = () => {
        if (video.videoWidth !== width || video.videoHeight !== height) finish(new Error(`Encoded dimensions are ${video.videoWidth} × ${video.videoHeight}, expected ${width} × ${height}.`));
        else finish();
      };
      video.onerror = () => finish(new Error("The browser could not decode the encoded video."));
      video.src = url; video.load();
    });
  } finally {
    video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
  }
}
