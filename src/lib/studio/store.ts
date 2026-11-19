import { create } from "zustand";
import { askEditor, beginShot, generateCustom, generateStills, planNextShot, pollShot } from "@/lib/studio/api.functions";
import { runLocalCheckpoint, runLocalVideo } from "@/lib/studio/comfy-local";
import { dbAll, dbDel, dbDelBlob, dbGetBlob, dbPut, dbPutBlob, uid } from "@/lib/studio/idb";
import { fileToJpegDataUrl, probeDuration, videoPoster } from "@/lib/studio/media";
import {
  STYLES,
  buildDigest,
  assetTagList,
  compileScene,
  formatTime,
  matchesTag,
  normalizeTag,
  parseTagList,
  tagFromTitle,
  type CanonAsset,
} from "@/lib/studio/prompt";
import { batchCap, frameSize, readSettings, writeSettings, type StudioSettings } from "@/lib/studio/settings";
import type {
  Asset,
  AssetKind,
  Candidate,
  ChatMsg,
  Cut,
  CutClip,
  Folder,
  FolderKind,
  PlayShot,
  PendingUpload,
  PreviewShot,
  Project,
  Reel,
  StripItem,
} from "@/lib/studio/types";

const DEFAULT_FOLDERS: { name: string; kind: FolderKind }[] = [
  { name: "Characters", kind: "characters" },
  { name: "Scenes", kind: "scenes" },
  { name: "Audio", kind: "audio" },
  { name: "Voices", kind: "voices" },
  { name: "Notes", kind: "notes" },
  { name: "Stills", kind: "stills" },
  { name: "Reels", kind: "reels" },
];

const urlCache = new Map<string, string>();
let generation = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

async function cachedUrl(id: string, blob: Blob): Promise<string> {
  const existing = urlCache.get(id);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

type StudioState = {
  ready: boolean;
  projects: Project[];
  folders: Folder[];
  assets: Asset[];
  chats: ChatMsg[];
  reels: Reel[];
  cuts: Cut[];
  activeCutId: string | null;
  activeProjectId: string | null;
  activeFolderId: string | null;
  selectedAssetId: string | null;
  pane: "library" | "stage" | "cut" | "chat" | "settings";
  mode: "still" | "motion";
  prompt: string;
  styleId: string;
  aspect: string;
  stillRes: "1k" | "2k";
  motionRes: "480p" | "720p" | "1080p";
  quality: "low" | "medium";
  batch: number;
  duration: number;
  cadence: 24 | 30 | 48;
  pinFirst: boolean;
  absolute: boolean;
  settings: StudioSettings;
  targetSeconds: number;
  strip: StripItem[];
  candidates: Candidate[];
  pendingUploads: PendingUpload[];
  preview: PreviewShot | null;
  playShots: PlayShot[];
  activeReelId: string | null;
  playerMode: "shot" | "reel";
  busy: boolean;
  busyLabel: string;
  error: string;
  warnings: string[];
  notice: string;
  revealed: string;
  chatInput: string;
  chatBusy: boolean;
  load: () => Promise<void>;
  setPane: (pane: StudioState["pane"]) => void;
  createProject: (title: string) => Promise<void>;
  selectProject: (id: string | null) => Promise<void>;
  renameProject: (title: string) => Promise<void>;
  deleteProject: () => Promise<void>;
  selectFolder: (id: string) => void;
  addFolder: (name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  selectAsset: (id: string | null) => void;
  updateAsset: (id: string, patch: Partial<Pick<Asset, "prompt" | "text">>) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
  uploadFiles: (folderId: string, files: File[]) => Promise<void>;
  setPending: (id: string, patch: Partial<Pick<PendingUpload, "title" | "tags">>) => void;
  discardPending: (id: string) => void;
  filePending: (id: string) => Promise<void>;
  saveNote: (title: string, body: string) => Promise<void>;
  fileVoice: (name: string, file: File) => Promise<void>;
  setMode: (mode: "still" | "motion") => void;
  setPrompt: (prompt: string) => void;
  updateSettings: (patch: Partial<StudioSettings>) => void;
  patchStage: (patch: Partial<Pick<StudioState, "styleId" | "aspect" | "stillRes" | "motionRes" | "quality" | "batch" | "duration" | "cadence" | "pinFirst" | "absolute" | "targetSeconds">>) => void;
  addUploadsToStrip: (files: File[]) => Promise<void>;
  useAsset: (id: string) => Promise<void>;
  removeStrip: (id: string) => void;
  moveStrip: (id: string, direction: -1 | 1) => void;
  revealPrompt: () => Promise<void>;
  generate: () => Promise<void>;
  cancelGenerate: () => void;
  setCandidate: (id: string, patch: Partial<Pick<Candidate, "title" | "tags" | "folderId">>) => void;
  discardCandidate: (id: string) => void;
  keepCandidate: (id: string) => Promise<void>;
  setPreviewMeta: (patch: Partial<Pick<PreviewShot, "title" | "tags" | "folderId">>) => void;
  discardPreview: () => void;
  keepPreview: (intoReel: boolean) => Promise<void>;
  removeReelShot: (assetId: string) => Promise<void>;
  addToCut: (assetId: string, hold?: number) => Promise<void>;
  uploadIntoCut: (files: File[]) => Promise<void>;
  newCut: () => Promise<void>;
  selectCut: (id: string) => void;
  moveCutClip: (id: string, direction: -1 | 1) => Promise<void>;
  trimCutClip: (id: string, patch: { inPoint?: number; outPoint?: number }) => Promise<void>;
  removeCutClip: (id: string) => Promise<void>;
  setPlayerMode: (mode: "shot" | "reel") => void;
  addSnapshot: (blob: Blob, at: number) => Promise<void>;
  setChatInput: (value: string) => void;
  sendChat: () => Promise<void>;
};

function folderIdFor(folders: Folder[], projectId: string, kind: FolderKind): string {
  return folders.find((folder) => folder.projectId === projectId && folder.kind === kind)?.id ?? "";
}

export const useStudio = create<StudioState>((set, get) => ({
  ready: false,
  projects: [],
  folders: [],
  assets: [],
  chats: [],
  reels: [],
  cuts: [],
  activeCutId: null,
  activeProjectId: null,
  activeFolderId: null,
  selectedAssetId: null,
  pane: "stage",
  mode: "still",
  prompt: "",
  styleId: "cine",
  aspect: "16:9",
  stillRes: "1k",
  motionRes: "720p",
  quality: "low",
  batch: 4,
  duration: 6,
  cadence: 24,
  pinFirst: false,
  absolute: true,
  settings: readSettings(),
  targetSeconds: 120,
  strip: [],
  candidates: [],
  pendingUploads: [],
  preview: null,
  playShots: [],
  activeReelId: null,
  playerMode: "shot",
  busy: false,
  busyLabel: "",
  error: "",
  warnings: [],
  notice: "",
  revealed: "",
  chatInput: "",
  chatBusy: false,

  load: async () => {
    try {
      const [projects, folders, assets, chats, reels, cuts] = await Promise.all([
        dbAll<Project>("projects"),
        dbAll<Folder>("folders"),
        dbAll<Asset>("assets"),
        dbAll<ChatMsg>("chats"),
        dbAll<Reel>("reels"),
        dbAll<Cut>("cuts"),
      ]);
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      const stored = localStorage.getItem("movie-studio-project");
      const active = projects.find((project) => project.id === stored) ?? projects[0] ?? null;
      set({
        ready: true,
        projects,
        folders,
        assets,
        chats,
        reels,
        cuts,
        activeProjectId: active?.id ?? null,
        activeFolderId: active ? (folders.find((folder) => folder.projectId === active.id)?.id ?? null) : null,
      });
      if (active) await get().selectProject(active.id);
    } catch (error) {
      set({ ready: true, error: messageOf(error) });
    }
  },

  setPane: (pane) => set({ pane }),

  createProject: async (title) => {
    const name = title.trim();
    if (!name) {
      set({ error: "Name the project first." });
      return;
    }
    const now = Date.now();
    const project: Project = { id: uid(), title: name, createdAt: now, updatedAt: now };
    const folders: Folder[] = DEFAULT_FOLDERS.map((folder) => ({
      id: uid(),
      projectId: project.id,
      name: folder.name,
      kind: folder.kind,
      createdAt: now,
    }));
    await dbPut("projects", project);
    for (const folder of folders) await dbPut("folders", folder);
    localStorage.setItem("movie-studio-project", project.id);
    set({
      projects: [project, ...get().projects],
      folders: [...get().folders, ...folders],
      activeProjectId: project.id,
      activeFolderId: folders[0]?.id ?? null,
      notice: `Opened ${name}. Characters, scenes, and notes are ready.`,
      error: "",
      pane: "library",
    });
    await hydrateReel(set, get, project.id);
  },

  selectProject: async (id) => {
    if (!id) {
      localStorage.removeItem("movie-studio-project");
      set({
        activeProjectId: null,
        activeFolderId: null,
        selectedAssetId: null,
        playShots: [],
        activeReelId: null,
        activeCutId: null,
        playerMode: "shot",
      });
      return;
    }
    localStorage.setItem("movie-studio-project", id);
    const folder = get().folders.find((item) => item.projectId === id);
    const cut = get().cuts.filter((item) => item.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    set({
      activeProjectId: id,
      activeFolderId: folder?.id ?? null,
      selectedAssetId: null,
      activeCutId: cut?.id ?? null,
      error: "",
    });
    await hydrateReel(set, get, id);
  },

  renameProject: async (title) => {
    const project = get().projects.find((item) => item.id === get().activeProjectId);
    const name = title.trim();
    if (!project || !name || name === project.title) return;
    const next = { ...project, title: name, updatedAt: Date.now() };
    await dbPut("projects", next);
    set({ projects: get().projects.map((item) => (item.id === next.id ? next : item)) });
  },

  deleteProject: async () => {
    const id = get().activeProjectId;
    if (!id) return;
    const assetIds = get().assets.filter((asset) => asset.projectId === id).map((asset) => asset.id);
    for (const assetId of assetIds) {
      await dbDel("assets", assetId);
      await dbDelBlob(assetId);
      const url = urlCache.get(assetId);
      if (url) URL.revokeObjectURL(url);
      urlCache.delete(assetId);
    }
    for (const folder of get().folders.filter((folder) => folder.projectId === id)) await dbDel("folders", folder.id);
    for (const reel of get().reels.filter((reel) => reel.projectId === id)) await dbDel("reels", reel.id);
    for (const cut of get().cuts.filter((cut) => cut.projectId === id)) await dbDel("cuts", cut.id);
    for (const message of get().chats.filter((message) => message.scope === id)) await dbDel("chats", message.id);
    await dbDel("projects", id);
    const projects = get().projects.filter((project) => project.id !== id);
    set({
      projects,
      folders: get().folders.filter((folder) => folder.projectId !== id),
      assets: get().assets.filter((asset) => asset.projectId !== id),
      reels: get().reels.filter((reel) => reel.projectId !== id),
      cuts: get().cuts.filter((cut) => cut.projectId !== id),
      chats: get().chats.filter((message) => message.scope !== id),
      notice: "Project deleted.",
    });
    await get().selectProject(projects[0]?.id ?? null);
  },

  selectFolder: (id) => set({ activeFolderId: id, selectedAssetId: null }),

  addFolder: async (name) => {
    const projectId = get().activeProjectId;
    const title = name.trim();
    if (!projectId || !title) return;
    const folder: Folder = { id: uid(), projectId, name: title, kind: "custom", createdAt: Date.now() };
    await dbPut("folders", folder);
    set({ folders: [...get().folders, folder], activeFolderId: folder.id, notice: `Folder ${title} added.` });
  },

  deleteFolder: async (id) => {
    const folder = get().folders.find((item) => item.id === id);
    if (!folder || folder.kind !== "custom") return;
    const doomed = get().assets.filter((asset) => asset.folderId === id);
    for (const asset of doomed) {
      await dbDel("assets", asset.id);
      await dbDelBlob(asset.id);
    }
    await dbDel("folders", id);
    const next = get().folders.filter((item) => item.id !== id);
    set({
      folders: next,
      assets: get().assets.filter((asset) => asset.folderId !== id),
      activeFolderId: next.find((item) => item.projectId === folder.projectId)?.id ?? null,
    });
  },

  selectAsset: (id) => set({ selectedAssetId: id }),

  updateAsset: async (id, patch) => {
    const asset = get().assets.find((item) => item.id === id);
    if (!asset) return;
    const next = { ...asset, ...patch };
    await dbPut("assets", next);
    set({ assets: get().assets.map((item) => (item.id === id ? next : item)) });
  },

  deleteAsset: async (id) => {
    await dbDel("assets", id);
    await dbDelBlob(id);
    const url = urlCache.get(id);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(id);
    const reels = get().reels.map((reel) => ({
      ...reel,
      shots: reel.shots.filter((shot) => shot.assetId !== id),
    }));
    for (const reel of reels) await dbPut("reels", reel);
    set({
      assets: get().assets.filter((asset) => asset.id !== id),
      reels,
      playShots: get().playShots.filter((shot) => shot.assetId !== id),
      strip: get().strip.filter((item) => item.assetId !== id),
      selectedAssetId: get().selectedAssetId === id ? null : get().selectedAssetId,
    });
  },

  uploadFiles: async (folderId, files) => {
    await queueUploads(set, get, folderId, files, false);
  },

  setPending: (id, patch) => {
    set({
      pendingUploads: get().pendingUploads.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  },

  discardPending: (id) => {
    const item = get().pendingUploads.find((upload) => upload.id === id);
    if (item) URL.revokeObjectURL(item.url);
    set({ pendingUploads: get().pendingUploads.filter((upload) => upload.id !== id) });
  },

  filePending: async (id) => {
    const item = get().pendingUploads.find((upload) => upload.id === id);
    if (!item) return;
    const title = item.title.trim() || "Upload";
    const wanted = parseTagList(item.tags);
    const tags = claimTags(get, item.projectId, wanted.length ? wanted : [tagFromTitle(title)]);
    try {
      const asset = await makeStoredAsset({
        projectId: item.projectId,
        folderId: item.folderId,
        title,
        tag: tags[0] || "Upload",
        tags,
        kind: item.kind,
        mime: item.blob.type || "application/octet-stream",
        prompt: "Uploaded by the filmmaker. This is canon. Match it. Do not redesign it.",
        text: "",
        blob: item.blob,
      });
      URL.revokeObjectURL(item.url);
      set({
        assets: [asset, ...get().assets],
        pendingUploads: get().pendingUploads.filter((upload) => upload.id !== id),
        notice: `Filed “${title}” as ${tags.map((tag) => `@${tag}`).join(", ")}.`,
        error: "",
      });
      if (item.intoCut && (asset.kind === "image" || asset.kind === "video")) await get().addToCut(asset.id);
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  saveNote: async (title, body) => {
    const projectId = get().activeProjectId;
    if (!projectId) {
      set({ error: "Open a project before filing a note." });
      return;
    }
    const name = title.trim() || "Note";
    const text = body.trim();
    if (!text) return;
    const folderId = folderIdFor(get().folders, projectId, "notes");
    const existing = get().assets.find(
      (asset) => asset.projectId === projectId && asset.kind === "note" && asset.title.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      const next = { ...existing, text, prompt: text.slice(0, 500) };
      await dbPut("assets", next);
      set({
        assets: get().assets.map((asset) => (asset.id === existing.id ? next : asset)),
        notice: `Updated note “${name}”.`,
        activeFolderId: folderId,
      });
      return;
    }
    const tag = uniqueTag(get, projectId, tagFromTitle(name));
    const asset: Asset = {
      id: uid(),
      projectId,
      folderId,
      title: name,
      tag,
      kind: "note",
      mime: "text/markdown",
      prompt: text.slice(0, 500),
      text,
      thumb: "",
      duration: 0,
      createdAt: Date.now(),
    };
    await dbPut("assets", asset);
    set({
      assets: [asset, ...get().assets],
      notice: `Filed note “${name}” in ${get().projects.find((project) => project.id === projectId)?.title ?? "the project"}.`,
      activeFolderId: folderId,
      error: "",
    });
  },

  fileVoice: async (name, file) => {
    const projectId = get().activeProjectId;
    if (!projectId) {
      set({ error: "Open a project before filing a voice." });
      return;
    }
    const title = name.trim();
    if (!title) {
      set({ error: "Name the sample as the character." });
      return;
    }
    if (!file.type.startsWith("audio") && !/\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name)) {
      set({ error: "Choose an audio file." });
      return;
    }
    const folderId = folderIdFor(get().folders, projectId, "voices");
    const tags = claimTags(get, projectId, [tagFromTitle(title)]);
    const tag = tags[0] || "Voice";
    try {
      const asset = await makeStoredAsset({
        projectId,
        folderId,
        title,
        tag,
        tags,
        kind: "voice",
        mime: file.type || "audio/mpeg",
        prompt: `Voice of ${title}. When this character speaks in a shot, use this voice and no other.`,
        text: "",
        blob: file,
      });
      set({
        assets: [asset, ...get().assets],
        notice: `Filed @${tag} as the voice of ${title}. A shot that names them is told to use it.`,
        error: "",
        activeFolderId: folderId,
      });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  setMode: (mode) => {
    const aspects = mode === "still" ? ["16:9", "21:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "2:1"] : ["16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"];
    const aspect = aspects.includes(get().aspect) ? get().aspect : "16:9";
    set({ mode, aspect });
  },

  setPrompt: (prompt) => set({ prompt, revealed: "" }),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    writeSettings(settings);
    set({ settings });
  },

  patchStage: (patch) => set({ ...patch, revealed: "" }),

  addUploadsToStrip: async (files) => {
    try {
      const next = [...get().strip];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await fileToJpegDataUrl(file, 1024, 0.86);
        next.push({ id: uid(), dataUrl, tag: `image${next.length + 1}` });
      }
      set({ strip: next, error: "" });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  useAsset: async (id) => {
    const asset = get().assets.find((item) => item.id === id);
    if (!asset) return;
    const token = `@${asset.tag}`;
    const prompt = get().prompt.includes(token) ? get().prompt : `${get().prompt.trim()} ${token}`.trim();
    if (asset.kind === "image") {
      if (!get().strip.some((item) => item.assetId === asset.id)) {
        const blob = await dbGetBlob(asset.id);
        if (!blob) {
          set({ error: "That still has no image data." });
          return;
        }
        const dataUrl = await fileToJpegDataUrl(blob, 1024, 0.86);
        const folder = get().folders.find((item) => item.id === asset.folderId);
        set({
          strip: [
            ...get().strip,
            {
              id: uid(),
              assetId: asset.id,
              tag: asset.tag,
              folder: folder?.name,
              canon: asset.prompt,
              dataUrl,
            },
          ],
        });
      }
    }
    set({ prompt, pane: "stage", notice: `${token} is in the scene line.`, error: "" });
  },

  removeStrip: (id) => set({ strip: get().strip.filter((item) => item.id !== id) }),

  moveStrip: (id, direction) => {
    const strip = [...get().strip];
    const index = strip.findIndex((item) => item.id === id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= strip.length) return;
    const [item] = strip.splice(index, 1);
    strip.splice(swap, 0, item);
    set({ strip });
  },

  revealPrompt: async () => {
    try {
      const compiled = await assemble(get);
      set({ revealed: compiled.prompt, warnings: compiled.warnings, error: "" });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  generate: async () => {
    if (get().busy) return;
    const token = ++generation;
    set({ busy: true, busyLabel: get().mode === "still" ? "Rendering stills…" : "Rendering shot…", error: "", notice: "" });
    const started = Date.now();
    try {
      const compiled = await assemble(get);
      if (token !== generation) return;
      set({ warnings: compiled.warnings });
      const settings = get().settings;
      if (settings.engine === "comfy") {
        if (get().mode === "still") {
          const size = frameSize(get().aspect, settings.maxSide);
          set({ busyLabel: `Image checkpoint · ${size.width}×${size.height} · ${settings.steps} steps` });
          const blobs = await runLocalCheckpoint({
            settings,
            prompt: compiled.prompt,
            aspect: get().aspect,
            batch: Math.min(batchCap(settings.profile), Math.max(1, Math.round(get().batch) || 1)),
            cancelled: () => token !== generation,
          });
          if (token !== generation) return;
          const projectId = get().activeProjectId;
          const folderId = projectId ? folderIdFor(get().folders, projectId, "stills") : "";
          const candidates: Candidate[] = blobs.map((blob, index) => ({
            id: uid(),
            url: URL.createObjectURL(blob),
            blob,
            prompt: compiled.prompt,
            title: `Still ${index + 1}`,
            tags: "",
            folderId,
          }));
          for (const old of get().candidates) URL.revokeObjectURL(old.url);
          set({ candidates, busy: false, busyLabel: "", notice: "Stills are in the bay. Nothing is filed until you keep one." });
          return;
        }
        set({ busyLabel: "Video checkpoint…" });
        const blob = await runLocalVideo({
          settings,
          prompt: compiled.prompt,
          aspect: get().aspect,
          seconds: get().duration,
          fps: get().cadence,
          cancelled: () => token !== generation,
        });
        if (token !== generation) return;
        const url = URL.createObjectURL(blob);
        const duration = (await probeDuration(blob)) || get().duration;
        if (get().preview) URL.revokeObjectURL(get().preview!.url);
        const projectId = get().activeProjectId;
        set({
          preview: {
            url,
            blob,
            duration,
            prompt: compiled.prompt,
            title: "Shot",
            tags: "",
            folderId: projectId ? folderIdFor(get().folders, projectId, "reels") : "",
            savedTag: "",
          },
          playerMode: "shot",
          busy: false,
          busyLabel: "",
          notice: "Shot is in the player. File it when it belongs in the project.",
        });
        return;
      }
      if (settings.engine === "api" && get().mode === "still") {
        const size = frameSize(get().aspect, settings.maxSide);
        const wanted = Math.min(batchCap(settings.profile), Math.max(1, Math.round(get().batch) || 1));
        const result = await generateCustom({
          data: {
            base: settings.apiBase,
            apiKey: settings.apiKey,
            model: settings.apiModel,
            prompt: compiled.prompt,
            n: wanted,
            size: `${size.width}x${size.height}`,
          },
        });
        if (token !== generation) return;
        if (!result.ok) {
          set({ busy: false, busyLabel: "", error: result.error });
          return;
        }
        const projectId = get().activeProjectId;
        const folderId = projectId ? folderIdFor(get().folders, projectId, "stills") : "";
        const candidates: Candidate[] = [];
        for (const [index, dataUrl] of result.images.entries()) {
          const blob = await (await fetch(dataUrl)).blob();
          candidates.push({
            id: uid(),
            url: URL.createObjectURL(blob),
            blob,
            prompt: compiled.prompt,
            title: `Still ${index + 1}`,
            tags: "",
            folderId,
          });
        }
        for (const old of get().candidates) URL.revokeObjectURL(old.url);
        set({ candidates, busy: false, busyLabel: "", notice: "Stills are in the bay. Nothing is filed until you keep one." });
        return;
      }
      if (get().mode === "still") {
        const wanted = Math.min(10, Math.max(1, Math.round(get().batch) || 1));
        const images: string[] = [];
        for (let offset = 0; offset < wanted; offset += 10) {
          if (token !== generation) return;
          const n = Math.min(10, wanted - offset);
          set({ busyLabel: `Rendering stills ${offset + 1}–${offset + n} of ${wanted}…` });
          const result = await generateStills({
            data: {
              prompt: compiled.prompt,
              n,
              aspectRatio: get().aspect,
              resolution: get().stillRes,
              quality: get().quality,
              references: compiled.references,
            },
          });
          if (token !== generation) return;
          if (!result.ok) {
            if (!images.length) {
              set({ busy: false, busyLabel: "", error: result.error });
              return;
            }
            set({ error: result.error });
            break;
          }
          images.push(...result.images);
        }
        const projectId = get().activeProjectId;
        const folderId = projectId ? folderIdFor(get().folders, projectId, "stills") : "";
        const candidates: Candidate[] = [];
        for (const [index, dataUrl] of images.entries()) {
          const blob = await (await fetch(dataUrl)).blob();
          candidates.push({
            id: uid(),
            url: URL.createObjectURL(blob),
            blob,
            prompt: compiled.prompt,
            title: `Still ${index + 1}`,
            tags: "",
            folderId,
          });
        }
        for (const old of get().candidates) URL.revokeObjectURL(old.url);
        set({ candidates, busy: false, busyLabel: "", notice: "Stills are in the bay. Nothing is filed until you keep one." });
        return;
      }

      const startedShot = await beginShot({
        data: {
          prompt: compiled.prompt,
          duration: get().duration,
          aspectRatio: get().aspect,
          resolution: get().motionRes,
          pinFirst: get().pinFirst,
          references: compiled.references,
        },
      });
      if (token !== generation) return;
      if (!startedShot.ok) {
        set({ busy: false, busyLabel: "", error: startedShot.error });
        return;
      }
      if (startedShot.note) set({ warnings: [...get().warnings, startedShot.note] });
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(5000);
        if (token !== generation) return;
        const status = await pollShot({ data: { requestId: startedShot.requestId } });
        if (token !== generation) return;
        if (!status.ok) {
          set({ busy: false, busyLabel: "", error: status.error });
          return;
        }
        const elapsed = Math.round((Date.now() - started) / 1000);
        set({ busyLabel: `Rendering shot · ${elapsed}s` });
        if (status.status === "done") break;
        if (attempt === 49) throw new Error("The shot is still rendering. Try again in a moment.");
      }
      set({ busyLabel: "Fetching the shot…" });
      const response = await fetch(`/api/studio-media?requestId=${encodeURIComponent(startedShot.requestId)}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Could not download the shot.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const duration = (await probeDuration(blob)) || get().duration;
      if (token !== generation) {
        URL.revokeObjectURL(url);
        return;
      }
      if (get().preview) URL.revokeObjectURL(get().preview!.url);
      const projectId = get().activeProjectId;
      set({
        preview: {
          url,
          blob,
          duration,
          prompt: compiled.prompt,
          title: "Shot",
          tags: "",
          folderId: projectId ? folderIdFor(get().folders, projectId, "reels") : "",
          savedTag: "",
        },
        playerMode: "shot",
        busy: false,
        busyLabel: "",
        notice: "Shot is in the player. File it when it belongs in the project.",
      });
    } catch (error) {
      if (token !== generation) return;
      set({ busy: false, busyLabel: "", error: messageOf(error) });
    }
  },

  cancelGenerate: () => {
    generation += 1;
    set({ busy: false, busyLabel: "", notice: "Render cancelled." });
  },

  setCandidate: (id, patch) => {
    set({
      candidates: get().candidates.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  },

  discardCandidate: (id) => {
    const candidate = get().candidates.find((item) => item.id === id);
    if (candidate) URL.revokeObjectURL(candidate.url);
    set({ candidates: get().candidates.filter((item) => item.id !== id) });
  },

  keepCandidate: async (id) => {
    const candidate = get().candidates.find((item) => item.id === id);
    const projectId = get().activeProjectId;
    if (!candidate || !projectId) {
      set({ error: "Choose a project in the header before keeping a still." });
      return;
    }
    const title = candidate.title.trim();
    if (!title) {
      set({ error: "Name the still before filing it." });
      return;
    }
    const folderId = candidate.folderId || folderIdFor(get().folders, projectId, "stills");
    const wanted = parseTagList(candidate.tags);
    const tags = claimTags(get, projectId, wanted.length ? wanted : [tagFromTitle(title)]);
    const asset = await makeStoredAsset({
      projectId,
      folderId,
      title,
      tag: tags[0] || "Still",
      tags,
      kind: "image",
      mime: candidate.blob.type || "image/jpeg",
      prompt: candidate.prompt,
      text: "",
      blob: candidate.blob,
    });
    URL.revokeObjectURL(candidate.url);
    set({
      assets: [asset, ...get().assets],
      candidates: get().candidates.filter((item) => item.id !== id),
      notice: `Filed “${title}” as ${tags.map((tag) => `@${tag}`).join(", ")}.`,
      error: "",
    });
  },

  setPreviewMeta: (patch) => {
    const preview = get().preview;
    if (!preview) return;
    set({ preview: { ...preview, ...patch } });
  },

  discardPreview: () => {
    const preview = get().preview;
    if (preview) URL.revokeObjectURL(preview.url);
    set({ preview: null, playerMode: get().playShots.length ? "reel" : "shot" });
  },

  keepPreview: async (intoReel) => {
    const preview = get().preview;
    const projectId = get().activeProjectId;
    if (!preview || !projectId) {
      set({ error: "Choose a project in the header before filing this shot." });
      return;
    }
    let tag = preview.savedTag;
    let assetId = get().assets.find((asset) => asset.projectId === projectId && asset.tag === tag)?.id;
    if (!tag || !assetId) {
      const title = preview.title.trim();
      if (!title) {
        set({ error: "Name the shot before filing it." });
        return;
      }
      const folderId = preview.folderId || folderIdFor(get().folders, projectId, "reels");
      const wanted = parseTagList(preview.tags);
      const tags = claimTags(get, projectId, wanted.length ? wanted : [tagFromTitle(title)]);
      tag = tags[0] || "Shot";
      const asset = await makeStoredAsset({
        projectId,
        folderId,
        title,
        tag,
        tags,
        kind: "video",
        mime: preview.blob.type || "video/mp4",
        prompt: preview.prompt,
        text: "",
        blob: preview.blob,
        duration: preview.duration,
      });
      assetId = asset.id;
      await cachedUrl(asset.id, preview.blob);
      set({
        assets: [asset, ...get().assets],
        preview: { ...get().preview!, savedTag: tag },
      });
    }
    let notice = `Filed @${tag}. Its prompt stays active when you reference it.`;
    if (intoReel && assetId) {
      const current =
        get().reels.find((reel) => reel.id === get().activeReelId) ??
        ({
          id: uid(),
          projectId,
          title: "Reel 1",
          shots: [],
          updatedAt: Date.now(),
        } satisfies Reel);
      if (!current.shots.some((shot) => shot.assetId === assetId)) {
        const reel: Reel = {
          ...current,
          shots: [...current.shots, { assetId, label: tag }],
          updatedAt: Date.now(),
        };
        await dbPut("reels", reel);
        const reels = get().reels.some((item) => item.id === reel.id)
          ? get().reels.map((item) => (item.id === reel.id ? reel : item))
          : [reel, ...get().reels];
        const duration = get().assets.find((asset) => asset.id === assetId)?.duration ?? preview.duration;
        set({
          reels,
          activeReelId: reel.id,
          playShots: get().playShots.some((shot) => shot.assetId === assetId)
            ? get().playShots
            : [...get().playShots, { assetId, url: await cachedUrl(assetId, preview.blob), duration, label: tag }],
          playerMode: "reel",
        });
      }
      notice = `Filed @${tag} on the reel. Length is the sum of the shots, each up to 15 seconds.`;
    }
    set({ notice, error: "" });
  },

  removeReelShot: async (assetId) => {
    const reel = get().reels.find((item) => item.id === get().activeReelId);
    if (!reel) return;
    const next = { ...reel, shots: reel.shots.filter((shot) => shot.assetId !== assetId), updatedAt: Date.now() };
    await dbPut("reels", next);
    set({
      reels: get().reels.map((item) => (item.id === next.id ? next : item)),
      playShots: get().playShots.filter((shot) => shot.assetId !== assetId),
    });
  },

  addToCut: async (assetId, hold = 4) => {
    const asset = get().assets.find((item) => item.id === assetId);
    const projectId = get().activeProjectId;
    if (!asset || !projectId || asset.projectId !== projectId) return;
    if (asset.kind !== "image" && asset.kind !== "video") {
      set({ error: "The cut takes a picture or a video." });
      return;
    }
    const clip: CutClip = {
      id: uid(),
      assetId,
      kind: asset.kind,
      label: asset.tag,
      inPoint: 0,
      outPoint: asset.kind === "image" ? Math.min(120, Math.max(0.5, hold)) : Math.max(0.5, asset.duration || 5),
    };
    const cut = await ensureCut(set, get, projectId);
    await writeCut(set, get, { ...cut, clips: [...cut.clips, clip], updatedAt: Date.now() });
    set({ notice: `Added @${asset.tag} to the cut.`, error: "", pane: "cut" });
  },

  uploadIntoCut: async (files) => {
    const projectId = get().activeProjectId;
    if (!projectId) {
      set({ error: "Open a project. Uploads file into it and onto the cut." });
      return;
    }
    const folderId = folderIdFor(get().folders, projectId, "stills");
    queueUploads(set, get, folderId, files, true);
  },

  newCut: async () => {
    const projectId = get().activeProjectId;
    if (!projectId) return;
    const count = get().cuts.filter((cut) => cut.projectId === projectId).length + 1;
    const cut: Cut = { id: uid(), projectId, title: `Cut ${count}`, clips: [], updatedAt: Date.now() };
    await writeCut(set, get, cut);
  },

  selectCut: (id) => set({ activeCutId: id }),

  moveCutClip: async (id, direction) => {
    const cut = currentCut(get);
    if (!cut) return;
    const index = cut.clips.findIndex((clip) => clip.id === id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= cut.clips.length) return;
    const clips = [...cut.clips];
    const [clip] = clips.splice(index, 1);
    clips.splice(swap, 0, clip);
    await writeCut(set, get, { ...cut, clips, updatedAt: Date.now() });
  },

  trimCutClip: async (id, patch) => {
    const cut = currentCut(get);
    if (!cut) return;
    const clips = cut.clips.map((clip) => {
      if (clip.id !== id) return clip;
      const asset = get().assets.find((item) => item.id === clip.assetId);
      const span = asset?.duration || clip.outPoint || 5;
      let inPoint = patch.inPoint ?? clip.inPoint;
      let outPoint = patch.outPoint ?? clip.outPoint;
      if (clip.kind === "image") {
        inPoint = 0;
        outPoint = Math.min(120, Math.max(0.5, outPoint));
      } else {
        inPoint = Math.max(0, Math.min(inPoint, Math.max(0, span - 0.2)));
        outPoint = Math.max(inPoint + 0.2, Math.min(outPoint, span || outPoint));
      }
      return { ...clip, inPoint, outPoint };
    });
    await writeCut(set, get, { ...cut, clips, updatedAt: Date.now() });
  },

  removeCutClip: async (id) => {
    const cut = currentCut(get);
    if (!cut) return;
    await writeCut(set, get, {
      ...cut,
      clips: cut.clips.filter((clip) => clip.id !== id),
      updatedAt: Date.now(),
    });
  },

  setPlayerMode: (mode) => set({ playerMode: mode }),

  addSnapshot: async (blob, at) => {
    const projectId = get().activeProjectId;
    const folderId = projectId ? folderIdFor(get().folders, projectId, "stills") : "";
    const url = URL.createObjectURL(blob);
    const minutes = Math.floor(at / 60);
    const seconds = Math.floor(at % 60);
    set({
      candidates: [
        {
          id: uid(),
          url,
          blob,
          prompt: `Snapshot from the player at ${minutes}:${seconds.toString().padStart(2, "0")}.`,
          title: "Frame",
          tags: "",
          folderId,
        },
        ...get().candidates,
      ],
      notice: "Frame captured. Title it and keep it if it belongs in the project.",
    });
  },

  setChatInput: (value) => set({ chatInput: value }),

  sendChat: async () => {
    const text = get().chatInput.trim();
    if (!text || get().chatBusy) return;
    const scope = get().activeProjectId ?? "free";
    const userMessage: ChatMsg = { id: uid(), scope, role: "user", content: text, createdAt: Date.now() };
    const history = [...get().chats.filter((message) => message.scope === scope), userMessage];
    set({ chats: [...get().chats, userMessage], chatInput: "", chatBusy: true, error: "" });
    await dbPut("chats", userMessage);
    try {
      if (wantsProduction(text)) {
        if (!get().activeProjectId) {
          await say(set, get, scope, "Open a project first. The shots file onto its reel.");
          set({ chatBusy: false });
          return;
        }
        const notes = get()
          .assets.filter((asset) => asset.projectId === scope && asset.kind === "note")
          .map((asset) => `NOTE ${asset.title}\n${asset.text}`);
        const library = buildDigest({
          activeProjectId: get().activeProjectId,
          projects: get().projects,
          folders: get().folders,
          assets: get().assets,
        });
        const script = [library, ...history.map((message) => `${message.role}: ${message.content}`), ...notes]
          .join("\n\n")
          .slice(0, 12000);
        await say(
          set,
          get,
          scope,
          "Producing that script. Each shot is at most 15 seconds and files onto the reel. Stop on the stage ends this pass. Say proceed again to continue.",
        );
        set({ chatBusy: false });
        await produceFromChat(set, get, script);
        return;
      }
      const digest = buildDigest({
        activeProjectId: get().activeProjectId,
        projects: get().projects,
        folders: get().folders,
        assets: get().assets,
      });
      const result = await askEditor({
        data: {
          digest,
          messages: history.slice(-12).map((message) => ({ role: message.role, content: message.content })),
        },
      });
      if (!result.ok) {
        set({ chatBusy: false, error: result.error });
        return;
      }
      const reply: ChatMsg = {
        id: uid(),
        scope,
        role: "assistant",
        content: result.text,
        createdAt: Date.now(),
      };
      await dbPut("chats", reply);
      set({ chats: [...get().chats, reply], chatBusy: false });
    } catch (error) {
      set({ chatBusy: false, error: messageOf(error) });
    }
  },
}));

function wantsProduction(text: string): boolean {
  const line = text.toLowerCase();
  const verb = /\b(proceed|generate|render|produce|shoot)\b/.test(line);
  const noun = /\b(script|film|episode|scene|shots?)\b/.test(line);
  return verb && noun;
}

async function say(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  scope: string,
  content: string,
) {
  const reply: ChatMsg = { id: uid(), scope, role: "assistant", content, createdAt: Date.now() };
  await dbPut("chats", reply);
  set({ chats: [...get().chats, reply] });
}

async function produceFromChat(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  script: string,
) {
  if (get().busy) {
    set({ error: "A render is already running." });
    return;
  }
  const projectId = get().activeProjectId;
  if (!projectId) return;
  const token = ++generation;
  const pass = 6;
  set({
    busy: true,
    mode: "motion",
    pane: "stage",
    playerMode: "reel",
    busyLabel: "Reading the script…",
    error: "",
  });
  let made = 0;
  try {
    while (made < pass) {
      if (token !== generation) return;
      const filedSeconds = get().playShots.reduce((sum, shot) => sum + (shot.duration || 0), 0);
      if (filedSeconds >= get().targetSeconds - 0.5) {
        await say(set, get, projectId, `The film length is filed (${formatTime(filedSeconds)}).`);
        break;
      }
      const style = STYLES.find((item) => item.id === get().styleId) ?? STYLES[2];
      const plan = await planNextShot({
        data: {
          script,
          styleLine: style.line,
          shotSeconds: Math.min(15, Math.max(4, get().duration)),
          filmSeconds: get().targetSeconds,
          filed: get().playShots.map((shot) => ({
            title: shot.label,
            seconds: Math.max(1, Math.round(shot.duration || get().duration)),
          })),
        },
      });
      if (token !== generation) return;
      if (!plan.ok) throw new Error(plan.error);
      if (plan.done) {
        await say(
          set,
          get,
          projectId,
          made ? `The script is covered. ${made} shot${made === 1 ? "" : "s"} filed on the reel.` : "That script is already covered on the reel.",
        );
        break;
      }
      set({ busyLabel: `Shot ${made + 1}: ${plan.title}` });
      const compiled = await assemble(get, plan.scene);
      const started = await beginShot({
        data: {
          prompt: compiled.prompt,
          duration: plan.seconds,
          aspectRatio: get().aspect,
          resolution: get().motionRes,
          pinFirst: get().pinFirst,
          references: compiled.references,
        },
      });
      if (token !== generation) return;
      if (!started.ok) throw new Error(started.error);
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(5000);
        if (token !== generation) return;
        const status = await pollShot({ data: { requestId: started.requestId } });
        if (!status.ok) throw new Error(status.error);
        if (status.status === "done") {
          ready = true;
          break;
        }
      }
      if (!ready) throw new Error("The shot is still rendering. Say proceed again in a moment.");
      const response = await fetch(`/api/studio-media?requestId=${encodeURIComponent(started.requestId)}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Could not download the shot.");
      }
      const blob = await response.blob();
      const duration = (await probeDuration(blob)) || plan.seconds;
      const folderId = folderIdFor(get().folders, projectId, "reels");
      const tag = uniqueTag(get, projectId, tagFromTitle(plan.title));
      const asset = await makeStoredAsset({
        projectId,
        folderId,
        title: plan.title,
        tag,
        kind: "video",
        mime: blob.type || "video/mp4",
        prompt: compiled.prompt,
        text: "",
        blob,
        duration,
      });
      const current =
        get().reels.find((reel) => reel.id === get().activeReelId) ??
        ({ id: uid(), projectId, title: "Reel 1", shots: [], updatedAt: Date.now() } satisfies Reel);
      const reel: Reel = {
        ...current,
        shots: [...current.shots, { assetId: asset.id, label: tag }],
        updatedAt: Date.now(),
      };
      await dbPut("reels", reel);
      const reels = get().reels.some((item) => item.id === reel.id)
        ? get().reels.map((item) => (item.id === reel.id ? reel : item))
        : [reel, ...get().reels];
      set({
        assets: [asset, ...get().assets],
        reels,
        activeReelId: reel.id,
        playShots: [...get().playShots, { assetId: asset.id, url: await cachedUrl(asset.id, blob), duration, label: tag }],
        playerMode: "reel",
      });
      made += 1;
    }
    if (token !== generation) return;
    if (made >= pass) {
      const left = Math.max(0, get().targetSeconds - get().playShots.reduce((sum, shot) => sum + (shot.duration || 0), 0));
      await say(set, get, projectId, `Filed ${made} shots. ${formatTime(left)} left on the film. Say proceed again to continue.`);
    }
    set({ busy: false, busyLabel: "", error: "" });
  } catch (error) {
    if (token !== generation) return;
    const message = messageOf(error);
    set({ busy: false, busyLabel: "", error: message });
    await say(set, get, projectId, message);
  }
}

async function hydrateReel(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  projectId: string,
) {
  const reel = get().reels
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!reel) {
    set({ activeReelId: null, playShots: [], playerMode: "shot" });
    return;
  }
  const shots: PlayShot[] = [];
  for (const shot of reel.shots) {
    const asset = get().assets.find((item) => item.id === shot.assetId);
    const blob = await dbGetBlob(shot.assetId);
    if (!blob) continue;
    shots.push({
      assetId: shot.assetId,
      url: await cachedUrl(shot.assetId, blob),
      duration: asset?.duration || 0,
      label: shot.label,
    });
  }
  set({ activeReelId: reel.id, playShots: shots });
}

function currentCut(get: () => StudioState): Cut | null {
  return get().cuts.find((cut) => cut.id === get().activeCutId) ?? null;
}

async function ensureCut(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  projectId: string,
): Promise<Cut> {
  const existing = get().cuts.find((cut) => cut.id === get().activeCutId && cut.projectId === projectId);
  if (existing) return existing;
  const latest = get().cuts.filter((cut) => cut.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) {
    set({ activeCutId: latest.id });
    return latest;
  }
  const cut: Cut = { id: uid(), projectId, title: "Cut 1", clips: [], updatedAt: Date.now() };
  await writeCut(set, get, cut);
  return cut;
}

async function writeCut(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  cut: Cut,
): Promise<void> {
  await dbPut("cuts", cut);
  const cuts = get().cuts.some((item) => item.id === cut.id)
    ? get().cuts.map((item) => (item.id === cut.id ? cut : item))
    : [cut, ...get().cuts];
  set({ cuts, activeCutId: cut.id });
}

function claimTags(get: () => StudioState, projectId: string, wanted: string[]): string[] {
  const used = new Set(
    get()
      .assets.filter((asset) => asset.projectId === projectId)
      .flatMap((asset) => assetTagList(asset).map((tag) => normalizeTag(tag))),
  );
  const claimed: string[] = [];
  for (const base of wanted) {
    const root = base || "Still";
    let tag = root;
    let n = 2;
    while (used.has(normalizeTag(tag))) {
      tag = `${root}${n}`;
      n += 1;
    }
    used.add(normalizeTag(tag));
    claimed.push(tag);
  }
  return claimed;
}

async function queueUploads(
  set: (partial: Partial<StudioState>) => void,
  get: () => StudioState,
  folderId: string,
  files: File[],
  intoCut: boolean,
) {
  const folder = get().folders.find((item) => item.id === folderId);
  const projectId = intoCut ? get().activeProjectId : folder?.projectId;
  if (!projectId) return;
  const queued: PendingUpload[] = [];
  for (const file of files) {
    const title = file.name.replace(/\.[^.]+$/, "") || "Upload";
    if (!intoCut && folder?.kind === "notes") {
      const text = (await file.text()).trim();
      if (text) await get().saveNote(title, text);
      continue;
    }
    const video = file.type.startsWith("video");
    const image = file.type.startsWith("image");
    if (intoCut && !video && !image) continue;
    const kind = intoCut ? (video ? "video" : "image") : kindForUpload(folder?.kind ?? "custom", file.type);
    if (kind === "note") continue;
    const dest = intoCut ? folderIdFor(get().folders, projectId, video ? "reels" : "stills") : folderId;
    queued.push({
      id: uid(),
      projectId,
      folderId: dest,
      kind,
      blob: file,
      url: URL.createObjectURL(file),
      title,
      tags: "",
      intoCut,
    });
  }
  if (!queued.length) return;
  set({
    pendingUploads: [...queued, ...get().pendingUploads],
    notice: "Name it and add tags, then file it.",
    error: "",
  });
}

function uniqueTag(get: () => StudioState, projectId: string, base: string): string {
  const used = new Set(
    get()
      .assets.filter((asset) => asset.projectId === projectId)
      .flatMap((asset) => assetTagList(asset).map((tag) => normalizeTag(tag))),
  );
  const root = base || "Still";
  if (!used.has(normalizeTag(root))) return root;
  let n = 2;
  while (used.has(normalizeTag(`${root}${n}`))) n += 1;
  return `${root}${n}`;
}

function kindForUpload(folder: FolderKind, mime: string): AssetKind {
  if (folder === "voices") return "voice";
  if (folder === "audio") return "audio";
  if (mime.startsWith("audio")) return "audio";
  if (mime.startsWith("video")) return "video";
  return "image";
}

async function makeStoredAsset(input: {
  projectId: string;
  folderId: string;
  title: string;
  tag: string;
  tags?: string[];
  kind: AssetKind;
  mime: string;
  prompt: string;
  text: string;
  blob: Blob;
  duration?: number;
}): Promise<Asset> {
  const id = uid();
  let thumb = "";
  let duration = input.duration ?? 0;
  if (input.kind === "image") thumb = await fileToJpegDataUrl(input.blob, 480, 0.8);
  if (input.kind === "video") {
    thumb = await videoPoster(input.blob);
    if (!duration) duration = await probeDuration(input.blob);
  }
  if (input.kind === "audio" || input.kind === "voice") duration = await probeDuration(input.blob);
  const asset: Asset = {
    id,
    projectId: input.projectId,
    folderId: input.folderId,
    title: input.title,
    tag: input.tag,
    tags: input.tags?.length ? input.tags : [input.tag],
    kind: input.kind,
    mime: input.mime,
    prompt: input.prompt,
    text: input.text,
    thumb,
    duration,
    createdAt: Date.now(),
  };
  await dbPut("assets", asset);
  await dbPutBlob(id, input.blob);
  await cachedUrl(id, input.blob);
  return asset;
}

async function assemble(get: () => StudioState, scene?: string) {
  const state = get();
  const spoken = scene ?? state.prompt;
  const project = state.projects.find((item) => item.id === state.activeProjectId) ?? null;
  const library: CanonAsset[] = project
    ? state.assets
        .filter((asset) => asset.projectId === project.id)
        .map((asset) => ({
          id: asset.id,
          tag: asset.tag,
          tags: asset.tags,
          title: asset.title,
          folder: state.folders.find((folder) => folder.id === asset.folderId)?.name ?? "",
          kind: asset.kind,
          prompt: asset.prompt,
          text: asset.text,
        }))
    : [];
  const extras: { asset: CanonAsset; dataUrl: string }[] = [];
  const mentioned = new Set<string>();
  for (const token of spoken.match(/@([A-Za-z0-9_-]+)/g) ?? []) {
    const raw = token.slice(1);
    if (/^image\d+$/i.test(raw)) continue;
    const asset = library.find((item) => matchesTag(item, raw));
    if (!asset || asset.kind !== "image") continue;
    mentioned.add(asset.id);
  }
  const rank = (asset: (typeof state.assets)[number]) => {
    const kind = state.folders.find((folder) => folder.id === asset.folderId)?.kind;
    if (mentioned.has(asset.id)) return 0;
    if (kind === "characters") return 1;
    if (kind === "scenes") return 2;
    return 3;
  };
  const imageAssets = project
    ? state.assets
        .filter((asset) => asset.projectId === project.id && asset.kind === "image")
        .sort((a, b) => rank(a) - rank(b))
    : [];
  const maxRefs = state.mode === "still" ? 5 : 7;
  for (const asset of imageAssets) {
    if (!state.absolute && !mentioned.has(asset.id)) continue;
    if (state.strip.some((item) => item.assetId === asset.id)) continue;
    if (state.strip.length + extras.length >= maxRefs) break;
    const blob = await dbGetBlob(asset.id);
    if (!blob) continue;
    const canon = library.find((item) => item.id === asset.id);
    if (!canon) continue;
    extras.push({ asset: canon, dataUrl: await fileToJpegDataUrl(blob, 768, 0.8) });
  }
  const style = STYLES.find((item) => item.id === state.styleId) ?? STYLES[2];
  return compileScene({
    mode: state.mode,
    projectTitle: project?.title ?? null,
    styleLine: style.line,
    cadence: state.mode === "motion" ? state.cadence : null,
    scene: spoken,
    strip: state.strip,
    library,
    extras,
    maxRefs,
    absolute: Boolean(project) && state.absolute,
  });
}
