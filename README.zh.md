# dsh-prts-ui

PRTS 是 **dsh 的 GUI 外壳**，不是独立 agent。它启动 dsh 的 web 后端、在其上打开窗口，并通过 dsh 的 `/api` RPC + WebSocket 协议镜像 dsh 的真实状态：工作区、会话、模型、凭证、工具、插件都来自 dsh。PRTS 额外提供的只是外观：单色界面、粒子开场、系统面板、语音输入。

因为 PRTS 只依赖 dsh 稳定的 `/api` 协议，dsh 升级不会让它失效。

- 基于 `dsh web` 的 GUI 窗口（无独立 TUI）。
- dsh 的工作区 + 会话（新建/切换/重命名/归档）、模型取自 `llm.models`。
- 粒子开场、系统面板（硬件遥测）、语音输入、社区插件按钮。

## 安装

**一键安装脚本**（推荐）：Linux/macOS 运行 `install.sh`，Windows 运行 `install.bat`（`build-exe.bat` 可用 Windows 自带的 IExpress 打包成 `PRTS-Setup.exe`）。脚本会检查 Node.js、**缺省时自动安装 dsh（已装则跳过）**、构建 tarball、把 PRTS 装进 `prts` profile、创建桌面与应用菜单快捷方式。

```sh
# Linux / macOS —— 在仓库目录下运行：
bash install.sh
# 或用现成 tarball：
bash install.sh ./dsh-prts-ui-0.1.0.tgz

# Windows —— 双击 install.bat（或 PRTS-Setup.exe）
```

手动安装：

```sh
# 一次性：构建 tarball
pnpm pack

# profile 侧 —— 把 dsh-prts-ui 装进 `prts` profile
dsh plugin --profile prts install ./dsh-prts-ui-0.1.0.tgz
```

启动：

```sh
dsh --profile prts            # 打开 PRTS 窗口（底层自动启动 dsh web）
dsh --profile prts --shortcut # 刷新桌面快捷方式
```

`prts` profile 是最小的（`bundles: ["dsh-prts-ui"]`）：runner 会以子进程方式启动 `dsh web` 作为后端，再在其上打开 PRTS 窗口，因此 PRTS 不依赖 dsh 的内部实现。

## 使用

```sh
dsh --profile prts                 # GUI 窗口（默认）
dsh --profile prts --lang zh       # 中文界面
dsh --profile prts --shortcut      # 安装桌面快捷方式
```

关于 agent 的一切 —— 会话、模型、凭证、工具、插件、设置 —— 都是 dsh 的，按 dsh 的方式管理。PRTS 窗口只是镜像：侧栏列出 dsh 的**工作区**与**会话**，输入框把消息发给 dsh agent，模型芯片显示 dsh 的模型目录。会话按 dsh 语义"归档"（`workspace.archiveSession`），工作区按 dsh 语义"删除"（`workspace.delete`）。

### 在终端里用 `prts` 启动

安装插件后，加一行别名即可让输入 `prts` 打开 GUI：

```sh
# 写入 ~/.bashrc（或 ~/.zshrc），然后 source ~/.bashrc
alias prts='/home/a/.dsh/profiles/prts/node_modules/dsh-prts-ui/bin/dsh-prts-ui.js'

prts                  # 打开 PRTS 窗口（底层自动启动 dsh web）
prts --shortcut       # 刷新桌面快捷方式
```

若以全局方式安装（`npm i -g dsh-prts-ui`），`prts` 命令已在 PATH 上，用法相同。

### 桌面快捷方式

桌面启动器按需创建（postinstall 也会尽力自动刷新一次）：

```sh
dsh --profile prts --shortcut
```

Linux 会写入**两个**条目：`~/Desktop/dsh-prts.desktop`（桌面图标）与 `~/.local/share/applications/dsh-prts.desktop`（应用菜单），都指向 `dsh --profile prts`，`Icon=` 指向包内 `assets/prts.png`。macOS 生成 `~/Desktop/PRTS.command`。**Windows** 会写入桌面 `PRTS.lnk`（带 PRTS `.ico` 图标）**和**开始菜单（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\PRTS.lnk`），通过 `wscript` 无控制台窗口启动。

**关于 Windows 任务栏（"启动坞"）：** Windows 从设计上不允许应用自行固定到任务栏 —— 这始终是用户操作。因此 PRTS 不会自动出现在任务栏，而是通过开始菜单条目固定：开始菜单 → 右键 **PRTS** → **固定到任务栏**。

**KDE Plasma 说明：** 请确认桌面文件夹与 `XDG_DESKTOP_DIR` 一致（默认 `~/Desktop`）—— 如果系统语言把桌面目录本地化（如 `~/桌面`），Plasma 不会监视 `~/Desktop`。首次看到桌面图标时，右键 → **允许启动 (Allow Launching)**。要固定到启动坞/任务栏：打开应用启动器找到 **PRTS**，右键 → **固定到任务管理器**（应用菜单条目正是启动坞需要的）。

只创建一个启动器（用标记文件防重复）；删除 `~/.config/prts/.shortcut-done` 可再次创建，或用 `DSH_PRTS_DESKTOP` 指定其它目录（CI 用）。

### 更新

**一键更新**（推荐）：

```sh
bash update.sh        # Linux / macOS —— 在仓库目录下运行
update.bat            # Windows
# 或直接指向新版 tarball：
bash update.sh ./dsh-prts-ui-<新版本>.tgz
```

脚本会自动重建 tarball、在 `prts` profile 内更新插件、刷新桌面与应用菜单快捷方式。手动方式等价于：

```sh
pnpm bundle && pnpm pack
dsh plugin --profile prts install ./dsh-prts-ui-<新版本>.tgz
rm -f ~/.config/prts/.shortcut-done
dsh --profile prts --shortcut
```

更新 dsh 框架本身：`npm i -g @deepseek-ai/dsh@latest`。

### 卸载 PRTS

```sh
# 从 prts profile 移除插件（转发给 pnpm remove）
dsh plugin --profile prts remove dsh-prts-ui

# 清理快捷方式、配置与 profile
rm -f ~/Desktop/dsh-prts.desktop ~/.local/share/applications/dsh-prts.desktop
rm -rf ~/.config/prts ~/.dsh/profiles/prts
# macOS / Windows 请改为删除对应的 PRTS.command / .lnk
```

### 数据存在哪里

PRTS **只保存自己的窗口外观**（主题、语言）在 `~/.dsh/profiles/prts/prts-ui.json`（dsh 主目录下的 prts profile 目录里 —— 删除 profile 时一并移除）。与 agent 相关的一切 —— 工作区、会话、历史、模型、凭证、API Key、工具、插件 —— 都存在 **dsh**（`~/.dsh/`）里，因为 PRTS 只是 dsh 的 GUI。在 PRTS 里删除工作区或归档会话，执行的就是对应的 dsh 操作（`workspace.delete` / `workspace.archiveSession`）。

### 设置 → 提供商与 API Key

设置面板会列出 dsh 的提供商（`llm.providers`），并为每个提供商提供输入 API Key 的字段。保存时调用 dsh 的 `credentials.set`，把 Key 写入 dsh 主目录（`~/.dsh/.credentials.yaml`）—— 与 dsh 运行时所读的是同一个存储，因此该 Key 对 dsh 的所有界面都生效，而不仅限于 PRTS；本插件绝不保存它。

### 模型、指令与 `/` 面板

- **模型**：模型芯片采用"先选厂家"流程 —— 选厂家 → 若未配 Key 则先填写 → 再选该厂家的模型（全部来自 `llm.models`），通过 `session.selectModel` 选择；对话框下方的模型按钮同样可切换。
- **指令**：Commands 按钮列出 dsh 已装指令（`commands.list`），例如安装了 givemyflag 就会显示 `/givemyflag`。点击后把 `/名称 ` 填入输入框。
- **`/` 识别**：输入框首个字符为 `/` 时，实时匹配 dsh 指令并弹出补全下拉；Enter/Tab 补全指令名，提交后由 dsh 在宿主侧解析并执行（`session.prompt` 识别斜杠指令）。

### 平台支持

PRTS 在 **Linux、macOS、Windows** 上行为一致：相同界面、配置布局、按项目历史、语音输入与系统面板，桌面快捷方式分别生成各平台原生启动器（`.desktop` / `.command` / `.lnk`）。Electron 固定 `43.4.0`，首次启动按平台下载。需要说明：本项目在 **Linux** 上开发并实测；macOS/Windows 路径已实现但未在 CI 中验证，正式使用前请以实际平台为准。

### 环境变量

| 变量 | 含义 |
| --- | --- |
| `PRTS_ELECTRON` | 预先安装好的 Electron 二进制路径（跳过下载） |
| `PRTS_ELECTRON_CACHE` | 覆盖 Electron 缓存目录（默认 `~/.cache/prts/electron`） |
| `DSH_PRTS_DESKTOP` | `--shortcut` 的桌面目录（测试用） |
| `DSH_PRTS_NO_SHORTCUT` | 设为 `1` 禁用快捷方式安装（CI 用） |
| `DSH_PRTS_PROFILE` | 写入快捷方式的 profile 名（默认 `prts`） |
| `DSH_PRTS_DEBUG` | 输出详细的启动调试信息 |

## GUI

GUI 是单文件 Web 应用（`web/index.html`，由 `scripts/bundle-gui.mjs` 打包），由 `electron/main.cjs` 加载。渲染进程通过 `window.prts.bridge` 与主进程通信：`prts:systemInfo`（硬件遥测）与 `prts.dsh`（dsh 的 RPC + mux 中继）—— 主进程用 Node 直接请求 dsh 的 `/api` HTTP 与 `/api/events.mux` WebSocket，渲染进程因此不受 CORS 限制。窗口加载的是 PRTS 自己的外观，背后的 agent 是 dsh。

Electron 不打进插件里：首次启动 GUI 时会下载固定版本（优先 GitHub Releases，npmmirror 兜底）并缓存到 `~/.cache/prts/electron/v43.4.0`。设置 `PRTS_ELECTRON` 指向系统 Electron 可跳过下载。

### 语音输入

composer 右下角的麦克风按钮可开关语音输入。开启后应用采集麦克风、做语音活动检测，并在检测到持续人声时自动启动语音识别（静音自动结束）。聆听期间 PRTS 品牌标志会依据麦克风电平和频谱实时显示线条波纹。语音识别使用平台 `SpeechRecognition` API；社区插件可覆盖识别引擎。

### 系统面板

点击左上角 PRTS 品牌标志打开系统面板。左侧：一个缓慢旋转的组合圆 —— 少量加长圆润的弧形段，各圈相位错开互不对齐，鹰角扁平风格。右侧：fastfetch/btop 风格遥测，放在同一空间内用发丝线划分 —— 硬件（系统、主机、CPU、负载、GPU、内存、交换、存储、CPU 功耗、各温度）与智能体（模型、模式、已用/剩余 Token、会话、消息）。动态指标（内存/交换/存储占比、CPU 负载与功耗、温度、Token 用量）以 30fps 平滑趋近目标，数字与进度条如流水般实时滚动，每 1.5s 通过 `prts:systemInfo` 刷新一次。

粒子开场持续更久（约 12 秒，可点击跳过），全程复用同一批粒子 —— 散乱的点阵重组为带字距的 **welcome to / PRTS** 字标，再依次变形为 **PRTS · DEEPSEEK** 横幅、方形菱形标志（不散开、不淡出），每个阶段按现代浏览器宽高比居中显示。

### 输入框

输入框无边框 —— 只有白色光标标示输入区。**Enter 发送，Shift+Enter 换行**，输入框保持固定高度、支持滑轮滚动（当前行始终钉在底部）。上方有一个淡色的鹰角风开关 —— 一个缺口的朝上三角与三颗流动小圆点 —— 点击可将输入框向上展开到高度上限，且不会移动 PRTS 标志的位置。

### 社区插件按钮

PRTS 是 dsh 框架的 UI，因此保留了 dsh 的可扩展性。插件通过共享命名空间注册按钮；没有插件注册时不会渲染任何额外按钮，所以默认安装无多余控件。

```js
PRTS.plugins.register({
  id: 'my-plugin',
  area: 'composer',          // 'composer' | 'header'
  order: 10,
  icon: '<svg ...></svg>',   // 内联 SVG，使用 currentColor
  label: 'Vision',
  onClick(ctx) { /* ctx = { app, config, store, chat } */ },
})
```

宿主可在启动前设置 `window.PRTS_PLUGINS` 为数组来预置插件，启动时会逐个采纳。语音识别引擎可用 `area: 'asr'` 加 `engine` 对象（提供 `start`/`stop`/`setLang`）覆盖。完整约定见 `src/gui/plugins.js`。

### 品牌标志

桌面启动器与 Electron 窗口使用 `assets/prts.png` —— 透明背景的方形菱形：纯白菱形描边、四角斜体 **P · R / T · S**、中央小号斜体 **PRTS** 字样及其下方装饰线，鹰角/迎角网络线条风格。源文件为 `assets/prts.svg`。

## 开发

```sh
pnpm install
pnpm bundle        # 由 src/gui + src/core + web/src 重新生成 web/index.html
pnpm pack:ui       # bundle 并打包 profile tarball
```

不依赖真实 dsh 即可验证 GUI 与 `/api` + mux 协议：运行 `node /tmp/opencode/mock-dsh.mjs`，把 Electron 窗口指向 `http://127.0.0.1:3085`。

## 打包

`pnpm pack` 生成 `dsh-prts-ui-0.1.0.tgz`（src、web bundle、electron 主进程、scripts、`cordis.patch.yml`）。`postinstall` 脚本会在 GUI bundle 缺失时重建，并安装桌面快捷方式（尽力而为，绝不影响安装本身）。

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。
