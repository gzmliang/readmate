# ReadMate（读伴）国际化（i18n）全量改造设计

> **核心目标**：彻底消灭代码内硬编码中文，支持界面语言动态切换（Popup、Options、网页浮动条、摘要卡片、右键菜单、Toast 提示），并设计“防迷路”语言切换器（国旗/图标极简切换），防止误设语言后无法切回。

---

## 一、“防迷路”语言切换器设计（即使不懂文字也能一键切回）

### 1. 痛点场景
用户如果不小心把语言切成了自己完全看不懂的语言（比如俄语、阿拉伯语、德语），界面所有文字全变了，用户无法通过文字找到“设置/界面语言”菜单切回。

### 2. 视觉防迷路解法（常驻顶部图标矩阵 / 国旗胶囊）
在 Popup 弹窗与 Options 页面最顶部右上角，常驻一个**永远不需要翻译的极简语言图标栏**：
- 🌐 `[ 🇨🇳 中文 | 🇺🇸 EN | 🇯🇵 日本語 ]`
- 或者一个醒目的地球图标 🌐，点击直接展开带国旗的语言列表。
- **无论当前界面处于什么语言，这组国旗与原生语言名字永远固定不变**，任何用户一眼就能识别并一秒切回母语！

---

## 二、语言资源包扩展（`_locales`）

除了现有的 `zh_CN` 和 `en`，标准扩展支持主流多语种目录：
- `_locales/zh_CN/messages.json`（简体中文）
- `_locales/en/messages.json`（English）
- `_locales/ja/messages.json`（日本語）
- `_locales/es/messages.json`（Español）

---

## 三、全端国际化替换清单（零硬编码）

### 1. 网页注入端（`content.js` + `content.css`）
- **浮动条模式下拉**：
  - `🔊 仅读原文` → `_('modeOriginal')`
  - `🌐 直接读译文` → `_('modeTranslated')`
  - `🔄 双语交替读` → `_('modeBilingual')`
- **按钮 Title 与文字**：
  - `⚡ 摘要` → `_('btnSummary')`
  - `字幕` → `_('lblSubtitles')`
  - `上一句 / 播放 / 下一句 / 停止` → `_('btnPrev')`, `_('btnPlay')`, `_('btnNext')`, `_('btnStop')`
- **⚡ AI 摘要弹窗**：
  - `⚡ AI 双语核心要闻摘要` → `_('summaryCardTitle')`
  - `🗣️ 读原文` / `🌐 读译文` → `_('readOriginal')` / `_('readTranslated')`
  - `▶ 连播摘要 (双语)` → `_('playAllSummary')`
  - `📋 复制 Markdown` → `_('copyMarkdown')`
- **Toast 提示语**：
  - `正在由 AI 提炼 3 句双语核心快报...` → `_('generatingSummary')`
  - `当前文章已朗读完毕` → `_('articleFinished')`
  - `正文过短（<50字），无法朗读` → `_('textTooShort')`

### 2. 工具栏弹窗（`popup.html` + `popup.js`）
- 所有 label、button、option 全部通过 `data-i18n` 属性或统一 `localize()` 函数注入，不在 HTML 写死文字。
- 服务商预设与模式描述多语言化。

### 3. 设置页面（`options.html` + `options.js`）
- 全页面统一接入 `_locales`。

---

## 四、动态语言联动广播机制
当用户在 Popup 或 Options 切换界面语言时：
1. 本地存储 `uiLanguage`。
2. 通过 `chrome.tabs.sendMessage` 向所有活动标签页广播 `languageChanged` 事件。
3. 网页上的浮动条和摘要卡片**无需刷新页面，瞬间原地重新渲染为新语言**。
