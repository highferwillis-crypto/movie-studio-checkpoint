import { IMAGE_ASPECTS, STYLES, VIDEO_ASPECTS, formatTime, lintScene, parseTagList } from "@/lib/studio/prompt";
import { useStudio } from "@/lib/studio/store";
import { Btn, Field, Select, controlClass } from "@/components/studio/ui";
import { MotionPlayer } from "@/components/studio/player";
import { VoiceSampler } from "@/components/studio/voice-sampler";

export function StagePane() {
  const mode = useStudio((state) => state.mode);
  const prompt = useStudio((state) => state.prompt);
  const styleId = useStudio((state) => state.styleId);
  const aspect = useStudio((state) => state.aspect);
  const stillRes = useStudio((state) => state.stillRes);
  const motionRes = useStudio((state) => state.motionRes);
  const quality = useStudio((state) => state.quality);
  const batch = useStudio((state) => state.batch);
  const duration = useStudio((state) => state.duration);
  const cadence = useStudio((state) => state.cadence);
  const pinFirst = useStudio((state) => state.pinFirst);
  const absolute = useStudio((state) => state.absolute);
  const targetSeconds = useStudio((state) => state.targetSeconds);
  const strip = useStudio((state) => state.strip);
  const candidates = useStudio((state) => state.candidates);
  const preview = useStudio((state) => state.preview);
  const playShots = useStudio((state) => state.playShots);
  const playerMode = useStudio((state) => state.playerMode);
  const busy = useStudio((state) => state.busy);
  const busyLabel = useStudio((state) => state.busyLabel);
  const warnings = useStudio((state) => state.warnings);
  const revealed = useStudio((state) => state.revealed);
  const projects = useStudio((state) => state.projects);
  const folders = useStudio((state) => state.folders);
  const assets = useStudio((state) => state.assets);
  const activeProjectId = useStudio((state) => state.activeProjectId);
  const setMode = useStudio((state) => state.setMode);
  const setPrompt = useStudio((state) => state.setPrompt);
  const patchStage = useStudio((state) => state.patchStage);
  const addUploadsToStrip = useStudio((state) => state.addUploadsToStrip);
  const removeStrip = useStudio((state) => state.removeStrip);
  const moveStrip = useStudio((state) => state.moveStrip);
  const revealPrompt = useStudio((state) => state.revealPrompt);
  const generate = useStudio((state) => state.generate);
  const cancelGenerate = useStudio((state) => state.cancelGenerate);
  const setCandidate = useStudio((state) => state.setCandidate);
  const discardCandidate = useStudio((state) => state.discardCandidate);
  const keepCandidate = useStudio((state) => state.keepCandidate);
  const setPreviewMeta = useStudio((state) => state.setPreviewMeta);
  const discardPreview = useStudio((state) => state.discardPreview);
  const keepPreview = useStudio((state) => state.keepPreview);
  const removeReelShot = useStudio((state) => state.removeReelShot);
  const setPlayerMode = useStudio((state) => state.setPlayerMode);
  const addSnapshot = useStudio((state) => state.addSnapshot);

  const project = projects.find((item) => item.id === activeProjectId);
  const style = STYLES.find((item) => item.id === styleId) ?? STYLES[2];
  const aspects = mode === "still" ? IMAGE_ASPECTS : VIDEO_ASPECTS;
  const projectFolders = folders.filter((folder) => folder.projectId === activeProjectId);
  const library = project
    ? assets
        .filter((asset) => asset.projectId === project.id)
        .map((asset) => ({
          id: asset.id,
          tag: asset.tag,
          title: asset.title,
          folder: "",
          kind: asset.kind,
          prompt: asset.prompt,
          text: asset.text,
        }))
    : [];
  const liveWarnings = lintScene(prompt, library, strip.length);
  const prefix = [
    "studio",
    project ? `project=${project.title.replace(/\s+/g, "-")}` : "project=free",
    mode,
    style.label.toLowerCase().replace(/\s+/g, "-"),
    aspect,
    mode === "still" ? `${stillRes} ${quality === "low" ? "draft" : "finish"} ×${batch}` : `${duration}s ${motionRes} ${cadence}fps`,
  ].join(" › ");
  const reelSeconds = playShots.reduce((sum, shot) => sum + (shot.duration || 0), 0);
  const remaining = Math.max(0, targetSeconds - reelSeconds);
  const moreShots = duration > 0 ? Math.ceil(remaining / duration) : 0;
  const playerShots =
    playerMode === "reel" && playShots.length
      ? playShots.map((shot) => ({ url: shot.url, duration: shot.duration, label: `@${shot.label}` }))
      : preview
        ? [{ url: preview.url, duration: preview.duration, label: preview.title || "Shot" }]
        : [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 md:p-4">
      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          <Btn tone={mode === "still" ? "solid" : "quiet"} onClick={() => setMode("still")}>
            Stills
          </Btn>
          <Btn tone={mode === "motion" ? "solid" : "quiet"} onClick={() => setMode("motion")}>
            Motion
          </Btn>
          <Btn
            tone={absolute ? "solid" : "quiet"}
            onClick={() => patchStage({ absolute: !absolute })}
            disabled={!project}
          >
            Absolute
          </Btn>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Style">
            <Select value={styleId} onChange={(event) => patchStage({ styleId: event.target.value })}>
              {STYLES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Aspect">
            <Select value={aspect} onChange={(event) => patchStage({ aspect: event.target.value })}>
              {aspects.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </Field>
          {mode === "still" ? (
            <>
              <Field label="Batch">
                <input
                  aria-label="Batch"
                  type="number"
                  min={1}
                  max={10}
                  value={batch}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    patchStage({ batch: Math.min(10, Math.max(1, Math.round(next))) });
                  }}
                  className={controlClass}
                />
              </Field>
              <Field label="Resolution">
                <Select
                  value={stillRes}
                  onChange={(event) => patchStage({ stillRes: event.target.value === "2k" ? "2k" : "1k" })}
                >
                  <option value="1k">1k</option>
                  <option value="2k">2k</option>
                </Select>
              </Field>
              <Field label="Quality">
                <Select
                  value={quality}
                  onChange={(event) => patchStage({ quality: event.target.value === "medium" ? "medium" : "low" })}
                >
                  <option value="low">Draft</option>
                  <option value="medium">Finish</option>
                </Select>
              </Field>
            </>
          ) : (
            <>
              <Field label={`This shot ${duration}s`}>
                <input
                  aria-label="Shot length"
                  type="range"
                  min={1}
                  max={15}
                  value={duration}
                  onChange={(event) => patchStage({ duration: Number(event.target.value) })}
                  className="mt-3 w-full accent-bone"
                />
              </Field>
              <Field label={`Film ${formatTime(targetSeconds)}`}>
                <input
                  aria-label="Film length"
                  type="range"
                  min={60}
                  max={7200}
                  step={60}
                  value={Math.min(7200, Math.max(60, targetSeconds))}
                  onChange={(event) => patchStage({ targetSeconds: Number(event.target.value) })}
                  className="mt-3 w-full accent-bone"
                />
              </Field>
              <Field label="Resolution">
                <Select
                  value={motionRes}
                  onChange={(event) =>
                    patchStage({
                      motionRes:
                        event.target.value === "1080p" || event.target.value === "480p" ? event.target.value : "720p",
                    })
                  }
                >
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </Select>
              </Field>
              <Field label="Cadence">
                <Select
                  value={cadence}
                  onChange={(event) => patchStage({ cadence: Number(event.target.value) === 30 ? 30 : Number(event.target.value) === 48 ? 48 : 24 })}
                >
                  <option value={24}>24 fps</option>
                  <option value={30}>30 fps</option>
                  <option value={48}>48 fps</option>
                </Select>
              </Field>
              <Field label={`Look ≈ ${duration * cadence} frames`}>
                <label className="flex h-11 items-center gap-2 text-sm text-bone">
                  <input
                    type="checkbox"
                    checked={pinFirst}
                    onChange={(event) => patchStage({ pinFirst: event.target.checked })}
                  />
                  Open on first reference
                </label>
              </Field>
            </>
          )}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-mist">{prefix}</p>
        <label className="mt-2 flex gap-2 rounded-md border border-line bg-ink p-3">
          <span className="pt-0.5 text-stone" aria-hidden>
            ›
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void generate();
              }
            }}
            placeholder="@Mara crosses @RainAlley. She says we waited long enough. Camera: slow dolly in. Sound: rain, no score."
            className="min-h-28 w-full resize-y bg-transparent text-sm outline-none"
          />
        </label>
        <p className="mt-2 text-xs text-mist">
          {project
            ? absolute
              ? `Absolute is optional and on. A picture’s name and tag words are what the render follows. Turn it off to generate freely.`
              : `@tags pull files from any folder in ${project.title}. A title you keep becomes the tag, and its prompt stays active.`
            : "No project selected, so this render is free. File it later by choosing a project first."}
          {mode === "motion"
            ? " A shot is at most 15 seconds. Stack kept shots on the reel for a scene that runs minutes. Cadence is written into the prompt as a film look."
            : " Stills stay in the bay until you keep them."}
        </p>
        {liveWarnings.length ? (
          <ul className="mt-2 text-xs text-stone">
            {liveWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <VoiceSampler />

      <div
        className="rounded-xl border border-dashed border-line p-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addUploadsToStrip([...event.dataTransfer.files]);
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm text-stone">References</p>
          <label className="text-sm text-bone">
            <span className="cursor-pointer underline decoration-line underline-offset-4">Add images</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                void addUploadsToStrip(files);
              }}
            />
          </label>
        </div>
        {strip.length === 0 ? (
          <p className="text-sm text-mist">Drop stills here. They become @image1, @image2, and so on.</p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {strip.map((item, index) => (
              <li key={item.id} className="w-28 shrink-0">
                <img src={item.dataUrl} alt={`Reference ${index + 1}`} className="aspect-video w-full rounded-md object-cover" />
                <p className="mt-1 truncate text-xs text-stone">@image{index + 1}{item.tag && !/^image\d+$/i.test(item.tag) ? ` · @${item.tag}` : ""}</p>
                <div className="mt-1 flex gap-1">
                  <button type="button" className="text-xs text-stone" onClick={() => moveStrip(item.id, -1)} aria-label="Move reference left">
                    Left
                  </button>
                  <button type="button" className="text-xs text-stone" onClick={() => moveStrip(item.id, 1)} aria-label="Move reference right">
                    Right
                  </button>
                  <button type="button" className="text-xs text-danger" onClick={() => removeStrip(item.id)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Btn tone="solid" disabled={busy || (!prompt.trim() && strip.length === 0)} onClick={() => void generate()}>
          {busy ? busyLabel || "Rendering…" : mode === "still" ? "Render stills" : "Render shot"}
        </Btn>
        {busy ? (
          <Btn onClick={cancelGenerate}>Cancel</Btn>
        ) : (
          <Btn onClick={() => void revealPrompt()}>Show full prompt</Btn>
        )}
      </div>
      {warnings.length ? (
        <ul className="text-sm text-stone">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {revealed ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-ink p-3 text-xs leading-relaxed text-stone">
          {revealed}
        </pre>
      ) : null}

      {playerShots.length ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Btn tone={playerMode === "shot" ? "solid" : "quiet"} disabled={!preview} onClick={() => setPlayerMode("shot")}>
              This shot
            </Btn>
            <Btn
              tone={playerMode === "reel" ? "solid" : "quiet"}
              disabled={!playShots.length}
              onClick={() => setPlayerMode("reel")}
            >
              Reel {formatTime(reelSeconds)}
            </Btn>
          </div>
          <MotionPlayer
            key={playerShots.map((shot) => shot.url).join("|")}
            shots={playerShots}
            voiceUrl={playerMode === "shot" ? preview?.voiceUrl : undefined}
            onSnapshot={(blob, at) => void addSnapshot(blob, at)}
          />
        </div>
      ) : null}

      {mode === "motion" ? (
        <div className="rounded-xl border border-line bg-panel p-3">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <p className="pb-2 text-sm text-stone">
              Film {formatTime(targetSeconds)}. Filed {formatTime(reelSeconds)}. This render is {duration}s — about {moreShots} more shot{moreShots === 1 ? "" : "s"}.
            </p>
          </div>
          {preview ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
              <input
                value={preview.title}
                onChange={(event) => setPreviewMeta({ title: event.target.value })}
                className={controlClass}
                aria-label="Shot name"
                placeholder="Name"
              />
              <input
                value={preview.tags}
                onChange={(event) => setPreviewMeta({ tags: event.target.value })}
                className={controlClass}
                aria-label="Shot tags"
                placeholder="Tags, separated by commas"
              />
              <Select
                aria-label="Folder"
                value={preview.folderId}
                onChange={(event) => setPreviewMeta({ folderId: event.target.value })}
              >
                {projectFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </Select>
              <Btn tone="solid" onClick={() => void keepPreview(false)}>
                {preview.savedTag ? `Filed @${preview.savedTag}` : "File shot"}
              </Btn>
              <Btn onClick={() => void keepPreview(true)}>Add to reel</Btn>
              <Btn tone="text" className="text-danger sm:col-span-4 sm:justify-self-start" onClick={discardPreview}>
                Discard shot
              </Btn>
              <p className="text-xs text-mist sm:col-span-4">
                {parseTagList(preview.tags).length
                  ? `Tags ${parseTagList(preview.tags).map((tag) => `@${tag}`).join(", ")}`
                  : "Name it, then add tags separated by commas."}
              </p>
            </div>
          ) : (
            <p className="text-sm text-mist">Render a shot to play it, stop on a frame, and snapshot.</p>
          )}
          {playShots.length ? (
            <ul className="mt-3 flex flex-col gap-1">
              {playShots.map((shot, index) => (
                <li key={shot.assetId} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {index + 1}. @{shot.label} · {formatTime(shot.duration)}
                  </span>
                  <button type="button" className="text-xs text-danger" onClick={() => void removeReelShot(shot.assetId)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {candidates.length ? (
        <div>
          <p className="mb-2 text-sm text-stone">Bay — not filed yet</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="enter overflow-hidden rounded-xl border border-line bg-panel">
                <img src={candidate.url} alt={candidate.title || "Untitled still"} className="aspect-video w-full object-cover" />
                <div className="flex flex-col gap-2 p-3">
                  <input
                    value={candidate.title}
                    onChange={(event) => setCandidate(candidate.id, { title: event.target.value })}
                    aria-label="Still name"
                    placeholder="Name"
                    className={controlClass}
                  />
                  <input
                    value={candidate.tags}
                    onChange={(event) => setCandidate(candidate.id, { tags: event.target.value })}
                    aria-label="Still tags"
                    placeholder="Tags, separated by commas"
                    className={controlClass}
                  />
                  <p className="text-xs text-mist">
                    {parseTagList(candidate.tags).map((tag) => `@${tag}`).join(", ") || "Add tags separated by commas."}
                  </p>
                  <Select
                    aria-label="Folder"
                    value={candidate.folderId}
                    onChange={(event) => setCandidate(candidate.id, { folderId: event.target.value })}
                  >
                    {projectFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </Select>
                  <div className="flex gap-2">
                    <Btn tone="solid" onClick={() => void keepCandidate(candidate.id)}>
                      Keep
                    </Btn>
                    <Btn tone="text" className="text-danger" onClick={() => discardCandidate(candidate.id)}>
                      Discard
                    </Btn>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
