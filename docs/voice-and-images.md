# Voice and image generation

## Voice

Both directions sit behind swappable engines. The defaults are free and run in your browser; cloud engines are opt-in and their API keys stay in the OS keychain, never in the browser.

### Dictation (speech to text)

- Click the **microphone** in the composer, or press **Ctrl/Cmd+Shift+M** to start and stop.
- **Push-to-talk:** set a key combination in **Settings → Voice**, then hold it to dictate and release to stop.
- **Engines:**

| Engine | Needs | Notes |
|---|---|---|
| Browser (default) | A browser with the Web Speech API (Chrome, Edge) | Free |
| ElevenLabs | An ElevenLabs API key | Scribe transcription |
| OpenAI | An OpenAI API key (shared with OpenAI Images) | `gpt-4o-mini-transcribe` |

- **Language:** leave it on auto to follow the browser, or pick one.

Cloud dictation records in the browser and sends the audio to the CodeDen server, which forwards it to the provider with your key. The key never reaches the page.

### Read-aloud (text to speech)

When an agent's turn completes, CodeDen can read its final message aloud.

- Turn it on in **Settings → Voice → Read final messages aloud**. It's off by default.
- Code blocks and Markdown are stripped, and long messages are compressed to a sentence or two by the [utility model](workbench.md#the-utility-model) first.
- **Only when the tab isn't focused** keeps it quiet while you're looking.
- **Mute one session** from its **Details** tab.
- **Engines:** the browser's built-in voices (default, free) or ElevenLabs (pick a voice from your account).
- Quiet hours can be set with `voice.readAloud.quietHours` (`{ "start": "22:00", "end": "07:00" }`) in `settings.json`.

## Image generation

Every agent gets one `generate_image` tool, whatever its own provider can do. A Claude agent building a landing page can create its hero image; a PM can mock up an idea.

### Engines

| Engine | Needs | Default model |
|---|---|---|
| **Codex** | Your existing Codex login, no API key | your configured Codex model |
| **Gemini** | A Google AI API key | `gemini-nano-banana-2.1` |
| **OpenAI Images** | An OpenAI API key | `gpt-image-2` |

Choose in **Settings → Image generation**:

- **Engine:** `auto` (Codex when you're logged in, otherwise the first engine with a key), a specific engine, or `none` to hide the tool from agents. An engine you chose explicitly is never silently swapped for another.
- **Default size** (`1024x1024`) and **quality** (`auto`, `low`, `medium`, `high`).
- **Daily cap** across all projects (default 50; 0 turns generation off).
- **API keys** for Gemini and OpenAI, stored in the OS keychain.
- **Test the active engine:** generates one small image (it counts toward today's cap).

Per-project overrides (engine, size, quality and a project cap) live in `settings.json` under `imageGeneration.projects.<projectId>`.

If no engine is available, the tool is **hidden** from agents rather than failing when they call it.

### What the tool does

```text
generate_image({
  prompt: "A warm, minimal hero illustration of a cosy reading nook",
  aspectRatio: "16:9",          // or size: "1536x1024"
  count: 1,
  referenceImages: [...],       // optional, for edits and variations
  outputPath: "public/hero.png" // inside the worktree; default generated-images/
})
```

- Agents write into **their worktree** (default `generated-images/`). Paths outside it, inside `.git`, or through a symlink that escapes are refused. The orchestrator and PMs write to `~/.codeden/generated/<session>/`.
- File extensions follow the actual image bytes (`hero.png`, `hero-2.png`, ...).
- Every image is also saved as an **artifact** and shown inline in the chat (pass `share: false` to skip that).
- Images are reserved against the daily caps before the engine runs and released if it fails.

### Codex engine notes

- It runs a short, tool-restricted Codex turn under your own login: no MCP servers, plugins or web search, a read-only sandbox, no approvals. Codex returns the image and CodeDen writes the file itself.
- Expect roughly 20 to 40 seconds for one image.
- Sizes are approximate: "square" comes back around 1254x1254, landscape 1536x1024, portrait 1024x1536.
- Codex keeps its own copy of each image under `~/.codex/generated_images/`; CodeDen removes those copies.
- Usage-limit errors are reported with the time the limit resets.
