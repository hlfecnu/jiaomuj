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
  pageSize: 100,
  strictMode: true,
  journals: [
    "Cell",
    "Nature",
    "Science",
    "Cell Chemical Biology",
    "Cell Genomics",
    "Cell Host & Microbe",
    "Cell Metabolism",
    "Cell Reports",
    "Cell Reports Methods",
    "Cell Reports Physical Science",
    "Cell Systems",
    "Developmental Cell",
    "Molecular Cell",
    "Nature Biotechnology",
    "Nature Catalysis",
    "Nature Chemical Biology",
    "Nature Chemistry",
    "Nature Communications",
    "Nature Genetics",
    "Nature Machine Intelligence",
    "Nature Metabolism",
    "Nature Methods",
    "Nature Microbiology",
    "Nature Nanotechnology",
    "Nature Plants",
    "Nature Protocols",
    "Nature Structural & Molecular Biology",
    "Science Advances",
    "Science Robotics",
    "Science Signaling",
    "Science Translational Medicine",
  ],
  yeastTerms: [
    "yeast",
    "Saccharomyces cerevisiae",
    "Saccharomyces",
    "Pichia pastoris",
    "Komagataella phaffii",
    "Yarrowia lipolytica",
    "Schizosaccharomyces pombe",
  ],
  synbioTerms: [
    "synthetic biology",
    "metabolic engineering",
    "genome engineering",
    "genetic circuit",
    "biosensor",
    "bioproduction",
    "pathway engineering",
    "CRISPR",
    "directed evolution",
    "synthetic genome",
  ],
};

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

  return `JOURNAL:"${journal}" AND FIRST_PDATE:[${fromYear}-01-01 TO 2099-12-31] AND ${biologyQuery}`;
}

async function fetchJournal(query, pageSize) {
  const params = new URLSearchParams({
    query,
    format: "json",
    resultType: "core",
    pageSize: String(pageSize),
    sort: "FIRST_PDATE_D desc",
  });
  const response = await fetch(`${API_BASE}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Europe PMC returned ${response.status}`);
  }
  const data = await response.json();
  return data?.resultList?.result || [];
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function normalizeArticle(raw, targetJournal, yeastTerms, synbioTerms, fromYear) {
  const title = stripTags(raw.title || "Untitled");
  const abstract = stripTags(raw.abstractText || "");
  const text = `${title} ${abstract}`.toLowerCase();
  const matchedYeast = yeastTerms.filter((term) => text.includes(term.toLowerCase()));
  const matchedSynbio = synbioTerms.filter((term) => text.includes(term.toLowerCase()));
  const journal = raw.journalTitle || raw.journal || targetJournal;
  const year = Number(raw.pubYear || raw.firstPublicationDate?.slice(0, 4) || 0);
  const doiUrl = raw.doi ? `https://doi.org/${raw.doi}` : "";
  const pmidUrl = raw.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${raw.pmid}/` : "";
  const sourceUrl = raw.fullTextUrlList?.fullTextUrl?.[0]?.url || "";

  return {
    title,
    titleZh: "",
    journal,
    targetJournal,
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
    matchedYeast,
    matchedSynbio,
    included: year >= fromYear,
  };
}

function sortArticles(a, b) {
  return (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title);
}

function articleKey(article) {
  return article.doi || article.pmid || article.pmcid || article.title.toLowerCase();
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
  const data = await fetchJsonByPowerShell(googleUrl);
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
          "User-Agent": "Mozilla/5.0 LiteratureRadar/1.0",
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
  const pageSize = Math.max(20, Math.min(200, Number(settings.pageSize || DEFAULTS.pageSize)));
  return {
    fromYear,
    pageSize,
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
    for (let index = 0; index < normalized.journals.length; index += 1) {
      const journal = normalized.journals[index];
      updateState.progress = Math.round((index / normalized.journals.length) * 70);
      updateState.lastMessage = `正在检索 ${journal}`;
      const query = buildQuery(
        journal,
        normalized.yeastTerms,
        normalized.synbioTerms,
        normalized.fromYear,
        normalized.strictMode
      );
      const rawArticles = await fetchJournal(query, normalized.pageSize);
      rawArticles
        .map((raw) => normalizeArticle(raw, journal, normalized.yeastTerms, normalized.synbioTerms, normalized.fromYear))
        .filter((article) => article.included)
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
        updateState.progress = 70 + Math.round((translatedCount / Math.max(articles.length, 1)) * 25);
        if (translatedCount % 10 === 0) writeJson(translationCacheFile, translationCache);
      }
    });
    await Promise.all(workers);
    writeJson(translationCacheFile, translationCache);

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

ensureDataDir();
scheduleNextDailyUpdate();

let attemptedPort = preferredPort;

function listen(port) {
  attemptedPort = port;
  server.listen(port, host, () => {
    console.log(`Literature radar is running at http://${host}:${port}`);
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

listen(preferredPort);
