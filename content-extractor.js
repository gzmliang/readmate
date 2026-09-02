// ReadMate / 读伴 — 内容提取引擎（类 Readability）
// 从网页中提取正文内容，过滤广告/导航/侧栏/页脚

const ContentExtractor = (() => {
  'use strict';

  // ====== 需要剔除的标签 ======
  const STRIP_TAGS = [
    'script', 'style', 'noscript', 'iframe', 'nav', 'footer',
    'aside', 'form', 'button', 'select', 'input',
    'textarea', 'svg', 'canvas', 'video', 'audio', 'object',
    'embed', 'applet',
  ];

  // ====== class/id 黑名单模式 ======
  const STRIP_PATTERNS = [
    /^ad-/i, /-ad$/i, /^ads/i, /_ad_/i, /sponsor/i, /promo/i,
    /^sidebar/i, /side-bar/i, /^widget/i, /^social/i, /^share/i,
    /^comment/i, /^related/i, /recommend/i, /^footer/i, /^foot-/i,
    /^nav/i, /^menu/i, /^toolbar/i, /^breadcrumb/i,
    /^cookie/i, /^popup/i, /^modal/i, /^overlay/i,
    /^newsletter/i, /^subscribe/i, /signup/i, /^login/i,
    /^search/i, /^banner/i,
    /player/i, /video-container/i, /media-player/i, /vjs-/i, /jwplayer/i,
    /sr-only/i, /screen-reader/i, /visually-hidden/i, /hide-accessible/i,
    /control-text/i, /caption-text/i,
  ];

  // ====== 内容偏好标记 ======
  const CONTENT_CLASSES = [
    /^article/i, /^post/i, /^entry/i, /^content/i, /^main/i,
    /^story/i, /^body/i, /^text/i, /^reading/i,
  ];

  // ====== 工具函数 ======

  /** 获取元素文本长度（不含子元素空白） */
  function textLength(el) {
    if (!el || !el.textContent) return 0;
    return el.textContent.replace(/\s+/g, '').length;
  }

  /** 获取元素链接密度（链接文本 / 总文本） */
  function linkDensity(el) {
    const total = textLength(el);
    if (total === 0) return 1;
    let linkText = 0;
    const links = el.querySelectorAll('a');
    for (const a of links) {
      linkText += textLength(a);
    }
    return linkText / total;
  }

  /** 检查元素是否匹配黑名单模式 */
  function matchesStripPattern(el) {
    const id = el.id || '';
    const cls = Array.from(el.classList).join(' ');
    const check = id + ' ' + cls;
    return STRIP_PATTERNS.some(p => p.test(check));
  }

  /** 检查元素是否匹配内容偏好模式 */
  function matchesContentPattern(el) {
    const id = el.id || '';
    const cls = Array.from(el.classList).join(' ');
    const check = id + ' ' + cls;
    return CONTENT_CLASSES.some(p => p.test(check));
  }

  /** 检查元素是否应该被剔除 */
  function shouldStrip(el) {
    const tag = el.tagName.toLowerCase();

    // 针对 <header> 标签的智能判断：
    // 如果包含 h1/h2 标题，或位于 article/main 内，或具有文章头部特征类名，则作为文章标题区域保留；
    // 纯全站顶部导航 header 则剔除
    if (tag === 'header') {
      const hasHeading = el.querySelector('h1, h2');
      const isArticleHeader = matchesContentPattern(el) || (el.closest && el.closest('article, main, [role="main"]'));
      if (hasHeading || isArticleHeader) {
        return false;
      }
      return true;
    }

    if (STRIP_TAGS.includes(tag)) return true;
    if (matchesStripPattern(el)) return true;
    // 隐藏元素
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch (e) {}
    // 极小元素（无内容）
    if (textLength(el) < 10 && !el.querySelector('img')) return true;
    return false;
  }

  // ====== 评分系统 ======

  /** 计算元素的内容分数 */
  function scoreElement(el) {
    let score = 0;
    const tag = el.tagName.toLowerCase();

    // 基础分
    if (tag === 'article') score += 50;
    else if (tag === 'main') score += 40;
    else if (tag === 'section') score += 20;
    else if (tag === 'p') score += 10;
    else if (tag === 'pre' || tag === 'code') score += 5;
    else if (tag === 'blockquote') score += 5;
    else if (tag === 'h1' || tag === 'h2' || tag === 'h3') score += 5;
    else if (tag === 'figure') score += 3;
    else if (tag === 'img') score += 2;
    else if (tag === 'ul' || tag === 'ol') score += 3;

    // class/id 加分
    if (matchesContentPattern(el)) score += 25;

    // 文本密度加分
    const textLen = textLength(el);
    if (textLen > 100) score += 15;
    else if (textLen > 50) score += 8;
    else if (textLen > 20) score += 3;

    // 段落数加分
    const paragraphs = el.querySelectorAll('p').length;
    score += paragraphs * 3;

    // 链接密度减分（导航/目录通常链接多）
    const ld = linkDensity(el);
    if (ld > 0.5) score -= 20;
    else if (ld > 0.3) score -= 10;

    // 行内元素减分
    if (tag === 'div' && textLen < 20) score -= 5;

    return Math.max(score, 1);
  }

  // ====== 正文提取主流程 ======

  /** 克隆文档（避免修改原始 DOM） */
  function cloneDocument() {
    return document.cloneNode(true);
  }

  /** 第一轮：移除明显非内容元素 */
  function cleanDocument(doc) {
    const all = doc.body.querySelectorAll('*');
    for (const el of all) {
      try {
        if (shouldStrip(el)) {
          el.remove();
        }
      } catch (e) {
        // 跳过异常
      }
    }
    return doc;
  }

  /** 第二轮：找最佳内容容器 */
  function findBestContainer(doc) {
    const candidates = [];

    // 优先检查 article, main, [role=main]
    const semantic = doc.querySelectorAll('article, main, [role="main"], [role="article"]');
    for (const el of semantic) {
      const score = scoreElement(el);
      candidates.push({ el, score, type: 'semantic' });
    }

    // 检查正文区域常见容器
    const allDivs = doc.body.querySelectorAll('div, section');
    for (const el of allDivs) {
      // 只检查直接子元素包含较多文本的容器
      const textLen = textLength(el);
      if (textLen < 200) continue;
      const score = scoreElement(el);
      if (score > 30) {
        candidates.push({ el, score, type: 'div' });
      }
    }

    // 按分数排序
    candidates.sort((a, b) => b.score - a.score);
    return candidates.length > 0 ? candidates[0].el : null;
  }

  /** 清洗网页 title 中的网站后缀（如 "文章标题 - 少数派" -> "文章标题"） */
  function cleanTitle(raw) {
    if (!raw) return '';
    let t = raw.trim();
    // 剔除常见的网站后缀： - 网站名 / _ 网站名 / | 网站名 等
    t = t.replace(/\s*[-_|–—•·]\s*[^-_\s|–—•·]{2,20}\s*$/, '');
    return t.trim();
  }

  /** 获取最佳文章标题 */
  function findArticleTitle() {
    // 1. 文章语义容器内的 h1
    const articleH1 = document.querySelector('article h1, main h1, [role="main"] h1, [role="article"] h1');
    if (articleH1 && articleH1.textContent.trim().length > 2) {
      return articleH1.textContent.trim();
    }
    // 2. 特征类名标题
    const classTitle = document.querySelector('.article-title, .post-title, .entry-title, h1.title, [itemprop="headline"]');
    if (classTitle && classTitle.textContent.trim().length > 2) {
      return classTitle.textContent.trim();
    }
    // 3. OpenGraph 协议标题
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (ogTitle && ogTitle.trim().length > 2) {
      return cleanTitle(ogTitle);
    }
    // 4. 普通 h1
    const anyH1 = document.querySelector('h1');
    if (anyH1 && anyH1.textContent.trim().length > 2) {
      return anyH1.textContent.trim();
    }
    // 5. 网页 title 标签
    return cleanTitle(document.title || '');
  }

  /** 判断是否是无意义的元数据杂质行（日期、作者、来源、面包屑、分享等） */
  function isGarbageParagraph(text) {
    if (!text || text.length < 2) return true;
    const t = text.trim();
    // 纯符号或极短无意义文字
    if (/^[\s*#\-_—=~·•○●※✦✧|/\\:>]+$/.test(t)) return true;
    // 面包屑导航（如 首页 > 新闻 > 正文）
    if (/^[\w\u4e00-\u9fff\s]{1,20}(?:\s*[>›/\\»]\s*[\w\u4e00-\u9fff\s]{1,20}){1,5}$/.test(t)) return true;
    // 常见元数据前缀（如 来源：新华社、作者：张三、责任编辑：李四、发布时间：2026-09-01）
    if (/^(?:发布时间|更新时间|发表时间|来源|来源网站|作者|记者|编辑|责任编辑|责任人员|栏目|分类|标签|分享到|点击|浏览量|字数|阅读量|评论数|Published|Updated|Author|Source|By\s|Date:?|Time:?|Share\s*on)[\s:：]/i.test(t)) return true;
    // 纯日期/时间
    if (/^(?:\d{4}[-/年.]\d{1,2}[-/月.]\d{1,2}[日]?|\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}\s*(?:hours?|minutes?|days?|seconds?)\s*ago)$/i.test(t)) return true;
    // 社交操作提示（如 微信扫一扫、分享至朋友圈、收藏本文）
    if (/^(?:微信扫一扫|扫码分享|分享到微信|朋友圈|微博|收藏|打印|字号|字体大小|正文字体|大中小)$/i.test(t)) return true;
    return false;
  }

  /** 从元素提取结构化正文 */
  function extractContent(container) {
    if (!container) return null;

    const result = {
      title: '',
      text: '',
      html: '',
      wordCount: 0,
      paragraphs: [],
    };

    // 智能获取核心大标题
    const title = findArticleTitle();
    result.title = title;

    // 提取有意义的文本段落
    const textNodes = [];
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent.trim();
          if (text.length < 2) return NodeFilter.FILTER_REJECT;
          const parent = node.parentNode;
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT' || parent.tagName === 'NAV')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    // 构建段落列表
    const rawParagraphs = [];
    let currentParagraph = '';
    for (let i = 0; i < textNodes.length; i++) {
      const text = textNodes[i].textContent.trim();
      const parent = textNodes[i].parentNode;
      const isBlock = parent && ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH'].includes(parent.tagName);

      if (isBlock && currentParagraph) {
        rawParagraphs.push(currentParagraph);
        currentParagraph = text;
      } else if (isBlock) {
        currentParagraph = text;
      } else {
        currentParagraph += (currentParagraph ? ' ' : '') + text;
      }
    }
    if (currentParagraph) {
      rawParagraphs.push(currentParagraph);
    }

    // 过滤杂质段落
    const cleanT = (title || '').replace(/[^\w\u4e00-\u9fff]/g, '').toLowerCase();
    for (const p of rawParagraphs) {
      const pClean = p.replace(/[^\w\u4e00-\u9fff]/g, '').toLowerCase();
      // 如果正文中再次出现了完整标题段，跳过（避免读两遍）
      if (cleanT.length > 3 && pClean === cleanT) continue;
      // 过滤前后的元数据杂质（作者、日期、来源、面包屑等）
      if (isGarbageParagraph(p)) continue;
      result.paragraphs.push(p);
    }

    // ★ 关键：确保大标题排在第一句（第 0 句），让朗读从大标题正式开始！
    if (title && title.trim().length > 1) {
      result.paragraphs.unshift(title.trim());
    }

    result.text = result.paragraphs.join('\n\n');
    result.html = container.innerHTML;
    result.wordCount = result.text.replace(/\s+/g, '').length;

    return result;
  }

  // ====== 主入口 ======

  /**
   * 从页面提取正文
   * @returns {{ title, text, html, wordCount, paragraphs, success }}
   */
  function extract() {
    try {
      const doc = cloneDocument();

      // 第一轮清洗
      const cleaned = cleanDocument(doc);

      // 找最佳容器
      let container = findBestContainer(doc);

      // 如果找不到合适容器，回退到 body
      if (!container) {
        container = cleaned.body;
      }

      const content = extractContent(container);

      if (content && content.wordCount > 50) {
        return { ...content, success: true };
      }

      // 回退：直接取 body text
      const bodyText = document.body.innerText || '';
      if (bodyText.trim().length > 50) {
        return {
          title: document.title || '',
          text: bodyText,
          html: document.body.innerHTML,
          wordCount: bodyText.replace(/\s+/g, '').length,
          paragraphs: bodyText.split(/\n{2,}/).filter(p => p.trim().length > 0),
          success: true,
          fallback: true,
        };
      }

      return { success: false, error: 'No content found' };
    } catch (e) {
      console.error('[ReadMate Extractor] Error:', e);
      // 最终回退
      const bodyText = document.body.innerText || '';
      return {
        title: document.title || '',
        text: bodyText,
        wordCount: bodyText.replace(/\s+/g, '').length,
        success: bodyText.length > 50,
        error: e.message,
      };
    }
  }

  /** 检查页面是否有可提取的文章 */
  function hasArticle() {
    const result = extract();
    return result.success && result.wordCount > 100;
  }

  // ====== 下一页检测 ======

  /** 查找页面上的 "下一页" 链接 */
  function findNextPageLink() {
    // 优先检查 rel="next"
    const relNext = document.querySelector('link[rel="next"]');
    if (relNext && relNext.href) return { url: relNext.href, text: 'Next' };

    // 检查常见的下一页按钮/链接
    const nextPatterns = [
      /下[一页篇张章]?/i, /下一页/i, /下一篇/i,
      /next/i, /older/i, /later/i,
      /»/, /›/, /≫/,
      /^[1-9][0-9]*\s*$/,  // 页码数字
    ];

    // 查找所有链接
    const links = document.querySelectorAll('a[href]');
    let bestLink = null;
    let bestScore = 0;

    for (const a of links) {
      const text = a.textContent.trim();
      const href = a.href;
      const cls = a.className || '';
      const id = a.id || '';

      let score = 0;
      const check = text + ' ' + cls + ' ' + id;

      if (/next/i.test(check)) score += 20;
      if (/下一页/i.test(check)) score += 25;
      if (/下一篇/i.test(check)) score += 25;
      if (/older/i.test(check)) score += 15;
      if (/»/.test(text) || /›/.test(text) || /≫/.test(text)) score += 15;
      // 避免"上一页"
      if (/prev/i.test(check) || /上一/i.test(check)) score -= 30;

      // 避免链接到首页
      if (/page=1/.test(href) || href === window.location.href) score -= 20;

      // 同域优先
      if (href && href.startsWith(window.location.origin || '')) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestLink = a;
      }
    }

    if (bestLink && bestScore > 15) {
      return { url: bestLink.href, text: bestLink.textContent.trim() };
    }

    return null;
  }

  /** 查找当前页面的文章列表链接（智能过滤频道导航，精确提取新闻详情页） */
  function findArticleLinks() {
    const links = document.querySelectorAll('a[href]');
    const urlMap = new Map();
    const currentOrigin = window.location.origin;
    const currentPath = window.location.pathname.replace(/\/+$/, '');

    // 纯导航/分类通用词（中英文）
    const NAV_WORDS = /^(首页|要闻|国内|国际|军事|财经|科技|娱乐|体育|汽车|房产|无障碍|登录|注册|关于|联系|反馈|帮助|更多|查看更多|详情|返回|home|news|politics|u\.s\.|us|world|business|tech|technology|science|health|sports|entertainment|video|videos|audio|live|watch|listen|opinion|lifestyle|culture|local|weather|investigations|more|all|next|prev|previous|sign\s*in|log\s*in|subscribe|privacy|terms|about|contact|advertise|help|faq|menu|search|sections|feedback|trending|popular)$/i;

    // 纯频道/专题 slug（用于排除 /news/crime-courts, /world, /tech 这类聚合页）
    const CATEGORY_SLUGS = /^(news|politics|world|us-news|crime-courts|business|tech|technology|science|health|sports|entertainment|opinion|culture|lifestyle|local|weather|video|watch|live|about|contact|privacy|terms|category|topics?|tag|tags|channel|section|specials?)$/i;

    for (const a of links) {
      const rawHref = a.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) continue;

      let fullUrl;
      try {
        fullUrl = new URL(rawHref, window.location.href);
      } catch (e) {
        continue;
      }

      // 必须同源或主域名一致
      if (fullUrl.origin !== currentOrigin) continue;

      // 规范化 URL（去除 hash 与常见跟踪参数）
      const cleanUrl = fullUrl.origin + fullUrl.pathname;
      const path = fullUrl.pathname.replace(/\/+$/, '');

      // 排除与当前页面完全相同的路径，或纯根路径
      if (path === currentPath || path === '' || path === '/') continue;

      // 排除全站通用导航/底部/侧边栏内的链接
      if (a.closest('nav, footer, header, .nav, .footer, .header, .menu, #menu, .site-header, .site-footer')) continue;

      // 排除已知无用系统路径
      if (/\/(privacy|terms|about|contact|help|faq|login|register|signin|signup|search|feed|rss|sitemap|tag|tags|author|user|profile)\b/i.test(path)) continue;

      // 提取文章标题
      let text = a.textContent.trim().replace(/\s+/g, ' ');

      // 如果 <a> 内部有标题元素，优先使用
      const heading = a.querySelector('h1, h2, h3, h4, [class*="headline"], [class*="title"]');
      if (heading && heading.textContent.trim().length > text.length) {
        text = heading.textContent.trim().replace(/\s+/g, ' ');
      }
      // 如果 <a> 文字太短，但位于卡片内，尝试从卡片中查找主标题
      if (text.length < 10) {
        const card = a.closest('article, .card, [class*="item"], [class*="tease"], li');
        if (card) {
          const cardTitle = card.querySelector('h1, h2, h3, h4, [class*="headline"], [class*="title"]');
          if (cardTitle && cardTitle.textContent.trim().length >= 10) {
            text = cardTitle.textContent.trim().replace(/\s+/g, ' ');
          }
        }
      }

      // 过滤短词与纯导航词
      if (text.length < 5 || text.length > 220) continue;
      if (NAV_WORDS.test(text)) continue;

      // 路径结构与 Slug 分析
      const pathSegments = path.split('/').filter(Boolean);
      const lastSegment = pathSegments[pathSegments.length - 1] || '';

      // 排除纯分类目录 URL（如 /news/crime-courts）
      if (CATEGORY_SLUGS.test(lastSegment)) continue;

      let score = 0;

      // 1. Slug 与文章特征评分
      const hyphenCount = (lastSegment.match(/-/g) || []).length;
      if (hyphenCount >= 3) score += 30; // 包含完整标题 slug
      else if (hyphenCount >= 1 && lastSegment.length >= 16) score += 20;

      // 常见文章 ID 模式（如 NBC 的 rcna123456, 纯数字 ID, .html 等）
      if (/(rcna\d+|\d{5,}|\.s?html?$|[a-f0-9]{8,})/i.test(lastSegment)) score += 25;
      if (/\/\d{4}[\/\-_]\d{2}[\/\-_]\d{2}\//.test(path)) score += 25; // 日期路径
      if (/\/(article|post|story|news|p|entry|view|archives|detail|content|item|report)\//i.test(path)) score += 15;

      // 2. DOM 结构特征
      if (a.closest('h1, h2, h3, h4, .headline, [class*="headline"], [class*="title"]')) score += 20;
      if (a.closest('article, [class*="tease"], [class*="card"], [class*="news-item"], [class*="post-item"]')) score += 15;

      // 3. 标题文本特征
      if (text.length >= 20 && text.length <= 130) score += 15;
      else if (text.length >= 10 && text.length < 20) score += 8;

      // 扣分项：路径太浅且没有文章标识
      if (pathSegments.length <= 1 && lastSegment.length < 15 && hyphenCount < 2) score -= 30;
      if (text.length < 10 && hyphenCount < 2) score -= 20;

      if (score >= 25) {
        if (!urlMap.has(cleanUrl)) {
          urlMap.set(cleanUrl, {
            url: fullUrl.href,
            cleanUrl: cleanUrl,
            title: text,
            score: score,
            element: a
          });
        } else {
          // 同 URL 去重，保留标题更长、更完整和评分最高的那条
          const existing = urlMap.get(cleanUrl);
          if (score > existing.score || text.length > existing.title.length) {
            existing.title = text.length > existing.title.length ? text : existing.title;
            existing.score = Math.max(score, existing.score);
            if (a.closest('h1, h2, h3, h4')) existing.element = a;
          }
        }
      }
    }

    const candidates = Array.from(urlMap.values());
    // 按 DOM 出现顺序保留最多 25 篇
    return candidates.slice(0, 25);
  }

  /** 智能语言检测：以实际正文文本特征为主准绳，结合 HTML 声明判断语种代码 */
  function detectLanguage(sampleText) {
    // 1. 优先提取实际文本样本（优先使用传入文本，否则提取页面正文文本）
    let text = (sampleText || '').trim();
    if (!text && document.body) {
      text = (document.body.innerText || '').substring(0, 1000);
    }

    if (text && text.length >= 5) {
      const hangul = (text.match(/[\uac00-\ud7af\u1100-\u11ff]/g) || []).length;
      const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
      const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      const cyrillic = (text.match(/[\u0400-\u04ff]/g) || []).length;
      const latin = (text.match(/[a-zA-Z]/g) || []).length;

      // 只要含韩文字符（优先精准锁定韩语）
      if (hangul >= 3 || (hangul > 0 && hangul >= cjk)) return 'ko-KR';
      // 只要含日文假名（优先精准锁定日语）
      if (kana >= 3) return 'ja-JP';
      // 中文汉字
      if (cjk >= 5) return 'zh-CN';
      // 俄语西里尔字母
      if (cyrillic >= 5) return 'ru-RU';
      // 拉丁语系（英语/德语/法语/西语等）
      if (latin >= 10) {
        if (/[äöüßÄÖÜ]/.test(text) || /\b(der|die|das|und|ist|nicht|für|mit|ein|eine)\b/i.test(text)) return 'de-DE';
        if (/[éèêëàâùûôîïçÉÈÊËÀÂÙÛÔÎÏÇ]/.test(text) || /\b(le|la|les|des|est|une|dans|pour|avec|que)\b/i.test(text)) return 'fr-FR';
        if (/[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(text) || /\b(el|la|los|las|por|para|con|una|del|que)\b/i.test(text)) return 'es-ES';
        if (/\b(il|la|lo|gli|che|sono|per|con|del|della)\b/i.test(text)) return 'it-IT';
        if (/[ãõáéíóúçÃÕÁÉÍÓÚÇ]/.test(text) || /\b(não|com|para|uma|dos|das|que)\b/i.test(text)) return 'pt-PT';
        return 'en-US';
      }
    }

    // 2. 只有文本样本不足或无法区分时，才回退参考 HTML 声明
    const htmlLang = (document.documentElement.lang || document.body?.getAttribute('lang') || '').toLowerCase();
    if (htmlLang.startsWith('zh')) return 'zh-CN';
    if (htmlLang.startsWith('ja')) return 'ja-JP';
    if (htmlLang.startsWith('ko')) return 'ko-KR';
    if (htmlLang.startsWith('fr')) return 'fr-FR';
    if (htmlLang.startsWith('de')) return 'de-DE';
    if (htmlLang.startsWith('es')) return 'es-ES';
    if (htmlLang.startsWith('ru')) return 'ru-RU';
    if (htmlLang.startsWith('it')) return 'it-IT';
    if (htmlLang.startsWith('pt')) return 'pt-PT';
    if (htmlLang.startsWith('en')) return 'en-US';

    return 'en-US';
  }

  // 导出公共 API
  return {
    extract,
    hasArticle,
    findNextPageLink,
    findArticleLinks,
    detectLanguage,
    scoreElement,
    shouldStrip,
  };
})();
