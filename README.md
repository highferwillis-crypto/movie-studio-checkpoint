# Movie Studio — checkpoint

This repository is the checkpoint modification. Choose any checkpoint model and render stills to the studio’s prompt, aspect, batch, and steps. The original studio stays at [movie-studio](https://github.com/highferwillis-crypto/movie-studio).

A project desk for a film. One project holds the library. The stage renders stills and shots against that library. The cut assembles them. The editor talks from the open project’s names and tags.

Open source under the MIT license.

## What it does

- Projects, folders, and your own uploads. Name a file and add comma-separated tags before it is stored.
- Stills in a batch of 1 to 10. Nothing is filed until you keep it.
- Shots with aspect, resolution, and length. Kept shots stack on a reel.
- Absolute is optional. On, a render follows each filed picture by its name and tags. Off, it uses only the line you write.
- Cut: upload or pull from the project, hold a still, trim a video, and play the assembly. Expand fills the screen.
- Comfy Desk, on the front page, edits Flux and Wan graphs and exports a ComfyUI workflow.

Pictures and shots stay in the browser (IndexedDB). Generation calls the xAI API from the server unless you change Settings. Set `XAI_API_KEY` in the environment for the built-in engine. Do not commit that key.

In Settings you can point stills at another image API (`POST /v1/images/generations`) or choose an image checkpoint and a video checkpoint. The studio prompt, aspect, batch, length, and laptop steps drive that render. The file names are what the local server loads.

## Install

Requires [Node.js 22](https://nodejs.org/).

Directly from this GitHub address:

```bash
git clone https://github.com/highferwillis-crypto/movie-studio-checkpoint.git
cd movie-studio-checkpoint
npm install
npm run dev
```

Windows PowerShell often blocks `npm`. The clone still works. From the project folder, run the `.cmd` program instead:

```powershell
cd $HOME\movie-studio-checkpoint
npm.cmd install
npm.cmd run dev
```

Do not clone into `C:\WINDOWS\system32`. Clone into your user folder. If PowerShell still stops at `npm.ps1`, this one-time command allows your own scripts, then use `npm` as usual:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Or download the zip from the green **Code** button, unzip it, then run `npm install` and `npm run dev` in that folder.

The app serves on port 8080.

- Studio: [http://127.0.0.1:8080/studio](http://127.0.0.1:8080/studio)
- Comfy Desk: [http://127.0.0.1:8080/](http://127.0.0.1:8080/)

### Built-in stills and shots

The built-in engine needs an xAI key. Do not commit the key.

```bash
export XAI_API_KEY=your_key
npm run dev
```

Windows PowerShell:

```powershell
$env:XAI_API_KEY="your_key"
npm run dev
```

Windows Command Prompt:

```bat
set XAI_API_KEY=your_key
npm run dev
```

### Checkpoint stills

No key is required for this path.

1. Start the local model server on this machine at `http://127.0.0.1:8188`, with cross-origin access open. It has to be able to load both files.
2. Open the studio and go to **Settings**.
3. Choose **Checkpoint**.
4. Choose an image checkpoint and a video checkpoint from this computer, a jump drive, or an external drive.
5. On the stage, **Stills** uses the image file. A shot uses the video file.

The open project supplies the prompt. Aspect, batch, length, and the laptop steps set the render. Efficient caps a shot at 17 frames, Balanced at 33, Full at 81.

### Character voices

On the stage, **Voice sampler** records a sample or uploads one you already have. Name it as the character. The file is stored in that project’s Voices folder, and the name is the tag. A shot that uses the name is told to speak in that voice. The audio file is not sent to the video model as a cloned voice.

### Another image API

In **Settings**, choose **API server**. Set the address, the model, and the key. The server must accept `POST /images/generations` with a bearer key, a prompt, `n`, and `size`. The key stays in this browser. It is not written into the settings file.
