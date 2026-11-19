import { useEffect, useRef, useState } from "react";
import { Camera, Pause, Play, Square } from "lucide-react";
import { Btn } from "@/components/studio/ui";
import { grabFrame } from "@/lib/studio/media";
import { formatTime } from "@/lib/studio/prompt";

export function MotionPlayer({
  shots,
  onSnapshot,
  voiceUrl,
}: {
  shots: { url: string; duration: number; label: string }[];
  onSnapshot: (blob: Blob, at: number) => void;
  voiceUrl?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const pending = useRef<number | null>(null);
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [measured, setMeasured] = useState<number[]>([]);
  const [global, setGlobal] = useState(0);
  const [snapError, setSnapError] = useState("");
  const token = shots.map((shot) => shot.url).join("|");

  const durationOf = (i: number) => measured[i] || shots[i]?.duration || 0;
  const total = shots.reduce((sum, _, i) => sum + (durationOf(i) || 0.01), 0);

  useEffect(() => {
    const video = videoRef.current;
    const shot = shotsRef.current[index];
    if (!video || !shot) return;
    const apply = () => {
      if (pending.current != null) {
        video.currentTime = pending.current;
        pending.current = null;
      }
    };
    if (video.dataset.shot !== shot.url) {
      video.dataset.shot = shot.url;
      video.src = shot.url;
      video.addEventListener("loadeddata", apply, { once: true });
    } else {
      apply();
    }
  }, [index, token]);

  useEffect(() => {
    const video = videoRef.current;
    const voice = voiceRef.current;
    if (!video) return;
    if (playing) {
      if (voice && voiceUrl) {
        voice.currentTime = video.currentTime || 0;
        void voice.play().catch(() => undefined);
      }
      void video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
      voice?.pause();
    }
  }, [playing, index, voiceUrl]);

  function seek(seconds: number) {
    const list = shotsRef.current;
    let acc = 0;
    for (let i = 0; i < list.length; i += 1) {
      const span = durationOf(i) || 0.01;
      if (seconds <= acc + span || i === list.length - 1) {
        const local = Math.max(0, Math.min(Math.max(span - 0.04, 0), seconds - acc));
        const video = videoRef.current;
        pending.current = local;
        if (video && i === index && video.dataset.shot === list[i]?.url) {
          video.currentTime = local;
          pending.current = null;
        }
        setIndex(i);
        setGlobal(seconds);
        return;
      }
      acc += span;
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-ink">
      <video
        ref={videoRef}
        className="aspect-video w-full bg-bg object-contain"
        playsInline
        onLoadedMetadata={(event) => {
          const next = [...measured];
          next[index] = event.currentTarget.duration || shots[index]?.duration || 0;
          setMeasured(next);
        }}
        onTimeUpdate={(event) => {
          let acc = 0;
          for (let i = 0; i < index; i += 1) acc += durationOf(i) || 0.01;
          setGlobal(acc + event.currentTarget.currentTime);
        }}
        onEnded={() => {
          voiceRef.current?.pause();
          if (index < shots.length - 1) setIndex(index + 1);
          else setPlaying(false);
        }}
      />
      {voiceUrl ? <audio ref={voiceRef} src={voiceUrl} preload="auto" /> : null}
      <div className="flex flex-col gap-3 p-3">
        <input
          aria-label="Timeline"
          type="range"
          min={0}
          max={Math.max(total, 0.1)}
          step={0.05}
          value={Math.min(global, total)}
          onChange={(event) => {
            setPlaying(false);
            seek(Number(event.target.value));
          }}
          className="w-full accent-bone"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Play"}
          </Btn>
          <Btn
            aria-label="Stop"
            onClick={() => {
              setPlaying(false);
              seek(0);
            }}
          >
            <Square className="size-4" />
            Stop
          </Btn>
          <Btn
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              setPlaying(false);
              seek(Math.max(0, total - 0.08));
              window.setTimeout(() => {
                if (videoRef.current) videoRef.current.pause();
              }, 80);
            }}
          >
            End frame
          </Btn>
          <Btn
            tone="solid"
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              setPlaying(false);
              video.pause();
              void grabFrame(video)
                .then((blob) => {
                  setSnapError("");
                  onSnapshot(blob, global);
                })
                .catch((error: unknown) => {
                  setSnapError(error instanceof Error ? error.message : "Could not snapshot.");
                });
            }}
          >
            <Camera className="size-4" />
            Snapshot
          </Btn>
          <span className="ml-auto text-sm tabular-nums text-stone">
            {formatTime(global)} / {formatTime(total)}
            {shots[index]?.label ? ` · ${shots[index].label}` : ""}
          </span>
        </div>
        {snapError ? <p className="text-sm text-danger">{snapError}</p> : null}
      </div>
    </div>
  );
}
