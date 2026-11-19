import { useEffect, useRef, useState } from "react";
import { dbGetBlob } from "@/lib/studio/idb";
import { formatTime } from "@/lib/studio/prompt";
import { useStudio } from "@/lib/studio/store";
import type { CutClip } from "@/lib/studio/types";
import { MovieEditor } from "@/components/studio/movie-editor";
import { Btn, controlClass } from "@/components/studio/ui";

export function CutPane({
  expanded = false,
  onExpand,
  onMinimize,
}: {
  expanded?: boolean;
  onExpand?: () => void;
  onMinimize?: () => void;
}) {
  const projects = useStudio((state) => state.projects);
  const activeProjectId = useStudio((state) => state.activeProjectId);
  const folders = useStudio((state) => state.folders);
  const assets = useStudio((state) => state.assets);
  const cuts = useStudio((state) => state.cuts);
  const activeCutId = useStudio((state) => state.activeCutId);
  const addToCut = useStudio((state) => state.addToCut);
  const uploadIntoCut = useStudio((state) => state.uploadIntoCut);
  const pendingUploads = useStudio((state) => state.pendingUploads);
  const setPending = useStudio((state) => state.setPending);
  const discardPending = useStudio((state) => state.discardPending);
  const filePending = useStudio((state) => state.filePending);
  const newCut = useStudio((state) => state.newCut);
  const selectCut = useStudio((state) => state.selectCut);
  const moveCutClip = useStudio((state) => state.moveCutClip);
  const trimCutClip = useStudio((state) => state.trimCutClip);
  const removeCutClip = useStudio((state) => state.removeCutClip);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMinimize?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onMinimize]);
  const project = projects.find((item) => item.id === activeProjectId);
  const projectCuts = cuts.filter((cut) => cut.projectId === activeProjectId);
  const cut = projectCuts.find((item) => item.id === activeCutId) ?? projectCuts[0] ?? null;
  const media = project
    ? assets.filter((asset) => asset.projectId === project.id && (asset.kind === "image" || asset.kind === "video"))
    : [];

  if (!project) {
    return <p className="p-4 text-sm text-stone">Open a project. The cut uses its pictures and videos, and the files you upload.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 md:p-4">
      <MovieEditor />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl leading-none">Cut</h2>
          <p className="mt-1 text-sm text-stone">
            {project.title}. Bring a picture or a video from the project, or upload your own. A picture holds for as long as you set.
          </p>
        </div>
        <div className="flex gap-2">
          {projectCuts.length > 1 ? (
            <select
              aria-label="Choose cut"
              value={cut?.id ?? ""}
              onChange={(event) => selectCut(event.target.value)}
              className="h-11 rounded-md border border-line bg-ink px-2 text-sm"
            >
              {projectCuts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          ) : null}
          <Btn onClick={() => void newCut()}>New cut</Btn>
          <Btn tone={expanded ? "solid" : "quiet"} onClick={() => (expanded ? onMinimize?.() : onExpand?.())}>
            {expanded ? "Minimize" : "Expand"}
          </Btn>
        </div>
      </div>

      <label className="flex h-16 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-sm text-stone">
        Upload your own picture or video
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void uploadIntoCut(files);
          }}
        />
      </label>
      {pendingUploads
        .filter((item) => item.intoCut)
        .map((item) => (
          <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3">
            <p className="text-sm text-stone">Name this {item.kind} before it is filed</p>
            {item.kind === "image" ? <img src={item.url} alt="" className="aspect-video w-full rounded-md object-cover" /> : null}
            {item.kind === "video" ? <video src={item.url} controls className="aspect-video w-full rounded-md" /> : null}
            <input
              value={item.title}
              onChange={(event) => setPending(item.id, { title: event.target.value })}
              aria-label="Upload name"
              placeholder="Name"
              className={controlClass}
            />
            <input
              value={item.tags}
              onChange={(event) => setPending(item.id, { tags: event.target.value })}
              aria-label="Upload tags"
              placeholder="Tags, separated by commas"
              className={controlClass}
            />
            <div className="flex gap-2">
              <Btn tone="solid" onClick={() => void filePending(item.id)}>
                File
              </Btn>
              <Btn tone="text" className="text-danger" onClick={() => discardPending(item.id)}>
                Discard
              </Btn>
            </div>
          </div>
        ))}

      <div>
        <p className="mb-2 text-sm text-stone">From the project</p>
        {media.length === 0 ? (
          <p className="text-sm text-mist">Nothing filed yet. Upload here, or keep a still or a shot on the stage.</p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {media.map((asset) => {
              const folder = folders.find((item) => item.id === asset.folderId)?.name ?? "";
              return (
                <li key={asset.id} className="w-28 shrink-0">
                  <button type="button" onClick={() => void addToCut(asset.id)} className="w-full text-left">
                    {asset.thumb ? (
                      <img src={asset.thumb} alt={asset.title} className="aspect-video w-full rounded-md object-cover" />
                    ) : (
                      <span className="flex aspect-video items-center justify-center rounded-md bg-ink text-xs text-mist">
                        {asset.kind}
                      </span>
                    )}
                    <span className="mt-1 block truncate text-xs text-bone">@{asset.tag}</span>
                    <span className="block truncate text-xs text-mist">{folder}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {cut && cut.clips.length ? <Assembly clips={cut.clips} thumbs={assets} /> : null}

      <ol className="flex flex-col gap-2">
        {cut?.clips.map((clip, index) => {
          const asset = assets.find((item) => item.id === clip.assetId);
          const span = clip.outPoint - clip.inPoint;
          return (
            <li key={clip.id} className="rounded-xl border border-line bg-panel p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {index + 1}. @{clip.label}
                  <span className="text-stone"> · {clip.kind === "image" ? "picture" : "video"} · {formatTime(span)}</span>
                </p>
                <div className="flex gap-2">
                  <button type="button" className="text-xs text-stone" onClick={() => void moveCutClip(clip.id, -1)}>
                    Earlier
                  </button>
                  <button type="button" className="text-xs text-stone" onClick={() => void moveCutClip(clip.id, 1)}>
                    Later
                  </button>
                  <button type="button" className="text-xs text-danger" onClick={() => void removeCutClip(clip.id)}>
                    Remove
                  </button>
                </div>
              </div>
              {clip.kind === "image" ? (
                <label className="mt-2 block text-xs text-stone">
                  Hold {formatTime(clip.outPoint)}
                  <input
                    aria-label={`Hold for @${clip.label}`}
                    type="range"
                    min={1}
                    max={60}
                    step={1}
                    value={Math.min(60, Math.max(1, Math.round(clip.outPoint)))}
                    onChange={(event) => void trimCutClip(clip.id, { outPoint: Number(event.target.value) })}
                    className="mt-2 w-full accent-bone"
                  />
                </label>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs text-stone">
                    In
                    <input
                      aria-label={`In point for @${clip.label}`}
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number(clip.inPoint.toFixed(1))}
                      onChange={(event) => void trimCutClip(clip.id, { inPoint: Number(event.target.value) })}
                      className="mt-1 h-10 w-full rounded-md border border-line bg-ink px-2 text-sm text-bone"
                    />
                  </label>
                  <label className="text-xs text-stone">
                    Out {asset?.duration ? `(${formatTime(asset.duration)})` : ""}
                    <input
                      aria-label={`Out point for @${clip.label}`}
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number(clip.outPoint.toFixed(1))}
                      onChange={(event) => void trimCutClip(clip.id, { outPoint: Number(event.target.value) })}
                      className="mt-1 h-10 w-full rounded-md border border-line bg-ink px-2 text-sm text-bone"
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {cut && cut.clips.length === 0 ? <p className="text-sm text-stone">The timeline is empty.</p> : null}
    </div>
  );
}

function Assembly({
  clips,
  thumbs,
}: {
  clips: CutClip[];
  thumbs: { id: string; thumb: string }[];
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = clips[Math.min(index, clips.length - 1)];
  const total = clips.reduce((sum, item) => sum + Math.max(0.2, item.outPoint - item.inPoint), 0);

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [clips.map((item) => item.id).join("|")]);

  useEffect(() => {
    if (!clip || clip.kind !== "video") return;
    let alive = true;
    let url = "";
    void dbGetBlob(clip.assetId).then((blob) => {
      if (!alive || !blob) return;
      url = URL.createObjectURL(blob);
      setVideoUrl(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [clip?.id, clip?.assetId, clip?.kind]);

  useEffect(() => {
    if (!playing || !clip || clip.kind !== "image") return;
    const timer = window.setTimeout(() => go(1), Math.max(0.2, clip.outPoint - clip.inPoint) * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, clip?.id, clip?.kind, clip?.outPoint]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || clip.kind !== "video" || !videoUrl) return;
    const arm = () => {
      video.currentTime = clip.inPoint;
      if (playing) void video.play().catch(() => setPlaying(false));
    };
    video.onloadeddata = arm;
    if (video.readyState >= 2) arm();
    video.ontimeupdate = () => {
      if (video.currentTime >= clip.outPoint - 0.04) {
        video.pause();
        go(1);
      }
    };
  }, [videoUrl, playing, clip?.id, clip?.inPoint, clip?.outPoint]);

  function go(step: number) {
    setIndex((current) => {
      const next = current + step;
      if (next >= clips.length) {
        setPlaying(false);
        return 0;
      }
      return Math.max(0, next);
    });
  }

  if (!clip) return null;
  const still = thumbs.find((item) => item.id === clip.assetId)?.thumb ?? "";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink">
      <div className="flex aspect-video items-center justify-center bg-black">
        {clip.kind === "image" ? (
          still ? <img src={still} alt={clip.label} className="h-full w-full object-contain" /> : null
        ) : (
          <video ref={videoRef} src={videoUrl} className="h-full w-full" playsInline />
        )}
      </div>
      <div className="flex items-center gap-3 p-3">
        <Btn tone="solid" onClick={() => setPlaying((value) => !value)}>
          {playing ? "Pause" : "Play"}
        </Btn>
        <Btn
          onClick={() => {
            setPlaying(false);
            setIndex(0);
          }}
        >
          Stop
        </Btn>
        <p className="text-sm text-stone">
          {index + 1}/{clips.length} · @{clip.label} · {formatTime(total)}
        </p>
      </div>
    </div>
  );
}
