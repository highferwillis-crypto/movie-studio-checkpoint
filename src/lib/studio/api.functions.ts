import { createServerFn } from "@tanstack/react-start";
import { IMAGE_ASPECTS, VIDEO_ASPECTS } from "@/lib/studio/prompt";

const IMAGE_ASPECT_SET = new Set<string>(IMAGE_ASPECTS);
const VIDEO_ASPECT_SET = new Set<string>(VIDEO_ASPECTS);

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") throw new Error("Bad request");
  return input as Record<string, unknown>;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function readRefs(value: unknown, max: number): { dataUrl: string; tag: string }[] {
  if (!Array.isArray(value)) return [];
  if (value.length > max) throw new Error(`Use at most ${max} reference images.`);
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Bad reference");
    const ref = item as { dataUrl?: unknown; tag?: unknown };
    if (typeof ref.dataUrl !== "string" || !ref.dataUrl.startsWith("data:image/")) {
      throw new Error("A reference image was unreadable.");
    }
    if (ref.dataUrl.length > 2_000_000) throw new Error("A reference image is too large. Use a smaller still.");
    const tag = typeof ref.tag === "string" ? ref.tag.slice(0, 80) : "image";
    return { dataUrl: ref.dataUrl, tag };
  });
}

export const generateCustom = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const base = typeof data.base === "string" ? data.base.trim() : "";
    const apiKey = typeof data.apiKey === "string" ? data.apiKey : "";
    const model = typeof data.model === "string" ? data.model.trim() : "";
    const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
    if (!base) throw new Error("Set the API address in Settings.");
    if (!prompt) throw new Error("Write a scene before rendering.");
    return {
      base: base.slice(0, 300),
      apiKey: apiKey.slice(0, 500),
      model: model.slice(0, 120),
      prompt: prompt.slice(0, 8000),
      n: clampInt(data.n, 1, 10, 1),
      size: typeof data.size === "string" ? data.size.slice(0, 20) : "1024x1024",
    };
  })
  .handler(async ({ data }) => {
    const { generateCustomStills } = await import("./custom-api.server");
    return generateCustomStills(data);
  });

export const generateStills = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
    if (!prompt) throw new Error("Write a scene before rendering.");
    const aspectRatio = typeof data.aspectRatio === "string" ? data.aspectRatio : "16:9";
    if (!IMAGE_ASPECT_SET.has(aspectRatio)) throw new Error("Unsupported aspect ratio.");
    const resolution = data.resolution === "2k" ? "2k" : "1k";
    const quality = data.quality === "medium" ? "medium" : "low";
    const n = clampInt(data.n, 1, 10, 1);
    return {
      prompt: prompt.slice(0, 8000),
      n,
      aspectRatio,
      resolution,
      quality,
      references: readRefs(data.references, 5),
    } as const;
  })
  .handler(async ({ data }) => {
    const { generateImages } = await import("./xai.server");
    return generateImages(data);
  });

export const beginShot = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const prompt = typeof data.prompt === "string" ? data.prompt.trim() : "";
    if (!prompt) throw new Error("Write a scene before rendering.");
    const aspectRatio = typeof data.aspectRatio === "string" ? data.aspectRatio : "16:9";
    if (!VIDEO_ASPECT_SET.has(aspectRatio)) throw new Error("Unsupported aspect ratio.");
    const resolution = data.resolution === "1080p" || data.resolution === "480p" ? data.resolution : "720p";
    return {
      prompt: prompt.slice(0, 8000),
      duration: clampInt(data.duration, 1, 15, 6),
      aspectRatio,
      resolution,
      pinFirst: data.pinFirst === true,
      references: readRefs(data.references, 7),
    } as const;
  })
  .handler(async ({ data }) => {
    const { startVideo } = await import("./xai.server");
    return startVideo(data);
  });

export const pollShot = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    if (!/^[\w-]{6,}$/.test(requestId)) throw new Error("Unknown shot.");
    return { requestId };
  })
  .handler(async ({ data }) => {
    const { readVideoStatus } = await import("./xai.server");
    return readVideoStatus(data.requestId);
  });

export const planNextShot = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const script = typeof data.script === "string" ? data.script.trim() : "";
    if (!script) throw new Error("There is no script to produce.");
    const filed = Array.isArray(data.filed)
      ? data.filed.slice(0, 80).map((item) => {
          const shot = asRecord(item);
          return {
            title: typeof shot.title === "string" ? shot.title.slice(0, 80) : "Shot",
            seconds: clampInt(shot.seconds, 1, 30, 15),
          };
        })
      : [];
    return {
      script: script.slice(0, 12000),
      styleLine: typeof data.styleLine === "string" ? data.styleLine.slice(0, 400) : "Cinematic.",
      shotSeconds: clampInt(data.shotSeconds, 4, 15, 15),
      filmSeconds: clampInt(data.filmSeconds, 15, 7200, 120),
      filed,
    };
  })
  .handler(async ({ data }) => {
    const { planShot } = await import("./xai.server");
    return planShot(data);
  });

export const askEditor = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    if (!Array.isArray(data.messages)) throw new Error("Bad request");
    const messages = data.messages.slice(-12).map((item) => {
      if (!item || typeof item !== "object") throw new Error("Bad request");
      const message = item as { role?: unknown; content?: unknown };
      if (message.role !== "user" && message.role !== "assistant") throw new Error("Bad request");
      if (typeof message.content !== "string") throw new Error("Bad request");
      const role = message.role === "assistant" ? ("assistant" as const) : ("user" as const);
      return { role, content: message.content.slice(0, 6000) };
    });
    if (!messages.length || messages[messages.length - 1]?.role !== "user") {
      throw new Error("Write a note to the editor first.");
    }
    const digest = typeof data.digest === "string" ? data.digest.slice(0, 14000) : "";
    return { messages, digest };
  })
  .handler(async ({ data }) => {
    const { studioChat } = await import("./xai.server");
    return studioChat(data);
  });

export const speakReply = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) throw new Error("Nothing to read.");
    const voiceId = typeof data.voiceId === "string" ? data.voiceId.trim().slice(0, 80) : "";
    return { text: text.slice(0, 4000), voiceId };
  })
  .handler(async ({ data }) => {
    const { speakLine } = await import("./xai.server");
    return speakLine(data.text, data.voiceId || undefined);
  });

export const registerVoice = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const wavBase64 = typeof data.wavBase64 === "string" ? data.wavBase64 : "";
    if (!name) throw new Error("Name the character.");
    if (!wavBase64) throw new Error("The voice sample was empty.");
    if (wavBase64.length > 12_000_000) throw new Error("That sample is too long. Keep it under two minutes.");
    return { name: name.slice(0, 80), wavBase64 };
  })
  .handler(async ({ data }) => {
    const { registerCustomVoice } = await import("./xai.server");
    return registerCustomVoice(data.name, data.wavBase64);
  });

export const transcribeSpeech = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = asRecord(input);
    const audioBase64 = typeof data.audioBase64 === "string" ? data.audioBase64 : "";
    const mime = typeof data.mime === "string" ? data.mime.slice(0, 80) : "audio/webm";
    if (!audioBase64) throw new Error("The recording was empty.");
    if (audioBase64.length > 8_000_000) throw new Error("That recording is too long.");
    return { audioBase64, mime };
  })
  .handler(async ({ data }) => {
    const { transcribeSpeech: hear } = await import("./xai.server");
    return hear(data.audioBase64, data.mime);
  });
