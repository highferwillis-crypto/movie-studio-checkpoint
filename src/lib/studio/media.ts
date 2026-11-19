export async function fileToJpegDataUrl(file: Blob, maxEdge: number, quality = 0.86): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not read that image");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    bitmap.close();
  }
}

export function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const element = document.createElement(blob.type.startsWith("audio") ? "audio" : "video");
    const finish = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(Number.isFinite(element.duration) ? element.duration : 0);
    element.onerror = () => finish(0);
    element.src = url;
  });
}

export function videoPoster(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    const finish = (value: string) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.onloadeddata = () => {
      try {
        const width = 480;
        const height = Math.max(1, Math.round(width * ((video.videoHeight || 9) / (video.videoWidth || 16))));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish("");
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        finish(canvas.toDataURL("image/jpeg", 0.8));
      } catch {
        finish("");
      }
    };
    video.onerror = () => finish("");
    video.src = url;
  });
}

export async function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    throw new Error("Pause on a visible frame first.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not snapshot this frame.");
  ctx.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92));
  if (!blob) throw new Error("Could not snapshot this frame. File the shot, then try again.");
  return blob;
}

export async function compileMovie(blobs: Blob[], onStep?: (index: number, total: number) => void): Promise<Blob> {
  if (!blobs.length) throw new Error("There are no reels to compile.");
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not open the movie.");
  const audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();
  const picture = canvas.captureStream(24);
  const mixed = new MediaStream([...picture.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
  const recorder = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });
  recorder.start(500);
  try {
    for (let index = 0; index < blobs.length; index += 1) {
      onStep?.(index + 1, blobs.length);
      await drawReelClip(ctx, canvas, blobs[index], audioCtx, dest);
    }
  } finally {
    recorder.stop();
  }
  const movie = await finished;
  await audioCtx.close();
  if (!movie.size) throw new Error("The movie compiled empty.");
  return movie;
}

function drawReelClip(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  blob: Blob,
  audioCtx: AudioContext,
  dest: MediaStreamAudioDestinationNode,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.playsInline = true;
    video.src = url;
    const source = audioCtx.createMediaElementSource(video);
    source.connect(dest);
    const finish = () => {
      source.disconnect();
      URL.revokeObjectURL(url);
      resolve();
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("A reel clip could not be read."));
    };
    video.onloadeddata = () => {
      void video.play().then(() => {
        const paint = () => {
          if (video.ended) {
            finish();
            return;
          }
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const width = video.videoWidth || canvas.width;
          const height = video.videoHeight || canvas.height;
          const scale = Math.min(canvas.width / width, canvas.height / height);
          const w = width * scale;
          const h = height * scale;
          ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
          requestAnimationFrame(paint);
        };
        paint();
      }).catch((error: unknown) => {
        URL.revokeObjectURL(url);
        reject(error instanceof Error ? error : new Error("A reel clip would not play."));
      });
    };
  });
}

export async function blobToWavBase64(blob: Blob): Promise<string> {
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const wav = encodeWav(audio);
    const bytes = new Uint8Array(await wav.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  } finally {
    await ctx.close();
  }
}

function encodeWav(buffer: AudioBuffer): Blob {
  const rate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);
  const length = channel.length;
  const data = new ArrayBuffer(44 + length * 2);
  const view = new DataView(data);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i] || 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([data], { type: "audio/wav" });
}

export async function mixVoiceOntoVideo(videoBlob: Blob, voiceBlob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Could not read the shot."));
  });
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not lay the voice on the shot.");
  const audioCtx = new AudioContext();
  const voiceBuffer = await audioCtx.decodeAudioData(await voiceBlob.arrayBuffer());
  const source = audioCtx.createBufferSource();
  source.buffer = voiceBuffer;
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(dest);
  const picture = canvas.captureStream(24);
  const mixed = new MediaStream([...picture.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
  const recorder = new MediaRecorder(mixed, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  });
  const draw = () => {
    if (video.ended || video.paused) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    requestAnimationFrame(draw);
  };
  recorder.start();
  source.start();
  await video.play();
  draw();
  await new Promise<void>((resolve) => {
    video.onended = () => resolve();
  });
  source.stop();
  recorder.stop();
  const result = await finished;
  URL.revokeObjectURL(url);
  await audioCtx.close();
  return result;
}
