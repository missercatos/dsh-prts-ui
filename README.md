# dsh-prts-ui

<p align="center">
  <img src="assets/prts.png" width="160" alt="PRTS logo">
</p>

<p align="center">
  <a href="https://github.com/missercatos/dsh-prts-ui/releases"><img src="https://img.shields.io/badge/version-v0.9.1-7aa2f7?style=flat-square" alt="v0.9.1"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-9ece6a?style=flat-square" alt="MIT"></a>
  <a href="https://github.com/missercatos/dsh-prts-ui/releases"><img src="https://img.shields.io/badge/release-0.9.1-bb9af7?style=flat-square" alt="release"></a>
</p>

> [中文](./README.zh.md)

**v0.9.1** · PRTS is a **GUI shell for dsh (DeepSeek Harness)** — not a standalone app. It mirrors dsh's real state (workspaces, sessions, models, credentials, tools, plugins) over dsh's stable `/api` RPC + WebSocket protocol; PRTS adds only the look and the control surface. Because it depends on the stable `/api` contract, dsh upgrades do not break it.

Version 0.6.x is fixed and tested against the **current dsh core (v4-generation wire: `session.list`→`items`, `/api/events.mux` as a WebSocket)**.

## Features (mirroring dsh's capabilities)

- **Workspaces**: sidebar list, create/delete, header crumb switcher; workspace selector chips in the sidebar and above the welcome-screen composer (switch/add) — adding a workspace opens the OS file manager first (Electron-native dialog on Windows/Linux/macOS), with a typed-path fallback
- **Sessions**: new, archive, **session search** (local filter + dsh `session.search`), **bulk archive** (select mode + select-all, combines with search)
- **Mode**: dsh's own agent presets. Blank sessions switch directly; **started sessions are preset-locked** (dsh constraint) — switching offers a new session with that preset
- **Model**: provider → model picker (live `session.models`)
- **Reasoning level**: per-model reasoning efforts via `session.selectModel` `reasoningEffort`
- **Permission level**: permission presets from the session projection (applied via the `/permission` command)
- **File transfer**: attach images (PNG/JPEG/WebP/GIF) to messages; history images resolve via `session.attachment`
- **Approvals & questions**: `approval/requested` / `question/requested` cards with allow/reject/answer
- **Context meter**: live context-window pressure ring next to the composer
- **Bottom stats dock**: the same live stats line as the session UI — turns · steps | LLM · tool time | avg TTFT · tok/s | cache hit % | in/out tokens (projection frames + 8 s poll)
- **Voice input**: real microphone speech-to-text — first-use consent modal, VAD auto start/stop, local whisper-tiny ONNX engine (engine + model cached from npmmirror / hf-mirror on first use, fully offline after; webkitSpeechRecognition preferred when present)
- **Trajectory & log split**: the Trajectory tab is a step timeline (grouped by turn/step with durations); the Session log button downloads the dsh-web-style ZIP archive (`/api/session.export`) and falls back to a raw-event overlay with JSON export
- **Welcome-screen selectors**: above the initial input area, dsh-web style — a folder chip (workspace switch/add), mode (standard / PTC / minimal / creative…), model and reasoning chips; selectable before any session is open
- Plus: three-phase particle intro (welcome → PRTS·DEEPSEEK banner → diamond mark, 3.2 s each) that doubles as the loading animation — it loops while dsh is still booting, a click before readiness shows the "not ready" hint, and once ready the three scenes play out and auto-enter (or click to enter); system panel (hardware telemetry), cost panel, plugin market, zh/en UI, light/dark theme

## Compatibility fixes in 0.2.0

- Mux transport is now **WebSocket-first** (current builds answer plain GET with `upgrade required`), SSE fallback kept
- `session.list` `items` shape, titles from `projections.values.title`
- `session.history` `{events:[{event,view}]}` shape + paged back-read (`beforeSeq`/`maxMessages`) so huge sessions open instantly
- Streaming via `assistant/chunk` (`reasoning-delta`/`text-delta`/`tool-call-delta`/`usage`/`finish`)
- The command directory comes from the `commands/list` RPC (the dsh web source — includes plugin-extended commands), with a local fallback from the session's `command/run` history + built-ins for older builds
- `session.search` degrades to a local title filter when the deployment disables the index
- `window.prompt()`/`window.confirm()` replaced with PRTS-styled modals (Electron disables `prompt()` — this was the "buttons do nothing" bug)
- Approval/question answers wrapped correctly as `{ok:true,value:{...}}`
- Header popovers open downward when the trigger is near the top edge
- Dead controls wired: sidebar collapse (a floating expand chip reappears when collapsed), chat/trajectory tabs, session log, context meter
- Settings "Model configuration" collapse fixed (`[hidden]{display:none!important}` — CSS display was overriding the attribute; same fix for the attach strip and status row)
- Streaming renders are batched per animation frame + throttled to 90 ms (a 9 s live turn rewrites the DOM ~16 times instead of once per chunk); history reloads cooldown 30 s
- **Window-first boot**: launching PRTS without dsh web running no longer errors/hangs — the window opens immediately, the particle intro is the loading screen, and dsh web boots silently in the background (Windows `.cmd` shims supported); when PRTS closes, the dsh web it spawned is killed (pidfile + fallback pid, cross-platform)
- The Electron mux relay probes with plain HTTP before ever opening its WebSocket against the backend (a failed WS connect inside the Electron main process wedges its message loop) — probes keep running until dsh answers, then the relay connects and re-probes after drops
- Settings collapse animates (grid-row 0fr→1fr) instead of jumping
- The Electron renderer is served over a loopback-only HTTP server (random 127.0.0.1 port) so the speech engine's wasm import()/worker loading works; the dsh API still rides the preload bridge — no window, no exposure
- Streaming state no longer sticks on "stop" after a mux drop

## Install (one click, CN-network friendly)

Every network step falls back to npmmirror (npm registry + Electron mirror); GitHub access is never required.

| Platform | Installer |
| --- | --- |
| Windows | `PRTS-Setup-<ver>-windows-x64.exe` (self-extracting, double-click) or `install.bat` |
| Linux | `PRTS-<ver>-linux-x64.run` (self-extracting) or `sh install.sh` |
| macOS | `PRTS-<ver>-macos.sh` or `sh install.sh` |
| Android | Termux: `sh install-android.sh` (dsh web + PRTS in the browser); or install the website as a PWA |

The installer: checks Node → installs dsh (if missing) → installs the plugins listed in `prts.config.json` → builds/reuses the `dsh-prts-ui` tarball → installs it into the `prts` profile → pins the bundle → creates desktop/menu shortcuts → puts `prts` on PATH.

```sh
prts                        # open the PRTS window immediately (particle intro = loading;
                            # dsh web:3080 boots/reuses silently in the background;
                            # closing the window kills the dsh web it spawned)
dsh --profile prts          # equivalent
dsh --profile prts --lang zh
dsh --profile web --shortcut   # refresh desktop shortcuts
```

**Config**: first install provisions `~/.dsh/profiles/prts/prts.config.json` (template: `prts.config.example.json`) — npm/Electron mirrors, plugin list, release URL. Updates preserve it.

**Update**: `sh update.sh` (Windows: `update.bat`) downloads the latest release from `releaseBase` (`releases.json`), falls back to a local rebuild, and updates dsh + plugins.

**Remove**:

```sh
dsh plugin --profile prts remove dsh-prts-ui
rm -f ~/Desktop/dsh-prts.desktop ~/.local/share/applications/dsh-prts.desktop
rm -rf ~/.config/prts ~/.dsh/profiles/prts
```

## Plugin form on a running dsh (`/prts`)

The GUI is a plugin. Besides the profile install above, it can mount as a **dynamic Cordis plugin** on a live dsh: the Host half registers the `/prts` route (this repo's `plugin/host.js` + `plugin/client.js`; running in this session as plugin `prts-1`). Open `http://127.0.0.1:3080/prts/` — the full PRTS UI on the same origin, same sessions, same agent.

## Packaging & website

```sh
sh scripts/make-dist.sh     # dist/: tgz + .run + .sh + .exe + .zip + SHA256SUMS + releases.json
```

- The Windows exe is a mingw-w64 self-extracting stub (`dist-tools/sfx.c`) with the payload zip appended — buildable on Linux. Without mingw it falls back to the zip + `build-exe.bat` (Windows IExpress).
- The site lives in `docs/`: particle-text zh/en intro ("Welcome to PRTS / This is the dsh-prts official site" …) + four platform download buttons + PWA (installable on Android). See `docs/README.txt`.

## Development & self-tests

```sh
pnpm install && pnpm bundle      # regenerate web/index.html from src/ + web/src
node test/live-transport.mjs     # full /api + mux verification against a live dsh
node test/cdp-drive.mjs          # CDP state/console/screenshot of the window
node test/cdp-audit.mjs          # per-control hit-testing (clickability audit)
node test/cdp-interact.mjs       # functional interactions (session/search/popovers/send/stop)
```

## Environment variables

| Variable | Meaning |
| --- | --- |
| `PRTS_DSH_URL` | dsh web backend URL (default `http://127.0.0.1:3080`) |
| `PRTS_ELECTRON` | preinstalled Electron binary path |
| `PRTS_ELECTRON_CACHE` | Electron cache dir (default `~/.cache/prts/electron`) |
| `ELECTRON_MIRROR` | Electron download mirror (installers default to npmmirror) |
| `DSH_PRTS_NO_SHORTCUT` | `1` disables shortcut installation |
| `DSH_PRTS_DESKTOP` | desktop dir for shortcuts (tests) |
| `DSH_HOME` | dsh home (default `~/.dsh`) |

## License

MIT — see [LICENSE](./LICENSE).
