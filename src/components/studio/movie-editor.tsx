import { useEffect, useState } from "react";
import { formatTime } from "@/lib/studio/prompt";
import { useStudio } from "@/lib/studio/store";
import { Btn, controlClass } from "@/components/studio/ui";

export function MovieEditor() {
  const projectId = useStudio((state) => state.activeProjectId);
  const projects = useStudio((state) => state.projects);
  const reels = useStudio((state) => state.reels);
  const assets = useStudio((state) => state.assets);
  const busy = useStudio((state) => state.busy);
  const duration = useStudio((state) => state.duration);
  const rerenderReelShot = useStudio((state) => state.rerenderReelShot);
  const compileProjectMovie = useStudio((state) => state.compileProjectMovie);
  const projectReels = reels
    .filter((reel) => reel.projectId === projectId)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const [reelId, setReelId] = useState<string | null>(null);
  const [shotId, setShotId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const reel = projectReels.find((item) => item.id === reelId) ?? projectReels[0] ?? null;
  const shot = reel?.shots.find((item) => item.assetId === shotId) ?? reel?.shots[0] ?? null;
  const asset = assets.find((item) => item.id === shot?.assetId);
  const project = projects.find((item) => item.id === projectId);

  useEffect(() => {
    if (!shot) {
      setPrompt("");
      return;
    }
    const filed = assets.find((item) => item.id === shot.assetId);
    setPrompt(filed?.prompt ?? "");
    // Load the filed prompt only when the selected piece changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.assetId]);

  if (!project) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
      <div>
        <h2 className="font-display text-2xl leading-none">Movie</h2>
        <p className="mt-1 text-sm text-stone">
          {project.title}. Select a reel, change its prompt, and re-render that piece. Compile writes every reel in this project into one video.
        </p>
      </div>
      {projectReels.length === 0 ? (
        <p className="text-sm text-mist">No reels yet. File a shot onto a reel from the stage.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {projectReels.map((item, index) => (
              <Btn key={item.id} tone={reel?.id === item.id ? "solid" : "quiet"} onClick={() => setReelId(item.id)}>
                {item.title || `Reel ${index + 1}`} · {item.shots.length}
              </Btn>
            ))}
          </div>
          {reel ? (
            <ul className="flex flex-col gap-1">
              {reel.shots.map((item, index) => {
                const filed = assets.find((assetItem) => assetItem.id === item.assetId);
                return (
                  <li key={item.assetId}>
                    <button
                      type="button"
                      onClick={() => setShotId(item.assetId)}
                      className={`w-full rounded-md px-2 py-2 text-left text-sm ${shot?.assetId === item.assetId ? "bg-ink text-bone" : "text-stone"}`}
                    >
                      {index + 1}. @{item.label}
                      {filed?.duration ? ` · ${formatTime(filed.duration)}` : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <label className="flex flex-col gap-2 text-sm text-stone">
            Prompt for {shot ? `@${shot.label}` : "this reel"}
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              aria-label="Reel prompt"
              rows={6}
              className={`${controlClass} min-h-32 py-2`}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Btn
              tone="solid"
              disabled={busy || !shot}
              onClick={() => {
                if (shot) void rerenderReelShot(shot.assetId, prompt);
              }}
            >
              Re-render this reel
            </Btn>
            <Btn tone="quiet" disabled={busy} onClick={() => void compileProjectMovie()}>
              Compile reels into one movie
            </Btn>
          </div>
          <p className="text-xs text-mist">
            Re-render uses the stage length, {duration}s. A single render stops at 15 seconds. Above that, two renders are joined. Compile plays the reels through once, in real time, and files the movie without putting it back on a reel.
          </p>
        </>
      )}
    </section>
  );
}
