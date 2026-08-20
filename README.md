# PRTS — a DeepSeek Harness (dsh) integration + skin

> **v0.0.1 (new) — full rework**: PRTS is no longer a plugin that rewrites the whole UI. It is now an **integration pack + skin**.

<p align="center">
  <img src="assets/prts.png" width="160" alt="PRTS mark">
</p>

PRTS sits on **DeepSeek Harness (dsh)** as its kernel and adds a skin that only changes visuals — never the core. The desktop integration pack handles "detect/install dsh → package installed plugins → one-click enter"; the skin plugin handles the beauty.

## 🔑 One rule: never touch the core

**The PRTS skin does strictly five things; everything else stays 100% native dsh:**

| # | Effect | How |
|---|---|---|
| ① | Entry animation | integration-pack splash particle acts (sped up), then enters dsh |
| ② | Top-left brand | whale wordmark visually overridden to a rhombus + PRTS (no icon swap) |
| ③ | Home hero copy | 「探索未至之境」→「欢迎回归，博士」(copy & fish-mark overlay) |
| ④ | System panel | a **separate new button** opens a standalone window (does not alter the “click logo → new session” behavior) |
| ⑤ | Overall theme | monochrome + particles + glowing rhombus + background shapes layer (rhombus / squares / white dots, above the wallpaper, below the dialogs) |

This keeps the red line: **input position untouched, deepseek icon untouched, and dsh's core conversation/settings/market logic completely unaffected.** dsh upgrades bring new abilities, never break PRTS.

## ✨ Highlights

- **Skin tech**: built on dsh's official client-plugin API — `theme.overrideTokens()` (monochrome tokens), `slots.register('sidebar.footer.action', …)` (system-panel button), and a CSS skin layer for the brand & hero copy. All via stable dsh interfaces; no source patching.
- **System panel**: a standalone frameless Electron window (`prts:openSystemPanel`), read-only telemetry/about; does not change main-window layout.
- **Integration pack**: the installer "detect/install dsh → export installed plugins from `~/.dsh` → assemble the desktop integration → create the desktop shortcut", entering a full DeepSeek Harness under the PRTS skin in one click.

## 🖥️ Platforms & installers

| Platform | Installer |
| --- | --- |
| Windows | `PRTS-Setup-<ver>-windows-x64.exe` (self-extracting one-click, the priority) |
| Linux | `PRTS-<ver>-<arch>.deb` |
| macOS | `PRTS-<ver>-macos.sh` |

Installer flow:
1. **check whether dsh is present**, install it if missing (mirror fallback for CN networks);
2. **auto-read installed plugins across `~/.dsh` profiles** and ship them as one integration pack;
3. create a desktop shortcut (`prts` command; icon = the `prts.png` rhombus).

## ▶️ Usage

```sh
prts                       # open the PRTS window (particle intro → PRTS-skin dsh web)
dsh --profile prts         # equivalent
dsh --profile prts --lang zh
prts --shortcut            # refresh the desktop shortcut
```

Config at `~/.dsh/profiles/prts/prts-ui.json`: `.persona.userName` controls the “欢迎回归，博士” greeting.

## 🛠️ Development

```sh
pnpm install && pnpm bundle      # regenerate web/index.html & lib/client.js from src/
node scripts/make-dist.sh        # build all dist/ installers (needs per-platform tooling)
```

Skin plugin core: `src/prts-client.js`. Electron shell: `electron/main.cjs` + `electron/preload.cjs`.
Website (kept): `docs/` (particle download site + mobile guide), static hosting only.

## 📄 License

MIT — see [LICENSE](./LICENSE).
