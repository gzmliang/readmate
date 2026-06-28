// ReadMate / 读伴 — 内容提取引擎（类 Readability）
// 从网页中提取正文内容，过滤广告/导航/侧栏/页脚

const ContentExtractor = (() => {
  'use strict';

  // ====== 需要剔除的标签 ======
  const STRIP_TAGS = [
    'script', 'style', 'noscript', 'iframe', 'nav', 'footer',
    'header', 'aside', 'form', 'button', 'select', 'input',
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
    if (STRIP_TAGS.includes(tag)) return true;
    if (matchesStripPattern(el)) return true;
    // 隐藏元素
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
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

    // 标题
    const title =
      document.querySelector('h1')?.textContent?.trim() ||
      document.querySelector('title')?.textContent?.trim() ||
      '';

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
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
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
    let currentParagraph = '';
    for (let i = 0; i < textNodes.length; i++) {
      const text = textNodes[i].textContent.trim();
      const parent = textNodes[i].parentNode;
      const isBlock = parent && ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH'].includes(parent.tagName);

      if (isBlock && currentParagraph) {
        result.paragraphs.push(currentParagraph);
        currentParagraph = text;
      } else if (isBlock) {
        currentParagraph = text;
      } else {
        currentParagraph += (currentParagraph ? ' ' : '') + text;
      }
    }
    if (currentParagraph) {
      result.paragraphs.push(currentParagraph);
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

  /** 查找当前页面的文章列表链接 */
  function findArticleLinks() {
    const links = document.querySelectorAll('a[href]');
    const articles = [];

    for (const a of links) {
      const href = a.href;
      const text = a.textContent.trim();

      // 过滤无效链接
      if (!href || href.startsWith('javascript:') || href.startsWith('#')) continue;
      if (href === window.location.href) continue;
      if (text.length < 5) continue;

      // 偏好有文章特征的URL
      const isArticle = /\/(article|post|story|news|p|entry)\//i.test(href) ||
                        /\/\d{4}\/\d{2}\//.test(href) ||  // /2024/06/... 日期路径
                        /\/\d{5,}\b/.test(href);  // 数字ID

      if (isArticle && text.length > 5 && text.length < 200) {
        articles.push({ url: href, title: text });
      }
    }

    // 去重
    const seen = new Set();
    return articles.filter(a => {
      const key = a.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20); // 最多20篇
  }

  // 导出公共 API
  return {
    extract,
    hasArticle,
    findNextPageLink,
    findArticleLinks,
    scoreElement,
    shouldStrip,
  };
})();
