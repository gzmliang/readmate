# ReadMate（读伴）Chrome Web Store 官方上架全套申报指南

---

## 一、上架核心基本信息

| 申报字段 (Field) | 中文填写内容 (Chinese) | 英文填写内容 (English) | 说明 / 限制 |
| :--- | :--- | :--- | :--- |
| **扩展名称 (Name)** | ReadMate - 网页朗读与跟读助手 (TTS) | ReadMate: Read Aloud & Text to Speech (TTS) | 优化海外与国内 ASO/SEO 大词，直击 TTS 刚需 |
| **版本号 (Version)** | `1.0.9` | `1.0.9` | 以 `manifest.json` 的 `version` 为唯一权威（见 `CHANGELOG.md`） |
| **简短摘要 (Summary)** | 纯净网页双语朗读助手。支持全屏沉浸净读、Edge-TTS高清语音、即时查词与AI深度摘要，读外文新闻轻松跟上。 | Read web articles with natural neural voices, bilingual subtitles, immersive distraction-free mode and AI summaries. | 严格控制在 132 字符以内 |
| **主要类别 (Category)** | 生产工具 (Productivity) 或 新闻与天气 (News & Weather) | Productivity / Accessibility | 推荐【Productivity】 |
| **支持语言 (Language)** | 中文 (简体)、英语 (共覆盖 8 种语言) | English, Chinese Simplified, etc. | 自动读取 `_locales` |

---

## 二、详细描述 (Detailed Description)

### 【商店文案：英文版】（Store Description —— 后台只填这一份）

> 2026-09-26 梁老师拍板：**商店不再使用中文文案**（中文介绍只保留在个人网站）。
> 英文文案必须守住「零关键词堆砌」红线（Yellow Argon 判罚依据）：
> 1. 严禁罗列适用人群（language learners / researchers / ESL students …）；
> 2. 严禁枚举文件格式串（txt / Markdown / EPUB / PDF 这类格式清单）；
> 3. 严禁把发布日志塞进描述里，与下面的功能章节重复叙述同一件事。

```markdown
ReadMate is a privacy-friendly text-to-speech (TTS) and immersive reading companion for your browser.

Listen to articles with high-definition neural voices, read along with synchronized word highlighting, or eliminate online distractions with our full-screen Reader Mode.

🌟 Key Features:

1. 📖 Immersive Reader Mode
Transform cluttered web pages into a clean, book-like reading layout with soothing themes (Vintage Sepia, Dark, E-Ink, etc.). Enjoy sentence-by-sentence read-along highlighting, PDF export, and one-click MP3 audiobook downloads.

2. 📚 Book Page - Read Your Own Books
Import your own e-books into a dedicated reading page and read them exactly like web articles: narration, click-to-read, dictionary lookup, bilingual translation and export all work the same way. A small library keeps your books in order and remembers how far you got.

3. ☁️ Natural Voices & Neural TTS
Supports crystal-clear neural speech with natural pacing and emotion. Choose between local browser voices for zero latency or cloud neural voices for supreme naturalness.

4. 🌐 Bilingual Streaming & Audio Subtitles
Switch seamlessly between original audio, translated audio, or alternate bilingual playback. Live bilingual floating subtitles keep you on track without losing context.

5. ⚡ Instant Vocabulary & AI Highlights
Hover or select words to view instant definitions, phonetic transcriptions, and save them to your personal notebook. Trigger AI summaries to distill thousands of words into bilingual bullet points in seconds.

🔒 Privacy First:
- Zero Data Collection: Your reading preferences and vocabulary stay strictly in your local browser storage.
- Offline Parsing: Files you open are processed entirely inside your browser - nothing is ever uploaded to any server.
- Ad-Free & Distraction-Free: Clean and lightweight experience with no promotional clutter.
```

### 【What's new 字段】（后台单独的发布说明字段，务必短，不要重复功能列表）

```text
Book Page: import your own e-books and read them like web articles, with a small library and automatic reading progress.
Reading now starts from the exact sentence you click, with a quick confirmation bubble before playback.
The floating ball can be dragged anywhere on the page.
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
- **公开隐私政策链接 (Privacy Policy URL)** ➔ 填入官方 GitHub 页面：  
  `https://gzmliang.github.io/readmate/` （开启 Pages 后）  
  或直接使用 Raw 链接（现已 100% 连通生效）：  
  `https://raw.githubusercontent.com/gzmliang/readmate/gh-pages/privacy.html`

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
  `http://p-plus.duckdns.org/readmate.zip` 或 `/usr/share/nginx/html/readmate.zip`
- **代码状态**：内部版本保持 `2.14.6`，外部呈现 `1.0.0`，完全满足安全与审核需求。
