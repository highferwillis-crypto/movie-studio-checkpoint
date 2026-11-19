export type Engine = "xai" | "api" | "comfy";
export type LaptopProfile = "efficient" | "balanced" | "full";

export type StudioSettings = {
  engine: Engine;
  apiBase: string;
  apiModel: string;
  apiKey: string;
  comfyHost: string;
  checkpoint: string;
  profile: LaptopProfile;
  steps: number;
  cfg: number;
  maxSide: number;
};

export const DEFAULT_SETTINGS: StudioSettings = {
  engine: "xai",
  apiBase: "https://api.x.ai/v1",
  apiModel: "grok-imagine-image-2.0",
  apiKey: "",
  comfyHost: "http://127.0.0.1:8188",
  checkpoint: "",
  profile: "balanced",
  steps: 20,
  cfg: 7,
  maxSide: 768,
};

const KEY = "movie-studio-settings";

const PROFILES: Record<LaptopProfile, Pick<StudioSettings, "steps" | "cfg" | "maxSide">> = {
  efficient: { steps: 8, cfg: 6, maxSide: 512 },
  balanced: { steps: 20, cfg: 7, maxSide: 768 },
  full: { steps: 28, cfg: 7, maxSide: 1024 },
};

export function profilePatch(profile: LaptopProfile): Pick<StudioSettings, "profile" | "steps" | "cfg" | "maxSide"> {
  return { profile, ...PROFILES[profile] };
}

export function batchCap(profile: LaptopProfile): number {
  if (profile === "efficient") return 1;
  if (profile === "balanced") return 2;
  return 10;
}

export function readSettings(): StudioSettings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StudioSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(settings: StudioSettings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

export function frameSize(aspect: string, maxSide: number): { width: number; height: number } {
  const [rawW, rawH] = aspect.split(":").map((part) => Number(part));
  const aw = rawW > 0 ? rawW : 1;
  const ah = rawH > 0 ? rawH : 1;
  const long = Math.min(1280, Math.max(256, maxSide));
  const width = aw >= ah ? long : (long * aw) / ah;
  const height = ah >= aw ? long : (long * ah) / aw;
  const snap = (value: number) => Math.max(64, Math.round(value / 8) * 8);
  return { width: snap(width), height: snap(height) };
}

export const DOWNLOAD_URL = "https://github.com/highferwillis-crypto/movie-studio-checkpoint/archive/refs/heads/main.zip";
