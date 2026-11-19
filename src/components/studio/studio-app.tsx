import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChatPane } from "@/components/studio/chat-pane";
import { CutPane } from "@/components/studio/cut-pane";
import { LibraryPane } from "@/components/studio/library-pane";
import { SettingsPane } from "@/components/studio/settings-pane";
import { StagePane } from "@/components/studio/stage-pane";
import { markSpoken, playSpeech, spokenId, voiceEnabled } from "@/components/studio/speech";
import { Btn, Select, controlClass } from "@/components/studio/ui";
import { useStudio } from "@/lib/studio/store";

export function StudioApp() {
  const ready = useStudio((state) => state.ready);
  const load = useStudio((state) => state.load);
  const projects = useStudio((state) => state.projects);
  const activeProjectId = useStudio((state) => state.activeProjectId);
  const selectProject = useStudio((state) => state.selectProject);
  const createProject = useStudio((state) => state.createProject);
  const pane = useStudio((state) => state.pane);
  const setPane = useStudio((state) => state.setPane);
  const error = useStudio((state) => state.error);
  const notice = useStudio((state) => state.notice);
  const chats = useStudio((state) => state.chats);
  const [title, setTitle] = useState("");
  const [cutFocus, setCutFocus] = useState(false);
  const wide = cutFocus && pane === "cut";
  const heard = useRef(false);
  const latest = [...chats].reverse().find((message) => message.role === "assistant");

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!latest) return;
    if (!heard.current) {
      heard.current = true;
      markSpoken(latest.id);
      return;
    }
    if (!voiceEnabled() || spokenId() === latest.id) return;
    markSpoken(latest.id);
    void playSpeech(latest.content).catch(() => undefined);
  }, [latest]);

  return (
    <div className="flex h-dvh min-h-dvh flex-col bg-bg text-bone">
      <header className={`flex flex-col gap-3 border-b border-line px-4 py-3 md:flex-row md:items-end md:justify-between ${wide ? "hidden" : ""}`}>
        <div>
          <h1 className="font-display text-3xl leading-none tracking-tight">Movie Studio</h1>
          <p className="mt-1 text-sm text-stone">
            Projects hold the canon. The stage renders against it. The cut assembles it.{" "}
            <Link to="/" className="text-bone underline-offset-4 hover:underline">
              Comfy Desk
            </Link>
          </p>
        </div>
        <form
          className="flex min-w-0 flex-1 gap-2 md:max-w-md"
          onSubmit={(event) => {
            event.preventDefault();
            void createProject(title);
            setTitle("");
          }}
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New project title"
            aria-label="New project title"
            className={`${controlClass} min-w-0`}
          />
          <Btn type="submit" tone="solid" className="shrink-0">
            Create project
          </Btn>
        </form>
        <Select
          aria-label="Open project"
          value={activeProjectId ?? ""}
          onChange={(event) => void selectProject(event.target.value || null)}
          className="md:max-w-52"
        >
            <option value="">Free generation</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </Select>
      </header>
      {error || notice ? (
        <p role="status" className={`px-4 py-2 text-sm ${error ? "text-danger" : "text-stone"}`}>
          {error || notice}
        </p>
      ) : null}
      <nav className={`hidden gap-2 border-b border-line px-4 py-2 md:flex ${wide ? "md:hidden" : ""}`}>
        <Btn tone={pane === "cut" ? "quiet" : pane === "settings" ? "quiet" : "solid"} onClick={() => setPane("stage")}>
          Stage
        </Btn>
        <Btn tone={pane === "cut" ? "solid" : "quiet"} onClick={() => setPane("cut")}>
          Movie
        </Btn>
        <Btn tone={pane === "settings" ? "solid" : "quiet"} onClick={() => setPane("settings")}>
          Settings
        </Btn>
      </nav>
      <nav className={`flex border-b border-line md:hidden ${wide ? "hidden" : ""}`}>
        {(
          [
            ["library", "Library"],
            ["stage", "Stage"],
            ["cut", "Movie"],
            ["settings", "Settings"],
            ["chat", "Editor"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPane(id)}
            className={`h-11 flex-1 border-b-2 text-sm ${pane === id ? "border-bone text-bone" : "border-transparent text-mist"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={wide ? "flex min-h-0 flex-1 flex-col" : "grid min-h-0 flex-1 md:grid-cols-[18rem_minmax(0,1fr)_20rem]"}>
        <aside
          className={`${wide ? "hidden" : pane === "library" ? "flex" : "hidden"} ${wide ? "" : "md:flex"} min-h-0 flex-col border-line md:border-r`}
        >
          {ready ? <LibraryPane /> : <p className="p-4 text-sm text-stone">Opening the library…</p>}
        </aside>
        <main className={`${wide || pane === "stage" || pane === "cut" || pane === "settings" ? "block" : "hidden"} min-h-0 md:block ${wide ? "flex-1" : ""}`}>
          {pane === "cut" ? (
            <CutPane expanded={wide} onExpand={() => setCutFocus(true)} onMinimize={() => setCutFocus(false)} />
          ) : pane === "settings" ? (
            <SettingsPane />
          ) : (
            <StagePane />
          )}
        </main>
        <aside
          className={`${wide ? "hidden" : pane === "chat" ? "flex" : "hidden"} ${wide ? "" : "md:flex"} min-h-0 flex-col border-line md:border-l`}
        >
          <ChatPane />
        </aside>
      </div>
    </div>
  );
}
