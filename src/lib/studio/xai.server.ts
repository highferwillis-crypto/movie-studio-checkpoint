const IMAGE_MODEL = "grok-imagine-image-2.0";
const VIDEO_MODEL = "grok-imagine-video-1.5";

export type StillRequest = {
  prompt: string;
  n: number;
  aspectRatio: string;
  resolution: "1k" | "2k";
  quality: "low" | "medium";
  references: { dataUrl: string; tag: string }[];
};

export type VideoRequest = {
  prompt: string;
  duration: number;
  aspectRatio: string;
  resolution: "480p" | "720p" | "1080p";
  pinFirst: boolean;
  references: { dataUrl: string; tag: string }[];
};

export type ChatRequest = {
  messages: { role: "user" | "assistant"; content: string }[];
  digest: string;
};

type ImagePayload = { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } | string };

function apiKey(): string | null {
  return process.env.XAI_API_KEY ?? null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    if (typeof body.error === "string" && body.error) return body.error;
    if (typeof body.error === "object" && body.error?.message) return body.error.message;
  } catch {
    /* ignore */
  }
  return `${fallback} (${res.status})`;
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error("Could not download a generated still.");
  const mime = res.headers.get("content-type") || "image/jpeg";
  const bytes = Buffer.from(await res.arrayBuffer());
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function normalizeB64(value: string): string {
  if (value.startsWith("data:image/")) return value;
  return `data:image/jpeg;base64,${value}`;
}

async function postJson(path: string, body: unknown, key: string, timeoutMs: number): Promise<Response> {
  return fetch(`https://api.x.ai/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function generateImages(
  data: StillRequest,
): Promise<{ ok: true; images: string[] } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "AI is not available in this environment." };

  const prompt = data.prompt.slice(0, 8000);
  const shared = {
    model: IMAGE_MODEL,
    prompt,
    n: data.n,
    aspect_ratio: data.aspectRatio,
    resolution: data.resolution,
    quality: data.quality,
  };

  let res: Response;
  if (data.references.length === 0) {
    res = await postJson("/images/generations", { ...shared, response_format: "b64_json" }, key, 180_000);
  } else {
    const images = data.references.slice(0, 5).map((ref) => ({ type: "image_url" as const, url: ref.dataUrl }));
    res = await postJson(
      "/images/edits",
      {
        ...shared,
        image: images.length === 1 ? images[0] : undefined,
        images: images.length > 1 ? images : undefined,
        response_format: "b64_json",
      },
      key,
      180_000,
    );
  }

  if (!res.ok) return { ok: false, error: await errorMessage(res, "Still render failed") };

  const body = (await res.json()) as ImagePayload;
  const images: string[] = [];
  for (const item of body.data ?? []) {
    if (item.b64_json) images.push(normalizeB64(item.b64_json));
    else if (item.url) images.push(await urlToDataUrl(item.url));
  }
  if (!images.length) return { ok: false, error: "The render returned no stills." };
  return { ok: true, images };
}

export async function startVideo(
  data: VideoRequest,
): Promise<{ ok: true; requestId: string; note?: string } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "AI is not available in this environment." };

  let resolution = data.resolution;
  let note: string | undefined;
  const body: Record<string, unknown> = {
    model: VIDEO_MODEL,
    prompt: data.prompt.slice(0, 8000),
    duration: data.duration,
    aspect_ratio: data.aspectRatio,
  };

  const refs = data.references.slice(0, 7);
  if (data.pinFirst && refs.length > 0) {
    body.image = { url: refs[0].dataUrl };
    if (refs.length > 1) {
      body.reference_images = refs.slice(1).map((ref) => ({ url: ref.dataUrl }));
      if (resolution === "1080p") {
        resolution = "720p";
        note = "Reference shots render at 720p, so this one was set to 720p.";
      }
    }
  } else if (refs.length > 0) {
    body.reference_images = refs.map((ref) => ({ url: ref.dataUrl }));
    if (resolution === "1080p") {
      resolution = "720p";
      note = "Reference shots render at 720p, so this one was set to 720p.";
    }
  }
  body.resolution = resolution;

  const res = await postJson("/videos/generations", body, key, 60_000);
  if (!res.ok) return { ok: false, error: await errorMessage(res, "Shot render failed") };
  const payload = (await res.json()) as { request_id?: string; id?: string };
  const requestId = payload.request_id || payload.id;
  if (!requestId) return { ok: false, error: "The video service did not return a request id." };
  return note ? { ok: true, requestId, note } : { ok: true, requestId };
}

export async function readVideoStatus(
  requestId: string,
): Promise<{ ok: true; status: "pending" | "done" } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "AI is not available in this environment." };
  const res = await fetch(`https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return { ok: false, error: await errorMessage(res, "Could not check the shot") };
  const body = (await res.json()) as {
    status?: string;
    error?: { message?: string } | string;
  };
  const status = body.status ?? "";
  if (status === "done") return { ok: true, status: "done" };
  if (status === "failed" || status === "expired") {
    const message = typeof body.error === "string" ? body.error : body.error?.message || `The shot ${status}.`;
    return { ok: false, error: message };
  }
  return { ok: true, status: "pending" };
}

export async function proxyVideo(requestId: string): Promise<Response> {
  const key = apiKey();
  if (!key) return Response.json({ error: "AI is not available in this environment." }, { status: 503 });
  if (!/^[\w-]{6,}$/.test(requestId)) {
    return Response.json({ error: "Unknown shot." }, { status: 400 });
  }
  const statusRes = await fetch(`https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!statusRes.ok) {
    return Response.json({ error: await errorMessage(statusRes, "Could not fetch the shot") }, { status: 502 });
  }
  const body = (await statusRes.json()) as { status?: string; video?: { url?: string } };
  const url = body.video?.url;
  if (body.status !== "done" || !url) {
    return Response.json({ error: "The shot is not ready." }, { status: 409 });
  }
  const fileRes = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!fileRes.ok || !fileRes.body) {
    return Response.json({ error: "Could not download the shot." }, { status: 502 });
  }
  return new Response(fileRes.body, {
    headers: {
      "Content-Type": fileRes.headers.get("content-type") || "video/mp4",
      "Cache-Control": "no-store",
    },
  });
}

const SYSTEM = `You are the story editor inside Movie Studio, working inside one open project.
PROJECT FILES already contain that project's library: character names, scenes, stills, voices, notes, and their @tags. They are loaded for you. Do not ask the filmmaker to select or attach them.
Use those names and @tags when you write. Do not invent a character, costume, or place that contradicts a filed prompt. If the library is empty, help them decide what to make, and tell them to render it on the stage and file it into Characters, Scenes, Stills, or Reels.
Write generator-ready lines they can paste on the stage. Plain sentences.
When they ask you to save, summarize, or file the idea into the project, finish your reply with exactly this block:
:::note
title: short title
---
markdown to store
:::`;

export async function studioChat(
  data: ChatRequest,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "AI is not available in this environment." };
  const res = await postJson(
    "/chat/completions",
    {
      model: "grok-4.5",
      max_tokens: 900,
      temperature: 0.6,
      messages: [
        { role: "system", content: `${SYSTEM}\n\nPROJECT FILES:\n${data.digest}` },
        ...data.messages,
      ],
    },
    key,
    60_000,
  );
  if (!res.ok) return { ok: false, error: await errorMessage(res, "The editor is unavailable") };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) return { ok: false, error: "The editor returned an empty reply." };
  return { ok: true, text };
}

export async function planShot(data: {
  script: string;
  styleLine: string;
  shotSeconds: number;
  filmSeconds: number;
  filed: { title: string; seconds: number }[];
}): Promise<
  { ok: true; done: true } | { ok: true; done: false; title: string; scene: string; seconds: number } | { ok: false; error: string }
> {
  const key = apiKey();
  if (!key) return { ok: false, error: "AI is not available in this environment." };
  const filed = data.filed.length
    ? data.filed.map((shot, index) => `${index + 1}. ${shot.title} (${shot.seconds}s)`).join("\n")
    : "(none yet)";
  const res = await postJson(
    "/chat/completions",
    {
      model: "grok-4.5",
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            'You are the production lead in Movie Studio. Turn the script into the next single shot the video generator can render. Reply with JSON only. If the filed shots already cover the script, or the filed time has reached the film length, reply {"done":true}. Otherwise reply {"done":false,"title":"two or three words","seconds":15,"scene":"one shot in present tense: action, dialogue, camera, sound. Use @tags already written in the script."} seconds is an integer from 4 through the shot maximum. Do not repeat a filed shot. Do not plan more than one shot.',
        },
        {
          role: "user",
          content: `Style: ${data.styleLine}\nShot maximum: ${data.shotSeconds} seconds\nFilm length: ${data.filmSeconds} seconds\nAlready filed:\n${filed}\n\nSCRIPT:\n${data.script.slice(0, 12000)}`,
        },
      ],
    },
    key,
    60_000,
  );
  if (!res.ok) return { ok: false, error: await errorMessage(res, "Could not plan the next shot") };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim() ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: "The planner did not return a shot." };
  let parsed: { done?: boolean; title?: string; scene?: string; seconds?: number };
  try {
    parsed = JSON.parse(match[0]) as { done?: boolean; title?: string; scene?: string; seconds?: number };
  } catch {
    return { ok: false, error: "The planner did not return a shot." };
  }
  if (parsed.done) return { ok: true, done: true };
  const scene = typeof parsed.scene === "string" ? parsed.scene.trim() : "";
  if (!scene) return { ok: false, error: "The planner returned an empty shot." };
  const title = (typeof parsed.title === "string" && parsed.title.trim()) || "Shot";
  const seconds = Math.min(data.shotSeconds, Math.max(4, Math.round(Number(parsed.seconds) || data.shotSeconds)));
  return { ok: true, done: false, title: title.slice(0, 80), scene: scene.slice(0, 4000), seconds };
}

export async function speakLine(
  text: string,
  voiceId?: string,
): Promise<{ ok: true; audio: string; mime: string } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "AI is not available in this environment." };
  const spoken = text.replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!spoken) return { ok: false, error: "Nothing to read." };
  const voices = voiceId ? [voiceId] : ["ara", "eve"];
  let last = "Could not speak.";
  for (const id of voices) {
    const res = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: spoken, voice_id: id, language: "en" }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      last = await errorMessage(res, "Could not speak");
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return { ok: true, audio: bytes.toString("base64"), mime: res.headers.get("content-type") || "audio/mpeg" };
  }
  return { ok: false, error: last };
}

export async function registerCustomVoice(
  name: string,
  wavBase64: string,
): Promise<{ ok: true; voiceId: string } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "Voice cloning needs the built-in key. The sample can still be filed." };
  const bytes = Buffer.from(wavBase64, "base64");
  if (!bytes.length) return { ok: false, error: "The voice sample was empty." };
  const form = new FormData();
  form.append("name", name.slice(0, 80));
  form.append("language", "en");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "voice.wav");
  const res = await fetch("https://api.x.ai/v1/custom-voices", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return { ok: false, error: await errorMessage(res, "Could not make a character voice from that sample") };
  const body = (await res.json()) as { voice_id?: string };
  if (!body.voice_id) return { ok: false, error: "The voice service did not return an id." };
  return { ok: true, voiceId: body.voice_id };
}

export async function transcribeSpeech(
  audioBase64: string,
  mime: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: "Speech to the editor needs the built-in key." };
  const bytes = Buffer.from(audioBase64, "base64");
  if (!bytes.length) return { ok: false, error: "The recording was empty." };
  const form = new FormData();
  form.append("model", "grok-voice-transcribe-2.0");
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime || "audio/webm" }), "speech.webm");
  const res = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return { ok: false, error: await errorMessage(res, "Could not hear that") };
  const body = (await res.json()) as { text?: string };
  const text = body.text?.trim() ?? "";
  if (!text) return { ok: false, error: "No words were heard." };
  return { ok: true, text };
}
