// ReadMate / 读伴 — 阅读统计跟踪器
// 会话记录、字数统计、日/周/月汇总、持久化存储

const ReadingStats = (() => {
  'use strict';

  const STORAGE_KEY = 'readmate_stats';
  const MAX_HISTORY = 365; // 保留最多一年

  // ====== 数据结构 ======

  /** 获取空白的统计数据 */
  function emptyStats() {
    return {
      totalSessions: 0,
      totalCharsRead: 0,
      totalTimeMs: 0,
      totalArticles: 0,
      dailyLog: {},      // { '2026-06-27': { chars: N, timeMs: N, sessions: N } }
      monthlyLog: {},    // { '2026-06': { chars: N, timeMs: N, sessions: N } }
      lastUpdated: null,
      version: 2,
    };
  }

  /** 获取今日日期字符串 */
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  /** 获取本月字符串 */
  function monthStr() {
    return new Date().toISOString().slice(0, 7);
  }

  // ====== 核心操作 ======

  /** 从存储加载统计数据 */
  function load() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const data = result[STORAGE_KEY];
        if (data && data.version === 2) {
          resolve(data);
        } else {
          resolve(emptyStats());
        }
      });
    });
  }

  /** 保存统计数据 */
  function save(stats) {
    return new Promise((resolve) => {
      stats.lastUpdated = new Date().toISOString();
      chrome.storage.local.set({ [STORAGE_KEY]: stats }, () => {
        resolve();
      });
    });
  }

  /** 记录一次朗读会话 */
  async function recordSession(text, timeMs) {
    const stats = await load();
    const today = todayStr();
    const month = monthStr();
    const chars = text ? text.trim().length : 0;
    const sentences = text ? text.trim().split(/[.!?。！？；;]/).filter(s => s.trim().length > 0).length : 0;

    // 总量
    stats.totalSessions += 1;
    stats.totalCharsRead += chars;
    stats.totalTimeMs += timeMs;
    if (sentences > 3) stats.totalArticles += 1;

    // 日统计
    if (!stats.dailyLog[today]) {
      stats.dailyLog[today] = { chars: 0, timeMs: 0, sessions: 0 };
    }
    stats.dailyLog[today].chars += chars;
    stats.dailyLog[today].timeMs += timeMs;
    stats.dailyLog[today].sessions += 1;

    // 月统计
    if (!stats.monthlyLog[month]) {
      stats.monthlyLog[month] = { chars: 0, timeMs: 0, sessions: 0 };
    }
    stats.monthlyLog[month].chars += chars;
    stats.monthlyLog[month].timeMs += timeMs;
    stats.monthlyLog[month].sessions += 1;

    // 清理过期数据
    cleanupOldData(stats);

    await save(stats);
    return { chars, timeMs, sentences };
  }

  /** 清理超过保留期的数据 */
  function cleanupOldData(stats) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_HISTORY);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const day of Object.keys(stats.dailyLog)) {
      if (day < cutoffStr) {
        delete stats.dailyLog[day];
      }
    }

    // 清理旧月份
    const cutoffMonth = cutoffStr.slice(0, 7);
    for (const month of Object.keys(stats.monthlyLog)) {
      if (month < cutoffMonth) {
        delete stats.monthlyLog[month];
      }
    }
  }

  /** 获取今日统计摘要 */
  async function getTodayStats() {
    const stats = await load();
    const today = todayStr();
    const daily = stats.dailyLog[today] || { chars: 0, timeMs: 0, sessions: 0 };
    return {
      ...daily,
      totalCharsRead: stats.totalCharsRead,
      totalSessions: stats.totalSessions,
      totalArticles: stats.totalArticles,
    };
  }

  /** 获取本周统计 */
  async function getWeekStats() {
    const stats = await load();
    const now = new Date();
    const dayOfWeek = now.getDay() || 7; // 周日=7
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek + 1);

    let chars = 0, timeMs = 0, sessions = 0;
    for (let d = new Date(monday); d <= now; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayData = stats.dailyLog[dateStr];
      if (dayData) {
        chars += dayData.chars;
        timeMs += dayData.timeMs;
        sessions += dayData.sessions;
      }
    }
    return { chars, timeMs, sessions };
  }

  /** 获取本月统计 */
  async function getMonthStats() {
    const stats = await load();
    const month = monthStr();
    return stats.monthlyLog[month] || { chars: 0, timeMs: 0, sessions: 0 };
  }

  /** 获取全部数据 */
  async function getAllStats() {
    return await load();
  }

  /** 重置统计数据 */
  async function resetStats() {
    await save(emptyStats());
  }

  /** 格式化时间（毫秒 → 可读字符串） */
  function formatTime(ms) {
    if (ms < 1000) return '0秒';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `${minutes}分${secs}秒`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}小时${mins}分`;
  }

  /** 格式化字数 */
  function formatChars(count) {
    if (count < 1000) return `${count}`;
    if (count < 10000) return `${(count / 1000).toFixed(1)}千`;
    if (count < 1000000) return `${(count / 10000).toFixed(1)}万`;
    return `${(count / 10000).toFixed(0)}万`;
  }

  /** 获取每日阅读趋势（近7天） */
  async function getWeekTrend() {
    const stats = await load();
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayData = stats.dailyLog[dateStr] || { chars: 0, timeMs: 0, sessions: 0 };
      trend.push({
        date: dateStr,
        weekday: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
        ...dayData,
      });
    }
    return trend;
  }

  // 导出公共 API
  return {
    recordSession,
    getTodayStats,
    getWeekStats,
    getMonthStats,
    getAllStats,
    resetStats,
    formatTime,
    formatChars,
    getWeekTrend,
    STORAGE_KEY,
  };
})();
