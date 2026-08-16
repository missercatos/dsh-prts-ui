# PRTS 官网（下载站）— web-site/

单页下载站：粒子特效中文/英文欢迎文字 + 四个平台下载按钮，风格与 PRTS GUI 一致（纯黑白、发丝线、胶囊按钮）。

## 目录

```
web-site/
  index.html         单页站点（自包含：粒子引擎 + 样式 + 下载按钮）
  manifest.json      PWA 清单（Android 上可“添加到主屏幕”安装为应用）
  sw.js              离线缓存 Service Worker
  releases/          安装包目录（make-dist.sh 已把产物复制到这里）
    dsh-prts-ui-0.2.0.tgz
    PRTS-0.2.0-linux-x64.run
    PRTS-0.2.0-macos.sh
    PRTS-Setup-0.2.0-windows-x64.exe
    PRTS-Setup-0.2.0-windows-x64.zip
    PRTS-0.2.0-android.zip
    SHA256SUMS
    releases.json
```

## 部署

任意静态托管即可（Nginx / GitHub Pages / Gitee Pages / 对象存储 / 宝塔）：

```sh
# Nginx 示例：把 web-site 整个目录作为站点根
cp -r web-site/* /var/www/prts-site/
# 或本地预览：
cd web-site && python3 -m http.server 8080
```

把 `releases.json` 里的 `url` 前缀改成你的站点地址（或重新跑
`PRTS_RELEASE_BASE=https://你的域名/releases sh scripts/make-dist.sh`）。

## 修改下载地址

编辑 `web-site/index.html` 顶部的 `window.PRTS_RELEASES`：

```js
window.PRTS_RELEASES = {
  windows: 'releases/PRTS-Setup-0.2.0-windows-x64.exe',
  linux:   'releases/PRTS-0.2.0-linux-x64.run',
  macos:   'releases/PRTS-0.2.0-macos.sh',
  android: 'releases/PRTS-0.2.0-android.zip',
};
```

## 重新构建产物并同步到站点

```sh
sh scripts/make-dist.sh          # 重新生成 dist/
cp dist/* web-site/releases/     # 同步到站点目录
```

国内部署建议同时启用 gzip（安装包都是可压缩文本/可执行文件）并配置
`Cache-Control: public, max-age=86400`。
