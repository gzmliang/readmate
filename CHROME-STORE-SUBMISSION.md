# ReadMate（读伴）Chrome Web Store 官方上架全套申报指南

---

## 一、上架核心基本信息

| 申报字段 (Field) | 中文填写内容 (Chinese) | 英文填写内容 (English) | 说明 / 限制 |
| :--- | :--- | :--- | :--- |
| **扩展名称 (Name)** | ReadMate / 读伴 — 网页双语朗读与AI精读助手 | ReadMate — Immersive Web Reader, TTS & AI Study | 建议 45 字符内，突出朗读与沉浸阅读 |
| **版本号 (Version)** | `1.0.0` | `1.0.0` | 内部版本为 `1.0.0 (internal 2.14.6)` |
| **简短摘要 (Summary)** | 纯净网页双语朗读助手。支持全屏沉浸净读、Edge-TTS高清语音、即时查词与AI深度摘要，读外文新闻轻松跟上。 | Read web articles with natural neural voices, bilingual subtitles, immersive distraction-free mode and AI summaries. | 严格控制在 132 字符以内 |
| **主要类别 (Category)** | 生产工具 (Productivity) 或 新闻与天气 (News & Weather) | Productivity / Accessibility | 推荐【Productivity】 |
| **支持语言 (Language)** | 中文 (简体)、英语 (共覆盖 8 种语言) | English, Chinese Simplified, etc. | 自动读取 `_locales` |

---

## 二、详细描述 (Detailed Description)

### 【中文版推荐文案】（可直接复制粘贴到后台）
```markdown
ReadMate（读伴）是一款为深度阅读者、外语学习者打造的纯净网页朗读与 AI 辅助阅读扩展。

无论您是在阅读外语长篇新闻、技术博客、论文，还是想在做家务、通勤时“听”网页，读伴都能提供如丝般顺滑的声画同步体验。

🌟 核心功能亮点：

1. 📖 墨阅级“沉浸净读模式”（Reader Mode）
一键滤除网页杂乱广告、侧边栏干扰，以典雅全屏书页（羊皮纸、夜间黑等 6 款护眼底色）呈现正文。支持字号调节、声画双层高亮跟读、一键排版导出纯净 PDF，更支持整篇打包下载为 MP3 有声书！

2. ☁️ 高品质云端与原生语音（TTS）
内置高质量自然语音支持，支持 Edge-TTS 拟真情感发音，亦可调用浏览器本地原生语音（零延迟）；同时开放通用 OpenAI 兼容语音协议，随心切换。

3. 🌐 双轨对照与自由听读
支持【仅听原文】、【外文直接读译文】、【双语对照交替朗读】三档模式。在控制条优雅显示双语流动字幕，满足自学外语的精听精读需求。

4. ⚡ 毫秒级极速查词 + AI 核心摘要
遇到生词鼠标轻触即显音标与权威释义，支持一键加入生词本导出 Markdown；点击摘要按钮，大模型可在数秒内为您提炼全篇 4~6 条中英双语核心要点。

🔒 隐私与品质承诺：
- 零数据收集：所有阅读设置、生词仅存储在您的浏览器本地。
- 无广告干扰：纯净独立开发，绝不插入推广内容。
- 极轻资源占用：纯原生 JavaScript 驱动，秒开不卡顿。
```

### 【英文版推荐文案】（English Description for Store）
```markdown
ReadMate is an elegant, privacy-friendly text-to-speech (TTS) and immersive reading companion designed for language learners, researchers, and daily readers.

Listen to articles with high-definition neural voices, read along with synchronized word highlighting, or eliminate online distractions with our full-screen Reader Mode.

🌟 Key Features:

1. 📖 Immersive Reader Mode
Transform cluttered web pages into a clean, book-like reading layout with 6 soothing themes (Vintage Sepia, Dark, E-Ink, etc.). Enjoy sentence-by-sentence read-along highlighting, PDF export, and one-click MP3 audiobook downloads.

2. ☁️ High-Definition TTS & Neural Voices
Supports crystal-clear neural speech with natural pacing and emotion. Choose between local browser voices for zero latency or cloud neural voices for supreme naturalness.

3. 🌐 Bilingual Streaming & Audio Subtitles
Switch seamlessly between original audio, translated audio, or alternate bilingual playback. Live bilingual floating subtitles keep you on track without losing context.

4. ⚡ Instant Vocabulary & AI Highlights
Hover or select words to view instant definitions, phonetic transcriptions, and save them to your personal notebook. Trigger AI summaries to distill thousands of words into bilingual bullet points in seconds.

🔒 Privacy First:
- Zero Data Collection: Your reading preferences and vocabulary stay strictly in your local browser storage.
- Ad-Free & Distraction-Free.
```

---

## 三、权限合规性声明（审核最关键：单用途声明）

在 Developer Dashboard 的 **“Privacy Practices (隐私权规范)”** 标签页中，官方会要求填写权限使用理由：

### 1. 单一用途说明 (Single Purpose)
> **英文填报：**  
> "ReadMate is a text-to-speech reading assistant that extracts web page article content to provide synchronized audio narration, distraction-free reading layout, and vocabulary learning tools for the user."

### 2. 权限必要性陈述 (Permission Justification)
- **`activeTab` & `scripting`**：  
  > "Required to inspect and format the user's currently active tab when they explicitly click to read or enter reader mode, applying sentence highlights and displaying reading controls locally."
- **`storage`**：  
  > "Required to persist user preferences locally, such as reading speed, selected TTS voice, UI language, and user-provided API configurations across sessions."
- **`contextMenus`**：  
  > "Required to provide right-click shortcut actions allowing users to quickly 'Read selection' or 'Translate selection'."

### 3. 用户数据使用声明 (User Data FAQ)
- **是否出售用户数据？** ➔ 选择 **否 (No)**
- **是否用于与功能无关的广告/信贷？** ➔ 选择 **否 (No)**
- **公开隐私政策链接 (Privacy Policy URL)** ➔ 推荐使用 GitHub Pages 托管，或直接填写 GitHub 仓库公开 Raw 链接：  
  `https://raw.githubusercontent.com/gzmliang/readmate/main/PRIVACY-POLICY.md`  
  （或者您在 GitHub 上建立 `gh-pages` 后的地址：`https://gzmliang.github.io/readmate/privacy.html`）

---

## 四、商店陈列截图清单 (Store Assets)

已在实机 Chromium 1280x800 分辨率下生成全套高质量标准陈列图，存放于：
`/root/projects/readmate-ext/store-assets/`

1. `screenshot-1-floating-player.png`：**有声播放浮动胶囊条与双语字幕**
2. `screenshot-2-reader-mode.png`：**墨阅级全屏沉浸净读模式（羊皮纸护眼主题）**
3. `screenshot-3-ai-summary.png`：**AI 核心要点双语摘要卡片**
4. `screenshot-4-settings.png`：**全功能多语言设置与个性化配置**

---

## 五、正式上架安装包下载

- **AList 交付目录**：  
  `/root/files/from-you/readmate-v1.0.0-store.zip` (214KB)
- **下载站直链目录**：  
  `http://powerplus.blogsyte.com/readmate.zip` 或 `/usr/share/nginx/html/readmate.zip`
- **代码状态**：内部版本保持 `2.14.6`，外部呈现 `1.0.0`，完全满足安全与审核需求。
