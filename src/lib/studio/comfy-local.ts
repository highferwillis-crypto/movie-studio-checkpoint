import { frameSize, type StudioSettings } from "@/lib/studio/settings";

type OutFile = { filename: string; subfolder?: string; type?: string };

function basicPrompt(input: {
  prompt: string;
  checkpoint: string;
  width: number;
  height: number;
  batch: number;
  steps: number;
  cfg: number;
  seed: number;
}) {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: input.checkpoint } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: input.prompt, clip: ["1", 1] } },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: "blurry, watermark, warped anatomy, extra limbs", clip: ["1", 1] },
    },
    "4": {
      class_type: "EmptyLatentImage",
      inputs: { width: input.width, height: input.height, batch_size: input.batch },
    },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "studio", images: ["6", 0] } },
  };
}

function filesOf(outputs: Record<string, { images?: OutFile[]; gifs?: OutFile[] }> | undefined): OutFile[] {
  const files: OutFile[] = [];
  for (const node of Object.values(outputs ?? {})) files.push(...(node.images ?? []), ...(node.gifs ?? []));
  return files;
}

function fileName(value: string): string {
  return (value.trim().split(/[/\\]/).pop() ?? "").trim();
}

function videoFrames(seconds: number, fps: number, profile: StudioSettings["profile"]): number {
  const cap = profile === "efficient" ? 17 : profile === "balanced" ? 33 : 81;
  const raw = Math.round(Math.max(1, seconds) * Math.min(fps, 16));
  let frames = Math.min(cap, Math.max(17, raw));
  frames = frames - ((frames - 1) % 4);
  return Math.max(5, frames);
}

function videoPrompt(input: {
  prompt: string;
  checkpoint: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  steps: number;
  cfg: number;
  seed: number;
}) {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: input.checkpoint, weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan" },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: "wan2.2_vae.safetensors" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: input.prompt, clip: ["2", 0] } },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: "blur, flicker, watermark, warped anatomy", clip: ["2", 0] },
    },
    "6": { class_type: "ModelSamplingSD3", inputs: { shift: 5, model: ["1", 0] } },
    "7": {
      class_type: "EmptyHunyuanLatentVideo",
      inputs: { width: input.width, height: input.height, length: input.frames, batch_size: 1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: "uni_pc",
        scheduler: "simple",
        denoise: 1,
        model: ["6", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["7", 0],
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": {
      class_type: "SaveAnimatedWEBP",
      inputs: {
        filename_prefix: "studio",
        fps: input.fps,
        lossless: false,
        quality: 80,
        method: "default",
        images: ["9", 0],
      },
    },
  };
}

async function queueAndCollect(
  host: string,
  prompt: unknown,
  cancelled: () => boolean,
): Promise<Blob[]> {
  const queued = await fetch(`${host}/prompt`, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  }).catch(() => null);
  if (!queued) {
    throw new Error("Could not reach the local server. Start it on this machine and allow cross-origin access.");
  }
  const body = (await queued.json().catch(() => null)) as { prompt_id?: string; error?: unknown } | null;
  if (!queued.ok || !body?.prompt_id) {
    const reason = body?.error ? JSON.stringify(body.error) : `The local server refused that model (${queued.status}).`;
    throw new Error(reason);
  }
  const promptId = body.prompt_id;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (cancelled()) throw new Error("Render cancelled.");
    const history = await fetch(`${host}/history/${encodeURIComponent(promptId)}`, { mode: "cors" });
    if (!history.ok) continue;
    const payload = (await history.json()) as Record<
      string,
      { status?: { status_str?: string }; outputs?: Record<string, { images?: OutFile[]; gifs?: OutFile[] }> }
    >;
    const entry = payload[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === "error") throw new Error("The local server failed that checkpoint.");
    const files = filesOf(entry.outputs);
    if (!files.length) continue;
    const blobs: Blob[] = [];
    for (const file of files) {
      const view = new URL(`${host}/view`);
      view.searchParams.set("filename", file.filename);
      view.searchParams.set("type", file.type || "output");
      if (file.subfolder) view.searchParams.set("subfolder", file.subfolder);
      const image = await fetch(view, { mode: "cors" });
      if (!image.ok) throw new Error("The render finished, but the file could not be downloaded.");
      blobs.push(await image.blob());
    }
    return blobs;
  }
  throw new Error("The checkpoint is still rendering. Try again in a moment.");
}

export async function runLocalCheckpoint(input: {
  settings: StudioSettings;
  prompt: string;
  aspect: string;
  batch: number;
  cancelled: () => boolean;
}): Promise<Blob[]> {
  const host = input.settings.comfyHost.replace(/\/$/, "");
  const checkpoint = fileName(input.settings.checkpoint);
  if (!checkpoint) throw new Error("Choose an image checkpoint in Settings.");
  const size = frameSize(input.aspect, input.settings.maxSide);
  return queueAndCollect(
    host,
    basicPrompt({
      prompt: input.prompt,
      checkpoint,
      width: size.width,
      height: size.height,
      batch: input.batch,
      steps: input.settings.steps,
      cfg: input.settings.cfg,
      seed: Math.floor(Math.random() * 1_000_000_000),
    }),
    input.cancelled,
  );
}

export async function runLocalVideo(input: {
  settings: StudioSettings;
  prompt: string;
  aspect: string;
  seconds: number;
  fps: number;
  cancelled: () => boolean;
}): Promise<Blob> {
  const host = input.settings.comfyHost.replace(/\/$/, "");
  const checkpoint = fileName(input.settings.videoCheckpoint);
  if (!checkpoint) throw new Error("Choose a video checkpoint in Settings.");
  const size = frameSize(input.aspect, Math.min(input.settings.maxSide, 832));
  const frames = videoFrames(input.seconds, input.fps, input.settings.profile);
  const blobs = await queueAndCollect(
    host,
    videoPrompt({
      prompt: input.prompt,
      checkpoint,
      width: size.width,
      height: size.height,
      frames,
      fps: Math.min(input.fps, 16),
      steps: input.settings.steps,
      cfg: input.settings.cfg,
      seed: Math.floor(Math.random() * 1_000_000_000),
    }),
    input.cancelled,
  );
  const blob = blobs[0];
  if (!blob) throw new Error("The video checkpoint returned no shot.");
  return blob;
}
