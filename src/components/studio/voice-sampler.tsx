import { useEffect, useState } from "react";
import { dbGetBlob } from "@/lib/studio/idb";
import { useStudio } from "@/lib/studio/store";
import { Btn, Field, controlClass } from "@/components/studio/ui";

function VoiceClip({ id }: { id: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let current = "";
    let stop = false;
    void dbGetBlob(id).then((blob) => {
      if (stop || !blob) return;
      current = URL.createObjectURL(blob);
      setUrl(current);
    });
    return () => {
      stop = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [id]);
  if (!url) return null;
  return <audio src={url} controls className="h-10 w-full" />;
}

export function VoiceSampler() {
  const projectId = useStudio((state) => state.activeProjectId);
  const assets = useStudio((state) => state.assets);
  const fileVoice = useStudio((state) => state.fileVoice);
  const [name, setName] = useState("");
  const voices = assets.filter((asset) => asset.projectId === projectId && asset.kind === "voice");

  if (!projectId) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
      <div>
        <h2 className="text-sm text-bone">Voice sampler</h2>
        <p className="mt-1 text-xs text-mist">
          Add your own cartoon or anime recordings. Name each file as the character. A shot that uses that name is told to speak in that voice.
        </p>
      </div>
      <Field label="Character name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Mara"
          aria-label="Character name"
          className={controlClass}
        />
      </Field>
      <label className="flex h-11 cursor-pointer items-center justify-center rounded-md border border-dashed border-line text-sm text-stone">
        Choose a voice file
        <input
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void fileVoice(name, file).then(() => setName(""));
          }}
        />
      </label>
      {voices.length ? (
        <ul className="flex flex-col gap-3">
          {voices.map((voice) => (
            <li key={voice.id}>
              <p className="mb-1 text-sm">
                {voice.title} · @{voice.tag}
              </p>
              <VoiceClip id={voice.id} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-mist">No voices filed in this project yet.</p>
      )}
    </section>
  );
}
