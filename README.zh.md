# dsh-prts-ui (PRTS)

PRTS 是 **dsh（DeepSeek Harness）的 GUI 外壳**，不是独立软件。它复用 dsh 的 `/api` RPC + WebSocket 协议镜像 dsh 的真实状态：工作区、会话、模型、凭证、工具、插件都来自 dsh；PRTS 只提供外观与操作面板。因为只依赖 dsh 稳定的 `/api` 协议，dsh 升级不会让它失效。

本版（0.2.0）已针对**当前 dsh 内核（v4 代 / `session.list`→`items`、`/api/events.mux` 为 WebSocket）**逐项修正并实测。

## 功能（全部照搬 dsh 的能力）

- **工作区**：侧栏列表、新建/删除、头部面包屑随时切换
- **会话**：新建会话、归档、**搜索会话**（本地过滤 + dsh 的 session.search）
- **模式选择**：dsh 自己的 agent preset（标准 / PTC / 极简 / 创造…，`agentPreset.list/select`）
- **模型选择**：先选厂商再选模型（`session.models` 实时显示当前模型）
- **推理等级**：模型自带的 reasoning efforts（Off / High / Max，经 `session.selectModel` 的 `reasoningEffort`）
- **权限等级**：会话 projection 里的 permission presets（read-only / workspace-write / danger-full-access…，经 `/permission` 命令）
- **传递文件**：附加图片（PNG/JPEG/WebP/GIF）随消息发送，历史里的图片自动回读
- **审批 / 提问**：`approval/requested`、`question/requested` 弹卡，可批准/拒绝/回答
- **上下文仪表**：输入框旁的百分比环显示上下文窗口占用（projection `contextPressure`）
- 其余：粒子开场、系统面板（硬件遥测）、语音输入、费用面板、插件市场、轨迹视图、中英文界面、明暗主题

## 与当前 dsh 内核的兼容性修正（0.2.0）

| 问题 | 修正 |
| --- | --- |
| `/api/events.mux` 现在只接受 WebSocket（普通 GET 返回 `upgrade required`） | 客户端与 Electron 主进程改为 WebSocket 优先、SSE 兜底 |
| `session.list` 返回 `{items}`（旧代码读 `sessions`） | 已对齐；会话标题读 projection `values.title` |
| `session.history` 返回 `{events:[{event,view}]}` | 已对齐，并支持 `beforeSeq/maxMessages` 分页回读（大会话秒开） |
| 流式事件只有 `assistant/chunk`（reasoning-delta/text-delta/tool-call-delta/usage/finish） | 折叠逻辑全部重写，边流边渲染 |
| 无 `commands.list` RPC | 命令目录从会话 `command/run` 历史 + 内置命令构建 |
| `session.search` 在部分部署被禁用 | 自动降级为本地标题过滤 |
| Electron 禁用 `window.prompt()`（“新建工作区”等按钮点击即崩） | 换成 PRTS 风格模态框 |
| 审批/提问应答格式 | `respond` 现在正确打包 `{ok:true,value:{...}}` |
| 头部弹层在窗口顶端打开时跑出屏幕 | 弹层按触发器位置自动改为向下展开 |
| 死按钮 | 侧栏折叠、对话/轨迹页签、会话日志、上下文仪表均已接线 |
| 发送后卡在“停止”状态（mux 断流导致 streaming 永久为 true） | 流结束/断线都会复位 |

## 安装（一键，国内网络可用）

所有网络步骤失败时自动回退 npmmirror（npm 镜像、Electron 镜像），无需访问 GitHub。

| 平台 | 安装包 / 方式 |
| --- | --- |
| Windows | `PRTS-Setup-<ver>-windows-x64.exe`（自解压 exe，双击即装）或 `install.bat` |
| Linux | `PRTS-<ver>-linux-x64.run`（自解压）或 `sh install.sh` |
| macOS | `PRTS-<ver>-macos.sh` 或 `sh install.sh` |
| Android | Termux：`sh install-android.sh`（浏览器里跑 dsh web + PRTS）；或把官网作为 PWA“添加到主屏幕” |

安装器做的事：装 Node 环境依赖检查 → 装 dsh（缺省时）→ 装 `prts.config.json` 里列出的插件 → 打包/复用 `dsh-prts-ui-<ver>.tgz` → 装进 `prts` profile → 固定 bundle → 桌面/开始菜单快捷方式 → `prts` 命令入 PATH。

```sh
# 通用：启动
prts                       # 打开 PRTS 窗口（底层自动启动/复用 dsh web:3080）
dsh --profile prts         # 等价写法
dsh --profile prts --lang zh
dsh --profile prts --shortcut   # 刷新桌面快捷方式
```

**配置**：首次安装会生成 `~/.dsh/profiles/prts/prts.config.json`（模板 `prts.config.example.json`），里面可改 npm 镜像、Electron 镜像、插件列表、发布地址。更新时保留你的配置。

**更新**：`sh update.sh`（Windows `update.bat`）会先尝试从 `releaseBase`（官网 releases 目录，读 `releases.json`）下载最新包，失败则本地重建；同时更新 dsh 与插件。

**卸载**：

```sh
dsh plugin --profile prts remove dsh-prts-ui
rm -f ~/Desktop/dsh-prts.desktop ~/.local/share/applications/dsh-prts.desktop
rm -rf ~/.config/prts ~/.dsh/profiles/prts
```

## 运行在本机 dsh 上的插件形态（`/prts`）

GUI 本身就是插件。除了上面的 profile 安装方式，还可以作为**动态 Cordis 插件**挂到正在运行的 dsh 上：Host 半注册 `/prts` 路由（本仓库 `plugin/host.js` + `plugin/client.js`，由本会话的 `prts-1` 插件运行），浏览器打开 `http://127.0.0.1:3080/prts/` 即是完整 PRTS 界面，与当前 dsh 实例同一 origin、同一会话 —— 你在里面聊的就是这个 agent。

## 打包与官网

```sh
sh scripts/make-dist.sh     # 生成 dist/：tgz + .run + .sh + .exe + .zip + SHA256SUMS + releases.json
```

- Windows exe 用 mingw-w64 编译的自解压 stub（`dist-tools/sfx.c`）+ 追加 payload zip，Linux 上也能直接产出；没有 mingw 时退化为 zip + `build-exe.bat`（Windows 自带 IExpress）。
- 官网文件在 `web-site/`：粒子特效中英文文字（“欢迎使用PRTS / 这里是dsh-prts官网”…）+ 四个平台下载按钮 + PWA（Android 可安装为应用）。部署说明见 `web-site/README.txt`。

## 开发与自测

```sh
pnpm install && pnpm bundle      # 由 src/ + web/src 重新生成 web/index.html
node test/live-transport.mjs     # 对着运行中的 dsh 验证 /api + mux 全链路
node test/cdp-drive.mjs          # 通过 CDP 采集 Electron 窗口状态/截图
node test/cdp-audit.mjs          # 逐个控件命中测试（按钮可点击性）
node test/cdp-interact.mjs       # 功能交互测试（新会话/搜索/弹层/发送/停止）
```

不依赖真实 dsh 的旧 mock 方式见 README 历史版本；现在推荐直接对 3080 跑 live-transport。

## 环境变量

| 变量 | 含义 |
| --- | --- |
| `PRTS_DSH_URL` | 后端 dsh web 地址（默认 `http://127.0.0.1:3080`） |
| `PRTS_ELECTRON` | 预装 Electron 二进制路径（跳过下载） |
| `PRTS_ELECTRON_CACHE` | Electron 缓存目录（默认 `~/.cache/prts/electron`） |
| `ELECTRON_MIRROR` | Electron 下载镜像（安装器默认 npmmirror） |
| `DSH_PRTS_NO_SHORTCUT` | `1` 禁用快捷方式安装 |
| `DSH_PRTS_DESKTOP` | 快捷方式桌面目录（测试用） |
| `DSH_HOME` | dsh 主目录（默认 `~/.dsh`） |

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。7-Zip SFX 与 IExpress 仅为构建工具链，不随包分发额外二进制。
