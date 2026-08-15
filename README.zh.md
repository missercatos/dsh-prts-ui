# dsh-prts-ui

PRTS —— 一个以 profile 插件形式运行在 [dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) 框架内的单色 DeepSeek 聊天客户端。

- 纯黑白界面，粒子开场特效（散开 → 欢迎 → logo → 主界面）。
- 一条命令两种形态：终端客户端（`--tui`）与 Electron 窗口（默认）。
- 按项目保存聊天历史、`zh`/`en` 双语言、deepseek-chat 与 deepseek-reasoner 模型、思考强度预设。
- 以 `.tgz` profile 包发布：可通过 `dsh plugin` 安装，内置桌面快捷方式与 postinstall 逻辑。

## 安装

```sh
# 一次性：构建 tarball
pnpm pack

# profile 侧
dsh plugin --profile prts install ./dsh-prts-ui-0.1.0.tgz
dsh --profile prts --tui
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

TUI 按键：`Enter` 发送 · `Tab` 切换视图 · `Ctrl+L` 切换语言 · `Ctrl+C` 停止/退出 · `/help` 查看命令。设置通过 `/key`、`/base <url>`、`/model [n|name]`、`/strength off|low|medium|high`。

配置与历史位于平台配置目录（Linux `~/.config/prts`，macOS `~/Library/Application Support/prts`，Windows `%APPDATA%\prts`）：`config.json`、`projects/<id>/meta.json`、`projects/<id>/history.jsonl`。

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
