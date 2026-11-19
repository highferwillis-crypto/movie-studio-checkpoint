import { useEffect, useRef, useState } from "react";
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
  const [recording, setRecording] = useState(false);
  const [micError, setMicError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const voices = assets.filter((asset) => asset.projectId === projectId && asset.kind === "voice");

  useEffect(() => {
    return () => {
      const media = recorder.current;
      if (media && media.state !== "inactive") media.stop();
    };
  }, []);

  if (!projectId) return null;

  async function start() {
    if (!name.trim()) {
      setMicError("Name the character before you record.");
      return;
    }
    setMicError("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (!stream) {
      setMicError("The microphone was not available.");
      return;
    }
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    const character = name.trim();
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const type = media.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      const file = new File([blob], `${character}.webm`, { type });
      void fileVoice(character, file);
      setName("");
      setRecording(false);
    };
    recorder.current = media;
    media.start();
    setRecording(true);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-3">
      <div>
        <h2 className="text-sm text-bone">Voice sampler</h2>
        <p className="mt-1 text-xs text-mist">
          Record a sample, or upload one you already have. Either way it is filed in this project’s Voices folder under the character’s name.
        </p>
      </div>
      <Field label="Character name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Mara"
          aria-label="Character name"
          className={controlClass}
          disabled={recording}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <Btn tone="solid" onClick={() => recorder.current?.stop()}>
            Stop and file
          </Btn>
        ) : (
          <Btn tone="solid" onClick={() => void start()}>
            Record
          </Btn>
        )}
        <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-md border border-dashed border-line px-4 text-sm text-stone">
          Upload a voice file
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
            className="sr-only"
            disabled={recording}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void fileVoice(name, file).then(() => setName(""));
            }}
          />
        </label>
      </div>
      {micError ? <p className="text-xs text-danger">{micError}</p> : null}
      {recording ? <p className="text-xs text-stone">Recording {name.trim()}…</p> : null}
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
