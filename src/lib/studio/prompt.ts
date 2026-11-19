import type { AssetKind } from "@/lib/studio/types";

export const STYLES = [
  {
    id: "ultra",
    label: "Ultra realism",
    line: "Ultra-photoreal live action, real lenses, fine skin and material detail, natural imperfections.",
  },
  {
    id: "real",
    label: "Realism",
    line: "Realistic photographic image, believable materials and light.",
  },
  {
    id: "cine",
    label: "Cinematic",
    line: "Cinematic film frame, controlled contrast, anamorphic character, motivated lighting.",
  },
  {
    id: "anime",
    label: "Anime",
    line: "Anime film frame, drawn light, clean shapes, consistent character design.",
  },
  {
    id: "paint",
    label: "Painterly",
    line: "Painterly illustrated frame with coherent form and light.",
  },
  {
    id: "noir",
    label: "Noir",
    line: "Black-and-white noir, hard practical light, deep shadow, film grain.",
  },
  {
    id: "doc",
    label: "Documentary",
    line: "Documentary image, available light, unembellished.",
  },
] as const;

export const IMAGE_ASPECTS = ["16:9", "21:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "2:1"] as const;
export const VIDEO_ASPECTS = ["16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"] as const;

const LIGHTING =
  "Lighting is motivated and consistent with the style: a clear key direction, real falloff, and no unmotivated glow unless the style asks for it.";

export type CanonAsset = {
  id: string;
  tag: string;
  tags?: string[];
  title: string;
  folder: string;
  kind: AssetKind;
  prompt: string;
  text: string;
};

export type StripRef = {
  id: string;
  assetId?: string;
  tag?: string;
  folder?: string;
  canon?: string;
  dataUrl: string;
};

export function tagFromTitle(title: string): string {
  const parts = title
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z0-9_-]/g, ""))
    .filter(Boolean);
  return parts.join("") || "Still";
}

export function normalizeTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function parseTagList(value: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const tag = part.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
    const norm = normalizeTag(tag);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags;
}

export function assetTagList(asset: { tag: string; tags?: string[] }): string[] {
  return asset.tags?.length ? asset.tags : asset.tag ? [asset.tag] : [];
}

export function matchesTag(asset: { tag: string; title: string; tags?: string[] }, token: string): boolean {
  const norm = normalizeTag(token);
  if (!norm) return false;
  if (normalizeTag(asset.title) === norm) return true;
  return assetTagList(asset).some((tag) => normalizeTag(tag) === norm);
}

export function parseTokens(scene: string): string[] {
  return [...scene.matchAll(/@([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${remain.toString().padStart(2, "0")}`;
  return `${minutes}:${remain.toString().padStart(2, "0")}`;
}

export function parseNoteBlock(text: string): { title: string; body: string; visible: string } | null {
  const match = text.match(/:::note\s*\n([\s\S]*?)\n---\n([\s\S]*?):::/);
  if (!match) return null;
  const title = match[1].replace(/^title:\s*/i, "").trim() || "Note";
  const body = match[2].trim();
  const visible = text.replace(match[0], "").trim();
  return { title, body, visible };
}

export function buildDigest(input: {
  activeProjectId?: string | null;
  projects: { id: string; title: string }[];
  folders: { id: string; projectId: string; name: string }[];
  assets: {
    projectId: string;
    folderId: string;
    title: string;
    tag: string;
    tags?: string[];
    kind: string;
    prompt: string;
    text: string;
  }[];
}): string {
  const open = input.projects.find((project) => project.id === input.activeProjectId) ?? null;
  const chunks: string[] = [];
  if (!open) {
    chunks.push("No project is open. Do not invent a cast. Ask them to open a project.");
  } else {
    chunks.push(projectBlock(open, input.folders, input.assets, true));
  }
  const others = input.projects.filter((project) => project.id !== open?.id).map((project) => project.title);
  if (others.length) chunks.push(`Other projects, titles only: ${others.join(", ")}`);
  return chunks.join("\n\n").slice(0, 14000);
}

function projectBlock(
  project: { id: string; title: string },
  folders: { id: string; projectId: string; name: string }[],
  assets: {
    projectId: string;
    folderId: string;
    title: string;
    tag: string;
    tags?: string[];
    kind: string;
    prompt: string;
    text: string;
  }[],
  full: boolean,
): string {
  const projectFolders = folders.filter((folder) => folder.projectId === project.id);
  const projectAssets = assets.filter((asset) => asset.projectId === project.id);
  const lines = [
    `OPEN PROJECT: ${project.title}`,
    "Every name below is already loaded. Do not ask the filmmaker to select them.",
    `Folders: ${projectFolders.map((folder) => folder.name).join(", ") || "(none)"}`,
  ];
  const materials = projectAssets
    .filter((asset) => asset.kind !== "note")
    .map((asset) => {
      const folder = projectFolders.find((item) => item.id === asset.folderId)?.name ?? asset.kind;
      const blurb = (asset.prompt || asset.text).replace(/\s+/g, " ").slice(0, full ? 500 : 120);
      return `- ${assetTagList(asset).map((tag) => `@${tag}`).join(" ")} "${asset.title}" in ${folder} (${asset.kind}): ${blurb || "(no prompt yet — the name and picture are still canon)"}`;
    });
  if (materials.length) lines.push(`Library:\n${materials.join("\n")}`);
  else lines.push("Library: empty. They will file characters, scenes, and pictures from the stage.");
  for (const note of projectAssets.filter((asset) => asset.kind === "note").slice(0, 12)) {
    lines.push(`Note "${note.title}":\n${note.text.slice(0, full ? 1200 : 400)}`);
  }
  return lines.join("\n");
}

export function lintScene(scene: string, library: CanonAsset[], stripCount: number): string[] {
  const warnings: string[] = [];
  for (const token of parseTokens(scene)) {
    const imageSlot = /^image(\d+)$/i.exec(token);
    if (imageSlot) {
      const index = Number(imageSlot[1]) - 1;
      if (index < 0 || index >= stripCount) warnings.push(`@image${index + 1} is not on the reference strip.`);
      continue;
    }
    const known = library.some((asset) => matchesTag(asset, token));
    if (!known) warnings.push(`@${token} is not filed in this project.`);
  }
  return warnings;
}

export function compileScene(input: {
  mode: "still" | "motion";
  projectTitle: string | null;
  styleLine: string;
  cadence: number | null;
  scene: string;
  strip: StripRef[];
  library: CanonAsset[];
  extras: { asset: CanonAsset; dataUrl: string }[];
  maxRefs: number;
  absolute: boolean;
}): { prompt: string; references: { dataUrl: string; tag: string }[]; warnings: string[] } {
  const warnings = lintScene(input.scene, input.library, input.strip.length);
  type Ref = { dataUrl: string; tag: string; canon: string; key: string };
  const refs: Ref[] = [];

  const push = (dataUrl: string, tag: string, canon: string, key: string) => {
    if (!dataUrl.startsWith("data:image/")) return;
    if (refs.some((ref) => ref.key === key || ref.dataUrl === dataUrl)) return;
    if (refs.length >= input.maxRefs) {
      warnings.push(`@${tag} stays in the text — the reference limit is ${input.maxRefs}.`);
      return;
    }
    refs.push({ dataUrl, tag, canon: canon.slice(0, 500), key });
  };

  input.strip.forEach((item, index) => {
    push(item.dataUrl, item.tag || `image${index + 1}`, item.canon ?? "", item.assetId || item.id);
  });
  for (const extra of input.extras) {
    push(extra.dataUrl, extra.asset.tag, extra.asset.prompt || extra.asset.text, extra.asset.id);
  }

  const findRef = (token: string, stripIndex?: number): number => {
    if (stripIndex != null) {
      const item = input.strip[stripIndex];
      if (!item) return -1;
      return refs.findIndex((ref) => ref.key === (item.assetId || item.id));
    }
    const norm = normalizeTag(token);
    return refs.findIndex((ref) => normalizeTag(ref.tag) === norm);
  };

  const rewritten = input.scene.replace(/@([A-Za-z0-9_-]+)/g, (full, token: string) => {
    const imageSlot = /^image(\d+)$/i.exec(token);
    const index = imageSlot ? findRef(token, Number(imageSlot[1]) - 1) : findRef(token);
    if (index < 0) return full;
    return input.mode === "motion" ? `<IMAGE_${index}>` : `reference image ${index + 1}`;
  });

  const canon = refs.map((ref, index) => {
    const slot = input.mode === "motion" ? `<IMAGE_${index}>` : `reference image ${index + 1}`;
    const named = input.library.find((asset) => asset.id === ref.key || normalizeTag(asset.tag) === normalizeTag(ref.tag));
    const name = named?.title || ref.tag;
    return input.absolute
      ? `${slot} is named "${name}" and tagged @${ref.tag}. That name illustrates the picture. Use those words. ${ref.canon || "Match this picture exactly."}`
      : `${slot} (@${ref.tag}): ${ref.canon || "Match this picture exactly."}`;
  });

  const others: string[] = [];
  for (const token of parseTokens(input.scene)) {
    if (/^image\d+$/i.test(token)) continue;
    const asset = input.library.find((item) => matchesTag(item, token));
    if (!asset || asset.kind === "image") continue;
    if (asset.kind === "voice") {
      others.push(`@${asset.tag} speaks only in the filed voice sample named "${asset.title}". Do not substitute another voice.`);
      continue;
    }
    const blurb = (asset.prompt || asset.text).slice(0, 400);
    others.push(`@${asset.tag} (${asset.folder}, ${asset.kind}): ${blurb || "Use the filed material."}`);
  }

  const available = input.library
    .filter((asset) => asset.kind !== "note")
    .flatMap((asset) => assetTagList(asset).map((tag) => `@${tag}`))
    .slice(0, 40);

  const base =
    input.absolute && input.projectTitle
      ? input.library
          .filter((asset) => asset.kind !== "note")
          .slice(0, 24)
          .map((asset) => {
            const blurb = (asset.prompt || asset.text || "Match the filed picture. Do not redesign it.").slice(0, 220);
            return `${assetTagList(asset).map((tag) => `@${tag}`).join(" ")} named "${asset.title}" (${asset.folder}, ${asset.kind}): ${blurb}`;
          })
      : [];

  const lines = [
    input.absolute && input.projectTitle
      ? `ABSOLUTE is on. It is optional. Each filed picture is illustrated by its own name and tag words. Match those names, faces, costumes, and places, including pictures the filmmaker uploaded. Do not rename or redesign them. The scene is action and camera. If the scene conflicts with a filed name or prompt, the filed material wins.`
      : input.projectTitle
        ? `Project canon: "${input.projectTitle}". Adhere to tagged materials. Do not redesign referenced characters, costumes, or places.`
        : "Free generation. No project canon.",
    `Style: ${input.styleLine}`,
    input.mode === "motion" && input.cadence
      ? `Motion cadence: ${input.cadence} fps cinematic shutter, as a film look rather than a file setting.`
      : "",
    LIGHTING,
    available.length ? `Available tags: ${available.join(", ")}` : "",
    canon.length ? `References:\n${canon.join("\n")}` : "",
    others.length ? `Other filed material:\n${others.join("\n")}` : "",
    base.length ? `Project base:\n${base.join("\n")}` : "",
    "",
    "Scene:",
    rewritten.trim() || "(no scene text)",
  ].filter((line) => line !== "");

  return {
    prompt: lines.join("\n").slice(0, 8000),
    references: refs.map((ref) => ({ dataUrl: ref.dataUrl, tag: ref.tag })),
    warnings,
  };
}
