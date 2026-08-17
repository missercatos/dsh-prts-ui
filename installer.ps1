# PRTS Windows GUI installer (wizard) — 小白一键安装
# 运行环境: Windows PowerShell 5+ (SFX 提取后由 prts-launch.vbs 隐藏启动)
# 流程: 欢迎(许可) -> 组件勾选 -> 进度安装 -> 完成(快捷方式已建)
# 高级用户仍可使用同目录 install.bat (命令行流程)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Tgz  = Get-ChildItem -Path $Root -Filter 'dsh-prts-ui-*.tgz' | Sort-Object Name | Select-Object -Last 1
$Home = $env:USERPROFILE
$ProfileDir = Join-Path $Home '.dsh\profiles\web'
$AppDir = Join-Path $env:APPDATA 'prts'

$NPM_FALLBACK = 'https://registry.npmmirror.com'

# ---------- 主题 ----------
$Bg  = [System.Drawing.Color]::FromArgb(10, 10, 11)
$Ink = [System.Drawing.Color]::FromArgb(250, 250, 250)
$Dim = [System.Drawing.Color]::FromArgb(156, 156, 161)
$Accent = [System.Drawing.Color]::FromArgb(122, 162, 247)
$OkGreen = [System.Drawing.Color]::FromArgb(158, 206, 106)
$ErrRed = [System.Drawing.Color]::FromArgb(247, 118, 142)

function New-Label($parent, $text, $x, $y, $w, $size, $color) {
  $l = New-Object System.Windows.Forms.Label
  $l.Text = $text; $l.AutoSize = $false
  $l.Location = New-Object System.Drawing.Point($x, $y)
  $l.Size = New-Object System.Drawing.Size($w, [int]($size * 1.8))
  $l.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', $size)
  $l.ForeColor = $color
  $parent.Controls.Add($l)
  return $l
}

function New-Check($parent, $text, $x, $y, $checked, $enabled) {
  $c = New-Object System.Windows.Forms.CheckBox
  $c.Text = $text
  $c.Location = New-Object System.Drawing.Point($x, $y)
  $c.AutoSize = $true
  $c.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
  $c.ForeColor = $Ink
  $c.Checked = $checked
  $c.Enabled = $enabled
  $parent.Controls.Add($c)
  return $c
}

# ---------- 窗体 ----------
$Form = New-Object System.Windows.Forms.Form
$Form.Text = 'PRTS 安装向导'
$Form.Size = New-Object System.Drawing.Size(640, 460)
$Form.StartPosition = 'CenterScreen'
$Form.FormBorderStyle = 'FixedDialog'
$Form.MaximizeBox = $false
$Form.BackColor = $Bg
$Form.ForeColor = $Ink

$Pages = New-Object System.Collections.ArrayList
function New-Page {
  $p = New-Object System.Windows.Forms.Panel
  $p.Dock = 'Fill'
  $p.BackColor = $Bg
  $p.Visible = $false
  $Form.Controls.Add($p)
  [void]$Pages.Add($p)
  return $p
}

# ---------- 页 1: 欢迎 + 许可 ----------
$P1 = New-Page
[void](New-Label $P1 'PRTS 安装向导' 28 22 560 17 $Ink)
[void](New-Label $P1 'PRTS — DeepSeek Harness 的图形界面（罗德岛终端风格）。' 28 64 560 10 $Dim)
[void](New-Label $P1 '本向导将为你安装：' 28 100 560 10 $Dim)
[void](New-Label $P1 '  · dsh 本体（DeepSeek Harness）' 44 124 520 10 $Ink)
[void](New-Label $P1 '  · PRTS 图形界面与配置' 44 148 520 10 $Ink)
[void](New-Label $P1 '  · 可选：dsh 插件市场 / 第三方插件' 44 172 520 10 $Ink)
$Agree = New-Check $P1 '我已阅读并同意安装 dsh 与 PRTS（MIT 许可，可随时卸载）' 44 216 $true $true
$Next1 = New-Object System.Windows.Forms.Button
$Next1.Text = '下一步  ›'
$Next1.Size = New-Object System.Drawing.Size(130, 36)
$Next1.Location = New-Object System.Drawing.Point(470, 340)
$Next1.FlatStyle = 'Flat'
$Next1.BackColor = $Accent
$Next1.ForeColor = $Bg
$P1.Controls.Add($Next1)

# ---------- 页 2: 组件勾选 ----------
$P2 = New-Page
[void](New-Label $P2 '选择要安装的组件' 28 22 560 16 $Ink)
[void](New-Label $P2 '必装项已锁定；可选插件可随时在 dsh 插件市场中增删。' 28 60 560 10 $Dim)
$CkDsh = New-Check $P2 'dsh 本体（必装）' 44 100 $true $false
$CkMarket = New-Check $P2 'dsh 插件市场（dshmarket）— 图形界面浏览、搜索、一键装/卸插件' 44 130 $true $true
$CkGivemyflag = New-Check $P2 'givemyflag — CTF 解题工具（web 安全挑战自动打 FLAG）' 44 158 $false $true
$CkModlens = New-Check $P2 'ModLens — 视觉增强：给纯文本模型增加图片理解能力' 44 186 $true $true
$CkSidebar = New-Check $P2 'Better Sidebar — 类 VSCode 侧栏（资源管理器/编辑器/终端/Git）' 44 214 $true $true
$CkMessageEdit = New-Check $P2 'dsh-message-edit — 消息编辑：历史消息一键重写重新发送' 44 242 $true $true
$CkContextVista = New-Check $P2 'context-vista — 上下文可视化：token 占用与上下文窗口一目了然' 44 270 $true $true
$CkSpend = New-Check $P2 'dsh-spend — 花费统计：每次会话的 token 消耗与费用明细' 44 298 $true $true
$CkGenui = New-Check $P2 'dsh-genui — 界面生成（若 npm 未发布则自动跳过）' 44 326 $true $true
$CkTurnRewind = New-Check $P2 'dsh-turn-rewind — 回合回溯：回到对话的任意一步重来' 44 354 $true $true
$CkMneme = New-Check $P2 'dsh-mneme — 记忆插件（若 npm 未发布则自动跳过）' 44 382 $true $true
$CkAgentTeams = New-Check $P2 'dsh-agent-teams — 多智能体协作（若 npm 未发布则自动跳过）' 44 410 $true $true
$CkPlanExecute = New-Check $P2 'dsh-plan-execute — 计划-执行工作流（若 npm 未发布则自动跳过）' 44 438 $true $true
$CkPrts = New-Check $P2 'PRTS 图形界面（必装）' 44 220 $true $false
$Back2 = New-Object System.Windows.Forms.Button
$Back2.Text = '‹ 上一步'; $Back2.Size = New-Object System.Drawing.Size(110, 36)
$Back2.Location = New-Object System.Drawing.Point(310, 340); $Back2.FlatStyle = 'Flat'; $Back2.BackColor = $Bg; $Back2.ForeColor = $Dim
$P2.Controls.Add($Back2)
$Next2 = New-Object System.Windows.Forms.Button
$Next2.Text = '开始安装  ›'; $Next2.Size = New-Object System.Drawing.Size(130, 36)
$Next2.Location = New-Object System.Drawing.Point(470, 340); $Next2.FlatStyle = 'Flat'; $Next2.BackColor = $Accent; $Next2.ForeColor = $Bg
$P2.Controls.Add($Next2)

# ---------- 页 3: 进度 ----------
$P3 = New-Page
[void](New-Label $P3 '正在安装…' 28 22 560 16 $Ink)
$Log = New-Object System.Windows.Forms.ListBox
$Log.Location = New-Object System.Drawing.Point(28, 64)
$Log.Size = New-Object System.Drawing.Size(570, 220)
$Log.BackColor = [System.Drawing.Color]::FromArgb(17, 17, 18)
$Log.ForeColor = $Ink
$Log.Font = New-Object System.Drawing.Font('Consolas', 9)
$P3.Controls.Add($Log)
$Bar = New-Object System.Windows.Forms.ProgressBar
$Bar.Location = New-Object System.Drawing.Point(28, 300)
$Bar.Size = New-Object System.Drawing.Size(570, 20)
$P3.Controls.Add($Bar)
$Stat = New-Label $P3 '' 28 330 560 10 $Dim
$FinishBtn = New-Object System.Windows.Forms.Button
$FinishBtn.Text = '完成  ›'; $FinishBtn.Size = New-Object System.Drawing.Size(130, 36)
$FinishBtn.Location = New-Object System.Drawing.Point(470, 356); $FinishBtn.FlatStyle = 'Flat'; $FinishBtn.BackColor = $OkGreen; $FinishBtn.ForeColor = $Bg
$FinishBtn.Visible = $false
$P3.Controls.Add($FinishBtn)

function Write-Log($msg, $color) {
  $Log.Items.Add($msg)
  $Log.TopIndex = $Log.Items.Count - 1
  [System.Windows.Forms.Application]::DoEvents()
}

# ---------- 安装步骤 ----------
function Invoke-Step($label, $scriptblock) {
  Write-Log ('== ' + $label)
  & $scriptblock
  $Bar.Value = [Math]::Min(100, $Bar.Value + $script:stepIncr)
  [System.Windows.Forms.Application]::DoEvents()
}
$script:stepIncr = 0

function Install-Run {
  $total = 6 + $(if ($CkMarket.Checked) { 1 } else { 0 }) + $(if ($CkModlens.Checked) { 1 } else { 0 }) + $(if ($CkSidebar.Checked) { 1 } else { 0 })
  $script:stepIncr = [int](100 / $total)
  function Run-Cmd($cmd) {
    $out = & cmd /c $cmd 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) { throw ('exit ' + $LASTEXITCODE + ': ' + $out.Substring(0, [Math]::Min(300, $out.Length))) }
    if ($out.Trim()) { $out.Trim() -split "`n" | Select-Object -First 6 | ForEach-Object { Write-Log ('    ' + $_.Trim()) } }
  }
  try {
    # 1. node / npm
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
      Write-Log '未检测到 Node.js。' $ErrRed
      Write-Log '请先到 https://nodejs.org（或 https://npmmirror.com/mirrors/node/）安装后重试。' $ErrRed
      $Stat.Text = '安装失败：缺少 Node.js'
      $FinishBtn.Visible = $true
      return
    }
    Invoke-Step '检测运行环境 (node/npm)' { Write-Log ('    node ' + (& node --version)) }
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm) {
      Invoke-Step '安装 pnpm' { Run-Cmd 'npm i -g pnpm' }
    }
    # 2. dsh 本体
    $dsh = Get-Command dsh -ErrorAction SilentlyContinue
    if ($dsh) {
      Invoke-Step 'dsh 已安装' { Write-Log ('    ' + (& dsh --version | Select-Object -First 1)) }
    } else {
      Invoke-Step '安装 dsh 本体（国内镜像回退）' {
        Run-Cmd 'npm i -g @deepseek-ai/dsh --registry=' + $NPM_FALLBACK
      }
    }
    # 3. 可选插件
    if ($CkMarket.Checked) {
      Invoke-Step '安装 dsh 插件市场 (dshmarket)' { Run-Cmd 'dsh plugin --profile web add dshmarket' }
    }
    if ($CkGivemyflag.Checked) {
      Invoke-Step '安装第三方插件 givemyflag' { Run-Cmd 'dsh plugin --profile web add dsh-givemyflag' }
    }
    if ($CkModlens.Checked) {
      Invoke-Step '安装第三方插件 ModLens' { Run-Cmd 'dsh plugin --profile web add @liustack/modlens' }
    }
    if ($CkSidebar.Checked) {
      Invoke-Step '安装第三方插件 Better Sidebar' { Run-Cmd 'dsh plugin --profile web add dsh-better-sidebar' }
    }
    $optionalPlugins = @(
      @($CkMessageEdit, 'dsh-message-edit', '消息编辑'),
      @($CkContextVista, 'context-vista', '上下文可视化'),
      @($CkSpend, 'dsh-spend', '花费统计'),
      @($CkGenui, 'dsh-genui', '界面生成'),
      @($CkTurnRewind, 'dsh-turn-rewind', '回合回溯'),
      @($CkMneme, 'dsh-mneme', '记忆'),
      @($CkAgentTeams, 'dsh-agent-teams', '多智能体'),
      @($CkPlanExecute, 'dsh-plan-execute', '计划执行')
    )
    foreach ($op in $optionalPlugins) {
      if ($op[0].Checked) {
        Invoke-Step ('安装可选插件 ' + $op[2] + ' (' + $op[1] + ')') {
          try { Run-Cmd ('dsh plugin --profile web add ' + $op[1]) }
          catch { Write-Log ('    跳过：' + $op[1] + ' 未在仓库中找到（不影响安装）') }
        }
      }
    }
    # 4. PRTS 界面
    Invoke-Step '安装 PRTS 图形界面' {
      if (-not $Tgz) { throw '安装包缺少 dsh-prts-ui-*.tgz' }
      Run-Cmd ('dsh plugin --profile web add "' + $Tgz.FullName + '"')
      $pin = 'const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,"utf8"));m.dsh=m.dsh||{};const e=(m.dsh.profile&&m.dsh.profile.bundles)||[];m.dsh.profile={bundles:Array.from(new Set(["dsh-prts-ui"].concat(e)))};fs.writeFileSync(p,JSON.stringify(m,null,2));'
      Run-Cmd ('node -e "' + $pin + '" "' + (Join-Path $ProfileDir 'package.json') + '"')
    }
    # 5. 配置文件
    Invoke-Step '写入 PRTS 配置' {
      New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
      $cfg = Join-Path $ProfileDir 'prts.config.json'
      if (-not (Test-Path $cfg)) {
        @'
{
  "releaseBase": "https://missercatos.github.io/dsh-prts-ui/releases",
  "releaseManifest": "releases.json",
  "npmRegistry": "",
  "npmRegistryFallback": "https://registry.npmmirror.com",
  "electronMirror": "https://npmmirror.com/mirrors/electron/",
  "dshPackage": "@deepseek-ai/dsh",
  "plugins": []
}
'@ | Set-Content -Path $cfg -Encoding UTF8
      }
    }
    # 6. 快捷方式（桌面 + 开始菜单）
    Invoke-Step '创建桌面与开始菜单快捷方式' {
      New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
      $vbs = Join-Path $AppDir 'prts.vbs'
      'CreateObject("WScript.Shell").Run "node """ + (Join-Path $ProfileDir 'node_modules\dsh-prts-ui\bin\dsh-prts-ui.js') + """", 0, False' | Set-Content -Path $vbs -Encoding ASCII
      $ws = New-Object -ComObject WScript.Shell
      $desktop = [Environment]::GetFolderPath('Desktop')
      $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
      foreach ($dir in @($desktop, $startMenu)) {
        $lnk = Join-Path $dir 'PRTS.lnk'
        $s = $ws.CreateShortcut($lnk)
        $s.TargetPath = 'wscript.exe'
        $s.Arguments = '"' + $vbs + '"'
        $s.WorkingDirectory = $Home
        $s.Description = 'PRTS'
        $s.Save()
      }
      Write-Log ('    已创建: ' + $desktop + '\PRTS.lnk')
    }
    $Bar.Value = 100
    $Stat.Text = '安装完成！'
    Write-Log 'PRTS 安装完成 — 点击「完成」并启动。' $OkGreen
    $FinishBtn.Visible = $true
  } catch {
    $Stat.Text = '安装失败：' + $_.Exception.Message
    Write-Log ('ERROR: ' + $_.Exception.Message) $ErrRed
    $FinishBtn.Visible = $true
  }
}

# ---------- 页 4: 完成 ----------
$P4 = New-Page
[void](New-Label $P4 '安装完成' 28 22 560 18 $OkGreen)
[void](New-Label $P4 'PRTS 已安装到你的电脑，桌面与开始菜单已创建快捷方式。' 28 64 560 10 $Ink)
[void](New-Label $P4 '启动方式：双击桌面 PRTS 图标，或在任意终端输入 prts。' 28 90 560 10 $Dim)
$Launch = New-Object System.Windows.Forms.Button
$Launch.Text = '启动 PRTS'; $Launch.Size = New-Object System.Drawing.Size(150, 40)
$Launch.Location = New-Object System.Drawing.Point(180, 320); $Launch.FlatStyle = 'Flat'; $Launch.BackColor = $Accent; $Launch.ForeColor = $Bg
$P4.Controls.Add($Launch)
$Close4 = New-Object System.Windows.Forms.Button
$Close4.Text = '关闭'; $Close4.Size = New-Object System.Drawing.Size(110, 40)
$Close4.Location = New-Object System.Drawing.Point(360, 320); $Close4.FlatStyle = 'Flat'; $Close4.BackColor = $Bg; $Close4.ForeColor = $Dim
$P4.Controls.Add($Close4)

# ---------- 导航 ----------
function Show-Page($page) {
  foreach ($p in $Pages) { $p.Visible = ($p -eq $page) }
}
$Next1.Add_Click({ if (-not $Agree.Checked) { [System.Windows.Forms.MessageBox]::Show($Form, '请先勾选同意许可。', 'PRTS') } else { Show-Page $P2 } })
$Back2.Add_Click({ Show-Page $P1 })
$Next2.Add_Click({
  Show-Page $P3
  $Bar.Value = 0
  Install-Run
})
$FinishBtn.Add_Click({ Show-Page $P4 })
$Launch.Add_Click({
  $vbs = Join-Path $AppDir 'prts.vbs'
  Start-Process 'wscript.exe' -ArgumentList ('"' + $vbs + '"')
  $Form.Close()
})
$Close4.Add_Click({ $Form.Close() })

Show-Page $P1
$Form.ShowDialog()
