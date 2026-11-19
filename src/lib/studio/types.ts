export type FolderKind =
  | "characters"
  | "scenes"
  | "audio"
  | "voices"
  | "notes"
  | "stills"
  | "reels"
  | "custom";

export type AssetKind = "image" | "audio" | "voice" | "video" | "note";

export type Project = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type Folder = {
  id: string;
  projectId: string;
  name: string;
  kind: FolderKind;
  createdAt: number;
};

export type Asset = {
  id: string;
  projectId: string;
  folderId: string;
  title: string;
  tag: string;
  tags?: string[];
  kind: AssetKind;
  mime: string;
  prompt: string;
  text: string;
  thumb: string;
  duration: number;
  createdAt: number;
  voiceId?: string;
};

export type ChatMsg = {
  id: string;
  scope: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type Reel = {
  id: string;
  projectId: string;
  title: string;
  shots: { assetId: string; label: string }[];
  updatedAt: number;
};

export type CutClip = {
  id: string;
  assetId: string;
  kind: "video" | "image";
  label: string;
  inPoint: number;
  outPoint: number;
};

export type Cut = {
  id: string;
  projectId: string;
  title: string;
  clips: CutClip[];
  updatedAt: number;
};

export type StripItem = {
  id: string;
  assetId?: string;
  tag?: string;
  folder?: string;
  canon?: string;
  dataUrl: string;
};

export type Candidate = {
  id: string;
  url: string;
  blob: Blob;
  prompt: string;
  title: string;
  tags: string;
  folderId: string;
};

export type PreviewShot = {
  url: string;
  blob: Blob;
  duration: number;
  prompt: string;
  title: string;
  tags: string;
  folderId: string;
  savedTag: string;
  voiceUrl?: string;
};

export type PendingUpload = {
  id: string;
  projectId: string;
  folderId: string;
  kind: AssetKind;
  blob: Blob;
  url: string;
  title: string;
  tags: string;
  intoCut: boolean;
};

export type PlayShot = {
  assetId: string;
  url: string;
  duration: number;
  label: string;
};
