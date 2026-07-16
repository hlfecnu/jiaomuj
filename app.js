const state = {
  defaults: null,
  results: [],
  filtered: [],
  polling: null,
  renderLimit: 200,
  staticMode: false,
  staticData: null,
};

const els = {
  fromYear: document.querySelector("#fromYear"),
  pageSize: document.querySelector("#pageSize"),
  strictMode: document.querySelector("#strictMode"),
  journals: document.querySelector("#journals"),
  yeastTerms: document.querySelector("#yeastTerms"),
  synbioTerms: document.querySelector("#synbioTerms"),
  resetJournals: document.querySelector("#resetJournals"),
  resetTerms: document.querySelector("#resetTerms"),
  searchButton: document.querySelector("#searchButton"),
  stopButton: document.querySelector("#stopButton"),
  filterText: document.querySelector("#filterText"),
  journalFilter: document.querySelector("#journalFilter"),
  sortOrder: document.querySelector("#sortOrder"),
  exportCsv: document.querySelector("#exportCsv"),
  exportJson: document.querySelector("#exportJson"),
  metricTotal: document.querySelector("#metricTotal"),
  metricJournals: document.querySelector("#metricJournals"),
  metricRelevant: document.querySelector("#metricRelevant"),
  metricUpdated: document.querySelector("#metricUpdated"),
  progressBar: document.querySelector("#progressBar"),
  statusText: document.querySelector("#statusText"),
  activeQuery: document.querySelector("#activeQuery"),
  results: document.querySelector("#results"),
  loadMore: document.querySelector("#loadMore"),
};

async function init() {
  try {
    const defaults = await fetchJson("/api/defaults");
    state.defaults = defaults.defaults;
  } catch {
    state.staticMode = true;
    state.staticData = await fetchStaticLiterature();
    state.defaults = state.staticData.settings;
    els.searchButton.textContent = "重新加载";
    els.stopButton.hidden = true;
  }
  fillSettings(state.defaults);

  els.searchButton.addEventListener("click", startUpdate);
  els.stopButton.addEventListener("click", stopPolling);
  els.resetJournals.addEventListener("click", () => {
    els.journals.value = state.defaults.journals.join("\n");
  });
  els.resetTerms.addEventListener("click", () => {
    els.yeastTerms.value = state.defaults.yeastTerms.join("\n");
    els.synbioTerms.value = state.defaults.synbioTerms.join("\n");
  });
  els.filterText.addEventListener("input", applyFilters);
  els.journalFilter.addEventListener("change", applyFilters);
  els.sortOrder.addEventListener("change", applyFilters);
  els.exportCsv.addEventListener("click", () => exportData("csv"));
  els.exportJson.addEventListener("click", () => exportData("json"));
  els.loadMore.addEventListener("click", () => {
    state.renderLimit += 200;
    renderResults();
  });

  await loadLiterature();
  if (state.staticMode) {
    setStatus("数据由 GitHub Actions 每天北京时间 09:00 自动更新。", 100);
  } else {
    startPolling();
  }
}

function fillSettings(defaults) {
  els.fromYear.value = defaults.fromYear;
  els.pageSize.value = defaults.pageSize;
  els.strictMode.checked = defaults.strictMode;
  els.journals.value = defaults.journals.join("\n");
  els.yeastTerms.value = defaults.yeastTerms.join("\n");
  els.synbioTerms.value = defaults.synbioTerms.join("\n");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchStaticLiterature(force = false) {
  const url = new URL("data/literature.json", document.baseURI);
  if (force) url.searchParams.set("t", Date.now());
  return fetchJson(url.toString(), { cache: "no-store" });
}

function lines(value) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectSettings() {
  return {
    fromYear: Number(els.fromYear.value || 2020),
    pageSize: Number(els.pageSize.value || 100),
    strictMode: els.strictMode.checked,
    journals: lines(els.journals.value),
    yeastTerms: lines(els.yeastTerms.value),
    synbioTerms: lines(els.synbioTerms.value),
  };
}

async function startUpdate() {
  if (state.staticMode) {
    els.searchButton.disabled = true;
    setStatus("正在读取最新文献数据...", 50);
    try {
      await loadLiterature(true);
      setStatus("已加载最新文献数据。每天北京时间 09:00 自动更新。", 100);
    } catch (error) {
      setStatus(`重新加载失败：${error.message}`, 0);
    } finally {
      els.searchButton.disabled = false;
    }
    return;
  }

  const settings = collectSettings();
  if (!settings.journals.length || !settings.yeastTerms.length || !settings.synbioTerms.length) {
    setStatus("请至少保留 1 个期刊、1 个酵母关键词和 1 个合成生物学关键词。", 0);
    return;
  }

  els.searchButton.disabled = true;
  els.stopButton.disabled = false;
  els.activeQuery.textContent = `${describeScope(settings)} · ${settings.fromYear} 年以来 · 含中文翻译`;
  await fetchJson("/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });
  startPolling();
}

function startPolling() {
  if (state.staticMode) return;
  stopPolling(false);
  state.polling = setInterval(refreshStatus, 1600);
  refreshStatus();
}

function stopPolling(enableButton = true) {
  if (state.polling) {
    clearInterval(state.polling);
    state.polling = null;
  }
  if (enableButton) {
    els.searchButton.disabled = false;
    els.stopButton.disabled = true;
  }
}

async function refreshStatus() {
  try {
    const status = await fetchJson("/api/status");
    const updateState = status.updateState || {};
    setStatus(formatStatus(updateState, status), updateState.progress || 0);
    els.searchButton.disabled = Boolean(updateState.running);
    els.stopButton.disabled = !updateState.running;

    if (!updateState.running) {
      await loadLiterature();
      stopPolling();
    }
  } catch (error) {
    setStatus(`状态读取失败：${error.message}`, 0);
  }
}

async function loadLiterature(force = false) {
  const data = state.staticMode
    ? force
      ? await fetchStaticLiterature(true)
      : state.staticData || (await fetchStaticLiterature())
    : await fetchJson("/api/literature");
  state.staticData = state.staticMode ? data : null;
  state.results = prepareArticles(data.articles || []);
  const settings = data.settings || state.defaults;
  els.activeQuery.textContent = `${describeScope(settings)} · ${settings.fromYear || 2020} 年以来`;
  applyFilters();
  updateStatusMetric(data.updatedAt, data.updateState?.nextRunAt);
}

function formatStatus(updateState, status) {
  const next = updateState.nextRunAt ? `下次自动更新：${formatDate(updateState.nextRunAt)}` : "自动更新未排程";
  const count = status.count ? `当前缓存 ${status.count} 篇。` : "当前暂无缓存结果。";
  return `${updateState.lastMessage || "准备就绪"}。${count}${next}`;
}

function describeScope(settings = {}) {
  if (settings.coverageMode === "all" || state.staticMode) return "全部收录期刊";
  return `${settings.journals?.length || 0} 个期刊`;
}

function prepareArticles(articles) {
  const keywordLabels = new Map([
    ["saccharomyces cerevisiae", "酿酒酵母"],
    ["s. cerevisiae", "酿酒酵母"],
    ["saccharomyces boulardii", "布拉氏酵母"],
    ["s. boulardii", "布拉氏酵母"],
    ["pichia pastoris", "毕赤酵母"],
    ["komagataella phaffii", "毕赤酵母"],
    ["yarrowia lipolytica", "解脂耶氏酵母"],
    ["schizosaccharomyces pombe", "粟酒裂殖酵母"],
    ["synthetic biology", "合成生物学"],
    ["metabolic engineering", "代谢工程"],
    ["genome engineering", "基因组工程"],
    ["genome editing", "基因组编辑"],
    ["crispr", "CRISPR"],
    ["strain engineering", "菌株工程"],
    ["pathway engineering", "通路工程"],
    ["protein engineering", "蛋白质工程"],
    ["directed evolution", "定向进化"],
    ["synthetic genome", "合成基因组"],
    ["synthetic chromosome", "合成基因组"],
  ]);

  const normalized = articles.map((article) => {
    const fallbackKeywords = [...(article.matchedYeast || []), ...(article.matchedSynbio || [])]
      .map((item) => keywordLabels.get(String(item).toLowerCase()) || item)
      .filter(Boolean);
    const mainKeywords = [...new Set(article.mainKeywords?.length ? article.mainKeywords : fallbackKeywords)].slice(0, 10);
    const relevanceScore = Number(article.relevanceScore ?? (article.matchedYeast?.length && article.matchedSynbio?.length ? 68 : 40));
    return {
      ...article,
      mainKeywords,
      relevanceScore,
      relevanceLevel: article.relevanceLevel || (relevanceScore >= 78 ? "高度相关" : relevanceScore >= 60 ? "较高相关" : "相关"),
      articleScore: Number(article.articleScore ?? Math.min(100, Math.round(relevanceScore * 0.75 + 15))),
      citationCount: Number(article.citationCount || 0),
    };
  });

  const journalGroups = new Map();
  normalized.forEach((article) => {
    if (!journalGroups.has(article.journal)) journalGroups.set(article.journal, []);
    journalGroups.get(article.journal).push(article);
  });
  const fallbackRanking = Array.from(journalGroups, ([journal, items]) => ({
    journal,
    items,
    score: Math.round(items.reduce((sum, item) => sum + item.articleScore, 0) / items.length),
  })).sort((a, b) => b.score - a.score);
  fallbackRanking.forEach((entry, index) => {
    const percentile = fallbackRanking.length > 1 ? index / fallbackRanking.length : 0;
    const quartile = percentile < 0.25 ? "Q1" : percentile < 0.5 ? "Q2" : percentile < 0.75 ? "Q3" : "Q4";
    entry.items.forEach((article) => {
      article.journalScore = Number(article.journalScore ?? entry.score);
      article.journalQuartile = article.journalQuartile || quartile;
      article.journalMetricSource = article.journalMetricSource || "站内同主题文献动态分区";
    });
  });
  return normalized;
}

function applyFilters() {
  state.renderLimit = 200;
  const filterText = els.filterText.value.trim().toLowerCase();
  const journal = els.journalFilter.value;

  state.filtered = state.results.filter((article) => {
    const haystack = [
      article.title,
      article.titleZh,
      article.authors,
      article.journal,
      article.doi,
      article.abstract,
      article.abstractZh,
      ...(article.mainKeywords || []),
      article.relevanceLevel,
      article.journalQuartile,
    ]
      .join(" ")
      .toLowerCase();
    const textMatch = !filterText || haystack.includes(filterText);
    const journalMatch = !journal || article.journal === journal;
    return textMatch && journalMatch;
  });

  const sortOrder = els.sortOrder.value;
  const scoreKey = {
    articleScore: "articleScore",
    relevance: "relevanceScore",
    journalScore: "journalScore",
    citations: "citationCount",
  }[sortOrder];
  state.filtered.sort((a, b) => {
    if (scoreKey) return Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0) || String(b.date || "").localeCompare(String(a.date || ""));
    return String(b.date || "").localeCompare(String(a.date || ""));
  });

  updateJournalFilter();
  updateMetrics();
  renderResults();
}

function updateJournalFilter() {
  const current = els.journalFilter.value;
  const journals = [...new Set(state.results.map((article) => article.journal).filter(Boolean))].sort();
  els.journalFilter.innerHTML = '<option value="">全部期刊</option>';
  journals.forEach((journal) => {
    const option = document.createElement("option");
    option.value = journal;
    option.textContent = journal;
    els.journalFilter.append(option);
  });
  if (journals.includes(current)) els.journalFilter.value = current;
}

function updateMetrics() {
  const journals = new Set(state.filtered.map((article) => article.journal).filter(Boolean));
  const highlyRelevant = state.filtered.filter((article) => Number(article.relevanceScore || 0) >= 78).length;
  els.metricTotal.textContent = String(state.filtered.length);
  els.metricJournals.textContent = String(journals.size);
  els.metricRelevant.textContent = String(highlyRelevant);
  els.exportCsv.disabled = !state.filtered.length;
  els.exportJson.disabled = !state.filtered.length;
}

function updateStatusMetric(updatedAt, nextRunAt) {
  if (updatedAt) {
    els.metricUpdated.textContent = formatDate(updatedAt, true);
  } else if (nextRunAt) {
    els.metricUpdated.textContent = "待自动更新";
  } else {
    els.metricUpdated.textContent = "未更新";
  }
}

function renderResults() {
  if (!state.filtered.length) {
    els.loadMore.hidden = true;
    els.results.innerHTML = `
      <div class="empty-state">
        <strong>${state.results.length ? "没有符合当前筛选的文献" : "尚未搜集文献"}</strong>
        <p>${state.results.length ? "尝试清空筛选词或切换期刊。" : "点击“立即更新”会搜集文献、生成中文标题与中文摘要，并保存到本地缓存。"}</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filtered.slice(0, state.renderLimit).forEach((article) => {
    const item = document.createElement("article");
    item.className = "article";
    const quartileClass = `quartile-${String(article.journalQuartile || "q4").toLowerCase()}`;
    const relevanceClass = Number(article.relevanceScore || 0) >= 78 ? "relevance-high" : "score-pill";
    item.innerHTML = `
      <a class="article-title" href="${escapeAttr(article.url || article.doiUrl || "#")}" target="_blank" rel="noreferrer">${escapeHtml(article.titleZh || article.title)}</a>
      ${article.titleZh ? `<p class="english-title">${escapeHtml(article.title)}</p>` : ""}
      <p class="meta">
        <span class="pill">${escapeHtml(article.journal || "Unknown journal")}</span>
        <span class="pill">${escapeHtml(String(article.date || article.year || "Unknown date"))}</span>
        <span class="pill score-pill">文献评分 ${escapeHtml(String(article.articleScore || 0))}/100</span>
        <span class="pill ${quartileClass}" title="${escapeAttr(article.journalMetricSource || "站内同主题文献动态分区")}">站内 ${escapeHtml(article.journalQuartile || "-")}</span>
        <span class="pill score-pill">期刊评分 ${escapeHtml(String(article.journalScore || 0))}</span>
        <span class="pill ${relevanceClass}">${escapeHtml(article.relevanceLevel || "相关")} ${escapeHtml(String(article.relevanceScore || 0))}%</span>
        <span class="pill">引用 ${escapeHtml(String(article.citationCount || 0))}</span>
        ${article.doi ? `<a class="pill link-pill" href="${escapeAttr(article.doiUrl)}" target="_blank" rel="noreferrer">DOI ${escapeHtml(article.doi)}</a>` : ""}
        ${article.pmid ? `<a class="pill link-pill" href="${escapeAttr(article.pmidUrl)}" target="_blank" rel="noreferrer">PubMed ${escapeHtml(article.pmid)}</a>` : ""}
        ${article.sourceUrl ? `<a class="pill link-pill" href="${escapeAttr(article.sourceUrl)}" target="_blank" rel="noreferrer">原文链接</a>` : ""}
      </p>
      ${article.authors ? `<p class="authors">${escapeHtml(article.authors)}</p>` : ""}
      <div class="tag-row">
        <span class="keyword-label">主要关键词</span>
        ${(article.mainKeywords || []).slice(0, 10).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      ${article.abstractZh ? `<p class="abstract zh">${escapeHtml(truncate(article.abstractZh, 520))}</p>` : ""}
      ${article.abstract ? `<p class="abstract">${escapeHtml(truncate(article.abstract, 420))}</p>` : ""}
    `;
    fragment.append(item);
  });

  els.results.replaceChildren(fragment);
  const displayed = Math.min(state.renderLimit, state.filtered.length);
  els.loadMore.hidden = displayed >= state.filtered.length;
  els.loadMore.textContent = `加载更多（已显示 ${displayed} / ${state.filtered.length}）`;
}

function setStatus(message, progress) {
  els.statusText.textContent = message;
  els.progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function exportData(type) {
  if (type === "json") {
    downloadBlob(JSON.stringify(state.filtered, null, 2), "yeast-synbio-literature-zh.json", "application/json");
    return;
  }

  const headers = [
    "titleZh",
    "title",
    "journal",
    "date",
    "year",
    "authors",
    "doi",
    "doiUrl",
    "pmid",
    "pmidUrl",
    "sourceUrl",
    "articleScore",
    "journalScore",
    "journalQuartile",
    "relevanceScore",
    "relevanceLevel",
    "citationCount",
    "mainKeywords",
    "organismKeywords",
    "technologyKeywords",
    "matchedYeast",
    "matchedSynbio",
    "abstractZh",
    "abstract",
  ];
  const rows = state.filtered.map((article) =>
    headers.map((key) => csvCell(Array.isArray(article[key]) ? article[key].join("; ") : article[key] || "")).join(",")
  );
  downloadBlob([headers.join(","), ...rows].join("\n"), "yeast-synbio-literature-zh.csv", "text/csv;charset=utf-8");
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function truncate(value, limit) {
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
}

function formatDate(value, compact = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: compact ? "2-digit" : "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value || "#");
}

init().catch((error) => {
  console.error(error);
  setStatus(`初始化失败：${error.message}`, 0);
});
