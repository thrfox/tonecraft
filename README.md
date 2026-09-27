# Tonecraft 在线音乐工作室

基于 Vue 3、Vite 和 Web Audio API 的纯前端页面。包含钢琴键盘、六弦吉他指板、节拍器和麦克风调音器。

## 本地运行

需要 Node.js 20.19+ 或 22.12+ 与 pnpm 10+。

```bash
pnpm install
pnpm dev
```

Windows 可双击项目根目录的 `start-dev.cmd` 启动本地调试服务，然后访问 `http://127.0.0.1:5173/`。

构建：

```bash
pnpm build
```

## GitHub Pages 部署

1. 将本目录的文件提交到 GitHub 仓库的根目录，默认分支命名为 `main`。
2. 在仓库 **Settings → Pages → Build and deployment** 中将 Source 设为 **GitHub Actions**。
3. 推送到 `main` 后，工作流会自动构建并发布。也可在 Actions 中手动运行。

`vite.config.js` 使用相对资源路径，兼容 GitHub Pages 的仓库子路径。若默认分支不是 `main`，请修改 `.github/workflows/deploy.yml` 的 `branches` 设置。

## 功能说明

- 钢琴：支持 25、49、61、76、88 键规格切换，支持鼠标、触控及电脑键盘；点击琴键时在琴键上显示音高。音符标记默认关闭，可分别选择 12 种音名，按键提示可切换。
- 吉他：标准调弦、六弦 0–15 品，空弦点击区域为普通品位的一半；点击品位时在该位置显示音高。音符标记默认关闭，可独立选择要显示的音名，音调提示可切换。
- 节拍器：20–400 BPM、1–12 拍及 2/4/8/16 分母拍号、逐拍四级强度、五种音色、Tap Tempo。
- 调音器：进入页面时自动申请麦克风权限，展示实时输入波形和最近 12 秒的音高偏差轨迹，同时显示音名、频率、音分偏差和调音方向。音频仅在浏览器本机处理。

页面导航、钢琴键数、音符标记、提示开关和节拍器参数保存在浏览器 `localStorage` 中，刷新后保持上次设置。各功能也可通过 URL 的 `#piano`、`#guitar`、`#metronome`、`#tuner` 直接访问和分享。

麦克风需要 HTTPS 或 localhost。GitHub Pages 默认提供 HTTPS。
