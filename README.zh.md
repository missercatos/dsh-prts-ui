# PRTS — DeepSeek Harness (dsh) 整合包 + 皮肤

> **v0.0.1 (new) —— 彻底重做**：PRTS 不再是一个「重写整个界面」的插件，而是一套**整合包 + 皮肤**。

<p align="center">
  <img src="assets/prts.png" width="160" alt="PRTS 标志">
</p>

PRTS 以 **DeepSeek Harness (dsh)** 为内核，套上一层「只做视觉、绝不动核心」的皮肤。它把复杂的命令行智能体工具封装成人人可用的图形化入口：桌面整合包负责「检测 / 安装 dsh → 打包已装插件 → 一键进入」，皮肤插件负责「好看」。

## 🔑 一个重要原则：不碰核心

**PRTS 皮肤层严格只做五件事，其余 100% 走 dsh 原生：**

| # | 皮肤效果 | 做法 |
|---|---|---|
| ① | 入场动画 | 整合包 splash 层三幕粒子（速度加快），dsh 就绪后进入 |
| ② | 左上角品牌 | 鲸鱼 wordmark **视觉覆盖**为菱形 + PRTS（不换图标文件） |
| ③ | 首页欢迎语 | 「探索未至之境」→「欢迎回归，博士」（覆盖文案与鱼标） |
| ④ | 系统面板 | 侧栏**新增独立按钮**，另开独立窗口（不改“点 logo 新建会话”） |
| ⑤ | 整体主题 | 黑白 + 粒子 + 发光菱形 + 背景图形层（菱形 / 方块 / 白点，壁纸之上、对话框之下） |

这条红线保证了：**输入框位置不动、deepseek 图标不换、对话 / 设置 / 插件市场等 dsh 核心逻辑完全不受影响。** dsh 升级只会带来新能力，不会让 PRTS 失效。

## ✨ 技术亮点

- **皮肤技术**：复用 dsh 官方 client 插件 API —— `theme.overrideTokens()`（单色 token）、`slots.register('sidebar.footer.action', …)`（系统面板按钮）、CSS 皮肤层覆盖品牌与欢迎语。全部通过 dsh 稳定接口，不 patch 源码。
- **系统面板**：Electron 独立 frameless 小窗（`prts:openSystemPanel`），只读遥测 / 关于，不改主窗口布局。
- **整合包**：安装器「检测 / 装 dsh → 导出 `~/.dsh` 已装插件 → 打包桌面整合包 → 生成快捷方式」，一键进入 PRTS 皮肤下的完整 DeepSeek Harness。

## 🖥️ 支持平台与安装包

| 平台 | 安装包 |
| --- | --- |
| Windows | `PRTS-Setup-<ver>-windows-x64.exe`（自解压一键安装，重点） |
| Linux | `PRTS-<ver>-<arch>.deb` |
| macOS | `PRTS-<ver>-macos.sh`（安装器） |

安装器引导策略：
1. **检查系统是否自带 dsh**，没有则自动安装（国内镜像回退）；
2. **自动读取 `~/.dsh` 各 profile 已安装的插件清单**并作为整合包一起打包；
3. 生成桌面快捷方式（`prts` 命令 + 图标 = `prts.png` 菱形标志）。

## ▶️ 使用

```sh
prts                       # 打开 PRTS 窗口（粒子入场 → PRTS 皮肤版 dsh web）
dsh --profile prts         # 等价写法
dsh --profile prts --lang zh
prts --shortcut            # 刷新桌面快捷方式
```

配置 `~/.dsh/profiles/prts/prts-ui.json`：`.persona.userName` 控制「欢迎回归，博士」中的称呼。

## 🛠️ 开发

```sh
pnpm install && pnpm bundle      # 由 src/ 重新生成 web/index.html 与 lib/client.js
node scripts/make-dist.sh        # 生成 dist/ 全部安装包（需对应平台打包工具）
```

皮肤插件核心：`src/prts-client.js`。Electron 壳：`electron/main.cjs` + `electron/preload.cjs`。
官网（保留）：`docs/`（粒子特效下载站 + 手机端指引页），静态托管即可。

## ❓ 常见问题：Windows 安装时被 SmartScreen 拦截

安装 `PRTS-Setup-*.exe` 时 Windows 提示"**Microsoft Defender SmartScreen 已阻止无法识别的应用程序**"，是因为：
- exe **未做代码签名**（没有 Authenticode 数字证书），且是新文件、下载量少、信誉分不足。

**临时放行（对当前用户）**：点击"**更多信息 (More info)**" → "**仍要运行 (Run anyway)**"。
如果提示来自文件属性（"此文件来自其他计算机，可能被阻止"），右键 exe → 属性 → 勾选"**解除锁定 (Unblock)**"。

**彻底解决（发布方）**：对 exe 做代码签名，签名后 SmartScreen 不再拦截，并显示发布者名称：
1. 购买 **OV 或 EV 代码签名证书**（DigiCert / Sectigo / GlobalSign / SSL.com 等，EV 可立即获得信誉），或使用 **Azure Trusted Signing**（微软云签名，无需 USB 令牌、按次计费）；
2. 用 `make-dist.sh` 内置的签名步骤：
   ```sh
   # Linux/macOS 用 osslsigncode：
   PRTS_SIGN_PFX=/path/cert.pfx PRTS_SIGN_PASSWORD=xxx node scripts/make-dist.sh
   # Windows 用 SDK 的 signtool：
   PRTS_SIGN_SHA1=<证书指纹> node scripts/make-dist.sh
   ```
   （自动加时间戳 `http://timestamp.digicert.com`；不提供证书时 exe 保持未签名并给出提示。）
3. 把最终 exe 提交到 [Microsoft 恶意软件提交门户](https://www.microsoft.com/en-us/wdsi/filesubmission) 并持续分发（下载量会累积信誉）。

## 📄 许可证

MIT —— 见 [LICENSE](./LICENSE)。
