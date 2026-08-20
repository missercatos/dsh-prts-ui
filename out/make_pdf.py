#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 matplotlib 离线生成 PRTS 项目展示 PDF（暗色主题，多页，含 logo 与官网链接）。"""
import os
os.environ.setdefault("MPLCONFIGDIR", "/home/a/dsh-prts-ui/out/.mplcache")
import matplotlib
matplotlib.use("pdf")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Rectangle, FancyBboxPatch, Polygon
from matplotlib import rcParams

rcParams['font.sans-serif'] = ['Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans CJK KR', 'DejaVu Sans']
rcParams['axes.unicode_minus'] = False

# 尺寸 A4 纵向
PW, PH = 8.27, 11.69   # inches
# 配色（PRTS 单色 / 黑曜石）
BG      = '#0A0A0B'
PANEL   = '#121214'
ACCENT  = '#7AA2F7'   # 强调蓝
ACCENT2 = '#BB9AF7'   # 紫
INK     = '#F5F5F5'
DIM     = '#A3A3A8'
FAINT   = '#6B6B70'
HAIR    = '#26262B'

APP_URL = "https://prts.misser.top"
REPO_URL = "github.com/missercatos/dsh-prts-ui"

def new_fig():
    fig = plt.figure(figsize=(PW, PH))
    fig.patch.set_facecolor(BG)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_facecolor(BG)
    ax.set_xlim(0, PW); ax.set_ylim(0, PH); ax.axis('off')
    return fig, ax

def top_line(ax):
    ax.add_patch(Rectangle((0, PH-0.10), PW, 0.10, color=ACCENT, linewidth=0))

def footer(ax, page_no):
    ax.text(PW/2, 0.16, f"PRTS · 项目展示   |   {APP_URL}   |   {page_no}",
            ha='center', va='center', fontsize=7.5, color=FAINT)

def heading(ax, y, text):
    ax.add_patch(Rectangle((0.55, y-0.10), 0.06, 0.42, color=ACCENT, linewidth=0))
    ax.text(0.75, y, text, ha='left', va='center', fontsize=16, fontweight='bold', color=INK)

def bullets(ax, y_top, items, line_h=0.32, color=INK, mark=ACCENT, fs=9.6):
    y = y_top
    for it in items:
        ax.text(0.75, y, "▪", ha='left', va='center', fontsize=fs+1, color=mark)
        ax.text(0.92, y, it, ha='left', va='center', fontsize=fs, color=color, wrap=True)
        y -= line_h
    return y

def callout(ax, x, y, w, h, text, fs=10.5, lw=1.2):
    box = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.05,rounding_size=0.05",
                         facecolor=PANEL, edgecolor=ACCENT, linewidth=lw, mutation_aspect=1)
    ax.add_patch(box)
    ax.text(x+w/2, y+h/2, text, ha='center', va='center', fontsize=fs, color=INK, wrap=True)

def draw_logo(ax, cx, cy, s=0.55):
    # 两层菱形 + PRTS 斜体字
    d = s
    outer = Polygon([(cx, cy+d), (cx+d, cy), (cx, cy-d), (cx-d, cy)],
                    closed=True, facecolor='none', edgecolor=INK, linewidth=2.2)
    inner = Polygon([(cx, cy+d*0.55), (cx+d*0.55, cy), (cx, cy-d*0.55), (cx-d*0.55, cy)],
                    closed=True, facecolor=ACCENT, edgecolor=ACCENT)
    ax.add_patch(outer); ax.add_patch(inner)
    ax.text(cx, cy, "PRTS", ha='center', va='center', fontsize=9,
            color=BG, fontweight='black', style='italic', family='DejaVu Sans')

def draw_chip(ax, x, y, w, h, text, color=DIM):
    box = FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.03,rounding_size=0.14",
                         facecolor=PANEL, edgecolor=HAIR, linewidth=0.8)
    ax.add_patch(box)
    ax.text(x+w/2, y+h/2, text, ha='center', va='center', fontsize=7.5, color=color)

# =====================================================================
pdf = PdfPages("/home/a/dsh-prts-ui/out/PRTS-project-showcase.pdf")

# ---------- 第 1 页：封面 ----------
fig, ax = new_fig()
top_line(ax)
draw_logo(ax, 1.35, 9.7, s=0.62)
ax.text(1.35, 8.75, "PRTS", ha='center', va='center', fontsize=46,
        fontweight='bold', color=INK, style='italic', family='DejaVu Sans')
ax.text(1.35, 8.25, "DeepSeek Harness（dsh）· AI 交互图形化外壳",
        ha='center', va='center', fontsize=13, color=ACCENT, style='italic')
# 中线
ax.add_patch(Rectangle((0.55, 7.70), PW-1.10, 0.012, color=ACCENT))
# 领域 / 赛道
draw_chip(ax, 0.75, 6.90, 2.6, 0.42, "所属领域：人工智能+ · 大模型工具链")
draw_chip(ax, 3.45, 6.90, 3.0, 0.42, "赛道：高教主赛道 · 本科生创意组")
ax.text(0.75, 6.15, "把复杂的大模型智能体工具，封装成人人可用的图形化智能助手",
        ha='left', va='center', fontsize=13, color=INK, style='italic')
ax.text(0.75, 5.55, "图形界面 · 语音交互 · 跨平台 · 人格化", ha='left',
        va='center', fontsize=11, color=DIM)
# 平台徽章
platforms = ["Windows", "Linux", "macOS", "手机端扫码"]
pl_x = 0.75
for p in platforms:
    draw_chip(ax, pl_x, 4.60, 1.30, 0.42, p, color=ACCENT)
    pl_x += 1.42
# 官网强调
callout(ax, 0.75, 3.40, (PW-1.5), 0.8,
        f"项目官网：{APP_URL}\n开源仓库：{REPO_URL}", fs=12, lw=1.4)
footer(ax, 1)
pdf.savefig(fig); plt.close(fig)

# ---------- 第 2 页：项目简介与定位 ----------
fig, ax = new_fig()
top_line(ax)
heading(ax, PH-1.0, "一、项目简介与定位")
callout(ax, 0.55, PH-2.2, PW-1.1, 0.95,
        "一句话：把复杂的大模型智能体工具「DeepSeek Harness（dsh）」封装成普通用户也能轻松上手、\n美观专业的图形化智能助手 PRTS。", fs=11)
heading(ax, PH-3.0, "项目定位")
bullets(ax, PH-3.3, [
    "不重复造轮子：复用 dsh 稳定的 /api RPC + WebSocket 协议，镜像 dsh 真实状态",
    "（工作区、会话、模型、凭证、工具、插件均来自 dsh，PRTS 只提供外观与操作面板）。",
    "让用户在友好、美观、专业的图形界面里，使用完整的大模型智能体能力。",
    "仅依赖 dsh 稳定协议，dsh 升级不会让它失效，具备良好的长期兼容性。",
], line_h=0.34)
heading(ax, PH-5.4, "要解决的问题")
bullets(ax, PH-5.7, [
    "底层工具以大语言模型命令行 / 原生网页为主，普通用户上手门槛高。",
    "交互体验不友好，缺少品牌化与人格化的智能体应用入口。",
    "跨平台安装复杂、国内网络受限，需要一键安装、稳定可用的图形化方案。",
], line_h=0.34)
# 底部价值总结
callout(ax, 0.55, 0.85, PW-1.1, 1.35,
        "价值主张：让 DeepSeek 等大模型能力「平民化」——\n以图形化、人格化、移动化的交互入口，触达更广泛的个人用户与学生群体。", fs=10.5)
footer(ax, 2)
pdf.savefig(fig); plt.close(fig)

# ---------- 第 3 页：核心功能亮点 ----------
fig, ax = new_fig()
top_line(ax)
heading(ax, PH-1.0, "二、核心功能亮点")
heading(ax, PH-1.7, "工作流与智能")
bullets(ax, PH-2.0, [
    "工作区 / 会话管理：新建、删除、搜索、多选批量归档。",
    "模式 / 模型 / 推理等级 / 权限四级选择：标准、PTC、极简、创造等预设；",
    "厂商-模型两级选择，推理等级 Off / High / Max，权限预设自由切换。",
    "轨迹与日志拆分：按轮 / 步分组的分步时间线，支持导出 JSON 原始事件日志。",
    "上下文仪表：输入框百分比环保显示上下文窗口占用。",
    "底部实时统计条：轮数、步数、LLM 耗时、tokens、缓存命中、生成速率等。",
], line_h=0.31)
heading(ax, PH-4.3, "多模态与交互")
bullets(ax, PH-4.6, [
    "图片附件传递：随消息发送 PNG / JPEG / WebP / GIF，历史图片自动回读。",
    "审批 / 提问弹卡：可批准、拒绝或回答，安全可控。",
    "语音输入：本地 whisper-tiny ONNX 语音转文字，VAD 自动检测，断网亦可用。",
], line_h=0.31)
heading(ax, PH-5.9, "个性化与分发")
bullets(ax, PH-6.2, [
    "三幕粒子开场动画兼加载动画（PRTS 品牌视觉）。",
    "内置 PRTS 人格（自称 PRTS、称呼用户「博士」）与 PRTS 模式 agent 预设。",
    "中英文界面、明暗主题、Git 面板、插件市场、Skill 坞、系统硬件遥测。",
    "Windows / Linux / macOS 一键安装，手机端扫码连接当 App 用。",
    "国内网络自动回退 npmmirror，无需访问 GitHub。",
], line_h=0.31)
footer(ax, 3)
pdf.savefig(fig); plt.close(fig)

# ---------- 第 4 页：技术架构、创新点、前景 ----------
fig, ax = new_fig()
top_line(ax)
heading(ax, PH-1.0, "三、技术架构")
bullets(ax, PH-1.3, [
    "后端：复用 DeepSeek Harness（dsh）内核 —— /api RPC + WebSocket（/api/events.mux）通信，",
    " WebSocket 优先、SSE 兜底，保证实时性与稳定性。",
    "前端：带 GUI 皮肤层的 Web 应用，打包进独立 prts profile。",
    "桌面封装：Electron，跨平台；GUI 仅回环 HTTP 服务，安全可控。",
], line_h=0.34)
heading(ax, PH-3.3, "四、创新点")
bullets(ax, PH-3.6, [
    "低门槛大模型入口：把复杂命令行智能体封装成人人可用的图形界面。",
    "轻量依赖 dsh 稳定协议，跟随 dsh 演进不过时。",
    "适配国内网络环境，一键安装、自动镜像回退。",
    "品牌化视觉（明日方舟 PRTS 风格）、粒子开场动画、人格化体验。",
    "手机端扫码连接：桌面应用秒变移动端 App。",
], line_h=0.34)
heading(ax, PH-6.0, "五、应用前景")
bullets(ax, PH-6.3, [
    "面向所有希望便捷使用大模型能力的个人用户、学生、创作者与开发者。",
    "场景：日常问答、办公写作、编程助手、学习工具、多智能体协作等。",
    "大模型工具链平民化是重要趋势，图形化 + 人格化 + 移动化的 AI 交互入口市场空间广泛。",
    "结合大模型生态与开源社区，持续迭代，具备清晰的长期演进路径。",
], line_h=0.34)
# 页面底部：再次强调链接
ax.add_patch(Rectangle((0.55, 0.85), PW-1.1, 0.012, color=ACCENT))
ax.text(0.75, 0.62, f"项目官网：{APP_URL}", ha='left', va='center',
        fontsize=11, fontweight='bold', color=ACCENT)
ax.text(0.75, 0.34, f"开源仓库：{REPO_URL}", ha='left', va='center',
        fontsize=9.5, color=DIM)
footer(ax, 4)
pdf.savefig(fig); plt.close(fig)

pdf.close()
print("PDF generated OK")
