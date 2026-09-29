# Tonecraft 在线音乐工作室

基于 Vue 3、Vite 和 Web Audio API 的纯前端页面。包含钢琴键盘、六弦吉他指板、节拍器、麦克风调音器和曲谱库。

## 本地运行

需要 Node.js 20.19+ 或 22.12+ 与 pnpm 11+。

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

### 曲谱库与 Supabase

曲谱文件保存在 Supabase Storage 的公开 `scores` bucket，曲谱列表保存在 `public.scores` 表。访客无需登录即可阅读；只有 `public.score_admins` 中登记的 Supabase Auth 用户可以上传和删除。权限由 Supabase RLS 执行，前端的登录界面和按钮显隐只改善操作体验。

1. 在专用 Supabase 项目中应用 `supabase/score_library.sql`。
2. 在 Supabase Auth 中创建管理员用户，然后将该用户的 UUID 加入 `public.score_admins`。管理员登录使用该用户的邮箱和密码；前端不提供注册入口。
3. 本地复制 `.env.example` 为 `.env.local`，只填写项目 URL 和 **publishable key**。
4. GitHub 仓库的 Actions Variables 中设置 `TONECRAFT_SUPABASE_URL`，Actions Secrets 中设置 `TONECRAFT_SUPABASE_PUBLISHABLE_KEY`。工作流构建时读取这两个值。

**不要把 `sb_secret_`、`service_role` 密钥或管理员密码放进前端、GitHub 仓库或 Actions 的前端构建变量。** Publishable key 按 Supabase 设计会出现在浏览器请求中，不能当作秘密；真正的上传限制由登录身份和 RLS 保证。

## 功能说明

- 钢琴：支持 25、49、61、76、88 键规格切换，支持鼠标、触控及电脑键盘；点击琴键时在琴键上显示音高。音符标记默认关闭，可分别选择 12 种音名，按键提示可切换，并可独立调整音量。
- 吉他：标准调弦、六弦 0–15 品，空弦点击区域为普通品位的一半；点击品位时在该位置显示音高。音符标记默认关闭，可独立选择要显示的音名，音调提示可切换，并可独立调整音量。
- 节拍器：20–400 BPM、1–12 拍及 2/4/8/16 分母拍号、逐拍四级强度、五种音色、Tap Tempo，可独立调整音量。可为当前节奏命名并保存最多 10 个预设；超过上限时按保存时间移除最早的预设，支持载入和删除。
- 调音器：进入页面时自动申请麦克风权限，展示实时输入波形和最近 12 秒的音高偏差轨迹，同时显示音名、频率、音分偏差和调音方向。音频仅在浏览器本机处理。
- 曲谱库：访客免登录查看；管理员登录后可上传和删除 PDF、PNG、JPG、WebP、MusicXML、XML 曲谱。支持页内图片/PDF 预览和 MusicXML 五线谱渲染。

页面导航、钢琴键数、音符标记、提示开关、三个独立音量、节拍器参数和已保存的节奏预设保存在浏览器 `localStorage` 中，刷新后保持上次设置。各功能也可通过 URL 的 `#piano`、`#guitar`、`#metronome`、`#tuner`、`#scores` 直接访问和分享。

移动端使用触控布局：手机采用底部导航，平板采用窄侧栏；钢琴与吉他优先展示可滑动的演奏区域，节拍器优先展示开始/停止按钮，手机调音器优先展示音高和指针。布局支持竖屏与横屏切换。

麦克风需要 HTTPS 或 localhost。GitHub Pages 默认提供 HTTPS。
