const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "literature.json");
const translationCacheFile = path.join(dataDir, "translation-cache.json");
const preferredPort = Number(process.env.PORT || 5174);
const host = process.env.HOST || "127.0.0.1";

const API_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const TRANSLATE_BASE = "https://translate.googleapis.com/translate_a/single";
const TRANSLATION_CACHE_VERSION = "utf8-v3";

const DEFAULTS = {
  fromYear: 2020,
  pageSize: 500,
  maxResults: 5000,
  coverageMode: "all",
  strictMode: true,
  journals: [
    "Cell",
    "Nature",
    "Science",
    "Cancer Cell",
    "Cell Biomaterials",
    "Cell Chemical Biology",
    "Cell Genomics",
    "Cell Host & Microbe",
    "Cell Metabolism",
    "Cell Reports",
    "Cell Reports Medicine",
    "Cell Reports Methods",
    "Cell Reports Physical Science",
    "Cell Stem Cell",
    "Cell Systems",
    "Chem",
    "Chem Catalysis",
    "Current Biology",
    "Device",
    "Developmental Cell",
    "Heliyon",
    "Immunity",
    "iScience",
    "Joule",
    "Matter",
    "Med",
    "Molecular Cell",
    "Molecular Plant",
    "Molecular Therapy",
    "Molecular Therapy - Methods & Clinical Development",
    "Molecular Therapy - Nucleic Acids",
    "Neuron",
    "One Earth",
    "Patterns",
    "Plant Communications",
    "STAR Protocols",
    "Structure",
    "The American Journal of Human Genetics",
    "The Innovation",
    "Trends in Biotechnology",
    "Trends in Genetics",
    "Trends in Microbiology",
    "Trends in Plant Science",
    "Nature Aging",
    "Nature Biomedical Engineering",
    "Nature Biotechnology",
    "Nature Cancer",
    "Nature Catalysis",
    "Nature Cell Biology",
    "Nature Chemical Biology",
    "Nature Chemical Engineering",
    "Nature Chemistry",
    "Nature Communications",
    "Nature Computational Science",
    "Nature Ecology & Evolution",
    "Nature Food",
    "Nature Genetics",
    "Nature Human Behaviour",
    "Nature Machine Intelligence",
    "Nature Metabolism",
    "Nature Methods",
    "Nature Microbiology",
    "Nature Nanotechnology",
    "Nature Plants",
    "Nature Protocols",
    "Nature Reviews Genetics",
    "Nature Reviews Microbiology",
    "Nature Reviews Molecular Cell Biology",
    "Nature Synthesis",
    "Nature Structural & Molecular Biology",
    "npj Biofilms and Microbiomes",
    "npj Metabolic Health and Disease",
    "npj Systems Biology and Applications",
    "Scientific Data",
    "Scientific Reports",
    "Science Advances",
    "Science Immunology",
    "Science Robotics",
    "Science Signaling",
    "Science Translational Medicine",
  ],
  yeastTerms: [
    "yeast",
    "Saccharomyces cerevisiae",
    "Saccharomyces",
    "Kluyveromyces",
    "Pichia pastoris",
    "Komagataella phaffii",
    "Ogataea polymorpha",
    "Yarrowia lipolytica",
    "Schizosaccharomyces pombe",
    "Candida",
    "Debaryomyces",
    "Hansenula",
    "Scheffersomyces",
    "Zygosaccharomyces",
    "Saccharomyces boulardii",
    "S. boulardii",
    "brewer's yeast",
    "baker's yeast",
    "budding yeast",
    "methylotrophic yeast",
  ],
  synbioTerms: [
    "synthetic biology",
    "synthetic genomics",
    "metabolic engineering",
    "genome engineering",
    "strain engineering",
    "genetic circuit",
    "biosensor",
    "biofoundry",
    "bioproduction",
    "biomanufacturing",
    "biosynthesis",
    "fermentation",
    "pathway engineering",
    "protein engineering",
    "CRISPR",
    "directed evolution",
    "synthetic genome",
    "synthetic chromosome",
    "genome editing",
    "gene editing",
    "gene modification",
    "heterologous expression",
    "promoter engineering",
    "enzyme engineering",
    "adaptive laboratory evolution",
    "microbial cell factory",
    "cell factory",
    "chassis engineering",
    "whole-cell biosensor",
  ],
};

const KEYWORD_GROUPS = [
  { label: "酿酒酵母", category: "organism", terms: ["saccharomyces cerevisiae", "s. cerevisiae", "baker's yeast", "budding yeast", "brewer's yeast"] },
  { label: "布拉氏酵母", category: "organism", terms: ["saccharomyces boulardii", "s. boulardii", "boulardii"] },
  { label: "毕赤酵母", category: "organism", terms: ["pichia pastoris", "komagataella phaffii"] },
  { label: "解脂耶氏酵母", category: "organism", terms: ["yarrowia lipolytica"] },
  { label: "粟酒裂殖酵母", category: "organism", terms: ["schizosaccharomyces pombe", "s. pombe"] },
  { label: "克鲁维酵母", category: "organism", terms: ["kluyveromyces"] },
  { label: "多形汉逊酵母", category: "organism", terms: ["ogataea polymorpha", "hansenula polymorpha"] },
  { label: "念珠菌", category: "organism", terms: ["candida"] },
  { label: "非传统酵母", category: "organism", terms: ["non-conventional yeast", "nonconventional yeast", "methylotrophic yeast"] },
  { label: "酵母", category: "organism", terms: ["yeast", "saccharomyces"] },
  { label: "合成生物学", category: "technology", terms: ["synthetic biology", "synthetic genomics"] },
  { label: "代谢工程", category: "technology", terms: ["metabolic engineering", "metabolic pathway"] },
  { label: "基因组编辑", category: "technology", terms: ["genome editing", "gene editing", "gene modification"] },
  { label: "CRISPR", category: "technology", terms: ["crispr", "cas9", "cas12"] },
  { label: "菌株工程", category: "technology", terms: ["strain engineering", "chassis engineering"] },
  { label: "通路工程", category: "technology", terms: ["pathway engineering"] },
  { label: "合成基因组", category: "technology", terms: ["synthetic genome", "synthetic chromosome", "sc2.0"] },
  { label: "异源表达", category: "technology", terms: ["heterologous expression", "heterologous pathway"] },
  { label: "启动子工程", category: "technology", terms: ["promoter engineering", "promoter library"] },
  { label: "蛋白质工程", category: "technology", terms: ["protein engineering", "enzyme engineering"] },
  { label: "定向进化", category: "technology", terms: ["directed evolution", "adaptive laboratory evolution"] },
  { label: "遗传回路", category: "technology", terms: ["genetic circuit", "gene circuit"] },
  { label: "生物传感器", category: "technology", terms: ["biosensor", "whole-cell biosensor"] },
  { label: "细胞工厂", category: "technology", terms: ["cell factory", "microbial cell factory"] },
  { label: "生物制造", category: "technology", terms: ["biomanufacturing", "bioproduction", "biosynthesis", "fermentation"] },
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

let updateState = {
  running: false,
  lastMessage: "等待首次更新",
  lastStartedAt: null,
  lastFinishedAt: null,
  nextRunAt: null,
  progress: 0,
};

function logError(error) {
  ensureDataDir();
  const message = error?.stack || error?.message || String(error);
  fs.appendFileSync(path.join(dataDir, "server-error.log"), `[${new Date().toISOString()}]\n${message}\n\n`, "utf8");
}

process.on("uncaughtException", (error) => {
  logError(error);
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  logError(error);
  console.error(error);
});

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function quoteTerm(term) {
  return term.includes(" ") || term.includes("&") ? `"${term}"` : term;
}

function buildQuery(journal, yeastTerms, synbioTerms, fromYear, strictMode) {
  const yeastQuery = yeastTerms.map(quoteTerm).join(" OR ");
  const synbioQuery = synbioTerms.map(quoteTerm).join(" OR ");
  const biologyQuery = strictMode
    ? `((${yeastQuery}) AND (${synbioQuery}))`
    : `((${yeastQuery}) OR (${synbioQuery}))`;

  const journalClause = journal ? `JOURNAL:"${journal}" AND ` : "";
  return `${journalClause}FIRST_PDATE:[${fromYear}-01-01 TO 2099-12-31] AND HAS_ABSTRACT:Y AND ${biologyQuery}`;
}

async function fetchJournal(query, pageSize, maxResults = pageSize) {
  const results = [];
  let cursorMark = "*";

  while (results.length < maxResults) {
    const params = new URLSearchParams({
      query,
      format: "json",
      resultType: "core",
      cursorMark,
      pageSize: String(Math.min(pageSize, maxResults - results.length)),
      sort: "FIRST_PDATE_D desc",
    });
    const response = await fetch(`${API_BASE}POST`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!response.ok) {
      throw new Error(`Europe PMC returned ${response.status}`);
    }
    const data = await response.json();
    const page = data?.resultList?.result || [];
    results.push(...page);
    const nextCursorMark = data?.nextCursorMark;
    if (!page.length || !nextCursorMark || nextCursorMark === cursorMark) break;
    cursorMark = nextCursorMark;
  }

  return results.slice(0, maxResults);
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function findKeywordGroups(text, category) {
  const value = String(text || "").toLowerCase();
  return KEYWORD_GROUPS.filter(
    (group) => (!category || group.category === category) && group.terms.some((term) => value.includes(term))
  ).map((group) => group.label);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function calculateRelevance(title, abstract) {
  const titleOrganisms = findKeywordGroups(title, "organism");
  const abstractOrganisms = findKeywordGroups(abstract, "organism");
  const titleTechnologies = findKeywordGroups(title, "technology");
  const abstractTechnologies = findKeywordGroups(abstract, "technology");
  const organisms = unique([...titleOrganisms, ...abstractOrganisms]);
  const technologies = unique([...titleTechnologies, ...abstractTechnologies]);

  let score = 0;
  score += titleOrganisms.length ? 28 : abstractOrganisms.length ? 18 : 0;
  score += titleTechnologies.length ? 30 : abstractTechnologies.length ? 20 : 0;
  score += Math.min(12, Math.max(0, organisms.length - 1) * 4);
  score += Math.min(18, Math.max(0, technologies.length - 1) * 3);
  if (technologies.some((item) => ["基因组编辑", "CRISPR", "合成基因组", "菌株工程"].includes(item))) score += 8;
  if ((titleOrganisms.length && technologies.length) || (titleTechnologies.length && organisms.length)) score += 5;
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    level: score >= 78 ? "高度相关" : score >= 60 ? "较高相关" : score >= 42 ? "相关" : "低相关",
    organisms,
    technologies,
    mainKeywords: unique([...titleOrganisms, ...titleTechnologies, ...abstractOrganisms, ...abstractTechnologies]).slice(0, 10),
  };
}

function calculateArticleScore(article) {
  const age = Math.max(1, new Date().getFullYear() - Number(article.year || new Date().getFullYear()) + 1);
  const citationsPerYear = Number(article.citationCount || 0) / age;
  const citationScore = Math.min(25, Math.log2(citationsPerYear + 1) * 6);
  const metadataScore = (article.doi ? 4 : 0) + (article.abstract ? 4 : 0) + (article.authors ? 2 : 0);
  const recencyScore = Math.max(2, 10 - Math.max(0, age - 1) * 1.2);
  return Math.round(Math.min(100, article.relevanceScore * 0.55 + citationScore + metadataScore + recencyScore));
}

function normalizeArticle(raw, targetJournal, yeastTerms, synbioTerms, fromYear) {
  const title = stripTags(raw.title || "Untitled");
  const abstract = stripTags(raw.abstractText || "");
  const text = `${title} ${abstract}`.toLowerCase();
  const matchedYeast = yeastTerms.filter((term) => text.includes(term.toLowerCase()));
  const matchedSynbio = synbioTerms.filter((term) => text.includes(term.toLowerCase()));
  const journalMeta = raw.journalInfo?.journal || {};
  const journal = raw.journalTitle || raw.journal || journalMeta.title || targetJournal || "";
  const year = Number(raw.pubYear || raw.firstPublicationDate?.slice(0, 4) || 0);
  const doiUrl = raw.doi ? `https://doi.org/${raw.doi}` : "";
  const pmidUrl = raw.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${raw.pmid}/` : "";
  const sourceUrl = raw.fullTextUrlList?.fullTextUrl?.[0]?.url || "";
  const relevance = calculateRelevance(title, abstract);
  const article = {
    title,
    titleZh: "",
    journal,
    targetJournal: targetJournal || "全部收录期刊",
    issn: raw.issn || raw.journalInfo?.printIssn || journalMeta.issn || "",
    eissn: raw.essn || raw.journalInfo?.electronicIssn || journalMeta.essn || "",
    year,
    date: raw.firstPublicationDate || raw.firstIndexDate || raw.pubYear || "",
    authors: raw.authorString || "",
    doi: raw.doi || "",
    doiUrl,
    pmid: raw.pmid || "",
    pmidUrl,
    pmcid: raw.pmcid || "",
    abstract,
    abstractZh: "",
    url: doiUrl || pmidUrl || sourceUrl,
    sourceUrl,
    citationCount: Number(raw.citedByCount || 0),
    relevanceScore: relevance.score,
    relevanceLevel: relevance.level,
    organismKeywords: relevance.organisms,
    technologyKeywords: relevance.technologies,
    mainKeywords: relevance.mainKeywords,
    matchedYeast: relevance.organisms.length ? relevance.organisms : matchedYeast,
    matchedSynbio: relevance.technologies.length ? relevance.technologies : matchedSynbio,
    included: year >= fromYear && Boolean(journal) && raw.source !== "PPR",
  };
  article.articleScore = calculateArticleScore(article);

  return article;
}

function sortArticles(a, b) {
  return (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title);
}

function articleKey(article) {
  return article.doi || article.pmid || article.pmcid || article.title.toLowerCase();
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function assignJournalMetrics(articles) {
  const groups = new Map();
  articles.forEach((article) => {
    const key = article.journal || "Unknown journal";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  });

  const ranked = Array.from(groups, ([journal, items]) => {
    const citationRates = items.map((item) => {
      const age = Math.max(1, new Date().getFullYear() - Number(item.year || new Date().getFullYear()) + 1);
      return Number(item.citationCount || 0) / age;
    });
    const averageArticleScore = items.reduce((sum, item) => sum + Number(item.articleScore || 0), 0) / items.length;
    const averageRelevance = items.reduce((sum, item) => sum + Number(item.relevanceScore || 0), 0) / items.length;
    const citationComponent = Math.min(20, Math.log2(median(citationRates) + 1) * 6);
    const sampleComponent = Math.min(10, Math.log2(items.length + 1) * 2.5);
    const score = Math.round(Math.min(100, averageArticleScore * 0.55 + averageRelevance * 0.15 + citationComponent + sampleComponent));
    return { journal, items, score, articleCount: items.length, medianCitationsPerYear: Number(median(citationRates).toFixed(2)) };
  }).sort((a, b) => b.score - a.score || b.articleCount - a.articleCount || a.journal.localeCompare(b.journal));

  ranked.forEach((entry, index) => {
    const percentile = ranked.length > 1 ? index / ranked.length : 0;
    const quartile = percentile < 0.25 ? "Q1" : percentile < 0.5 ? "Q2" : percentile < 0.75 ? "Q3" : "Q4";
    entry.items.forEach((article) => {
      article.journalScore = entry.score;
      article.journalQuartile = quartile;
      article.journalArticleCount = entry.articleCount;
      article.journalMedianCitationsPerYear = entry.medianCitationsPerYear;
      article.journalMetricSource = "站内同主题文献动态分区";
    });
  });
}

async function translateText(text, cache, cacheKey) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (cache[cacheKey]) return cache[cacheKey];

  const params = new URLSearchParams({
    client: "gtx",
    sl: "en",
    tl: "zh-CN",
    dt: "t",
    q: value.slice(0, 1200),
  });
  const googleUrl = `${TRANSLATE_BASE}?${params.toString()}`;
  const data = await fetchJsonForTranslation(googleUrl);
  const translated = Array.isArray(data?.[0])
    ? data[0].map((part) => part?.[0] || "").join("")
    : "";
  cache[cacheKey] = translated || value;
  return cache[cacheKey];
}

function fetchJsonByHttps(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 YeastLiteratureLibrary/1.0",
          Accept: "application/json,text/plain,*/*",
        },
        timeout: 20000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Translation returned ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("timeout", () => {
      request.destroy(new Error("Translation timeout"));
    });
    request.on("error", reject);
  });
}

async function fetchJsonByFetch(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 YeastLiteratureLibrary/1.0",
        Accept: "application/json,text/plain,*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Translation returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function fetchJsonForTranslation(url) {
  return process.platform === "win32" ? fetchJsonByPowerShell(url) : fetchJsonByFetch(url);
}

function fetchJsonByPowerShell(url) {
  return new Promise((resolve, reject) => {
    const escapedUrl = url.replaceAll("'", "''");
    const command = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; $r=Invoke-WebRequest -Uri '${escapedUrl}' -UseBasicParsing -TimeoutSec 30; $r.RawContentStream.Position=0; $reader=New-Object System.IO.StreamReader($r.RawContentStream,[System.Text.Encoding]::UTF8); $reader.ReadToEnd()`;
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      { timeout: 45000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

async function translateArticle(article, cache) {
  const key = articleKey(article);
  try {
    article.titleZh = await translateText(article.title, cache, `${TRANSLATION_CACHE_VERSION}:${key}:title`);
    article.abstractZh = await translateText(article.abstract, cache, `${TRANSLATION_CACHE_VERSION}:${key}:abstract`);
  } catch (error) {
    article.translationError = error.message;
    article.titleZh = article.titleZh || "";
    article.abstractZh = article.abstractZh || "";
  }
  return article;
}

function normalizeSettings(settings = {}) {
  const fromYear = Number(settings.fromYear || DEFAULTS.fromYear);
  const pageSize = Math.max(20, Math.min(1000, Number(settings.pageSize || DEFAULTS.pageSize)));
  const maxResults = Math.max(pageSize, Math.min(5000, Number(settings.maxResults || DEFAULTS.maxResults)));
  return {
    fromYear,
    pageSize,
    maxResults,
    coverageMode: settings.coverageMode === "journal-list" ? "journal-list" : DEFAULTS.coverageMode,
    strictMode: settings.strictMode !== false,
    journals: Array.isArray(settings.journals) && settings.journals.length ? settings.journals : DEFAULTS.journals,
    yeastTerms: Array.isArray(settings.yeastTerms) && settings.yeastTerms.length ? settings.yeastTerms : DEFAULTS.yeastTerms,
    synbioTerms:
      Array.isArray(settings.synbioTerms) && settings.synbioTerms.length ? settings.synbioTerms : DEFAULTS.synbioTerms,
  };
}

async function collectLiterature(settings = DEFAULTS) {
  if (updateState.running) {
    return readJson(dataFile, { articles: [], settings, updatedAt: null, updateState });
  }

  const normalized = normalizeSettings(settings);
  const seen = new Map();
  const translationCache = readJson(translationCacheFile, {});
  updateState = {
    ...updateState,
    running: true,
    lastStartedAt: new Date().toISOString(),
    lastMessage: "开始更新文献",
    progress: 0,
  };

  try {
    const journalScopes = normalized.coverageMode === "all" ? [null] : normalized.journals;
    for (let index = 0; index < journalScopes.length; index += 1) {
      const journal = journalScopes[index];
      updateState.progress = Math.round((index / journalScopes.length) * 55);
      updateState.lastMessage = journal ? `正在检索 ${journal}` : "正在检索全部收录期刊";
      const query = buildQuery(
        journal,
        normalized.yeastTerms,
        normalized.synbioTerms,
        normalized.fromYear,
        normalized.strictMode
      );
      const rawArticles = await fetchJournal(
        query,
        normalized.pageSize,
        normalized.coverageMode === "all" ? normalized.maxResults : normalized.pageSize
      );
      rawArticles
        .map((raw) => normalizeArticle(raw, journal, normalized.yeastTerms, normalized.synbioTerms, normalized.fromYear))
        .filter((article) => article.included && article.relevanceScore >= 42)
        .forEach((article) => {
          const key = articleKey(article);
          if (!seen.has(key)) seen.set(key, article);
        });
    }

    const articles = Array.from(seen.values()).sort(sortArticles);
    let translatedCount = 0;
    const workers = Array.from({ length: Math.min(3, Math.max(articles.length, 1)) }, async (_, workerIndex) => {
      for (let index = workerIndex; index < articles.length; index += 3) {
        updateState.lastMessage = `正在翻译 ${translatedCount + 1}/${articles.length}`;
        await translateArticle(articles[index], translationCache);
        translatedCount += 1;
        updateState.progress = 55 + Math.round((translatedCount / Math.max(articles.length, 1)) * 35);
        if (translatedCount % 10 === 0) writeJson(translationCacheFile, translationCache);
      }
    });
    await Promise.all(workers);
    writeJson(translationCacheFile, translationCache);
    assignJournalMetrics(articles);

    const payload = {
      updatedAt: new Date().toISOString(),
      settings: normalized,
      articles,
      updateState: {
        ...updateState,
        running: false,
        progress: 100,
        lastMessage: `更新完成，共 ${articles.length} 篇`,
        lastFinishedAt: new Date().toISOString(),
      },
    };
    writeJson(dataFile, payload);
    updateState = { ...payload.updateState, nextRunAt: updateState.nextRunAt };
    return payload;
  } catch (error) {
    updateState = {
      ...updateState,
      running: false,
      lastFinishedAt: new Date().toISOString(),
      lastMessage: `更新失败：${error.message}`,
    };
    throw error;
  }
}

function nextTomorrowRun() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

function scheduleNextDailyUpdate() {
  const next = updateState.nextRunAt ? new Date(updateState.nextRunAt) : nextTomorrowRun();
  updateState.nextRunAt = next.toISOString();
  const delay = Math.max(1000, next.getTime() - Date.now());
  setTimeout(async () => {
    try {
      await collectLiterature(DEFAULTS);
    } catch (error) {
      console.error(error);
    } finally {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      updateState.nextRunAt = tomorrow.toISOString();
      scheduleNextDailyUpdate();
    }
  }, delay);
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const currentPort = server.address()?.port || preferredPort;
  const url = new URL(req.url || "/", `http://${host}:${currentPort}`);

  try {
    if (url.pathname === "/api/defaults") {
      sendJson(res, 200, { defaults: DEFAULTS, updateState });
      return;
    }

    if (url.pathname === "/api/status") {
      const data = readJson(dataFile, { articles: [], updatedAt: null });
      sendJson(res, 200, {
        updateState,
        updatedAt: data.updatedAt || null,
        count: data.articles?.length || 0,
      });
      return;
    }

    if (url.pathname === "/api/literature") {
      const data = readJson(dataFile, { articles: [], updatedAt: null, settings: DEFAULTS });
      sendJson(res, 200, { ...data, updateState });
      return;
    }

    if (url.pathname === "/api/update" && req.method === "POST") {
      const body = await readRequestBody(req);
      collectLiterature(body.settings || DEFAULTS).catch((error) => console.error(error));
      sendJson(res, 202, { ok: true, updateState: { ...updateState, lastMessage: "更新任务已启动" } });
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

let attemptedPort = preferredPort;

function listen(port) {
  attemptedPort = port;
  server.listen(port, host, () => {
    console.log(`Yeast literature library is running at http://${host}:${port}`);
    console.log(`Next automatic update: ${updateState.nextRunAt}`);
  });
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    listen(attemptedPort + 1);
    return;
  }
  throw error;
});

function startServer() {
  ensureDataDir();
  scheduleNextDailyUpdate();
  listen(preferredPort);
}

if (require.main === module) startServer();

module.exports = {
  DEFAULTS,
  assignJournalMetrics,
  buildQuery,
  calculateArticleScore,
  calculateRelevance,
  collectLiterature,
  fetchJournal,
  normalizeSettings,
  startServer,
};
