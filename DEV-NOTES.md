# ReadMate 读伴插件 — 开发交接要点

> 本文件是给新会话的交接文档。新会话会跑在 Gemini（多账号池）上。
> 任务背景：用户对"读伴"（ReadMate 网页朗读插件）提了 5 个问题，方案已全部拍板，**等待实施**。

---

## 一、用户提的问题 + 已确认方案（务必按此实施）

### 1. 右下角悬浮按钮拆成两个小圆钮（问题1+4，一起做）
- 现状：右下角只有一个蓝色圆形 **▶ 悬浮按钮**（`#readmate-fab`），点一下直接播放整页。
- 问题：**轮播按钮（📻）藏在"播放中"才出现的底部浮动条里**，必须先播放本页才能看到它，此时再点轮播去跳页，逻辑冲突（页还没读完就被跳走）。
- 方案：把右下角悬浮按钮改成**两个独立小圆钮**并排/叠放：
  - **▶ 播放当前页**（保留现有朗读逻辑）
  - **📻 轮播**（独立入口，不播放也能直接进轮播）→ 调 `scanAndShowPlaylist()`
- 这样 📻 从浮动条里解放出来，两个入口平级、互不干扰。

### 2. 停止三件套（问题2，用户拍板全做）
- ① **工具栏弹窗（popup）加常驻停止键**：popup/popup.html 里已有一个死按钮 `#stopBtn`（`display:none` 且 popup.js 里**完全没有绑定逻辑**）。激活它：始终显示 + 接线。点击 → 通知当前 tab 停止朗读 + 清空轮播记录（storage.session 的 `readmate_playlist`），确保**无论单篇/轮播、页面跳没跳都能停**。
- ② **浮动条停止键更醒目**：轮播时强制浮动条出现；`#readmate-stop-btn` 改成红色大字、更明显。
- ③ **快捷键提示**：manifest 已内置 `Ctrl+Shift+S = stop-read`，向用户提示。

### 3. 高亮（问题3，用户拍板：宽松匹配+标题高亮）
- 现状：`highlightSentence()` 拿"正在读的整句前200字"去页面全文文本里**精确匹配**位置再涂色。标题/首段最容易对不上——因为播放前 `TextUtils.preprocess()` 做了去空白/去装饰/折叠，清理后的句子和页面原文文字不一致 → 开头几句高亮失败或延迟。
- 方案：改为**宽松匹配**（忽略空白/标点差异后再匹配）；**标题单独高亮**（优先高亮 h1/h2 标题元素）。

### 4. 轮播按了没播放的 bug（问题5，尚未定位病灶）
- 四个最可能的卡点，动手时开调试日志逐个验证：
  1. `ContentExtractor.findArticleLinks()` 在目标页面扫不出新闻链接（列表识别失败）
  2. 确认胶囊条"开始连播"按钮点击后没触发跳转
  3. 跳转第一篇详情页后 `autoReadPlaylistArticle()` 没被唤醒（storage.session 接力失败）
  4. 新页面正文提取失败（正文 <50 字符）→ 直接跳"下一"篇，体感像没播
- 目标流水线：点📻 → 扫描列表(打序号徽章) → 确认 → 跳第1篇 → 朗读 → 自动第2篇 → … → 全部读完回列表页。

---

## 二、代码地图（/root/projects/readmate-ext）

| 内容 | 位置 |
|------|------|
| 项目根 | `/root/projects/readmate-ext` |
| 悬浮按钮 FAB | `content.js` `createFAB()` 约 L96（`#readmate-fab`） |
| 底部浮动条 | `content.js` `createFloatingBar()` 约 L670（📻 按钮 `#readmate-playlist-mode-btn` 在 L688/L712） |
| 停止 | `content.js` `stopReading()` 约 L834（清 playlist + speechSynthesis.cancel + hideBar） |
| 高亮 | `content.js` `highlightSentence()` 约 L858、`applyHighlight()`、`clearHighlights()` |
| 轮播 | `content.js` `scanAndShowPlaylist()` L1298、`skipToNextPlaylistItem()` L1375、`autoReadPlaylistArticle()` L1416、`startReading()` L1495 |
| 文本预处理 | `startReading()` 里 `TextUtils.preprocess()`（去空白/装饰，高亮不匹配的根源） |
| 内容提取 | `content-extractor.js` `findArticleLinks()` L419（新闻链接识别）、`extract()` 类 Readability |
| popup 死按钮 | `popup/popup.html` 的 `#stopBtn`（display:none、无绑定）；逻辑在 `popup/popup.js` |
| 快捷键 | `manifest.json`：read-page/stop-read 等，`Ctrl+Shift+S=停止` |

---

## 三、自主调试环境（已搭好，新会话直接用！）

**1. Chromium 已在 VNC 桌面跑，带远程调试 + 已加载插件**
- 在 tmux 会话 `chrome` 里，CDP 端口 `9222`，插件 ID `eahihnbhononpngbbogfkbmaglaimgdk`。
- 如需重启：
  ```bash
  tmux kill-session -t chrome
  tmux new-session -d -s chrome "cd /tmp && DISPLAY=:1 exec chromium-browser --user-data-dir=/root/chrome-debug-profile --remote-debugging-port=9222 --load-extension=/root/projects/readmate-ext --no-first-run --no-default-browser-check --no-sandbox --disable-gpu --disable-features=Translate about:blank"
  ```
- **两个关键坑**：① root 跑 chromium 必须 `--no-sandbox`；② 后台进程会被沙箱回收，必须用 tmux 会话守护，不能 nohup/后台&。

**2. CDP 遥控工具 `/root/cdp-tools/cdp.js`**（node + ws 已装）
```bash
cd /root/cdp-tools
node cdp.js targets                                        # 列出页面
node cdp.js nav <urlSubstr> <url> [delayMs]                # 导航
node cdp.js eval <urlSubstr> '<js>'                        # 读页面状态（调试主力）
node cdp.js mouseclick <urlSubstr> '#selector'             # ★真实鼠标点击（能触发插件）
node cdp.js click <urlSubstr> '#selector'                  # 页面世界 dispatch（不触发插件，别用）
node cdp.js shot <urlSubstr> out.png                       # 截图（当前模型看不了图，弃用）
```
- **★ 最重要坑**：content script 在隔离世界，页面世界 `dispatchEvent(click)` **不触发插件监听**，必须用 `mouseclick`（CDP Input 真实点击）。

**3. 本地测试站 `/root/test-site/news/`**（HTTP 服务在 tmux 会话 `testsite`，端口 8090）
- `http://127.0.0.1:8090/news/index.html` 列表页（4篇新闻标题）
- `http://127.0.0.1:8090/news/a1.html` ~ a4.html 详情页（h1 标题 + 多段正文，够长能朗读高亮）
- 结构按 `findArticleLinks()` 特征构造（article>h2>a，标题8-80字），能被识别。

**4. 环境注意**
- `speechSynthesis` 在无声卡服务器可能不发声，但状态变量（`speaking`/`paused`）+ 浮动条/高亮 DOM 足以判断逻辑是否走通。
- **当前模型不支持看图**，调试一律用 `eval` 读 DOM 状态，不用截图。

---

## 四、已验证 / 待办

**已验证**
- 插件注入成功，FAB 在列表页/详情页都出现（`fabDisplay=flex`）。
- 列表页点 FAB 会因"正文太短（<50字）"被插件跳过（符合预期逻辑）。

**待办（按顺序）**
1. 用 `mouseclick` 重测详情页 FAB 播放——确认能否真正触发 content script（此前 dispatch 方式无效；真实点击后状态仍 `barActive=false`、`fabDisplay=flex`，疑似走了 startReading 内部 stopReading→showFAB 的失败回退，需开调试日志细看）。
2. 复现轮播"按了没播放"bug，按四个卡点定位。
3. 实施上面 5 项改动（改前先 `.bak` 备份）。
4. 改完打包新 zip（旧版在 /root/files/from-you/readmate-v1.4.3.zip，按版本号递增），交给用户装。

---

## 五、其他提醒
- 用户是"梁老师"，编码偏弱：方案要说人话、讲重点。
- 本次任务用户明确要求"先讨论方案再动手"；方案已确认，新会话可以直接开工。
- 主力号/Gemini 多账号池的配置与插件无关，但新会话默认模型已是 Gemini 3.7 池，无需再动。
