# dsh-prts-ui

PRTS —— 一个**运行在 dsh 框架上**、以 profile 插件形式挂载的单色 DeepSeek 聊天客户端。`dsh` 是启动框架：负责挂载 profile 树、解析参数并把进程生命周期交给应用。

- 纯黑白界面，粒子开场特效（散开 → 欢迎 → 横幅 → 标志）。
- 一条命令两种形态：终端客户端（`--tui`）与 Electron 窗口（默认）。
- 按项目保存聊天历史、`zh`/`en` 双语言、deepseek-chat 与 deepseek-reasoner 模型、思考强度预设。
- 以 `.tgz` profile 包发布：可通过 `dsh plugin` 安装，内置桌面快捷方式与 postinstall 逻辑。

## 安装

**一键安装脚本**（推荐）：Linux/macOS 运行 `install.sh`，Windows 运行 `install.bat`（`build-exe.bat` 可用 Windows 自带的 IExpress 把它打包成 `PRTS-Setup.exe`）。脚本会检查 Node.js、缺省时安装 dsh 框架、构建 tarball、把插件装进 `prts` profile、创建桌面与应用菜单快捷方式，并把 `prts` 命令加入 PATH。

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

然后任选一种方式启动：

```sh
dsh --profile prts            # GUI 窗口
dsh --profile prts --tui      # 终端客户端
```

profile（`~/.dsh/profiles/prts/`）使用**最小 bundle** —— 只含 `dsh-prts-ui`，不引入 `@deepseek-ai/dsh-base`：

```json
{
  "dsh": { "profile": { "bundles": ["dsh-prts-ui"] } }
}
```

PRTS 是自包含的叶子客户端（通过 `fetch` 直连 DeepSeek API，自带存储与历史记录），不需要 `dsh-base` 挂载的 agent 壳、沙箱或宿主服务。保持树最小化还能避开框架整树启动的开销 —— 只要启动选择与 launcher IO 就绪，应用即可使用。

## 使用

```sh
dsh --profile prts                 # GUI 窗口（默认）
dsh --profile prts --tui           # 终端客户端
dsh --profile prts --tui --lang en # 英文界面
dsh --profile prts --tui --project ops
dsh --profile prts --shortcut      # 安装桌面快捷方式
```

TUI 按键：`Enter` 发送 · `Shift+Enter` 换行 · `Tab` 切换视图 · `Ctrl+L` 切换语言 · `Ctrl+C` 停止/退出 · `/help` 查看命令。设置通过 `/key`、`/base <url>`、`/model [n|name]`、`/strength off|low|medium|high`、`/mode standard|ptc|minimal|creative`。

### 对话模式与工作区

**对话模式**（composer 上的模式芯片，或 TUI 里 `/mode`）是类 dsh web 的预设，叠加在你选择的模型/强度之上：

| 模式 | 效果 |
| --- | --- |
| 标准模式 | 你的模型 + 强度，温度 1.0 |
| PTC 模式 | deepseek-chat，关闭思考，温度 0.6 |
| 极简模式 | deepseek-chat，关闭思考，温度 0.2，上限 400 token |
| 创造模式 | deepseek-chat，关闭思考，温度 1.5 |

**工作区**即 PRTS 所说的项目：各自独立的历史与设置。PRTS 标志下方的按钮显示当前工作区并打开切换器，其中 **+ 添加工作区** 可新建（侧栏"新建项目"同理）。默认工作区为 `default`。

### 在终端里用 `prts` 启动

安装插件后，加一行别名即可让输入 `prts` 直接打开 TUI（内置 `prts` 命令默认加 `--tui`）：

```sh
# 写入 ~/.bashrc（或 ~/.zshrc），然后 source ~/.bashrc
alias prts='/home/a/.dsh/profiles/prts/node_modules/dsh-prts-ui/bin/dsh-prts-ui.js'
# 或更简短（dsh 已在 PATH 时用 shell 函数）：
#   prts() { dsh --profile prts --tui "$@"; }

prts                  # 终端客户端
prts --lang zh        # 中文 TUI
prts --gui            # GUI 窗口
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

### 数据与 API Key 存在哪里

所有内容都**保存在本地**，位于平台配置目录：

| 平台 | 配置目录 |
| --- | --- |
| Linux | `~/.config/prts/` |
| macOS | `~/Library/Application Support/prts/` |
| Windows | `%APPDATA%\prts\` |

- `config.json` —— 语言、主题与 API 设置（`baseUrl`、**`apiKey`**、`model`、`strength`）。
- `projects/<id>/meta.json` —— 项目元数据。
- `projects/<id>/history.jsonl` —— 项目消息与会话分隔。

**API Key 只存在 `config.json` 里，绝不出现在项目里**（项目只存消息/历史）；它只会在请求时作为 `Authorization: Bearer` 头发给你配置的 `baseUrl`（默认 `https://api.deepseek.com`）。它以明文存放在你自己的用户目录下 —— 与 `gh`、`aws` 等大多数本地 CLI 工具一致。想更安全：保持配置目录权限收紧（就在家目录下）、使用限额受限的 API Key。项目与历史删除：侧栏项目悬停出现的垃圾桶按钮（或 设置→项目删除），以及顶栏的"清空历史"按钮。

### 平台支持

PRTS 在 **Linux、macOS、Windows** 上行为一致：相同界面、配置布局、按项目历史、语音输入与系统面板，桌面快捷方式分别生成各平台原生启动器（`.desktop` / `.command` / `.lnk`）。Electron 固定 `43.4.0`，首次启动按平台下载。需要说明：本项目在 **Linux** 上开发并实测；macOS/Windows 路径已实现但未在 CI 中验证，正式使用前请以实际平台为准。

### 环境变量

| 变量 | 含义 |
| --- | --- |
| `DSH_PRTS_READY_TIMEOUT` | loader 就绪等待的上限毫秒数（默认 `4000`；`0` = 一直等待） |
| `PRTS_ELECTRON` | 预先安装好的 Electron 二进制路径（跳过下载） |
| `PRTS_ELECTRON_CACHE` | 覆盖 Electron 缓存目录（默认 `~/.cache/prts/electron`） |
| `DSH_PRTS_DESKTOP` | `--shortcut` 的桌面目录（测试用） |
| `DSH_PRTS_NO_SHORTCUT` | 设为 `1` 禁用快捷方式安装（CI 用） |
| `DSH_PRTS_PROFILE` | 写入快捷方式的 profile 名（默认 `prts`） |
| `DSH_PRTS_DEBUG` | 输出详细的启动调试信息 |

## GUI

GUI 是单文件 Web 应用（`web/index.html`，由 `scripts/bundle-gui.mjs` 打包），由 `electron/main.cjs` 加载。渲染进程通过 `window.prts.bridge` 与主进程通信（`prts:readFile`、`prts:writeFile`、`prts:http`、`prts:systemInfo` 等），从而避免 CORS 并支持真正的文件存储与硬件遥测。

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

针对模拟 DeepSeek 端点的本地 e2e：

```sh
node /tmp/opencode/mock-sse.mjs     # 在 127.0.0.1:8127 提供 SSE 聊天服务
printf 'apiKey=sk-test-123\nbaseUrl=http://127.0.0.1:8127\n'   # 在 TUI 里通过 /key 与 /base 配置
dsh --profile prts --tui
```

## 打包

`pnpm pack` 生成 `dsh-prts-ui-0.1.0.tgz`（src、web bundle、electron 主进程、scripts、`cordis.patch.yml`）。`postinstall` 脚本会在 GUI bundle 缺失时重建，并安装桌面快捷方式（尽力而为，绝不影响安装本身）。

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。
