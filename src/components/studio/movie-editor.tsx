import { useEffect, useState } from "react";
import { formatTime } from "@/lib/studio/prompt";
import { useStudio } from "@/lib/studio/store";
import type { CutTransition } from "@/lib/studio/types";
import { Btn, controlClass } from "@/components/studio/ui";

const TRANSITIONS: { id: CutTransition; label: string }[] = [
  { id: "seamless", label: "Seamless" },
  { id: "fade", label: "Fade" },
  { id: "dissolve", label: "Dissolve" },
  { id: "wipe", label: "Wipe" },
];

const PX = 36;

export function MovieEditor() {
  const projectId = useStudio((state) => state.activeProjectId);
  const projects = useStudio((state) => state.projects);
  const reels = useStudio((state) => state.reels);
  const assets = useStudio((state) => state.assets);
  const cuts = useStudio((state) => state.cuts);
  const activeCutId = useStudio((state) => state.activeCutId);
  const busy = useStudio((state) => state.busy);
  const duration = useStudio((state) => state.duration);
  const placeOnTimeline = useStudio((state) => state.placeOnTimeline);
  const setClipLength = useStudio((state) => state.setClipLength);
  const setClipTransition = useStudio((state) => state.setClipTransition);
  const moveClipTo = useStudio((state) => state.moveClipTo);
  const removeCutClip = useStudio((state) => state.removeCutClip);
  const rerenderReelShot = useStudio((state) => state.rerenderReelShot);
  const compileProjectMovie = useStudio((state) => state.compileProjectMovie);
  const project = projects.find((item) => item.id === projectId);
  const projectReels = reels.filter((reel) => reel.projectId === projectId).sort((a, b) => a.updatedAt - b.updatedAt);
  const cut = cuts.find((item) => item.id === activeCutId && item.projectId === projectId) ?? cuts.find((item) => item.projectId === projectId) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [dragLength, setDragLength] = useState<{ id: string; seconds: number } | null>(null);
  const selected = cut?.clips.find((clip) => clip.id === selectedId) ?? null;
  const selectedAsset = assets.find((item) => item.id === selected?.assetId);

  useEffect(() => {
    setPrompt(selectedAsset?.prompt ?? "");
  }, [selected?.assetId, selectedAsset?.prompt]);

  if (!project) return null;

  const total = cut?.clips.reduce((sum, clip) => sum + (clip.outPoint - clip.inPoint), 0) ?? 0;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
      <div>
        <h2 className="font-display text-2xl leading-none">Movie</h2>
        <p className="mt-1 text-sm text-stone">
          Drag a reel onto the timeline. Each segment starts at 2 seconds. Drag its right edge open, up to 15 or the reel’s own length.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {projectReels.length === 0 ? (
          <p className="text-sm text-mist">No reels yet. File a shot onto a reel from the stage, then drag it here.</p>
        ) : (
          projectReels.map((reel) => (
            <div key={reel.id} className="flex shrink-0 gap-2">
              {reel.shots.map((shot) => {
                const asset = assets.find((item) => item.id === shot.assetId);
                return (
                  <button
                    key={shot.assetId}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/reel", shot.assetId);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                    className="w-28 shrink-0 rounded-md border border-line bg-ink p-2 text-left"
                  >
                    {asset?.thumb ? <img src={asset.thumb} alt="" className="mb-1 aspect-video w-full rounded object-cover" /> : null}
                    <span className="block truncate text-xs text-bone">@{shot.label}</span>
                    <span className="block text-xs text-mist">{asset?.duration ? formatTime(Math.min(15, asset.duration)) : "reel"}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div
        className="min-h-28 overflow-x-auto rounded-xl border border-dashed border-line bg-ink p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const assetId = event.dataTransfer.getData("text/reel");
          if (assetId) void placeOnTimeline(assetId);
        }}
      >
        {cut && cut.clips.length ? (
          <div className="flex h-24 items-stretch gap-1" style={{ width: Math.max(total * PX, 280) }}>
            {cut.clips.map((clip, index) => {
              const asset = assets.find((item) => item.id === clip.assetId);
              const full = Math.min(15, Math.max(2, asset?.kind === "image" ? 15 : asset?.duration || 15));
              const seconds = dragLength?.id === clip.id ? dragLength.seconds : clip.outPoint - clip.inPoint;
              return (
                <div
                  key={clip.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/clip", clip.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const clipId = event.dataTransfer.getData("text/clip");
                    const assetId = event.dataTransfer.getData("text/reel");
                    if (clipId) void moveClipTo(clipId, index);
                    else if (assetId) void placeOnTimeline(assetId);
                  }}
                  onClick={() => setSelectedId(clip.id)}
                  className={`relative flex h-full shrink-0 cursor-grab flex-col justify-between overflow-hidden rounded-md border ${selectedId === clip.id ? "border-bone" : "border-line"} bg-panel p-2`}
                  style={{ width: Math.max(72, seconds * PX) }}
                >
                  <span className="truncate text-xs text-bone">@{clip.label}</span>
                  <span className="text-xs text-mist">
                    {formatTime(seconds)} / {formatTime(full)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Length of @${clip.label}`}
                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-bone/70"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const startX = event.clientX;
                      const start = clip.outPoint - clip.inPoint;
                      const target = event.currentTarget;
                      target.setPointerCapture(event.pointerId);
                      const move = (pointer: PointerEvent) => {
                        const next = Math.min(full, Math.max(2, start + (pointer.clientX - startX) / PX));
                        setDragLength({ id: clip.id, seconds: next });
                      };
                      const up = (pointer: PointerEvent) => {
                        const next = Math.min(full, Math.max(2, start + (pointer.clientX - startX) / PX));
                        setDragLength(null);
                        void setClipLength(clip.id, next);
                        target.removeEventListener("pointermove", move);
                        target.removeEventListener("pointerup", up);
                      };
                      target.addEventListener("pointermove", move);
                      target.addEventListener("pointerup", up);
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-mist">Drop a reel here. It lands collapsed to 2 seconds.</p>
        )}
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-bone">@{selected.label}</p>
            {cut && cut.clips[0]?.id !== selected.id ? (
              <label className="text-xs text-stone">
                Transition in
                <select
                  aria-label="Transition"
                  value={selected.transition ?? "seamless"}
                  onChange={(event) => void setClipTransition(selected.id, event.target.value as CutTransition)}
                  className="ml-2 h-9 rounded-md border border-line bg-ink px-2 text-sm text-bone"
                >
                  {TRANSITIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-xs text-mist">First segment has no incoming transition.</span>
            )}
            <Btn tone="text" className="text-danger" onClick={() => void removeCutClip(selected.id)}>
              Remove
            </Btn>
          </div>
          <label className="flex flex-col gap-2 text-sm text-stone">
            Prompt for this reel
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="Reel prompt"
              rows={5}
              className={`${controlClass} min-h-28 py-2`}
            />
          </label>
          <Btn tone="solid" disabled={busy} onClick={() => void rerenderReelShot(selected.assetId, prompt)}>
            Re-render this reel
          </Btn>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Btn tone="solid" disabled={busy || !cut?.clips.length} onClick={() => void compileProjectMovie()}>
          Compile timeline
        </Btn>
        <p className="text-xs text-mist">
          Timeline {formatTime(total)}. Re-render uses the stage length, {duration}s. Seamless is a cut. Fade goes through black. Dissolve blends. Wipe opens left to right. Compile plays the timeline through in real time.
        </p>
      </div>
    </section>
  );
}
