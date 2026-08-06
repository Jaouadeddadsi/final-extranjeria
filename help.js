import fs from "fs";
import axios from "axios";
import lodash from "lodash";
import fetch from "node-fetch";
import proxyChain from "proxy-chain";
import puppeteer from "puppeteer-extra";
import { createCursor } from "ghost-cursor";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import TelegramBot from "node-telegram-bot-api";
import moment from "moment-timezone";
import UserAgent from "user-agents";
import path from "path";
import crypto from "crypto";

import languages from "./browser-data/languages.js";

puppeteer.use(StealthPlugin());

// Get the current working directory
const owner = "jaouad"; // sukuna, leona
const captchaUserId = "jaouadeddadsi2016@gmail.com";
const captchaApikey = "qlfsQRF3b4swypsVAcnm";

// Telegram notification function copied from uploaded working script.
// Browser window size/position: 8 browsers on one 1920x1080 screen (4 columns x 2 rows)

const BROWSER_WINDOW = { width: 470, height: 450 };
const BROWSER_POSITIONS = [
  { x: 0, y: 0 },
  { x: 505, y: 0 },
  { x: 1010, y: 0 },
  { x: 1515, y: 0 },
  { x: 2020, y: 0 },
  { x: 0, y: 475 },
  { x: 505, y: 475 },
  { x: 1010, y: 475 },
  { x: 1515, y: 475 },
  { x: 2020, y: 475 },
  { x: 0, y: 930 },
  { x: 505, y: 930 },
  { x: 1010, y: 930 },
  { x: 1515, y: 930 },
  { x: 2020, y: 930 },
];

let NEXT_BROWSER_POSITION_SLOT = 0;

const PAGE_ZOOM = "55%";
const FLOW_TIMEOUT_MS = 5000;

const ACVALIDAR_CADUCADO_WAIT_MS = 5000;
const ERROR_RESTART_DELAY_MS = 0; // No sleep mode: deleted profiles restart immediately after cleanup.
const CLAVE_SERVICE_REDIRECT_TIMEOUT_MS = 20000; // Cl@ve/manual certificate selection gets up to 20 seconds.
const ACOFERTA_NO_CITA_DELETE_WAIT_MS = 3000; // acOfertarCita no-cita page stays visible 3 seconds, then profile is deleted.
const BROWSER_CLOSE_TIMEOUT_MS = 2500; // Do not let browser.close() block restart forever.
const PROFILE_DELETE_TIMEOUT_MS = 4000; // Do not let Windows locked profile folder block restart forever.
const STEP_TIMEOUT_MS = FLOW_TIMEOUT_MS;
const LONG_STEP_TIMEOUT_MS = Number(process.env.LONG_STEP_TIMEOUT_MS || 10000);
const INITIAL_NAV_TIMEOUT_MS = Number(
  process.env.INITIAL_NAV_TIMEOUT_MS || 8000,
);
const POST_SLOT_BLOCK_HOLD_MS = 2 * 60 * 1000;
const POST_SLOT_RECOVERY_WAIT_MS = FLOW_TIMEOUT_MS;
const BAD_PAGE_WATCHER_POLL_MS = Number(
  process.env.BAD_PAGE_WATCHER_POLL_MS || 500,
);
const PROXY_BLOCK_COOLDOWN_MS = Number(
  process.env.PROXY_BLOCK_COOLDOWN_MS || 2 * 60 * 1000,
);
const PROXY_EXPLORE_RATE = Math.max(
  0,
  Math.min(1, Number(process.env.PROXY_EXPLORE_RATE || 0.25)),
);
const PROXY_TOP_POOL_SIZE = Math.max(
  1,
  Number(process.env.PROXY_TOP_POOL_SIZE || 12),
);
const PROXY_STATS_FILE = process.env.PROXY_STATS_FILE || "proxy-stats.json";
const PROFILE_SEARCH_LIFETIME_MS = Math.max(
  0,
  Number(process.env.PROFILE_SEARCH_LIFETIME_MS || 2 * 60 * 1000),
);

// acOfertarCita slow profile safe wait
// Script will wait until captcha + available appointment/date/radio slot are loaded before selecting.
const ACOFERTA_READY_WAIT_MS = Number(
  process.env.ACOFERTA_READY_WAIT_MS || 10000,
);
const ACOFERTA_READY_POLL_MS = 250;
const ACVERFORMULARIO_STUCK_WAIT_MS = Number(
  process.env.ACVERFORMULARIO_STUCK_WAIT_MS || 8000,
); // If the phone page does not advance, restart quickly.
const CALENDAR_DATEPICKER_RANDOM_ATTEMPTS = Math.max(
  1,
  Number(process.env.CALENDAR_DATEPICKER_RANDOM_ATTEMPTS || 2),
);
const CALENDAR_DATEPICKER_LOAD_WAIT_MS = Math.min(
  STEP_TIMEOUT_MS,
  Math.max(300, Number(process.env.CALENDAR_DATEPICKER_LOAD_WAIT_MS || 1200)),
);
const CALENDAR_POST_SLOT_MAX_RETRIES = Math.max(
  0,
  Number(process.env.CALENDAR_POST_SLOT_MAX_RETRIES || 2),
);

function allocateBrowserPositionSlot() {
  const slot = NEXT_BROWSER_POSITION_SLOT % BROWSER_POSITIONS.length;
  NEXT_BROWSER_POSITION_SLOT += 1;
  return slot;
}

function getBrowserPositionBySlot(slot) {
  return BROWSER_POSITIONS[slot % BROWSER_POSITIONS.length];
}

function getNextBrowserPosition() {
  // Fallback for any old calls. New restart-safe flow uses a fixed slot per getAppointment().
  return getBrowserPositionBySlot(allocateBrowserPositionSlot());
}

function maskProxyForLog(proxy) {
  const value = String(proxy || "").trim();
  if (!value) return "NO_PROXY";
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || ""}`;
  } catch (error) {
    const parts = value.split("@");
    return parts[parts.length - 1].slice(0, 80);
  }
}

const activeProxyKeys = new Set();
let proxyStatsLoaded = false;
let proxyStatsStore = { version: 1, proxies: {} };

function getProxyStatsPath() {
  return path.isAbsolute(PROXY_STATS_FILE)
    ? PROXY_STATS_FILE
    : path.join(process.cwd(), PROXY_STATS_FILE);
}

function getProxyKey(proxy) {
  return crypto
    .createHash("sha256")
    .update(String(proxy || ""))
    .digest("hex")
    .slice(0, 24);
}

function loadProxyStats() {
  if (proxyStatsLoaded) return;
  proxyStatsLoaded = true;

  try {
    const filePath = getProxyStatsPath();
    if (!fs.existsSync(filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.proxies &&
      typeof parsed.proxies === "object"
    ) {
      proxyStatsStore = {
        version: 1,
        proxies: parsed.proxies,
      };
    }
  } catch (error) {
    console.log(`PROXY_STATS_LOAD_FAILED: ${error?.message || error}`);
  }
}

function saveProxyStats() {
  try {
    const filePath = getProxyStatsPath();
    fs.writeFileSync(filePath, JSON.stringify(proxyStatsStore, null, 2));
  } catch (error) {
    console.log(`PROXY_STATS_SAVE_FAILED: ${error?.message || error}`);
  }
}

function getProxyStat(proxy) {
  loadProxyStats();
  const key = getProxyKey(proxy);
  if (!proxyStatsStore.proxies[key]) {
    proxyStatsStore.proxies[key] = {
      key,
      proxyMasked: maskProxyForLog(proxy),
      score: 100,
      uses: 0,
      success: 0,
      normalErrors: 0,
      blocks: 0,
      avgMs: 0,
      cooldownUntil: 0,
      lastUsedAt: 0,
      lastStage: "",
      lastReason: "",
    };
  }
  return proxyStatsStore.proxies[key];
}

function getProxyScore(stat, now = Date.now()) {
  const cooldownPenalty = stat.cooldownUntil > now ? 10000 : 0;
  const speedPenalty = stat.avgMs ? Math.min(35, stat.avgMs / 1000) : 0;
  const staleBonus = stat.lastUsedAt
    ? Math.min(8, (now - stat.lastUsedAt) / (30 * 60 * 1000))
    : 10;
  return (
    Number(stat.score || 100) - speedPenalty - cooldownPenalty + staleBonus
  );
}

function chooseRandomItem(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

function chooseManagedProxy(proxyPool, options = {}) {
  loadProxyStats();
  if (!proxyPool.length) {
    return { proxy: "", index: -1, key: "", stat: null };
  }

  const now = Date.now();
  const forcedIndex = Number.isInteger(options.forceIndex)
    ? options.forceIndex
    : null;
  const candidates = proxyPool.map((proxy, index) => {
    const stat = getProxyStat(proxy);
    const key = getProxyKey(proxy);
    return {
      proxy,
      index,
      key,
      stat,
      active: activeProxyKeys.has(key),
      cooling: Number(stat.cooldownUntil || 0) > now,
      score: getProxyScore(stat, now),
    };
  });

  if (forcedIndex !== null) {
    const forced = candidates.find(
      (candidate) => candidate.index === forcedIndex,
    );
    if (forced && !forced.active && !forced.cooling) {
      return forced;
    }
  }

  let available = candidates.filter(
    (candidate) => !candidate.active && !candidate.cooling,
  );
  if (available.length === 0) {
    available = candidates.filter((candidate) => !candidate.cooling);
  }
  if (available.length === 0) {
    available = candidates
      .filter((candidate) => !candidate.active)
      .sort(
        (a, b) =>
          Number(a.stat.cooldownUntil || 0) - Number(b.stat.cooldownUntil || 0),
      );
  }
  if (available.length === 0) {
    available = candidates
      .slice()
      .sort(
        (a, b) =>
          Number(a.stat.cooldownUntil || 0) - Number(b.stat.cooldownUntil || 0),
      );
  }

  const unknown = available.filter(
    (candidate) => Number(candidate.stat.uses || 0) === 0,
  );
  const shouldExplore =
    unknown.length > 0 &&
    (unknown.length === available.length || Math.random() < PROXY_EXPLORE_RATE);
  if (shouldExplore) {
    return chooseRandomItem(unknown);
  }

  const ranked = available
    .map((candidate) => ({
      ...candidate,
      score: candidate.score + Math.random() * 3,
    }))
    .sort((a, b) => b.score - a.score);
  return (
    chooseRandomItem(
      ranked.slice(0, Math.min(PROXY_TOP_POOL_SIZE, ranked.length)),
    ) || ranked[0]
  );
}

function acquireManagedProxy(proxyPool, options = {}) {
  const selected = chooseManagedProxy(proxyPool, options);
  if (!selected || !selected.proxy) return selected;

  activeProxyKeys.add(selected.key);
  selected.stat.uses = Number(selected.stat.uses || 0) + 1;
  selected.stat.lastUsedAt = Date.now();
  selected.stat.proxyMasked = maskProxyForLog(selected.proxy);
  saveProxyStats();
  return selected;
}

function releaseManagedProxy(lease) {
  if (lease?.key) {
    activeProxyKeys.delete(lease.key);
  }
}

function updateProxyAverageMs(stat, elapsedMs) {
  if (!stat || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
  const previous = Number(stat.avgMs || 0);
  stat.avgMs = previous
    ? Math.round(previous * 0.75 + elapsedMs * 0.25)
    : Math.round(elapsedMs);
}

function recordManagedProxyProgress(
  lease,
  stageName,
  points = 1,
  elapsedMs = 0,
) {
  if (!lease?.stat) return;
  lease.stat.lastStage = stageName;
  lease.stat.score = Math.min(200, Number(lease.stat.score || 100) + points);
  updateProxyAverageMs(lease.stat, elapsedMs);
  saveProxyStats();
}

function recordManagedProxyResult(lease, reason, options = {}) {
  if (!lease?.stat) return;
  const stat = lease.stat;
  const blocked = !!options.blocked;
  const elapsedMs = Number(options.elapsedMs || 0);
  const lower = String(reason || "").toLowerCase();
  const usableFlow =
    lower.includes("_done") ||
    lower.includes("acoferta_no_cita") ||
    lower.includes("appointment_not_in_range") ||
    lower.includes("no_oficinas_available") ||
    lower.includes("preferred_oficina_not_available") ||
    lower.includes("max_citas") ||
    lower.includes("telefono_0006") ||
    lower.includes("profile_lifetime_restart");

  updateProxyAverageMs(stat, elapsedMs);
  stat.lastReason = String(reason || "").slice(0, 160);
  stat.lastFinishedAt = Date.now();

  if (blocked) {
    stat.blocks = Number(stat.blocks || 0) + 1;
    stat.score = Math.max(0, Number(stat.score || 100) - 25);
    stat.cooldownUntil = Date.now() + PROXY_BLOCK_COOLDOWN_MS;
    console.log(
      `PROXY_COOLDOWN_SET: ${stat.proxyMasked} ${PROXY_BLOCK_COOLDOWN_MS}ms`,
    );
  } else if (usableFlow) {
    stat.success = Number(stat.success || 0) + 1;
    stat.score = Math.min(200, Number(stat.score || 100) + 6);
  } else {
    stat.normalErrors = Number(stat.normalErrors || 0) + 1;
    stat.score = Math.max(0, Number(stat.score || 100) - 4);
  }

  saveProxyStats();
}

const selectors = {
  "N.I.E.": "#rdbTipoDocNie",
  "D.N.I.": "#rdbTipoDocDni",
  PASAPORTE: "#rdbTipoDocPas",
  ID: "#txtIdCitado",
  "Nombre y apellidos": "#txtDesCitado",
  "Año de nacimiento": "#txtAnnoCitado",
  "País de nacionalidad": "#txtPaisNac",
  "Fecha de Caducidad de tu tarjeta actual": "#txtFecha",
};

export function changeSatus(id, status) {
  const baseUrl = "https://dgtapp.vercel.app/api/extranjeria/extranjeria/";
  // Create the JSON payload
  const payload = {
    status,
  };
  // Send the POST request without waiting for the response
  fetch(`${baseUrl}${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((error) => {
    console.error("Error sending request:", error);
  });
  console.log("Request sent (fire-and-forget)");
}

function getFirstNumber() {
  const filePath = "./phones/mobiles.txt";
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const rawlines = data.split("\n");
    const lines = rawlines.filter((str) => str.length >= 6);
    if (lines.length === 0) return null;
    const firstLine = lines.shift();
    lines.push(firstLine);
    fs.writeFileSync(filePath, lines.join("\n"));
    return firstLine;
  } catch (err) {
    throw err;
  }
}

export async function fetchData() {
  const SEARCHDATA = {
    "N.I.E.": "Y2513630C",
    "D.N.I.": "29577584k",
    PASAPORTE: "Z12457",
  };
  const url = "https://dgtapp.vercel.app/api/pending";
  while (true) {
    try {
      const response = await axios.get(url);
      let data = response.data.data;
      let searchList = [];
      let datos = {};
      // Filter data by owner
      data = data.filter((item) => !["sukuna", "leona"].includes(item.owner));
      // make oficina list
      data = data.map((item) => {
        let oficina = item["oficina"].split("-");
        oficina = oficina.filter(
          (item) => item.trim() !== "" && item.trim() !== "99",
        );
        return { ...item, oficina };
      });
      data.forEach((client) => {
        const key = `${client.provincia}__${client.tramite}`;
        if (
          searchList.filter(
            (item) => `${item["provincia"]}__${item["tramite"]}` === key,
          ).length === 0
        ) {
          let searchData = lodash.cloneDeep(client);
          searchData["docId"] = SEARCHDATA[searchData["docType"]];
          searchList.push(searchData);
          datos[key] = [client];
        } else {
          datos[key].push(client);
        }
      });
      return data;
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }
}

function buildEmailLocalPartFromName(name) {
  const localPart = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase()
    .slice(0, 60);

  if (localPart) return localPart;

  // Use letters and digits for the random string
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  // Randomly select characters and join them into a string
  let randomString = "";
  for (let i = 0; i < 10; i++) {
    randomString += characters.charAt(
      Math.floor(Math.random() * characters.length),
    );
  }
  return randomString.toLowerCase();
}

export function getEmail(name = "") {
  return `${buildEmailLocalPartFromName(name)}@grr.la`;
}

export async function sendMessageToGroup(owner, message) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN ||
    "8064000963:AAFgfMVj-AP_SaNfMAo_ghZVCsYhqGquUsM";
  const chadIds = {
    sukuna: "-1002226967850",
    leona: "-1002316821074",
    jaouad: "-4635162385",
  };
  const chatId = chadIds[owner];
  const safeMessage = String(message || "").slice(0, 3900);
  if (!token || !chatId) {
    console.error("Telegram message not sent: missing token or chat id");
    return false;
  }
  const bot = new TelegramBot(token);
  try {
    await bot.sendMessage(chatId, safeMessage);
    console.log("Message sent successfully!");
    return true;
  } catch (error) {
    console.error("Error sending message:", error?.message || error);
    return false;
  }
}

async function sendLongMessageToGroup(owner, message, chunkSize = 3600) {
  let remaining = String(message || "");
  if (!remaining) return await sendMessageToGroup(owner, "");

  let allSent = true;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, chunkSize);
    if (remaining.length > chunkSize) {
      const splitAt = chunk.lastIndexOf("\n");
      if (splitAt > 1000) chunk = chunk.slice(0, splitAt);
    }

    allSent = (await sendMessageToGroup(owner, chunk)) && allSent;
    remaining = remaining.slice(chunk.length).replace(/^\n+/, "");
  }

  return allSent;
}

export function getRandomItem(currentList, originalList) {
  if (currentList.length === 0) {
    // Reset the current list when it's empty
    currentList = lodash.cloneDeep(originalList);
  }
  // Choose a random index from the current list
  const randomIndex = Math.floor(Math.random() * currentList.length);
  const selectedItem = currentList[randomIndex];
  // Remove the selected item from the current list
  currentList.splice(randomIndex, 1);
  return [selectedItem, currentList];
}

export function getItem(currentList, originalList) {
  if (currentList.length === 0) {
    // Reset the current list when it's empty
    currentList = lodash.cloneDeep(originalList);
  }
  // Choose last item in the list
  const selectedItem = currentList.pop();
  return [selectedItem, currentList];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// function to solve captcha
async function solveCaptcha(page) {
  try {
    const imgSrc = await page.$eval('img[alt="captcha"]', (img) => img.src);
    const image_data = imgSrc.replace(
      /^data:image\/(png|jpg|jpeg|gif);base64,/,
      "",
    );
    const params = {
      userid: captchaUserId,
      apikey: captchaApikey,
      data: image_data,
    };
    const urlCaptcha = "https://api.apitruecaptcha.org/one/gettext";
    const response = await fetch(urlCaptcha, {
      method: "post",
      body: JSON.stringify(params),
    });
    const data = await response.json();
    const code = String(data.result || "").trim();
    if (!code) {
      console.log("Captcha service returned an empty result");
      return false;
    }
    await page.$eval("#captcha", (input) => (input.value = ""));
    await page.type("#captcha", code);
    await page.waitForFunction(
      (selector, expectedValue) => {
        return document.querySelector(selector).value === expectedValue;
      },
      { timeout: 5000 }, // 5 second timeout
      "#captcha", // selector argument
      code, // expectedValue argument
    );
    return true;
  } catch (error) {
    console.log("Captcha fill failed:", error?.message || error);
    return false;
  }
}

async function startCaptchaSolveInBackground(page) {
  const imgSrc = await page.$eval('img[alt="captcha"]', (img) => img.src);
  const imageData = imgSrc.replace(
    /^data:image\/(png|jpg|jpeg|gif);base64,/,
    "",
  );

  const promise = (async () => {
    try {
      const response = await fetch(
        "https://api.apitruecaptcha.org/one/gettext",
        {
          method: "post",
          body: JSON.stringify({
            userid: captchaUserId,
            apikey: captchaApikey,
            data: imageData,
          }),
        },
      );
      const data = await response.json();
      const code = String(data.result || "").trim();
      if (!code) {
        console.log("CALENDAR_CAPTCHA_BACKGROUND_EMPTY_RESULT");
        return false;
      }

      const fillResult = await page
        .evaluate(
          ({ expectedImageSrc, captchaCode }) => {
            const image = document.querySelector('img[alt="captcha"]');
            const input = document.querySelector("#captcha");
            if (!image || !input)
              return { ok: false, reason: "CAPTCHA_DOM_MISSING" };
            if (String(image.src || "") !== expectedImageSrc) {
              return { ok: false, reason: "CAPTCHA_IMAGE_CHANGED" };
            }

            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )?.set;
            if (setter) setter.call(input, captchaCode);
            else input.value = captchaCode;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return {
              ok: String(input.value || "") === captchaCode,
              reason:
                String(input.value || "") === captchaCode
                  ? ""
                  : "CAPTCHA_VALUE_NOT_SET",
            };
          },
          { expectedImageSrc: imgSrc, captchaCode: code },
        )
        .catch((error) => ({
          ok: false,
          reason: error?.message || String(error),
        }));

      if (!fillResult.ok) {
        console.log(
          `CALENDAR_CAPTCHA_BACKGROUND_FILL_FAILED: ${fillResult.reason}`,
        );
      }
      return !!fillResult.ok;
    } catch (error) {
      console.log(
        `CALENDAR_CAPTCHA_BACKGROUND_FAILED: ${error?.message || error}`,
      );
      return false;
    }
  })();

  return { imageSrc: imgSrc, promise };
}

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const match = String(dateStr).match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return null;
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

function mergeOficinas(array1, array2) {
  if (!array2 || array2.length === 0) {
    return array1; // Rule 1: Return array1 if array2 is empty
  } else {
    // Rule 2: Return common values (intersection)
    return array1.filter((item) => array2.includes(item));
  }
}

function normalizeOficinaText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function oficinaMatchesKeyword(option, keyword) {
  const normalizedKeyword = normalizeOficinaText(keyword);
  if (!normalizedKeyword) return true;
  const normalizedText = normalizeOficinaText(option?.text || "");
  const normalizedValue = normalizeOficinaText(option?.value || "");
  return (
    normalizedText.includes(normalizedKeyword) ||
    normalizedValue === normalizedKeyword
  );
}

function normalizeOfficeKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function oficinaMatchesAnyKeyword(option, keywords) {
  const list = normalizeOfficeKeywordList(keywords);
  if (list.length === 0) return true;
  return list.some((keyword) => oficinaMatchesKeyword(option, keyword));
}

export function readFileLines(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf-8", (err, data) => {
      if (err) {
        return reject(err);
      }
      // Split the content into lines and filter out any empty lines
      const lines = data.split("\n").filter((line) => line.trim() !== "");
      resolve(lines);
    });
  });
}

function generateFingerprint() {
  const newUserAgent = new UserAgent({ deviceCategory: "desktop" });
  const userAgent = newUserAgent.toString();
  const language = languages[Math.floor(Math.random() * languages.length)];
  const timezone =
    moment.tz.names()[Math.floor(Math.random() * moment.tz.names().length)];
  const viewport = {
    width: BROWSER_WINDOW.width,
    height: BROWSER_WINDOW.height,
    deviceScaleFactor: 1,
  };
  return {
    userAgent,
    language,
    timezone,
    viewport,
  };
}

export async function deleteFolderRecursive(folderPath) {
  try {
    // Normalize the path to avoid issues with different OS path separators
    const normalizedPath = path.normalize(folderPath);

    // Safety check - don't allow deletion of root directories
    if (normalizedPath === path.parse(normalizedPath).root) {
      throw new Error("Attempted to delete root directory - operation blocked");
    }

    // Check if path exists
    if (!fs.existsSync(normalizedPath)) {
      console.warn(`Folder does not exist: ${normalizedPath}`);
      return;
    }

    // Check if it's actually a directory
    const stat = fs.statSync(normalizedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${normalizedPath}`);
    }

    // Delete the folder (modern fs.rm with promise version)
    await fs.promises.rm(normalizedPath, {
      recursive: true,
      force: true,
      maxRetries: 3, // Retry on Windows lock issues
      retryDelay: 100, // Wait 100ms between retries
    });

    console.log(`Successfully deleted folder: ${normalizedPath}`);
  } catch (error) {
    console.error(`Failed to delete folder ${folderPath}:`, error);
    throw error; // Re-throw to allow caller to handle
  }
}

async function closeBrowserFast(browser, label = "") {
  if (!browser) return;
  const tag = label ? ` ${label}` : "";
  try {
    await Promise.race([
      browser.close(),
      sleep(BROWSER_CLOSE_TIMEOUT_MS).then(() => {
        throw new Error("BROWSER_CLOSE_TIMEOUT");
      }),
    ]);
    console.log(`BROWSER_CLOSE_DONE${tag}`);
  } catch (error) {
    console.log(
      `BROWSER_CLOSE_FAST_TIMEOUT_FORCE_KILL${tag}: ${error?.message || error}`,
    );
    try {
      const proc =
        typeof browser.process === "function" ? browser.process() : null;
      if (proc && !proc.killed) {
        proc.kill("SIGKILL");
        console.log(`BROWSER_PROCESS_KILLED${tag}`);
      }
    } catch (killError) {
      console.log(
        `BROWSER_FORCE_KILL_FAILED${tag}: ${killError?.message || killError}`,
      );
    }
  }
}

async function deleteProfileFolderFast(profileDir, label = "") {
  if (!profileDir) return;
  const tag = label ? ` ${label}` : "";
  try {
    await Promise.race([
      deleteFolderRecursive(profileDir),
      sleep(PROFILE_DELETE_TIMEOUT_MS).then(() => {
        throw new Error("PROFILE_DELETE_TIMEOUT");
      }),
    ]);
    console.log(`PROFILE_DELETE_DONE${tag}`);
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (msg.includes("PROFILE_DELETE_TIMEOUT")) {
      console.log(
        `PROFILE_DELETE_TIMEOUT_NON_BLOCKING${tag}: fresh profile will open immediately; locked folder can be cleaned on next start.`,
      );
    } else {
      console.log(`PROFILE_DELETE_FAST_FAILED_NON_BLOCKING${tag}: ${msg}`);
    }
  }
}

async function closeAnonymizedProxyFast(proxyUrl, label = "") {
  if (!proxyUrl) return;
  const tag = label ? ` ${label}` : "";
  try {
    await proxyChain.closeAnonymizedProxy(proxyUrl, true);
    console.log(`ANONYMIZED_PROXY_CLOSED${tag}`);
  } catch (error) {
    console.log(
      `ANONYMIZED_PROXY_CLOSE_FAILED${tag}: ${error?.message || error}`,
    );
  }
}

function getChromeExecutablePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
  ].filter(Boolean);

  if (process.platform === "win32") {
    candidates.push(
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
      path.join(
        process.env.LOCALAPPDATA || "",
        "Google\\Chrome\\Application\\chrome.exe",
      ),
      path.join(
        process.env.PROGRAMFILES || "C:\\Program Files",
        "Microsoft\\Edge\\Application\\msedge.exe",
      ),
      path.join(
        process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)",
        "Microsoft\\Edge\\Application\\msedge.exe",
      ),
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium",
    );
  }

  const executablePath = candidates.find((candidate) => {
    return candidate && fs.existsSync(candidate);
  });

  if (executablePath) {
    console.log(`CHROME_EXECUTABLE: ${executablePath}`);
    return executablePath;
  }

  console.log("CHROME_EXECUTABLE: auto/default Puppeteer browser");
  return undefined;
}

async function getFirstHome() {
  const filePath = "./homes/home.txt";
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const rawlines = data.split("\n");
    const lines = rawlines.filter((str) => str.length >= 6);
    if (lines.length === 0) return null;
    const firstLine = lines.shift();
    lines.push(firstLine);
    fs.writeFileSync(filePath, lines.join("\n"));
    return firstLine;
  } catch (err) {
    throw err;
  }
}

async function launchBrowserWithFingerprint(proxy, fixedPositionSlot = null) {
  const fingerprint = generateFingerprint();
  const cleanProxy = String(proxy || "").trim();
  const newUrl = cleanProxy ? await proxyChain.anonymizeProxy(cleanProxy) : "";
  const profileDir = "./profiles/profile-" + Math.random();
  const home = await getFirstHome();
  const browserPositionSlot = Number.isInteger(fixedPositionSlot)
    ? fixedPositionSlot % BROWSER_POSITIONS.length
    : allocateBrowserPositionSlot();
  const browserPosition = getBrowserPositionBySlot(browserPositionSlot);
  console.log(
    `BROWSER_FIXED_SLOT: ${browserPositionSlot + 1}/${BROWSER_POSITIONS.length} x=${browserPosition.x} y=${browserPosition.y}`,
  );
  const chromeExecutablePath = getChromeExecutablePath();
  const browserArgs = [
    ...(newUrl ? [`--proxy-server=${newUrl}`] : []),
    `--user-agent=${fingerprint.userAgent}`,
    `--window-size=${BROWSER_WINDOW.width},${BROWSER_WINDOW.height}`,
    `--window-position=${browserPosition.x},${browserPosition.y}`,
    `--lang=${fingerprint.language}`,
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--enable-webgl",
    "--use-gl=swiftshader",
    "--ignore-certificate-errors",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "--no-zygote",
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
  ];

  const browser = await puppeteer.launch({
    headless: false,
    ...(chromeExecutablePath ? { executablePath: chromeExecutablePath } : {}),
    userDataDir: profileDir,
    env: {
      ...process.env,
      HOME: home,
    },
    ignoreHTTPSErrors: true,
    args: browserArgs,
  });
  const page = await browser.newPage();
  page.__anonymizedProxyUrl = newUrl;
  try {
    const session = await page.target().createCDPSession();
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        left: browserPosition.x,
        top: browserPosition.y,
        width: BROWSER_WINDOW.width,
        height: BROWSER_WINDOW.height,
        windowState: "normal",
      },
    });
  } catch (e) {
    console.log("Window position set failed, using Chrome args position.");
  }
  // Slight zoom out for easier manual view
  page.on("domcontentloaded", async () => {
    try {
      await page.evaluate((z) => {
        document.documentElement.style.zoom = z;
        if (document.body) document.body.style.zoom = z;
      }, PAGE_ZOOM);
    } catch (e) {}
  });
  // Set viewport and other fingerprint attributes
  await page.setViewport(fingerprint.viewport);
  await page
    .evaluate((z) => {
      document.documentElement.style.zoom = z;
      if (document.body) document.body.style.zoom = z;
    }, PAGE_ZOOM)
    .catch(() => {});
  await page.setUserAgent(fingerprint.userAgent);
  await page.setExtraHTTPHeaders({
    "Accept-Language": fingerprint.language,
  });
  await page.emulateTimezone(fingerprint.timezone);
  if (!page.waitForTimeout) {
    page.waitForTimeout = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));
  }
  return { browser, page, profileDir, proxyUrl: newUrl };
}

async function savePageErrorSnapshot(page, error, folder = "error_snapshots") {
  try {
    // Create folder if needed
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    // Generate filename-safe string
    let cleanErrorMsg;
    if (error.message) {
      cleanErrorMsg = error.message.replace(/[^a-z0-9]/gi, "_").slice(0, 100); // Trim long messages
    } else {
      cleanErrorMsg = `${error}`;
    }
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_");

    const filename = `${cleanErrorMsg}_${timestamp}`;

    // Save files
    await Promise.all([
      page.screenshot({
        path: path.join(folder, `${filename}.png`),
        fullPage: true,
      }),
      //fs.promises.writeFile(
      //  path.join(folder, `${filename}.html`),
      //  await page.content()
      //)
    ]);

    console.log(`Saved error snapshot: ${filename}`);
  } catch (saveError) {
    console.error("Failed to save snapshot:", saveError);
  }
}

async function waitForText(page, text, options = {}) {
  const {
    timeout = STEP_TIMEOUT_MS,
    visible = true, // Check only visible text
    throwOnTimeout = true, // Throw error if timeout reached
    polling = 100, // Poll interval (ms)
  } = options;

  try {
    await page.waitForFunction(
      (text, visible) => {
        const content = visible
          ? document.body.innerText
          : document.body.textContent;
        return content.includes(text);
      },
      { timeout, polling },
      text,
      visible,
    );
  } catch (error) {
    if (throwOnTimeout) {
      throw new Error(`Text "${text}" not found within ${timeout}ms`);
    }
    return false;
  }
  return true;
}

async function isRequestRejectedPage(page) {
  const title = await page.title().catch(() => "");
  const bodyText = await page
    .evaluate(() => {
      return document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
    })
    .catch(() => "");

  return (
    title === "Request Rejected" ||
    bodyText.includes("The requested URL was rejected") ||
    bodyText.includes("Your support ID is")
  );
}

async function getBadPageDetails(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();
      const lower = `${title} ${url} ${text}`.toLowerCase();

      const requestRejected =
        title === "Request Rejected" ||
        lower.includes("the requested url was rejected") ||
        lower.includes("your support id is");
      const forbidden =
        lower.includes("forbidden") ||
        lower.includes("access denied") ||
        /\b403\b/.test(lower);
      const tooMany =
        lower.includes("too many requests") ||
        lower.includes("too many errors") ||
        lower.includes("demasiadas solicitudes") ||
        /\b429\b/.test(lower);
      const unreachable =
        url.startsWith("chrome-error://") ||
        lower.includes("this site can") ||
        lower.includes("no se puede acceder a este sitio") ||
        lower.includes("err_connection") ||
        lower.includes("err_timed_out") ||
        lower.includes("err_proxy") ||
        lower.includes("err_tunnel") ||
        lower.includes("err_name_not_resolved") ||
        lower.includes("err_internet_disconnected");
      const notFound =
        lower.includes("page not found") ||
        lower.includes("not found") ||
        lower.includes("no encontrado") ||
        /\b404\b/.test(lower);
      const blankError =
        url === "about:blank" &&
        !document.querySelector(
          "#btnAceptar, #btnEntrar, #btnEnviar, #btnSiguiente, #btnConfirmar, img[alt='captcha']",
        );

      let type = "";
      if (requestRejected) type = "REQUEST_REJECTED";
      else if (forbidden) type = "FORBIDDEN";
      else if (tooMany) type = "TOO_MANY_REQUESTS";
      else if (unreachable) type = "PAGE_UNREACHABLE";
      else if (notFound) type = "PAGE_NOT_FOUND";
      else if (blankError) type = "BLANK_PAGE";

      return {
        ok: !!type,
        type,
        url,
        title,
        manualHoldEligible: [
          "REQUEST_REJECTED",
          "FORBIDDEN",
          "TOO_MANY_REQUESTS",
        ].includes(type),
        textPreview: text.slice(0, 600),
      };
    })
    .catch((error) => ({
      ok: false,
      type: "PAGE_READ_FAILED",
      url: "UNKNOWN",
      title: "UNKNOWN",
      manualHoldEligible: false,
      textPreview: String(error?.message || error || "").slice(0, 600),
    }));
}

function isPostSlotStage(stage) {
  return [
    "SLOT_SELECTED",
    "SLOT_SUBMITTED",
    "SLOT_MODAL_ACCEPTED",
    "WAIT_CONFIRMATION",
  ].includes(stage);
}

async function getAppointmentContinuationState(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();
      return {
        hasModalButton: !!document.querySelector(
          "div.jconfirm-buttons > button:nth-child(1)",
        ),
        hasConfirmButton: !!document.querySelector("#btnConfirmar"),
        hasPrintButton: !!document.querySelector("#btnImprimir"),
        hasVerificationCode: !!document.querySelector("#txtCodigoVerificacion"),
        url,
        textPreview: text.slice(0, 600),
      };
    })
    .catch(() => ({
      hasModalButton: false,
      hasConfirmButton: false,
      hasPrintButton: false,
      hasVerificationCode: false,
      url: "UNKNOWN",
      textPreview: "",
    }));
}

async function holdPostSlotBlockedPage(page, data, details, label = "") {
  console.log(
    `POST_SLOT_BLOCKED_HOLD_FOREVER: ${details.type} ${label}. Keeping browser open for manual recovery; worker will not relaunch.`,
  );
  await sendMessageToGroup(
    data["owner"],
    `Slot selected but page returned ${details.type}. Browser will stay open for manual refresh and this worker will not open another tab on top.\n\nCITADO: ${data["nombre"]} - ${data["docId"]}`,
  );
  while (true) {
    if (typeof page.isClosed === "function" && page.isClosed()) {
      throw new Error(
        `POST_SLOT_MANUAL_HOLD_PAGE_CLOSED_RESTART_${details.type}`,
      );
    }

    const finalDetails = await getFinalConfirmationDetails(page);
    const continuation = await getAppointmentContinuationState(page);
    const text = String(continuation.textPreview || "").toLowerCase();
    const finalRecovered =
      finalDetails.ok ||
      continuation.hasPrintButton ||
      String(continuation.url || "").includes("/acGrabarCita") ||
      text.includes("cita confirmada") ||
      text.includes("justificante");

    if (finalRecovered && !finalDetails.requestRejected) {
      console.log(`POST_SLOT_MANUAL_HOLD_FINAL_RECOVERED: ${label}`);
      await sendFinalAppointmentTelegramAndHold(
        page,
        data,
        `manual hold ${label}`,
      );
      return { finalConfirmed: true };
    }

    if (
      continuation.hasModalButton ||
      continuation.hasConfirmButton ||
      continuation.hasVerificationCode
    ) {
      console.log(
        `POST_SLOT_MANUAL_HOLD_RECOVERED_CONTINUATION: modal=${continuation.hasModalButton} confirm=${continuation.hasConfirmButton} code=${continuation.hasVerificationCode} url=${continuation.url}`,
      );
      return continuation;
    }

    await page.waitForTimeout(1000).catch(() => {});
  }
}

async function throwIfBadPage(page, label = "", options = {}) {
  const details = await getBadPageDetails(page);
  if (!details.ok) return null;

  console.log(`BAD_PAGE_DETECTED ${label}: ${details.type}`);
  console.log(`BAD_PAGE_URL: ${details.url}`);
  console.log(`BAD_PAGE_TEXT: ${details.textPreview}`);

  if (details.manualHoldEligible && isPostSlotStage(options.stage)) {
    return await holdPostSlotBlockedPage(
      page,
      options.data || {},
      details,
      label,
    );
  }

  throw new Error(`BAD_PAGE_${details.type}`);
}

async function throwIfRequestRejected(page, label = "") {
  await throwIfBadPage(page, label);
}

function startPreSlotBadPageWatcher(page, getStage, onDetected) {
  let stopped = false;

  (async () => {
    while (!stopped) {
      await page.waitForTimeout(BAD_PAGE_WATCHER_POLL_MS).catch(() => {});
      if (stopped || (typeof page.isClosed === "function" && page.isClosed()))
        return;

      const stage = String(getStage?.() || "");
      if (isPostSlotStage(stage)) continue;

      const details = await getBadPageDetails(page);
      if (!details.ok) continue;

      const reason = `BAD_PAGE_${details.type}`;
      console.log(`BAD_PAGE_WATCHER_DETECTED stage=${stage}: ${details.type}`);
      console.log(`BAD_PAGE_WATCHER_URL: ${details.url}`);
      console.log(`BAD_PAGE_WATCHER_TEXT: ${details.textPreview}`);
      onDetected?.(reason, details);
      await page.close({ runBeforeUnload: false }).catch(() => {});
      return;
    }
  })().catch((error) => {
    if (!stopped) {
      console.log(`BAD_PAGE_WATCHER_ERROR: ${error?.message || error}`);
    }
  });

  return () => {
    stopped = true;
  };
}

function startProfileSearchLifetimeWatcher(
  page,
  getStage,
  onExpired,
  timeoutMs = PROFILE_SEARCH_LIFETIME_MS,
) {
  if (!timeoutMs || timeoutMs <= 0) {
    console.log("PROFILE_SEARCH_LIFETIME_DISABLED");
    return () => {};
  }

  let stopped = false;
  const timer = setTimeout(async () => {
    if (stopped || (typeof page.isClosed === "function" && page.isClosed()))
      return;

    const stage = String(getStage?.() || "");
    if (isPostSlotStage(stage)) {
      console.log(
        `PROFILE_SEARCH_LIFETIME_SKIP_POST_SLOT: stage=${stage} timeoutMs=${timeoutMs}`,
      );
      return;
    }

    let currentUrl = "UNKNOWN";
    try {
      currentUrl = typeof page.url === "function" ? page.url() : "UNKNOWN";
    } catch (error) {}

    console.log(
      `PROFILE_SEARCH_LIFETIME_EXPIRED_RESTART: stage=${stage} timeoutMs=${timeoutMs}`,
    );
    onExpired?.("PROFILE_LIFETIME_RESTART", {
      type: "PROFILE_LIFETIME_RESTART",
      url: currentUrl,
      textPreview: `Profile search lifetime exceeded at stage=${stage}`,
    });
    await page.close({ runBeforeUnload: false }).catch(() => {});
  }, timeoutMs);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

function shouldRotateProxyAfterAbort(reason) {
  const text = String(reason || "").toLowerCase();
  return (
    text.includes("request_rejected") ||
    text.includes("requested url was rejected") ||
    text.includes("url rejected") ||
    text.includes("forbidden") ||
    text.includes("too_many_requests") ||
    text.includes("too_many") ||
    text.includes("too many requests") ||
    text.includes("too many errors") ||
    text.includes("demasiadas solicitudes") ||
    /\b403\b/.test(text) ||
    /\b429\b/.test(text)
  );
}

function getAbortRepeatKey(reason) {
  const text = String(reason || "UNKNOWN_ERROR");
  const lower = text.toLowerCase();

  if (lower.includes("bad_page_page_unreachable"))
    return "BAD_PAGE_PAGE_UNREACHABLE";
  if (lower.includes("bad_page_page_not_found"))
    return "BAD_PAGE_PAGE_NOT_FOUND";
  if (lower.includes("bad_page_blank_page")) return "BAD_PAGE_BLANK_PAGE";
  if (lower.includes("bad_page_page_read_failed"))
    return "BAD_PAGE_PAGE_READ_FAILED";
  if (lower.includes("bad_page_")) {
    const match = text.match(/BAD_PAGE_([A-Z_]+)/);
    if (match) return `BAD_PAGE_${match[1]}`.slice(0, 80);
  }

  if (
    /ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|Navigation timeout/i.test(
      text,
    )
  ) {
    return "PAGE_UNREACHABLE";
  }

  const selectorMatch = text.match(/Waiting for selector\s+([^\s]+)\s+failed/i);
  if (selectorMatch) return `WAIT_SELECTOR_${selectorMatch[1]}`.slice(0, 80);

  if (lower.includes("appointment_not_in_range"))
    return "APPOINTMENT_NOT_IN_RANGE";
  if (lower.includes("no_oficinas_available")) return "NO_OFICINAS_AVAILABLE";
  if (lower.includes("preferred_oficina_not_available"))
    return "PREFERRED_OFICINA_NOT_AVAILABLE";
  if (lower.includes("all_oficinas_excluded")) return "ALL_OFICINAS_EXCLUDED";
  if (lower.includes("acoferta_no_cita")) return "ACOFERTA_NO_CITA";
  if (lower.includes("acoferta_not_ready")) return "ACOFERTA_NOT_READY";
  if (lower.includes("clave_service_redirect_timeout"))
    return "CLAVE_SERVICE_REDIRECT_TIMEOUT";

  return (
    text
      .replace(/https?:\/\/\S+/gi, "URL")
      .replace(/\b\d{4,}\b/g, "#")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "UNKNOWN_ERROR"
  );
}

async function getIcpSystemErrorDetails(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();

      const hasSystemError = text.includes(
        "Se ha producido un error en el sistema",
      );
      const hasCode0101 = /(?:^|\s)0101(?:\s|$)/.test(text);
      const codOperMatch = text.match(/Cod\.\s*Oper\.\s*:\s*([^\n\r]+)/i);
      const hasCodOper = !!codOperMatch;

      return {
        ok: (hasSystemError || hasCode0101) && hasCodOper,
        url,
        title,
        errorCode: hasCode0101 ? "0101" : "SYSTEM",
        codOper: codOperMatch ? codOperMatch[1].trim() : "UNKNOWN",
        textPreview: text.slice(0, 700),
      };
    })
    .catch(() => ({ ok: false }));
}

async function throwIfIcpSystemError(page, label = "") {
  const details = await getIcpSystemErrorDetails(page);
  if (details.ok) {
    console.log(`ICP_SYSTEM_ERROR_RESTART ${label}`);
    console.log(`ICP_ERROR_CODE: ${details.errorCode}`);
    console.log(`ICP_COD_OPER: ${details.codOper}`);
    console.log(`ICP_ERROR_URL: ${details.url}`);
    // No Telegram needed for 0101/system error. Catch block will close/delete profile and restart fresh.
    throw new Error(`ICP_SYSTEM_ERROR_${details.errorCode}_${details.codOper}`);
  }
}

function isManualBrowserCloseError(error) {
  const msg = String(error?.message || error || "");
  return /Target closed|Session closed|Browser disconnected|browser has disconnected|Protocol error.*Target|Protocol error.*closed|Connection closed|Page crashed|Cannot find context|Execution context was destroyed|Navigating frame was detached|Frame was detached/i.test(
    msg,
  );
}

async function getMaxCitasDetails(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();
      const lower = text.toLowerCase();

      const hasMaxCitas =
        lower.includes("lo sentimos, pero has superado el máximo de citas") ||
        lower.includes("lo sentimos, pero has superado el maximo de citas");

      const hasEquivalentOrProvince =
        lower.includes("trámite equivalente") ||
        lower.includes("tramite equivalente") ||
        lower.includes("provincia seleccionada") ||
        lower.includes("tendrás que anular") ||
        lower.includes("tendras que anular");

      return {
        ok: hasMaxCitas && hasEquivalentOrProvince,
        url,
        title,
        textPreview: text.slice(0, 700),
      };
    })
    .catch(() => ({ ok: false }));
}

async function handleMaxCitasIfPresent(
  page,
  data,
  browser,
  profileDir,
  requestHandler,
) {
  const details = await getMaxCitasDetails(page);
  if (!details.ok) return false;

  console.log("MAX_CITAS_DETECTED_PERMANENT_CLOSE");
  console.log(`MAX_CITAS_URL: ${details.url}`);
  console.log(`MAX_CITAS_TEXT: ${details.textPreview}`);

  const sent = await sendMessageToGroup(
    data["owner"],
    `⚠️ CITA YA EXISTE / MAXIMO DE CITAS ⚠️\n\nNIE: ${data["docId"] || "UNKNOWN"}\nNOMBRE: ${data["nombre"] || "UNKNOWN"}\nRAZON: MAXIMO DE CITAS`,
  );
  changeSatus(data["id"], "hasappointment");
  console.log(`MAX_CITAS_TELEGRAM_SENT: ${sent}`);

  try {
    page?.off("request", requestHandler);
  } catch (error) {}
  await closeBrowserFast(browser, "MAX_CITAS");
  await closeAnonymizedProxyFast(page?.__anonymizedProxyUrl, "MAX_CITAS");
  await deleteProfileFolderFast(profileDir, "MAX_CITAS");
  return true;
}

async function getUsuarioClaveFromAcEntrada(page) {
  return await page
    .evaluate(() => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();

      // ICP acEntrada page shows the certificado/Usuario CLAVE in these two disabled inputs:
      // <input id="idPresentador" ... value="Z0059960G">
      // <input id="desPresentador" ... value="FERNANDO AVALO ZAPATA">
      const readInputValue = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const value = normalize(
            el &&
              (el.value || el.getAttribute("value") || el.textContent || ""),
          );
          if (value) return value;
        }
        return "UNKNOWN";
      };

      const nie = readInputValue([
        "#idPresentador",
        "input#idPresentador",
        "input[name='idPresentador']",
        "input[id*='Presentador' i]",
      ]);

      const name = readInputValue([
        "#desPresentador",
        "input#desPresentador",
        "input[name='desPresentador']",
        "input[id*='desPresentador' i]",
      ]);

      return { nie, name };
    })
    .catch(() => ({ nie: "UNKNOWN", name: "UNKNOWN" }));
}

async function getClave0019Details(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();
      const lower = text.toLowerCase();

      const has0019 = /(?:^|\s)0019(?:\s|$)/.test(text);
      const hasClaveCitasLimit =
        lower.includes("se ha sobrepasado el número permitido de citas") ||
        lower.includes("se ha sobrepasado el numero permitido de citas");

      return {
        ok: has0019 || hasClaveCitasLimit,
        url,
        title,
        textPreview: text.slice(0, 700),
      };
    })
    .catch(() => ({ ok: false }));
}

async function sendClave0019Telegram(data, usuarioClave) {
  const nie = usuarioClave?.nie || "UNKNOWN";
  const name = usuarioClave?.name || "UNKNOWN";
  const sent = await sendMessageToGroup(
    data["owner"],
    `⚠️ ERROR CLAVE 0019 ⚠️\n\nNIE: ${nie}\nNAME: ${name}`,
  );
  console.log(`CLAVE_0019_TELEGRAM_SENT: ${sent}`);
  return sent;
}

async function handleClave0019IfPresent(
  page,
  data,
  usuarioClave,
  browser,
  profileDir,
  requestHandler,
) {
  const details = await getClave0019Details(page);
  if (!details.ok) return false;

  console.log("CLAVE_0019_DETECTED_PERMANENT_CLOSE");
  console.log(`CLAVE_0019_URL: ${details.url}`);
  console.log(`CLAVE_0019_TEXT: ${details.textPreview}`);
  console.log(
    `USUARIO_CLAVE_FOR_0019: ${JSON.stringify(usuarioClave || { nie: "UNKNOWN", name: "UNKNOWN" })}`,
  );

  await sendClave0019Telegram(data, usuarioClave);

  // sendMessageToGroup schedules Telegram send asynchronously, so keep page/profile alive briefly.
  await page.waitForTimeout(2500).catch(() => {});

  try {
    page?.off("request", requestHandler);
  } catch (error) {}
  await closeBrowserFast(browser, "CLAVE_0019");
  await closeAnonymizedProxyFast(page?.__anonymizedProxyUrl, "CLAVE_0019");
  await deleteProfileFolderFast(profileDir, "CLAVE_0019");
  return true;
}

async function getAcValidarExactCaducadoDetails(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();

      const buttons = Array.from(
        document.querySelectorAll(
          "button, input[type='button'], input[type='submit'], a",
        ),
      );
      const hasAceptarButton = buttons.some((btn) => {
        const label = String(
          btn.innerText || btn.textContent || btn.value || "",
        )
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const id = String(btn.id || "")
          .trim()
          .toLowerCase();
        return label === "aceptar" || id === "btnaceptar";
      });

      const exactNoCitaMessage =
        text.includes("En este momento no hay citas disponibles") &&
        text.includes(
          "En breve, la Oficina pondrá a su disposición nuevas citas",
        );
      const hasCodOper = /Cod\.\s*Oper\.\s*:/i.test(text);
      const requestRejected =
        title === "Request Rejected" ||
        text.includes("The requested URL was rejected") ||
        text.includes("Your support ID is");
      const hasPaso1 =
        text.includes("Paso 1 de 5") ||
        !!document.querySelector("#btnSiguiente") ||
        !!document.querySelector("#idSede");

      return {
        ok:
          exactNoCitaMessage &&
          hasCodOper &&
          hasAceptarButton &&
          !requestRejected &&
          !hasPaso1,
        url,
        title,
        exactNoCitaMessage,
        hasCodOper,
        hasAceptarButton,
        textPreview: text.slice(0, 700),
      };
    })
    .catch(() => ({ ok: false }));
}

async function handleAcValidarExactCaducadoIfPresent(
  page,
  data,
  browser,
  profileDir,
  requestHandler,
) {
  const details = await getAcValidarExactCaducadoDetails(page);
  if (!details.ok) return false;

  console.log("ACVALIDAR_NIE_CADUCADO_EXACT_DETECTED");
  console.log(`ACVALIDAR_NIE_CADUCADO_URL: ${details.url}`);
  console.log(`ACVALIDAR_NIE_CADUCADO_TEXT: ${details.textPreview}`);

  const nie = data["docId"] || "UNKNOWN";
  const sent = await sendMessageToGroup(
    data["owner"],
    `NIE ERROR

NIE: ${nie}
RAZON: CADUCADO`,
  );
  // change data status
  changeSatus(data["id"], "dataerror");
  console.log(`ACVALIDAR_NIE_CADUCADO_TELEGRAM_SENT: ${sent}`);
  console.log(
    `ACVALIDAR_NIE_CADUCADO_WAIT_${ACVALIDAR_CADUCADO_WAIT_MS}MS_BEFORE_CLOSE`,
  );
  await page.waitForTimeout(ACVALIDAR_CADUCADO_WAIT_MS).catch(() => {});

  try {
    page?.off("request", requestHandler);
  } catch (error) {}
  await closeBrowserFast(browser, "ACVALIDAR_CADUCADO");
  await closeAnonymizedProxyFast(
    page?.__anonymizedProxyUrl,
    "ACVALIDAR_CADUCADO",
  );
  await deleteProfileFolderFast(profileDir, "ACVALIDAR_CADUCADO");
  return true;
}

async function getTelefono0006Details(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();
      const lower = text.toLowerCase();

      const has0006 = /(?:^|\s)0006(?:\s|$)/.test(text);
      const noDisponible =
        lower.includes("en este momento no hay citas disponibles") ||
        lower.includes("no hay citas disponibles") ||
        lower.includes("no hay cita disponible");

      return {
        ok: has0006 && noDisponible,
        url,
        title,
        textPreview: text.slice(0, 700),
      };
    })
    .catch(() => ({ ok: false }));
}

async function handleTelefono0006IfPresent(page, data, phone) {
  const details = await getTelefono0006Details(page);
  if (!details.ok) return false;

  console.log("TELEFONO_0006_DETECTED");
  console.log(`TELEFONO_0006_URL: ${details.url}`);
  console.log(`TELEFONO_0006_TEXT: ${details.textPreview}`);
  console.log(`TELEFONO_0006_NUMBER: ${phone || "UNKNOWN"}`);

  const sent = await sendMessageToGroup(
    data["owner"],
    `ERROR NUMERO TELEFONO: ${phone || "UNKNOWN"}`,
  );
  console.log(`TELEFONO_0006_TELEGRAM_SENT: ${sent}`);

  // sendMessageToGroup schedules Telegram send asynchronously, so keep page/profile alive briefly.
  await page.waitForTimeout(2500).catch(() => {});
  return true;
}

async function getAcofertaReadyState(page) {
  return await page
    .evaluate(() => {
      const title = document.title || "";
      const url = window.location.href || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const normalized = bodyText.replace(/\s+/g, " ").trim();
      const lower = normalized.toLowerCase();

      const requestRejected =
        title === "Request Rejected" ||
        normalized.includes("The requested URL was rejected") ||
        normalized.includes("Your support ID is") ||
        lower.includes("forbidden") ||
        lower.includes("too many requests") ||
        lower.includes("too many errors") ||
        lower.includes("this site can") ||
        lower.includes("err_connection") ||
        lower.includes("err_timed_out") ||
        lower.includes("err_proxy") ||
        /\b(?:403|429|404)\b/.test(lower);

      const noDisponible =
        normalized.includes("En este momento no hay citas disponibles") ||
        lower.includes("no hay citas disponibles") ||
        lower.includes("no hay cita disponible");

      const hasCodOper = /Cod\.\s*Oper\.\s*:/i.test(normalized);
      const noDisponibleWithCodOper = noDisponible && hasCodOper;

      const systemError =
        (normalized.includes("Se ha producido un error en el sistema") ||
          /(?:^|\s)0101(?:\s|$)/.test(normalized)) &&
        hasCodOper;

      const hasCaptcha =
        !!document.querySelector('img[alt="captcha"]') &&
        !!document.querySelector("#captcha");

      const dateLinks = Array.from(
        document.querySelectorAll(
          'td[class*="colFecha"] a[role="button"], td[class*="colFecha"] a',
        ),
      ).filter((a) => {
        const text = String(a.innerText || a.textContent || "").trim();
        const cls = String(a.className || "").toLowerCase();
        const disabled =
          a.disabled ||
          a.getAttribute("aria-disabled") === "true" ||
          cls.includes("disabled") ||
          cls.includes("ui-state-disabled");
        return text && !disabled;
      });

      const radioInputs = Array.from(
        document.querySelectorAll(
          'div[id^="cita_"] input, input[type="radio"], input[type="checkbox"], input[name*="cita"], input[id*="cita"]',
        ),
      ).filter((input) => {
        const type = String(input.type || "").toLowerCase();
        if (input.disabled) return false;
        if (
          type === "hidden" ||
          type === "text" ||
          type === "submit" ||
          type === "button"
        )
          return false;
        if (input.id === "captcha" || input.name === "captcha") return false;
        return (
          type === "radio" ||
          type === "checkbox" ||
          String(input.name || input.id || "")
            .toLowerCase()
            .includes("cita")
        );
      });

      return {
        url,
        title,
        requestRejected,
        noDisponible,
        hasCodOper,
        noDisponibleWithCodOper,
        systemError,
        hasCaptcha,
        dateLinkCount: dateLinks.length,
        radioSlotCount: radioInputs.length,
        ready: hasCaptcha && (dateLinks.length > 0 || radioInputs.length > 0),
        textPreview: normalized.slice(0, 400),
      };
    })
    .catch((error) => ({
      url: "UNKNOWN",
      title: "UNKNOWN",
      requestRejected: false,
      noDisponible: false,
      hasCodOper: false,
      noDisponibleWithCodOper: false,
      systemError: false,
      hasCaptcha: false,
      dateLinkCount: 0,
      radioSlotCount: 0,
      ready: false,
      textPreview: `ACOFERTA_READY_STATE_FAILED: ${error?.message || error}`,
    }));
}

async function waitForAcofertaCaptchaAndAppointment(
  page,
  timeoutMs = ACOFERTA_READY_WAIT_MS,
) {
  console.log(
    `ACOFERTA_WAIT_AVAILABLE_ONLY: waiting up to ${timeoutMs}ms until REAL available appointment/date/radio slot appears...`,
  );
  await page
    .waitForFunction(
      () => {
        const title = document.title || "";
        const bodyText = document.body
          ? document.body.innerText || document.body.textContent || ""
          : "";
        const normalized = bodyText.replace(/\s+/g, " ").trim();
        const lower = normalized.toLowerCase();

        const requestRejected =
          title === "Request Rejected" ||
          normalized.includes("The requested URL was rejected") ||
          normalized.includes("Your support ID is") ||
          lower.includes("forbidden") ||
          lower.includes("too many requests") ||
          lower.includes("too many errors") ||
          lower.includes("this site can") ||
          lower.includes("err_connection") ||
          lower.includes("err_timed_out") ||
          lower.includes("err_proxy") ||
          /\b(?:403|429|404)\b/.test(lower);

        const noDisponible =
          normalized.includes("En este momento no hay citas disponibles") ||
          lower.includes("no hay citas disponibles") ||
          lower.includes("no hay cita disponible");

        const hasCodOper = /Cod\.\s*Oper\.\s*:/i.test(normalized);
        const noDisponibleWithCodOper = noDisponible && hasCodOper;
        const telefono0006 =
          noDisponible && /(?:^|\s)0006(?:\s|$)/.test(normalized);
        const clave0019 =
          /(?:^|\s)0019(?:\s|$)/.test(normalized) ||
          lower.includes("se ha sobrepasado el número permitido de citas") ||
          lower.includes("se ha sobrepasado el numero permitido de citas");

        const systemError =
          (normalized.includes("Se ha producido un error en el sistema") ||
            /(?:^|\s)0101(?:\s|$)/.test(normalized)) &&
          hasCodOper;

        const hasCaptcha =
          !!document.querySelector('img[alt="captcha"]') &&
          !!document.querySelector("#captcha");

        const dateLinks = Array.from(
          document.querySelectorAll(
            'td[class*="colFecha"] a[role="button"], td[class*="colFecha"] a',
          ),
        ).filter((a) => {
          const text = String(a.innerText || a.textContent || "").trim();
          const cls = String(a.className || "").toLowerCase();
          const disabled =
            a.disabled ||
            a.getAttribute("aria-disabled") === "true" ||
            cls.includes("disabled") ||
            cls.includes("ui-state-disabled");
          return text && !disabled;
        });

        const radioInputs = Array.from(
          document.querySelectorAll(
            'div[id^="cita_"] input, input[type="radio"], input[type="checkbox"], input[name*="cita"], input[id*="cita"]',
          ),
        ).filter((input) => {
          const type = String(input.type || "").toLowerCase();
          if (input.disabled) return false;
          if (
            type === "hidden" ||
            type === "text" ||
            type === "submit" ||
            type === "button"
          )
            return false;
          if (input.id === "captcha" || input.name === "captcha") return false;
          return (
            type === "radio" ||
            type === "checkbox" ||
            String(input.name || input.id || "")
              .toLowerCase()
              .includes("cita")
          );
        });

        // Stop for hard errors, or the final no-cita page with Cod. Oper.
        // Otherwise wait until a real selectable appointment exists.
        return (
          requestRejected ||
          systemError ||
          clave0019 ||
          telefono0006 ||
          noDisponibleWithCodOper ||
          (hasCaptcha && (dateLinks.length > 0 || radioInputs.length > 0))
        );
      },
      { timeout: timeoutMs, polling: ACOFERTA_READY_POLL_MS },
    )
    .catch(() => null);

  // Extra render-stable wait for slow proxies/layouts.
  await page.waitForTimeout(700).catch(() => {});
  const state = await getAcofertaReadyState(page);
  console.log(
    `ACOFERTA_READY_STATUS: captcha=${state.hasCaptcha} dateLinks=${state.dateLinkCount} radioSlots=${state.radioSlotCount} noDisponible=${state.noDisponible} codOper=${state.hasCodOper} rejected=${state.requestRejected} systemError=${state.systemError}`,
  );
  if (!state.ready && state.noDisponibleWithCodOper) {
    console.log(
      "ACOFERTA_NO_CITA_WITH_COD_OPER_DETECTED: will delete profile after 3 seconds.",
    );
  } else if (!state.ready && state.noDisponible) {
    console.log(
      "ACOFERTA_WAIT_FINISHED_NO_AVAILABLE_APPOINTMENT: waited full time; no auto select attempted.",
    );
  }
  return state;
}

function isDateInRange(dateText, minDateText, maxDateText) {
  const currentDate = parseDate(dateText);
  const minDate = parseDate(minDateText);
  const maxDate = parseDate(maxDateText);
  if (!currentDate) return false;
  return (
    (!minDate || currentDate >= minDate) && (!maxDate || currentDate <= maxDate)
  );
}

function groupSlotsByDate(slots) {
  const groups = new Map();
  for (const slot of slots) {
    const key = slot.dateText || "UNKNOWN_DATE";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  }
  return groups;
}

async function selectRandomCalendarSlotFast(page, dateMin, dateMax) {
  return await page
    .evaluate(
      ({ dateMin, dateMax }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const parseDateValue = (value) => {
          const match = String(value || "").match(
            /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
          );
          if (!match) return null;
          const day = match[1].padStart(2, "0");
          const month = match[2].padStart(2, "0");
          const year = match[3].length === 2 ? `20${match[3]}` : match[3];
          const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const inRange = (dateText) => {
          const current = parseDateValue(dateText);
          const min = parseDateValue(dateMin);
          const max = parseDateValue(dateMax);
          return (
            current && (!min || current >= min) && (!max || current <= max)
          );
        };
        const clickElement = (el) => {
          el.scrollIntoView({ block: "center" });
          setTimeout(() => {
            ["mouseover", "mousedown", "mouseup", "click"].forEach(
              (eventName) => {
                el.dispatchEvent(
                  new MouseEvent(eventName, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                  }),
                );
              },
            );
            if (typeof el.click === "function") el.click();
          }, 0);
        };

        const headers = Array.from(
          document.querySelectorAll(
            'th[class^="colFecha"], th[class*=" colFecha"]',
          ),
        );
        const links = Array.from(
          document.querySelectorAll(
            'td[class*="colFecha"] a[role="button"], td[class*="colFecha"] a',
          ),
        );
        const slots = [];

        for (const link of links) {
          const cell = link.closest("td");
          const cls =
            `${link.className || ""} ${cell?.className || ""}`.toLowerCase();
          const disabled =
            link.disabled ||
            link.getAttribute("aria-disabled") === "true" ||
            cls.includes("disabled") ||
            cls.includes("ui-state-disabled");
          if (disabled) continue;

          const rect = link.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const cellClasses = cell ? Array.from(cell.classList || []) : [];
          const matchingHeader = headers.find((header) => {
            const headerClasses = Array.from(header.classList || []);
            return headerClasses.some((headerClass) =>
              cellClasses.includes(headerClass),
            );
          });
          const headerText = normalize(
            matchingHeader &&
              (matchingHeader.innerText || matchingHeader.textContent),
          );
          const cellText = normalize(
            cell && (cell.innerText || cell.textContent),
          );
          const linkText = normalize(
            link.innerText ||
              link.textContent ||
              link.getAttribute("aria-label") ||
              link.getAttribute("title"),
          );
          const dateMatch = `${headerText} ${cellText} ${linkText}`.match(
            /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/,
          );
          const dateText = dateMatch ? dateMatch[1] : headerText;
          if (!dateText || !inRange(dateText)) continue;
          slots.push({ el: link, dateText, label: linkText || cellText });
        }

        if (slots.length === 0) {
          return { ok: false, reason: "NO_CALENDAR_SLOTS_IN_RANGE" };
        }

        const grouped = new Map();
        for (const slot of slots) {
          if (!grouped.has(slot.dateText)) grouped.set(slot.dateText, []);
          grouped.get(slot.dateText).push(slot);
        }
        const dates = Array.from(grouped.keys());
        const selectedDate = dates[Math.floor(Math.random() * dates.length)];
        const slotsForDate = grouped.get(selectedDate);
        const selectedSlot =
          slotsForDate[Math.floor(Math.random() * slotsForDate.length)];
        clickElement(selectedSlot.el);
        return {
          ok: true,
          mode: "calendar",
          dateText: selectedDate,
          label: selectedSlot.label,
          totalSlots: slots.length,
          slotsOnDate: slotsForDate.length,
          dateCount: dates.length,
        };
      },
      { dateMin, dateMax },
    )
    .catch((error) => ({
      ok: false,
      reason: `CALENDAR_FAST_SELECT_FAILED: ${error?.message || error}`,
    }));
}

async function selectRandomRadioSlotFast(page, dateMin, dateMax) {
  return await page
    .evaluate(
      ({ dateMin, dateMax }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const parseDateValue = (value) => {
          const match = String(value || "").match(
            /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
          );
          if (!match) return null;
          const day = match[1].padStart(2, "0");
          const month = match[2].padStart(2, "0");
          const year = match[3].length === 2 ? `20${match[3]}` : match[3];
          const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const hasDateRange =
          !!parseDateValue(dateMin) || !!parseDateValue(dateMax);
        const inRange = (dateText) => {
          const current = parseDateValue(dateText);
          const min = parseDateValue(dateMin);
          const max = parseDateValue(dateMax);
          if (!current) return true;
          return (!min || current >= min) && (!max || current <= max);
        };
        const clickInput = (input) => {
          input.scrollIntoView({ block: "center" });
          input.focus();
          ["mouseover", "mousedown", "mouseup", "click"].forEach(
            (eventName) => {
              input.dispatchEvent(
                new MouseEvent(eventName, {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }),
              );
            },
          );
          if (typeof input.click === "function") input.click();
          if (!input.checked) input.checked = true;
          ["input", "change", "blur"].forEach((eventName) => {
            input.dispatchEvent(
              new Event(eventName, { bubbles: true, cancelable: true }),
            );
          });
          return !!input.checked;
        };

        const inputs = Array.from(
          document.querySelectorAll(
            'div[id^="cita_"] input, input[type="radio"], input[type="checkbox"], input[name*="cita"], input[id*="cita"]',
          ),
        );
        const slots = [];
        const seen = new Set();

        for (const input of inputs) {
          const type = String(input.type || "").toLowerCase();
          if (input.disabled) continue;
          if (["hidden", "text", "submit", "button"].includes(type)) continue;
          if (input.id === "captcha" || input.name === "captcha") continue;
          if (
            type !== "radio" &&
            type !== "checkbox" &&
            !String(input.name || input.id || "")
              .toLowerCase()
              .includes("cita")
          )
            continue;

          const key = `${input.id || ""}|${input.name || ""}|${input.value || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const root =
            input.closest('div[id^="cita_"]') ||
            input.closest("tr") ||
            input.closest("li") ||
            input.closest("label") ||
            input.parentElement;
          const label =
            (input.id &&
              document.querySelector(
                `label[for="${input.id.replace(/"/g, '\\"')}"]`,
              )) ||
            input.closest("label");
          const nearbyText = normalize(
            [
              root && (root.innerText || root.textContent),
              label && (label.innerText || label.textContent),
              input.getAttribute("aria-label"),
              input.getAttribute("title"),
              input.value,
            ]
              .filter(Boolean)
              .join(" "),
          );
          const dateMatch = nearbyText.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/);
          const dateText = dateMatch ? dateMatch[1] : "UNKNOWN_DATE";
          if (!inRange(dateText)) continue;
          slots.push({ el: input, dateText, label: nearbyText });
        }

        if (slots.length === 0) {
          return { ok: false, reason: "NO_RADIO_SLOTS_IN_RANGE" };
        }

        const grouped = new Map();
        for (const slot of slots) {
          if (!grouped.has(slot.dateText)) grouped.set(slot.dateText, []);
          grouped.get(slot.dateText).push(slot);
        }
        const dates = Array.from(grouped.keys());
        const selectedDate = dates[Math.floor(Math.random() * dates.length)];
        const slotsForDate = grouped.get(selectedDate);
        const selectedSlot =
          slotsForDate[Math.floor(Math.random() * slotsForDate.length)];
        const checked = clickInput(selectedSlot.el);
        return {
          ok: checked,
          mode: "radio",
          dateText: selectedDate,
          label: selectedSlot.label,
          totalSlots: slots.length,
          slotsOnDate: slotsForDate.length,
          dateCount: dates.length,
          reason: checked ? "" : "RADIO_NOT_CHECKED",
        };
      },
      { dateMin, dateMax },
    )
    .catch((error) => ({
      ok: false,
      reason: `RADIO_FAST_SELECT_FAILED: ${error?.message || error}`,
    }));
}

async function collectDatepickerDates(page, dateMin, dateMax) {
  return await page
    .evaluate(
      ({ dateMin, dateMax }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const normalizeKey = (value) =>
          normalize(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
        const monthMap = {
          enero: 1,
          january: 1,
          febrero: 2,
          february: 2,
          marzo: 3,
          march: 3,
          abril: 4,
          april: 4,
          mayo: 5,
          may: 5,
          junio: 6,
          june: 6,
          julio: 7,
          july: 7,
          agosto: 8,
          august: 8,
          septiembre: 9,
          setiembre: 9,
          september: 9,
          octubre: 10,
          october: 10,
          noviembre: 11,
          november: 11,
          diciembre: 12,
          december: 12,
        };
        const parseDateValue = (value) => {
          const match = String(value || "").match(
            /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
          );
          if (!match) return null;
          const day = match[1].padStart(2, "0");
          const month = match[2].padStart(2, "0");
          const year = match[3].length === 2 ? `20${match[3]}` : match[3];
          const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const inRange = (dateText) => {
          const current = parseDateValue(dateText);
          const min = parseDateValue(dateMin);
          const max = parseDateValue(dateMax);
          return (
            current && (!min || current >= min) && (!max || current <= max)
          );
        };

        const root = document.querySelector("#datepicker");
        if (!root) return [];

        const monthText = normalize(
          root.querySelector(".ui-datepicker-month")?.textContent,
        );
        const yearText = normalize(
          root.querySelector(".ui-datepicker-year")?.textContent,
        );
        const fallbackMonth = monthMap[normalizeKey(monthText)];
        const fallbackYear = (yearText.match(/\d{4}/) || [])[0];

        const dates = [];
        const cells = Array.from(
          root.querySelectorAll('td[data-handler="selectDay"], td'),
        );
        cells.forEach((td, visibleIndex) => {
          const anchor = td.querySelector("a.ui-state-default, a");
          const tdClass = String(td?.className || "").toLowerCase();
          const anchorClass = String(anchor?.className || "").toLowerCase();
          if (
            tdClass.includes("ui-datepicker-unselectable") ||
            tdClass.includes("ui-state-disabled")
          )
            return;
          if (
            tdClass.includes("ui-datepicker-other-month") ||
            anchorClass.includes("ui-priority-secondary")
          )
            return;
          if (anchor?.getAttribute("aria-disabled") === "true") return;
          if (
            td.getAttribute("data-handler") &&
            td.getAttribute("data-handler") !== "selectDay"
          )
            return;

          const clickable = anchor || td;
          const rect = clickable.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;

          const rawMonth = td.getAttribute("data-month");
          const rawYear = td.getAttribute("data-year");
          const month =
            rawMonth !== null && rawMonth !== ""
              ? Number(rawMonth) + 1
              : fallbackMonth;
          const year = rawYear || fallbackYear;
          if (!month || !year) return;

          const day = Number(
            normalize(clickable.textContent).match(/\d{1,2}/)?.[0],
          );
          if (!day) return;
          const dateText = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
          if (!inRange(dateText)) return;
          dates.push({
            dateText,
            day,
            month,
            year: String(year),
            visibleIndex,
          });
        });

        return dates;
      },
      { dateMin, dateMax },
    )
    .catch(() => []);
}

async function clickDatepickerDate(page, dateText) {
  const targetMatch = String(dateText || "").match(
    /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
  );
  if (!targetMatch) return { ok: false, reason: "DATEPICKER_BAD_TARGET_DATE" };

  const target = {
    day: Number(targetMatch[1]),
    month: Number(targetMatch[2]),
    year: targetMatch[3].length === 2 ? `20${targetMatch[3]}` : targetMatch[3],
  };
  const beforeSignature = await page
    .evaluate(() => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      return normalize(
        document.querySelector("#CitaMAP_HORAS")?.innerText ||
          document.querySelector("#CitaMAP_HORAS")?.textContent,
      );
    })
    .catch(() => "");

  const handles = await page.$$(
    '#datepicker td[data-handler="selectDay"] a.ui-state-default, #datepicker td[data-handler="selectDay"] a, #datepicker td a.ui-state-default, #datepicker td a',
  );
  for (const handle of handles) {
    const isTarget = await handle
      .evaluate((anchor, targetDate) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const normalizeKey = (value) =>
          normalize(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
        const monthMap = {
          enero: 1,
          january: 1,
          febrero: 2,
          february: 2,
          marzo: 3,
          march: 3,
          abril: 4,
          april: 4,
          mayo: 5,
          may: 5,
          junio: 6,
          june: 6,
          julio: 7,
          july: 7,
          agosto: 8,
          august: 8,
          septiembre: 9,
          setiembre: 9,
          september: 9,
          octubre: 10,
          october: 10,
          noviembre: 11,
          november: 11,
          diciembre: 12,
          december: 12,
        };
        const td = anchor.closest("td");
        const tdClass = String(td?.className || "").toLowerCase();
        const anchorClass = String(anchor.className || "").toLowerCase();
        if (
          tdClass.includes("ui-datepicker-unselectable") ||
          tdClass.includes("ui-state-disabled")
        )
          return false;
        if (
          tdClass.includes("ui-datepicker-other-month") ||
          anchorClass.includes("ui-priority-secondary")
        )
          return false;

        const root = document.querySelector("#datepicker");
        if (!root) return false;
        const rawMonth = td?.getAttribute("data-month");
        const rawYear = td?.getAttribute("data-year");
        const currentMonth =
          rawMonth !== null && rawMonth !== ""
            ? Number(rawMonth) + 1
            : monthMap[
                normalizeKey(
                  root.querySelector(".ui-datepicker-month")?.textContent,
                )
              ];
        const currentYear =
          rawYear ||
          (normalize(
            root.querySelector(".ui-datepicker-year")?.textContent,
          ).match(/\d{4}/) || [])[0];
        if (
          currentMonth !== targetDate.month ||
          currentYear !== targetDate.year
        )
          return false;

        const day = Number(normalize(anchor.textContent).match(/\d{1,2}/)?.[0]);
        return day === targetDate.day;
      }, target)
      .catch(() => false);

    if (!isTarget) continue;
    await clickElementHandleTurbo(page, handle, "datepicker_date");
    return { ok: true, beforeSignature };
  }

  return { ok: false, reason: "DATEPICKER_TARGET_ANCHOR_NOT_FOUND" };
}

async function waitForCalendarHoursReload(page, beforeSignature = "") {
  await page
    .waitForFunction(
      (previousText) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const root = document.querySelector("#CitaMAP_HORAS") || document;
        const text = normalize(root.innerText || root.textContent || "");
        const style = root === document ? null : window.getComputedStyle(root);
        const visible =
          root === document ||
          (style && style.display !== "none" && style.visibility !== "hidden");
        const hasResult =
          root.querySelector(
            'td[class*="colFecha"] a[id^="HUECO"], td[class*="colFecha"] a[onclick*="confirmarHueco"]',
          ) ||
          /\bLIBRE\b/i.test(text) ||
          /\bOCUPADO\b/i.test(text);
        return visible && hasResult && (!previousText || text !== previousText);
      },
      { timeout: CALENDAR_DATEPICKER_LOAD_WAIT_MS, polling: 100 },
      beforeSignature,
    )
    .catch(() => null);
  await page.waitForTimeout(80).catch(() => {});
}

async function collectCalendarSlots(page, dateMin, dateMax) {
  const handles = await page.$$(
    'td[class*="colFecha"] a[id^="HUECO"], td[class*="colFecha"] a[onclick*="confirmarHueco"]',
  );
  const slots = [];

  for (const handle of handles) {
    const meta = await handle
      .evaluate((el) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const disabled =
          el.disabled ||
          el.getAttribute("aria-disabled") === "true" ||
          String(el.className || "")
            .toLowerCase()
            .includes("disabled") ||
          String(el.closest("td")?.className || "")
            .toLowerCase()
            .includes("disabled");
        if (disabled) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const cell = el.closest("td");
        const row = el.closest("tr");
        const cellClasses = cell ? Array.from(cell.classList || []) : [];
        const headers = Array.from(
          document.querySelectorAll(
            'th[class^="colFecha"], th[class*=" colFecha"]',
          ),
        );
        const matchingHeader = headers.find((header) => {
          const headerClasses = Array.from(header.classList || []);
          return headerClasses.some((cls) => cellClasses.includes(cls));
        });

        const headerText = normalize(
          matchingHeader &&
            (matchingHeader.innerText || matchingHeader.textContent),
        );
        const cellText = normalize(
          cell && (cell.innerText || cell.textContent),
        );
        const linkText = normalize(
          el.innerText ||
            el.textContent ||
            el.getAttribute("aria-label") ||
            el.getAttribute("title"),
        );
        const onclick = String(el.getAttribute("onclick") || "");
        const isFree =
          /^HUECO/i.test(String(el.id || "")) ||
          /confirmarHueco/i.test(onclick) ||
          /\bLIBRE\b/i.test(linkText || cellText);
        if (!isFree) return null;
        const dateMatch = `${headerText} ${cellText} ${linkText}`.match(
          /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/,
        );
        const timeText = normalize(
          row?.querySelector("th")?.innerText ||
            row?.querySelector("th")?.textContent,
        );
        const columnClass =
          cellClasses.find((cls) => /^colFecha\d+$/i.test(cls)) || "";
        const huecoIdMatch =
          String(el.id || "").match(/(\d+)/) ||
          onclick.match(/confirmarHueco\s*\([^,]+,\s*(\d+)/i);

        return {
          dateText: dateMatch ? dateMatch[1] : headerText,
          label: normalize(
            [
              timeText,
              dateMatch ? dateMatch[1] : headerText,
              linkText || cellText,
            ]
              .filter(Boolean)
              .join(" "),
          ),
          timeText,
          columnClass,
          huecoId: huecoIdMatch ? huecoIdMatch[1] : "",
        };
      })
      .catch(() => null);

    if (!meta || !meta.dateText) continue;
    if (!isDateInRange(meta.dateText, dateMin, dateMax)) continue;
    slots.push({ ...meta, handle });
  }

  return slots;
}

async function clickElementHandleLikeUser(page, handle, label = "element") {
  await handle
    .evaluate((el) => {
      el.scrollIntoView({ block: "center", inline: "center" });
    })
    .catch(() => {});
  await page.waitForTimeout(120).catch(() => {});

  const box = await handle.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 4 }).catch(() => {});
    await page.waitForTimeout(35).catch(() => {});
    await page.mouse.down().catch(() => {});
    await page.waitForTimeout(45).catch(() => {});
    await page.mouse.up().catch(() => {});
    return true;
  }

  await handle.click({ delay: 35 }).catch((error) => {
    throw new Error(`CLICK_HANDLE_FAILED_${label}_${error?.message || error}`);
  });
  return true;
}

async function clickElementHandleTurbo(page, handle, label = "element") {
  await handle
    .evaluate((el) => {
      el.scrollIntoView({ block: "center", inline: "center" });
    })
    .catch(() => {});

  const directClickOk = await handle
    .click({ delay: 0 })
    .then(() => true)
    .catch(() => false);
  if (directClickOk) return true;

  const box = await handle.boundingBox().catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    await page.mouse
      .click(box.x + box.width / 2, box.y + box.height / 2, { delay: 0 })
      .catch((error) => {
        throw new Error(
          `TURBO_MOUSE_CLICK_FAILED_${label}_${error?.message || error}`,
        );
      });
    return true;
  }

  throw new Error(`TURBO_CLICK_FAILED_${label}`);
}

async function selectRandomCalendarSlotTrusted(page, dateMin, dateMax) {
  const slots = await collectCalendarSlots(page, dateMin, dateMax);
  if (slots.length === 0) {
    return { ok: false, reason: "NO_CALENDAR_SLOTS_IN_RANGE" };
  }

  const grouped = groupSlotsByDate(slots);
  const dates = Array.from(grouped.keys()).filter(Boolean);
  const selectedDate = chooseRandomItem(dates);
  const slotsForDate = grouped.get(selectedDate) || [];
  const selectedSlot = chooseRandomItem(slotsForDate);

  if (!selectedSlot?.handle) {
    return { ok: false, reason: "CALENDAR_SELECTED_SLOT_HANDLE_MISSING" };
  }

  await clickElementHandleLikeUser(page, selectedSlot.handle, "calendar_slot");
  await page.waitForTimeout(250).catch(() => {});

  return {
    ok: true,
    mode: "calendar",
    dateText: selectedDate,
    label: selectedSlot.label,
    huecoId: selectedSlot.huecoId,
    timeText: selectedSlot.timeText,
    columnClass: selectedSlot.columnClass,
    totalSlots: slots.length,
    slotsOnDate: slotsForDate.length,
    dateCount: dates.length,
  };
}

async function collectCalendarDatesFromDom(page, dateMin, dateMax) {
  return await page
    .evaluate(
      ({ minDateText, maxDateText }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const normalizeKey = (value) =>
          normalize(value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
        const monthMap = {
          enero: 1,
          january: 1,
          febrero: 2,
          february: 2,
          marzo: 3,
          march: 3,
          abril: 4,
          april: 4,
          mayo: 5,
          may: 5,
          junio: 6,
          june: 6,
          julio: 7,
          july: 7,
          agosto: 8,
          august: 8,
          septiembre: 9,
          setiembre: 9,
          september: 9,
          octubre: 10,
          october: 10,
          noviembre: 11,
          november: 11,
          diciembre: 12,
          december: 12,
        };
        const parseDateValue = (value) => {
          const match = String(value || "").match(
            /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
          );
          if (!match) return null;
          const year = match[3].length === 2 ? `20${match[3]}` : match[3];
          const parsed = new Date(
            `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}T00:00:00`,
          );
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const inRange = (dateText) => {
          const current = parseDateValue(dateText);
          const min = parseDateValue(minDateText);
          const max = parseDateValue(maxDateText);
          return (
            current && (!min || current >= min) && (!max || current <= max)
          );
        };

        const root = document.querySelector("#datepicker");
        if (!root) return [];
        const fallbackMonth =
          monthMap[
            normalizeKey(
              root.querySelector(".ui-datepicker-month")?.textContent,
            )
          ];
        const fallbackYear = (normalize(
          root.querySelector(".ui-datepicker-year")?.textContent,
        ).match(/\d{4}/) || [])[0];
        const seen = new Set();
        const dates = [];

        for (const td of Array.from(
          root.querySelectorAll('td[data-handler="selectDay"], td'),
        )) {
          const anchor = td.querySelector("a.ui-state-default, a");
          if (!anchor) continue;
          const tdClass = String(td.className || "").toLowerCase();
          const anchorClass = String(anchor.className || "").toLowerCase();
          if (
            tdClass.includes("ui-datepicker-unselectable") ||
            tdClass.includes("ui-state-disabled")
          )
            continue;
          if (
            tdClass.includes("ui-datepicker-other-month") ||
            anchorClass.includes("ui-priority-secondary")
          )
            continue;
          if (anchor.getAttribute("aria-disabled") === "true") continue;

          const rawMonth = td.getAttribute("data-month");
          const rawYear = td.getAttribute("data-year");
          const month =
            rawMonth !== null && rawMonth !== ""
              ? Number(rawMonth) + 1
              : fallbackMonth;
          const year = rawYear || fallbackYear;
          const day = Number(
            (normalize(anchor.textContent).match(/\d{1,2}/) || [])[0],
          );
          if (!day || !month || !year) continue;
          const dateText = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
          if (!inRange(dateText) || seen.has(dateText)) continue;
          seen.add(dateText);
          dates.push({ dateText, day, month, year: String(year) });
        }
        return dates;
      },
      { minDateText: dateMin, maxDateText: dateMax },
    )
    .catch(() => []);
}

async function clickCalendarDateFromDom(page, dateText) {
  return await page
    .evaluate((targetText) => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      const normalizeKey = (value) =>
        normalize(value)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
      const monthMap = {
        enero: 1,
        january: 1,
        febrero: 2,
        february: 2,
        marzo: 3,
        march: 3,
        abril: 4,
        april: 4,
        mayo: 5,
        may: 5,
        junio: 6,
        june: 6,
        julio: 7,
        july: 7,
        agosto: 8,
        august: 8,
        septiembre: 9,
        setiembre: 9,
        september: 9,
        octubre: 10,
        october: 10,
        noviembre: 11,
        november: 11,
        diciembre: 12,
        december: 12,
      };
      const match = String(targetText || "").match(
        /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
      );
      if (!match) return { ok: false, reason: "DATEPICKER_BAD_TARGET_DATE" };
      const target = {
        day: Number(match[1]),
        month: Number(match[2]),
        year: match[3].length === 2 ? `20${match[3]}` : match[3],
      };
      const hoursRoot = document.querySelector("#CitaMAP_HORAS");
      const signature = () => {
        if (!hoursRoot) return "";
        const headers = Array.from(
          hoursRoot.querySelectorAll(
            'th[class^="colFecha"], th[class*=" colFecha"]',
          ),
        ).map((header) => normalize(header.textContent));
        const freeIds = Array.from(
          hoursRoot.querySelectorAll(
            'a[id^="HUECO"], a[onclick*="confirmarHueco"]',
          ),
        ).map((link) => `${link.id || ""}:${normalize(link.textContent)}`);
        return `${headers.join("|")}::${freeIds.join("|")}`;
      };
      const loadedDates = Array.from(
        document.querySelectorAll(
          '#CitaMAP_HORAS th[class^="colFecha"], #CitaMAP_HORAS th[class*=" colFecha"]',
        ),
      ).map((header) => normalize(header.textContent));
      const beforeSignature = signature();
      if (loadedDates.includes(targetText)) {
        return { ok: true, alreadyLoaded: true, beforeSignature };
      }

      const root = document.querySelector("#datepicker");
      if (!root) return { ok: false, reason: "DATEPICKER_NOT_FOUND" };
      const fallbackMonth =
        monthMap[
          normalizeKey(root.querySelector(".ui-datepicker-month")?.textContent)
        ];
      const fallbackYear = (normalize(
        root.querySelector(".ui-datepicker-year")?.textContent,
      ).match(/\d{4}/) || [])[0];
      const cells = Array.from(
        root.querySelectorAll('td[data-handler="selectDay"], td'),
      );
      for (const td of cells) {
        const anchor = td.querySelector("a.ui-state-default, a");
        if (!anchor) continue;
        const rawMonth = td.getAttribute("data-month");
        const rawYear = td.getAttribute("data-year");
        const month =
          rawMonth !== null && rawMonth !== ""
            ? Number(rawMonth) + 1
            : fallbackMonth;
        const year = rawYear || fallbackYear;
        const day = Number(
          (normalize(anchor.textContent).match(/\d{1,2}/) || [])[0],
        );
        if (
          day !== target.day ||
          month !== target.month ||
          String(year) !== target.year
        )
          continue;
        anchor.click();
        return { ok: true, alreadyLoaded: false, beforeSignature };
      }
      return { ok: false, reason: "DATEPICKER_TARGET_ANCHOR_NOT_FOUND" };
    }, dateText)
    .catch((error) => ({
      ok: false,
      reason: `DATEPICKER_DOM_CLICK_FAILED: ${error?.message || error}`,
    }));
}

async function waitForCalendarDomUpdate(page, beforeSignature, targetDate) {
  return await page
    .evaluate(
      ({ previousSignature, expectedDate, timeoutMs }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const root = document.querySelector("#CitaMAP_HORAS");
        if (!root) return false;
        const signature = () => {
          const headers = Array.from(
            root.querySelectorAll(
              'th[class^="colFecha"], th[class*=" colFecha"]',
            ),
          ).map((header) => normalize(header.textContent));
          const freeIds = Array.from(
            root.querySelectorAll(
              'a[id^="HUECO"], a[onclick*="confirmarHueco"]',
            ),
          ).map((link) => `${link.id || ""}:${normalize(link.textContent)}`);
          return `${headers.join("|")}::${freeIds.join("|")}`;
        };
        const isReady = () => {
          const headers = Array.from(
            root.querySelectorAll(
              'th[class^="colFecha"], th[class*=" colFecha"]',
            ),
          ).map((header) => normalize(header.textContent));
          return (
            headers.includes(expectedDate) && signature() !== previousSignature
          );
        };
        if (isReady()) return true;

        return new Promise((resolve) => {
          let finished = false;
          const finish = (value) => {
            if (finished) return;
            finished = true;
            observer.disconnect();
            clearTimeout(timer);
            resolve(value);
          };
          const observer = new MutationObserver(() => {
            if (isReady()) finish(true);
          });
          observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
          });
          const timer = setTimeout(() => finish(isReady()), timeoutMs);
        });
      },
      {
        previousSignature: beforeSignature || "",
        expectedDate: targetDate,
        timeoutMs: CALENDAR_DATEPICKER_LOAD_WAIT_MS,
      },
    )
    .catch(() => false);
}

async function selectCalendarSlotFromDom(
  page,
  dateMin,
  dateMax,
  targetDate,
  excludedHuecoIds = [],
) {
  return await page
    .evaluate(
      ({ minDateText, maxDateText, preferredDate, excludedIds }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const parseDateValue = (value) => {
          const match = String(value || "").match(
            /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
          );
          if (!match) return null;
          const year = match[3].length === 2 ? `20${match[3]}` : match[3];
          const parsed = new Date(
            `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}T00:00:00`,
          );
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const inRange = (dateText) => {
          const current = parseDateValue(dateText);
          const min = parseDateValue(minDateText);
          const max = parseDateValue(maxDateText);
          return (
            current && (!min || current >= min) && (!max || current <= max)
          );
        };
        const excluded = new Set(
          (excludedIds || []).map((value) => String(value || "")),
        );
        const root = document.querySelector("#CitaMAP_HORAS") || document;
        const headers = Array.from(
          root.querySelectorAll(
            'th[class^="colFecha"], th[class*=" colFecha"]',
          ),
        );
        const dateByColumn = new Map();
        for (const header of headers) {
          const dateMatch = normalize(header.textContent).match(
            /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/,
          );
          if (!dateMatch) continue;
          for (const className of Array.from(header.classList || [])) {
            if (/^colFecha\d+$/i.test(className))
              dateByColumn.set(className, dateMatch[1]);
          }
        }

        const anchors = Array.from(
          root.querySelectorAll(
            'td[class*="colFecha"] a[id^="HUECO"], td[class*="colFecha"] a[onclick*="confirmarHueco"], td[class*="colFecha"] a',
          ),
        );
        const slots = [];
        for (const anchor of anchors) {
          const cell = anchor.closest("td");
          const row = anchor.closest("tr");
          const cellClasses = Array.from(cell?.classList || []);
          const columnClass =
            cellClasses.find((className) => /^colFecha\d+$/i.test(className)) ||
            "";
          const linkText = normalize(
            anchor.textContent ||
              anchor.getAttribute("aria-label") ||
              anchor.getAttribute("title"),
          );
          const cellText = normalize(cell?.textContent);
          const onclick = String(anchor.getAttribute("onclick") || "");
          const isFree =
            /^HUECO/i.test(String(anchor.id || "")) ||
            /confirmarHueco/i.test(onclick) ||
            /\bLIBRE\b/i.test(linkText || cellText);
          if (!isFree) continue;
          if (
            anchor.disabled ||
            anchor.getAttribute("aria-disabled") === "true"
          )
            continue;
          if (
            String(anchor.className || "")
              .toLowerCase()
              .includes("disabled")
          )
            continue;

          const dateText =
            dateByColumn.get(columnClass) ||
            (`${cellText} ${linkText}`.match(
              /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/,
            ) || [])[1] ||
            "";
          if (!dateText || !inRange(dateText)) continue;
          const huecoMatch =
            String(anchor.id || "").match(/(\d+)/) ||
            onclick.match(/confirmarHueco\s*\([^,]+,\s*(\d+)/i);
          const huecoId = huecoMatch ? huecoMatch[1] : "";
          if (huecoId && excluded.has(huecoId)) continue;
          const timeText = normalize(row?.querySelector("th")?.textContent);
          slots.push({
            anchor,
            dateText,
            huecoId,
            timeText,
            columnClass,
            label: normalize(
              [timeText, dateText, linkText || cellText]
                .filter(Boolean)
                .join(" "),
            ),
          });
        }

        const grouped = new Map();
        for (const slot of slots) {
          if (!grouped.has(slot.dateText)) grouped.set(slot.dateText, []);
          grouped.get(slot.dateText).push(slot);
        }
        const availableDates = Array.from(grouped.keys());
        const selectedDate =
          preferredDate && grouped.has(preferredDate)
            ? preferredDate
            : availableDates[Math.floor(Math.random() * availableDates.length)];
        const candidates = grouped.get(selectedDate) || [];
        if (candidates.length === 0) {
          return {
            ok: false,
            reason: preferredDate
              ? "NO_FREE_SLOT_FOR_SELECTED_DATE"
              : "NO_CALENDAR_SLOTS_IN_RANGE",
            targetDate: preferredDate || "",
            loadedDateCount: dateByColumn.size,
            totalSlots: slots.length,
            scannedAnchors: anchors.length,
          };
        }

        const selected =
          candidates[Math.floor(Math.random() * candidates.length)];
        selected.anchor.click();
        return {
          ok: true,
          mode: "calendar",
          clickMode: "dom-full-map",
          dateText: selectedDate,
          datePickerTarget: preferredDate || selectedDate,
          label: selected.label,
          huecoId: selected.huecoId,
          timeText: selected.timeText,
          columnClass: selected.columnClass,
          totalSlots: slots.length,
          slotsOnDate: candidates.length,
          dateCount: availableDates.length,
          loadedDateCount: dateByColumn.size,
          scannedAnchors: anchors.length,
        };
      },
      {
        minDateText: dateMin,
        maxDateText: dateMax,
        preferredDate: targetDate || "",
        excludedIds: excludedHuecoIds || [],
      },
    )
    .catch((error) => ({
      ok: false,
      reason: `CALENDAR_DOM_MAP_FAILED: ${error?.message || error}`,
    }));
}

async function selectRandomCalendarSlotTurbo(
  page,
  dateMin,
  dateMax,
  excludedHuecoIds = [],
) {
  const datepickerDates = await collectCalendarDatesFromDom(
    page,
    dateMin,
    dateMax,
  );
  const attempts = lodash
    .shuffle(datepickerDates)
    .slice(
      0,
      Math.min(CALENDAR_DATEPICKER_RANDOM_ATTEMPTS, datepickerDates.length),
    );

  for (const targetDate of attempts) {
    const clickResult = await clickCalendarDateFromDom(
      page,
      targetDate.dateText,
    );
    if (!clickResult.ok) {
      console.log(
        `CALENDAR_DOM_DATE_CLICK_SKIP: date=${targetDate.dateText} reason=${clickResult.reason}`,
      );
      continue;
    }
    if (!clickResult.alreadyLoaded) {
      await waitForCalendarDomUpdate(
        page,
        clickResult.beforeSignature,
        targetDate.dateText,
      );
    }

    const selected = await selectCalendarSlotFromDom(
      page,
      dateMin,
      dateMax,
      targetDate.dateText,
      excludedHuecoIds,
    );
    console.log(
      `CALENDAR_DOM_MAP: target=${targetDate.dateText} selectableDates=${datepickerDates.length} ` +
        `loadedDates=${selected.loadedDateCount || 0} freeSlots=${selected.totalSlots || 0} ` +
        `scannedAnchors=${selected.scannedAnchors || 0}`,
    );
    if (selected.ok) return selected;
  }

  const fallback = await selectCalendarSlotFromDom(
    page,
    dateMin,
    dateMax,
    "",
    excludedHuecoIds,
  );
  console.log(
    `CALENDAR_DOM_MAP_FALLBACK: selectableDates=${datepickerDates.length} ` +
      `loadedDates=${fallback.loadedDateCount || 0} freeSlots=${fallback.totalSlots || 0} ` +
      `scannedAnchors=${fallback.scannedAnchors || 0}`,
  );
  return fallback;
}

async function collectRadioSlots(page, dateMin, dateMax) {
  const handles = await page.$$(
    'div[id^="cita_"] input, input[type="radio"], input[type="checkbox"], input[name*="cita"], input[id*="cita"]',
  );
  const slots = [];
  const seen = new Set();

  for (const handle of handles) {
    const meta = await handle
      .evaluate((input) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const type = String(input.type || "").toLowerCase();
        if (input.disabled) return null;
        if (["hidden", "text", "submit", "button"].includes(type)) return null;
        if (input.id === "captcha" || input.name === "captcha") return null;
        if (
          type !== "radio" &&
          type !== "checkbox" &&
          !String(input.name || input.id || "")
            .toLowerCase()
            .includes("cita")
        ) {
          return null;
        }

        const root =
          input.closest('div[id^="cita_"]') ||
          input.closest("tr") ||
          input.closest("li") ||
          input.closest("label") ||
          input.parentElement;
        const label =
          (input.id &&
            document.querySelector(
              `label[for="${input.id.replace(/"/g, '\\"')}"]`,
            )) ||
          input.closest("label");
        const nearbyText = normalize(
          [
            root && (root.innerText || root.textContent),
            label && (label.innerText || label.textContent),
            input.getAttribute("aria-label"),
            input.getAttribute("title"),
            input.value,
          ]
            .filter(Boolean)
            .join(" "),
        );
        const dateMatch = nearbyText.match(/(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/);

        return {
          dateText: dateMatch ? dateMatch[1] : "",
          label: nearbyText,
          key: `${input.id || ""}|${input.name || ""}|${input.value || ""}`,
        };
      })
      .catch(() => null);

    if (!meta || seen.has(meta.key)) continue;
    seen.add(meta.key);
    if (meta.dateText && !isDateInRange(meta.dateText, dateMin, dateMax))
      continue;
    if (!meta.dateText && (parseDate(dateMin) || parseDate(dateMax))) continue;
    slots.push({ ...meta, handle });
  }

  return slots;
}

async function clickRadioSlot(page, slot) {
  const targetHandle = await slot.handle
    .evaluateHandle((input) => {
      const isVisible = (el) => {
        if (!el || typeof el.getBoundingClientRect !== "function") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const labelByFor = input.id
        ? Array.from(document.querySelectorAll("label")).find(
            (label) => label.getAttribute("for") === input.id,
          )
        : null;
      const label = labelByFor || input.closest("label");
      const root =
        input.closest('div[id^="cita_"]') ||
        input.closest("tr") ||
        input.closest("li") ||
        input.parentElement;

      if (isVisible(input)) return input;
      if (isVisible(label)) return label;
      if (isVisible(root)) return root;
      return input;
    })
    .catch(() => null);

  const clickHandle =
    targetHandle && typeof targetHandle.asElement === "function"
      ? targetHandle.asElement()
      : null;

  await clickElementHandleLikeUser(
    page,
    clickHandle || slot.handle,
    "radio_slot",
  );
  await new Promise((resolve) => setTimeout(resolve, 180));

  let checked = await slot.handle
    .evaluate((input) => !!input.checked)
    .catch(() => false);
  if (!checked && clickHandle && clickHandle !== slot.handle) {
    await clickElementHandleLikeUser(
      page,
      slot.handle,
      "radio_input_fallback",
    ).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 180));
    checked = await slot.handle
      .evaluate((input) => !!input.checked)
      .catch(() => false);
  }

  if (!checked) {
    throw new Error("RADIO_SLOT_NOT_CHECKED_AFTER_CLICK");
  }
}

async function selectRandomRadioSlotTrusted(page, dateMin, dateMax) {
  try {
    const slots = await collectRadioSlots(page, dateMin, dateMax);
    if (slots.length === 0) {
      return { ok: false, reason: "NO_RADIO_SLOTS_IN_RANGE" };
    }

    const grouped = groupSlotsByDate(slots);
    const dates = Array.from(grouped.keys()).filter(Boolean);
    const selectedDate = chooseRandomItem(dates);
    const slotsForDate = grouped.get(selectedDate) || [];
    const selectedSlot = chooseRandomItem(slotsForDate);

    if (!selectedSlot?.handle) {
      return { ok: false, reason: "RADIO_SELECTED_SLOT_HANDLE_MISSING" };
    }

    await clickRadioSlot(page, selectedSlot);

    return {
      ok: true,
      mode: "radio",
      clickMode: "trusted",
      dateText: selectedDate,
      label: selectedSlot.label,
      totalSlots: slots.length,
      slotsOnDate: slotsForDate.length,
      dateCount: dates.length,
      reason: "",
    };
  } catch (error) {
    return {
      ok: false,
      reason: `RADIO_TRUSTED_SELECT_FAILED: ${error?.message || error}`,
    };
  }
}

async function waitForPostSlotSelector(
  page,
  selector,
  data,
  stage,
  label,
  timeout = STEP_TIMEOUT_MS,
) {
  const badPagePromise = page
    .waitForFunction(
      () => {
        const url = window.location.href || "";
        const title = document.title || "";
        const bodyText = document.body
          ? document.body.innerText || document.body.textContent || ""
          : "";
        const lower = `${title} ${url} ${bodyText}`.toLowerCase();
        return (
          title === "Request Rejected" ||
          lower.includes("the requested url was rejected") ||
          lower.includes("your support id is") ||
          lower.includes("forbidden") ||
          lower.includes("too many requests") ||
          lower.includes("too many errors") ||
          lower.includes("this site can") ||
          lower.includes("err_connection") ||
          lower.includes("err_timed_out") ||
          lower.includes("err_proxy") ||
          /\b(?:403|429|404)\b/.test(lower)
        );
      },
      { timeout, polling: 500 },
    )
    .then(() => "bad")
    .catch(() => null);
  const found = await Promise.race([
    page
      .waitForSelector(selector, { timeout })
      .then(() => "selector")
      .catch(() => null),
    badPagePromise,
    sleep(timeout).then(() => null),
  ]);
  if (found === "selector") return "selector";

  const continuation = await throwIfBadPage(page, label, { data, stage });
  if (continuation?.hasModalButton) return "modal";
  if (continuation?.hasConfirmButton) return "confirm";
  if (continuation?.hasPrintButton) return "final";

  const recovered = await page
    .waitForSelector(selector, { timeout: POST_SLOT_RECOVERY_WAIT_MS })
    .then(() => "selector")
    .catch(() => null);
  if (recovered === "selector") return "selector";
  throw new Error(`POST_SLOT_WAIT_TIMEOUT_${label}`);
}

async function clickJconfirmYesButtonReliable(page, label = "jconfirm yes") {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const selectedHandle = await page
      .waitForFunction(
        () => {
          const normalize = (value) =>
            String(value || "")
              .replace(/\s+/g, " ")
              .trim();
          const plainText = (button) =>
            normalize(button.innerText || button.textContent || button.value)
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase();
          const isVisible = (button) => {
            const style = window.getComputedStyle(button);
            const rect = button.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          };
          const buttons = Array.from(
            document.querySelectorAll(
              "div.jconfirm.jconfirm-open div.jconfirm-buttons button, div.jconfirm-buttons button",
            ),
          ).filter(isVisible);
          if (buttons.length === 0) return false;
          return (
            buttons.find((button) => {
              const plain = plainText(button);
              return plain === "si" || plain.startsWith("si ");
            }) || buttons[0]
          );
        },
        { timeout: attempt === 1 ? STEP_TIMEOUT_MS : 350, polling: "raf" },
      )
      .then((handle) => handle.asElement())
      .catch(() => null);

    if (!selectedHandle) {
      console.log(
        `POST_SLOT_MODAL_YES_VISIBLE_WAIT_FAILED_${attempt}: ${label}`,
      );
      continue;
    }

    console.log(`POST_SLOT_MODAL_YES_CLICK_ATTEMPT_${attempt}: ${label}`);
    const navigationPromise = page
      .waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: LONG_STEP_TIMEOUT_MS,
      })
      .then(() => true)
      .catch(() => false);
    await clickElementHandleTurbo(page, selectedHandle, "jconfirm_yes");

    const advanced = await Promise.race([
      navigationPromise,
      page
        .waitForFunction(
          () => {
            const url = window.location.href || "";
            const text = document.body
              ? document.body.innerText || document.body.textContent || ""
              : "";
            const modalOpen = !!document.querySelector(
              "div.jconfirm.jconfirm-open div.jconfirm-buttons button",
            );
            return (
              !modalOpen ||
              url.includes("/acVerificarCita") ||
              url.includes("/acGrabarCita") ||
              !!document.querySelector("#btnConfirmar") ||
              /Debes confirmar los datos de la cita asignada/i.test(text)
            );
          },
          { timeout: 700, polling: 50 },
        )
        .then(() => true)
        .catch(() => false),
      page.waitForTimeout(800).then(() => false),
    ]).catch(() => false);

    if (advanced) {
      console.log(`POST_SLOT_MODAL_YES_CLICK_CONFIRMED_${attempt}: ${label}`);
      return true;
    }

    const stillOpen = await page
      .$("div.jconfirm.jconfirm-open div.jconfirm-buttons button")
      .then(Boolean)
      .catch(() => false);
    if (!stillOpen) {
      console.log(`POST_SLOT_MODAL_YES_CLICK_MODAL_GONE_${attempt}: ${label}`);
      return true;
    }

    console.log(`POST_SLOT_MODAL_YES_CLICK_RETRY_NEEDED_${attempt}: ${label}`);
  }

  return false;
}

async function getPostSlotUnavailableDetails(page) {
  return await page
    .evaluate(() => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      const normalizeKey = (value) =>
        normalize(value)
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = normalize(bodyText);
      const lower = normalizeKey(`${title} ${url} ${text}`);

      const badPage =
        title === "Request Rejected" ||
        lower.includes("the requested url was rejected") ||
        lower.includes("your support id is") ||
        lower.includes("forbidden") ||
        lower.includes("too many requests") ||
        lower.includes("too many errors");

      const unavailable =
        lower.includes("cita seleccionada no esta disponible") ||
        lower.includes("cita que ha seleccionado no esta disponible") ||
        lower.includes("cita solicitada no esta disponible") ||
        lower.includes("cita no esta disponible") ||
        (lower.includes("cita") &&
          lower.includes("ya no") &&
          lower.includes("disponible")) ||
        (lower.includes("hueco") &&
          lower.includes("no") &&
          lower.includes("disponible")) ||
        lower.includes("no se ha podido reservar la cita") ||
        lower.includes("no ha sido posible reservar la cita");

      return {
        ok: unavailable && !badPage,
        url,
        title,
        textPreview: text.slice(0, 700),
      };
    })
    .catch(() => ({ ok: false }));
}

async function recoverAcofertaAfterCalendarSlotUnavailable(page, data, stage) {
  const attempts = [
    async () => {
      console.log("CALENDAR_SLOT_UNAVAILABLE_RECOVERY: reload current page");
      await page
        .reload({
          waitUntil: "domcontentloaded",
          timeout: LONG_STEP_TIMEOUT_MS,
        })
        .catch(() => null);
    },
    async () => {
      console.log(
        "CALENDAR_SLOT_UNAVAILABLE_RECOVERY: go back to previous appointment page",
      );
      await page
        .goBack({
          waitUntil: "domcontentloaded",
          timeout: LONG_STEP_TIMEOUT_MS,
        })
        .catch(() => null);
    },
  ];

  for (const action of attempts) {
    await action();
    await page.waitForTimeout(250).catch(() => {});
    await throwIfRequestRejected(page, "calendar slot unavailable recovery");
    await throwIfIcpSystemError(page, "calendar slot unavailable recovery");

    const state = await waitForAcofertaCaptchaAndAppointment(
      page,
      ACOFERTA_READY_WAIT_MS,
    );
    if (state.requestRejected) {
      await throwIfRequestRejected(
        page,
        "calendar slot unavailable recovery state",
      );
    }
    if (state.systemError) {
      await throwIfIcpSystemError(
        page,
        "calendar slot unavailable recovery state",
      );
    }
    if (state.ready) {
      console.log(
        `CALENDAR_SLOT_UNAVAILABLE_RECOVERY_READY: captcha=${state.hasCaptcha} dateLinks=${state.dateLinkCount} radioSlots=${state.radioSlotCount}`,
      );
      return state;
    }
    if (state.noDisponibleWithCodOper || state.noDisponible) {
      console.log(
        `CALENDAR_SLOT_UNAVAILABLE_RECOVERY_NO_CITA: ${state.textPreview}`,
      );
      return state;
    }
  }

  throw new Error("CALENDAR_SLOT_UNAVAILABLE_RECOVERY_FAILED");
}

async function savePageState(page) {
  // Save the page state
  const state = {
    html: await page.content(), // Save the HTML content
    cookies: await page.cookies(), // Save the cookies
  };
  return state;
}

async function loadPageState(page, state) {
  try {
    // Load the HTML content
    await page.setContent(state.html);
    // Load the cookies
    await page.setCookie(...state.cookies);
  } catch (error) {
    console.log("failed load state");
  }
}

async function waitAndSelectTramite(
  page,
  tramiteCode,
  timeout = STEP_TIMEOUT_MS,
) {
  const tramite = String(tramiteCode || "").trim();
  if (!tramite) return false;

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(
        `Waiting/selecting tramite attempt ${attempt}/${maxAttempts}: ${tramite}`,
      );

      await page.waitForFunction(
        (value) => {
          const tramiteSelects = Array.from(
            document.querySelectorAll("select"),
          ).filter((select) => {
            const id = String(select.id || "");
            const name = String(select.name || "");
            return (
              id.startsWith("tramiteGrupo[") || name.startsWith("tramiteGrupo[")
            );
          });

          return tramiteSelects.some((select) => {
            return Array.from(select.options || []).some(
              (option) => String(option.value || "") === value,
            );
          });
        },
        { timeout, polling: 500 },
        tramite,
      );

      const result = await page.evaluate((value) => {
        const tramiteSelects = Array.from(
          document.querySelectorAll("select"),
        ).filter((select) => {
          const id = String(select.id || "");
          const name = String(select.name || "");
          return (
            id.startsWith("tramiteGrupo[") || name.startsWith("tramiteGrupo[")
          );
        });

        for (const select of tramiteSelects) {
          const options = Array.from(select.options || []);
          const optionIndex = options.findIndex(
            (opt) => String(opt.value || "") === value,
          );
          if (optionIndex === -1) continue;

          const option = options[optionIndex];
          select.scrollIntoView({ block: "center" });
          select.focus();
          select.selectedIndex = optionIndex;
          select.value = value;
          option.selected = true;

          // Fire all events ICP normally listens to.
          ["mousedown", "mouseup", "click", "input", "change", "blur"].forEach(
            (eventName) => {
              select.dispatchEvent(
                new Event(eventName, { bubbles: true, cancelable: true }),
              );
            },
          );

          // If jQuery exists on the ICP page, trigger its change handler too.
          if (window.jQuery) {
            window.jQuery(select).val(value).trigger("change");
          }

          return {
            ok: String(select.value || "") === value,
            id: select.id || "",
            name: select.name || "",
            value: String(select.value || ""),
            text: String(option.textContent || option.innerText || "").trim(),
          };
        }

        return { ok: false, reason: "tramite select/option not found" };
      }, tramite);

      if (!result || !result.ok) {
        throw new Error(
          `Tramite option found but not selected: ${JSON.stringify(result)}`,
        );
      }

      await page.waitForFunction(
        (value) => {
          const tramiteSelects = Array.from(
            document.querySelectorAll("select"),
          ).filter((select) => {
            const id = String(select.id || "");
            const name = String(select.name || "");
            return (
              id.startsWith("tramiteGrupo[") || name.startsWith("tramiteGrupo[")
            );
          });

          return tramiteSelects.some(
            (select) => String(select.value || "") === value,
          );
        },
        { timeout: STEP_TIMEOUT_MS, polling: 250 },
        tramite,
      );

      console.log(
        `Tramite selected and verified on attempt ${attempt}/${maxAttempts}: ${tramite}`,
      );
      return true;
    } catch (error) {
      lastError = error;
      console.log(
        `Tramite select attempt ${attempt}/${maxAttempts} failed: ${error.message}`,
      );

      if (attempt < maxAttempts) {
        await page.waitForTimeout(1500);
      }
    }
  }

  throw (
    lastError ||
    new Error(`Tramite not selected after ${maxAttempts} attempts: ${tramite}`)
  );
}

async function clickAceptarAfterTramiteSelected(page, tramiteCode) {
  const maxClicks = 2;

  for (let clickAttempt = 1; clickAttempt <= maxClicks; clickAttempt++) {
    await waitAndSelectTramite(page, tramiteCode, STEP_TIMEOUT_MS);
    await page.waitForTimeout(800);

    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ block: "center" });
      }
    }, "#btnAceptar");

    await page.locator("#btnAceptar").click();

    await page.waitForTimeout(1200);

    const stillOnTramiteError = await page
      .evaluate(() => {
        const text = document.body
          ? document.body.innerText || document.body.textContent || ""
          : "";
        return (
          text.includes("Debes seleccionar un trámite") ||
          text.includes("Debes seleccionar un tramite") ||
          text.includes("Por favor, selecciona un trámite") ||
          text.includes("Por favor, selecciona un tramite")
        );
      })
      .catch(() => false);

    if (!stillOnTramiteError) {
      return true;
    }

    console.log(
      `Aceptar clicked but ICP still says tramite not selected. Re-selecting tramite (${clickAttempt}/${maxClicks}).`,
    );

    await page
      .evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll(
            'button, input[type="button"], input[type="submit"]',
          ),
        );
        const aceptar = buttons.find(
          (btn) =>
            String(btn.innerText || btn.value || "")
              .trim()
              .toLowerCase() === "aceptar",
        );
        if (aceptar) aceptar.click();
      })
      .catch(() => {});

    await page.waitForTimeout(1500);
  }

  throw new Error(
    "ICP still says tramite not selected after re-select attempts",
  );
}

async function clickAcInfoClaveIfPresent(page) {
  // acInfo page: select exact "Presentación con Cl@ve" container if it appears.
  const isAcInfoOrClaveBox = await page
    .evaluate(() => {
      const text = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      return (
        window.location.href.includes("/acInfo") ||
        !!document.querySelector("#btnAccesoClave") ||
        text.includes("Presentación con Cl@ve") ||
        text.includes("Presentacion con Cl@ve")
      );
    })
    .catch(() => false);

  if (!isAcInfoOrClaveBox) return false;

  await page
    .waitForSelector("#btnAccesoClave", {
      timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS,
    })
    .catch(() => null);

  const clicked = await page
    .evaluate(() => {
      const claveBox = document.querySelector("#btnAccesoClave");
      if (!claveBox) return false;

      claveBox.scrollIntoView({ block: "center" });
      const accesoInput = claveBox.querySelector(
        'input[name="acceso"], #acceso',
      );
      if (accesoInput) {
        accesoInput.value = "N";
        accesoInput.dispatchEvent(new Event("input", { bubbles: true }));
        accesoInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      ["mousedown", "mouseup", "click"].forEach((eventName) => {
        claveBox.dispatchEvent(
          new MouseEvent(eventName, {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      });

      return true;
    })
    .catch(() => false);

  if (!clicked) return false;

  console.log("ACINFO_CLAVE_CLICKED");
  await Promise.race([
    page
      .waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS,
      })
      .catch(() => null),
    page
      .waitForSelector("#btnEntrar", {
        timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS,
      })
      .catch(() => null),
    page
      .waitForSelector("#btnEnviar", {
        timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS,
      })
      .catch(() => null),
    page
      .waitForFunction(
        () => {
          const url = window.location.href || "";
          const text = document.body
            ? document.body.innerText || document.body.textContent || ""
            : "";
          return (
            url.includes("pasarela.clave.gob.es") ||
            url.includes("/Proxy2/ServiceProvider") ||
            text.includes("Acceso DNIe / Certificado electrónico") ||
            text.includes("Acceso DNIe / Certificado electronico") ||
            text.includes("Se ha producido un error en el sistema") ||
            text.includes("Cod. Oper.")
          );
        },
        { timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS, polling: 500 },
      )
      .catch(() => null),
    page.waitForTimeout(CLAVE_SERVICE_REDIRECT_TIMEOUT_MS),
  ]);
  await throwIfRequestRejected(page, "after acInfo Cl@ve click");
  await throwIfIcpSystemError(page, "after acInfo Cl@ve click");
  return true;
}

async function clickClaveCertificadoIfPresent(page) {
  // Cl@ve gateway page: click "Acceso DNIe / Certificado electrónico" if it appears.
  const isClaveGateway = await page
    .evaluate(() => {
      const text = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      return (
        window.location.href.includes("pasarela.clave.gob.es") ||
        window.location.href.includes("/Proxy2/ServiceProvider") ||
        text.includes("Acceso DNIe / Certificado electrónico") ||
        text.includes("Acceso DNIe / Certificado electronico")
      );
    })
    .catch(() => false);

  if (!isClaveGateway) return false;

  console.log("CLAVE_GATEWAY_DETECTED");

  await page
    .waitForFunction(
      () => {
        const buttons = Array.from(
          document.querySelectorAll(
            "button, input[type='button'], input[type='submit'], a",
          ),
        );
        return buttons.some((btn) => {
          const text = String(
            btn.innerText || btn.textContent || btn.value || "",
          );
          const onclick = String(btn.getAttribute("onclick") || "");
          return (
            text.includes("Acceso DNIe / Certificado electrónico") ||
            text.includes("Acceso DNIe / Certificado electronico") ||
            onclick.includes("selectedIdP('AFIRMA')") ||
            onclick.includes('selectedIdP("AFIRMA")')
          );
        });
      },
      { timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS, polling: 500 },
    )
    .catch(() => null);

  const clicked = await page
    .evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll(
          "button, input[type='button'], input[type='submit'], a",
        ),
      );
      const certButton = buttons.find((btn) => {
        const text = String(
          btn.innerText || btn.textContent || btn.value || "",
        );
        const onclick = String(btn.getAttribute("onclick") || "");
        return (
          text.includes("Acceso DNIe / Certificado electrónico") ||
          text.includes("Acceso DNIe / Certificado electronico") ||
          onclick.includes("selectedIdP('AFIRMA')") ||
          onclick.includes('selectedIdP("AFIRMA")')
        );
      });

      if (!certButton) return false;
      certButton.scrollIntoView({ block: "center" });
      ["mousedown", "mouseup", "click"].forEach((eventName) => {
        certButton.dispatchEvent(
          new MouseEvent(eventName, {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
      });
      if (typeof certButton.click === "function") certButton.click();
      return true;
    })
    .catch(() => false);

  if (!clicked) {
    console.log("CLAVE_CERT_BUTTON_NOT_CLICKED_KEEP_WAIT");
    return false;
  }

  console.log("CLAVE_CERT_CLICKED_WAIT_ACENTRADA");
  await waitUntilAcEntradaOrEntrarAfterClave(page);
  await throwIfRequestRejected(page, "after Cl@ve certificado click");
  await throwIfIcpSystemError(page, "after Cl@ve certificado click");
  return true;
}

async function waitUntilAcEntradaOrEntrarAfterClave(page) {
  console.log(
    `WAIT_ACENTRADA_OR_ENTRAR_AFTER_CLAVE: max ${CLAVE_SERVICE_REDIRECT_TIMEOUT_MS}ms / 20 seconds`,
  );
  const ok = await page
    .waitForFunction(
      () => {
        const url = window.location.href || "";
        const title = document.title || "";
        const text = document.body
          ? document.body.innerText || document.body.textContent || ""
          : "";
        const hasEntradaForm =
          !!document.querySelector("#btnEnviar") ||
          !!document.querySelector("#txtIdCitado");
        return (
          hasEntradaForm ||
          !!document.querySelector("#btnEntrar") ||
          title === "Request Rejected" ||
          text.includes("The requested URL was rejected") ||
          text.includes("Your support ID is") ||
          text.includes("Se ha producido un error en el sistema") ||
          text.includes("Cod. Oper.")
        );
      },
      { timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);

  if (!ok) {
    console.log("CLAVE_SERVICE_REDIRECT_TIMEOUT_20S");
    throw new Error("CLAVE_SERVICE_REDIRECT_TIMEOUT_20S");
  }
}

async function waitForAcGrabarCitaFinalAndNotify(
  page,
  data,
  phone,
  email,
  usuarioClave = { nie: "UNKNOWN", name: "UNKNOWN" },
  timeoutMs = STEP_TIMEOUT_MS,
) {
  console.log(
    `ACGRABAR_WAIT_AFTER_SMS_CODE: waiting up to ${timeoutMs}ms for acGrabarCita / final confirmation...`,
  );

  await page
    .waitForFunction(
      () => {
        const url = window.location.href || "";
        const title = document.title || "";
        const bodyText = document.body
          ? document.body.innerText || document.body.textContent || ""
          : "";
        const text = bodyText.replace(/\s+/g, " ").trim();
        const lower = text.toLowerCase();

        const requestRejected =
          title === "Request Rejected" ||
          text.includes("The requested URL was rejected") ||
          text.includes("Your support ID is");

        const clave0019 =
          /(?:^|\s)0019(?:\s|$)/.test(text) ||
          lower.includes("se ha sobrepasado el número permitido de citas") ||
          lower.includes("se ha sobrepasado el numero permitido de citas");

        const finalUrl = url.includes("/acGrabarCita");
        const finalText =
          lower.includes("cita confirmada") ||
          lower.includes("cita grabada") ||
          lower.includes("justificante") ||
          lower.includes("reserva") ||
          lower.includes("su cita");

        return requestRejected || clave0019 || finalUrl || finalText;
      },
      { timeout: timeoutMs, polling: 500 },
    )
    .catch(() => null);

  const details = await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();
      const lower = text.toLowerCase();

      const requestRejected =
        title === "Request Rejected" ||
        text.includes("The requested URL was rejected") ||
        text.includes("Your support ID is");

      const clave0019 =
        /(?:^|\s)0019(?:\s|$)/.test(text) ||
        lower.includes("se ha sobrepasado el número permitido de citas") ||
        lower.includes("se ha sobrepasado el numero permitido de citas");

      const finalUrl = url.includes("/acGrabarCita");
      const finalText =
        lower.includes("cita confirmada") ||
        lower.includes("cita grabada") ||
        lower.includes("justificante") ||
        lower.includes("reserva") ||
        lower.includes("su cita");

      return {
        ok: !requestRejected && !clave0019 && (finalUrl || finalText),
        requestRejected,
        clave0019,
        url,
        title,
        textPreview: text.slice(0, 700),
      };
    })
    .catch(() => ({
      ok: false,
      requestRejected: false,
      clave0019: false,
      url: "UNKNOWN",
      title: "UNKNOWN",
      textPreview: "READ_FAILED",
    }));

  console.log(
    `ACGRABAR_STATUS: ok=${details.ok} rejected=${details.requestRejected} clave0019=${details.clave0019} url=${details.url}`,
  );
  console.log(`ACGRABAR_TEXT_PREVIEW: ${details.textPreview}`);

  if (details.clave0019) {
    console.log("CLAVE_0019_DETECTED_AFTER_SMS_CODE");
    await sendClave0019Telegram(data, usuarioClave);
    throw new Error("CLAVE_0019_NOTIFIED");
  }

  if (details.requestRejected) {
    console.log(
      "ACGRABAR_REQUEST_REJECTED_DETECTED: no final Telegram sent. Profile will restart by error handler.",
    );
    throw new Error("ACGRABAR_REQUEST_REJECTED");
  }

  if (!details.ok) {
    console.log(
      "ACGRABAR_NOT_REACHED_AFTER_SMS: final page not detected, no final Telegram sent.",
    );
    return false;
  }

  const sent = await sendMessageToGroup(
    data["owner"],
    `✅ CITA GRABADA ✅\n\n📝 Tramite: ${data["tramiteLabel"]}\n\n📍CITADO: ${data["nombre"]} - ${data["docId"]}\n\n🏢 Phone: ${phone}\n\nEmail: ${email}`,
  );
  console.log(`ACGRABAR_FINAL_TELEGRAM_SENT: ${sent}`);
  return true;
}

async function extractAppointmentConfirmationText(page) {
  return await page
    .evaluate(() => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      const root =
        document.querySelector("form") ||
        document.querySelector("#mainWindow") ||
        document.querySelector("main") ||
        document.body;
      const lines = normalize(
        root && (root.innerText || root.textContent || ""),
      )
        .split(
          /(?=N.|Justificante|Provincia|Oficina|Direcci|D[ií]a|Fecha|Hora|Mesa|Citado|Nombre|Documento)/i,
        )
        .map((line) => normalize(line))
        .filter(Boolean);
      const uniqueLines = [];
      for (const line of lines) {
        if (!uniqueLines.includes(line)) uniqueLines.push(line);
      }
      return uniqueLines.join("\n").slice(0, 3000);
    })
    .catch(() => "");
}

async function extractAppointmentConfirmationTextV2(page) {
  return await page
    .evaluate(() => {
      const normalize = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      const cleanupLabel = (value) =>
        normalize(value)
          .replace(/\s*:\s*$/, "")
          .replace(/\s+/g, " ");
      const escapeCss = (value) => {
        if (window.CSS && typeof window.CSS.escape === "function") {
          return window.CSS.escape(value);
        }
        return String(value || "")
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
      };
      const isClickableOnly = (line) => {
        const lower = normalize(line).toLowerCase();
        return ["imprimir", "salir", "volver", "aceptar"].includes(lower);
      };
      const readValue = (element) => {
        if (!element) return "";
        const tag = String(element.tagName || "").toLowerCase();
        const type = String(element.getAttribute("type") || "").toLowerCase();

        if (tag === "select") {
          const selected =
            element.options && element.selectedIndex >= 0
              ? element.options[element.selectedIndex]
              : null;
          return normalize(
            (selected && (selected.innerText || selected.textContent)) ||
              element.value ||
              "",
          );
        }

        if (tag === "textarea") {
          return normalize(element.value || element.textContent || "");
        }

        if (tag === "input") {
          if (["hidden", "submit", "button", "reset", "image"].includes(type))
            return "";
          if (["checkbox", "radio"].includes(type)) {
            return element.checked ? normalize(element.value || "SI") : "";
          }
          return normalize(
            element.value || element.getAttribute("value") || "",
          );
        }

        return normalize(
          element.innerText ||
            element.textContent ||
            element.getAttribute("value") ||
            "",
        );
      };
      const readContainerText = (element) => {
        if (!element) return "";
        const text = normalize(element.innerText || element.textContent || "");
        const values = Array.from(
          element.querySelectorAll("input, textarea, select"),
        )
          .map(readValue)
          .filter(Boolean);
        const merged = [text];
        for (const value of values) {
          if (!merged.some((item) => item.includes(value))) merged.push(value);
        }
        return normalize(merged.join(" "));
      };
      const lines = [];
      const pushLine = (line) => {
        const clean = normalize(line);
        if (!clean || isClickableOnly(clean)) return;
        if (!lines.includes(clean)) lines.push(clean);
      };
      const pushPair = (label, value) => {
        const cleanLabel = cleanupLabel(label);
        const cleanValue = normalize(value);
        if (!cleanValue || isClickableOnly(cleanValue)) return;
        if (
          !cleanLabel ||
          cleanLabel === cleanValue ||
          cleanLabel.includes(cleanValue)
        ) {
          pushLine(cleanValue);
          return;
        }
        pushLine(`${cleanLabel}: ${cleanValue}`);
      };

      const justificante = readValue(
        document.querySelector("#justificanteFinal"),
      );
      const root =
        document.querySelector("form") ||
        document.querySelector("#mainWindow") ||
        document.querySelector("main") ||
        document.body;

      if (justificante)
        pushPair("Numero de Justificante de cita", justificante);

      for (const heading of Array.from(
        root.querySelectorAll("h1, h2, h3, h4, legend, .titulo, .subtitulo"),
      )) {
        pushLine(readContainerText(heading));
      }

      for (const labelElement of Array.from(root.querySelectorAll("label"))) {
        const labelText = readValue(labelElement);
        if (!labelText) continue;

        let value = "";
        const labelFor = labelElement.getAttribute("for") || "";
        if (labelFor) {
          value = readValue(root.querySelector(`#${escapeCss(labelFor)}`));
        }

        const container =
          labelElement.closest(".fld, fieldset, tr, div") ||
          labelElement.parentElement;
        if (!value && container) {
          const candidates = Array.from(
            container.querySelectorAll("input, textarea, select, span"),
          ).filter(
            (candidate) =>
              candidate !== labelElement && !labelElement.contains(candidate),
          );
          for (const candidate of candidates) {
            const candidateValue = readValue(candidate);
            if (candidateValue && candidateValue !== labelText) {
              value = candidateValue;
              break;
            }
          }
        }

        let sibling = labelElement.nextElementSibling;
        while (!value && sibling) {
          const siblingValue = readValue(sibling);
          if (siblingValue && siblingValue !== labelText) {
            value = siblingValue;
            break;
          }
          sibling = sibling.nextElementSibling;
        }

        pushPair(labelText, value);
      }

      for (const table of Array.from(root.querySelectorAll("table"))) {
        for (const row of Array.from(table.querySelectorAll("tr"))) {
          const cells = Array.from(row.children).filter((child) =>
            /^(td|th)$/i.test(child.tagName || ""),
          );
          if (cells.length >= 2) {
            const label = readContainerText(cells[0]);
            const value = cells
              .slice(1)
              .map(readContainerText)
              .filter(Boolean)
              .join(" ");
            if (value) {
              pushPair(label, value);
            } else {
              pushLine(readContainerText(row));
            }
          } else {
            pushLine(readContainerText(row));
          }
        }
      }

      for (const field of Array.from(
        root.querySelectorAll("input, textarea, select"),
      )) {
        const value = readValue(field);
        if (!value) continue;

        let label = "";
        if (field.id) {
          label = readContainerText(
            root.querySelector(`label[for="${escapeCss(field.id)}"]`),
          );
        }

        if (!label) {
          const row = field.closest("tr");
          if (row) {
            const cells = Array.from(row.children).filter((child) =>
              /^(td|th)$/i.test(child.tagName || ""),
            );
            if (cells.length >= 2) {
              const ownCellIndex = cells.findIndex((cell) =>
                cell.contains(field),
              );
              if (ownCellIndex > 0)
                label = readContainerText(cells[ownCellIndex - 1]);
            }
            if (!label) label = readContainerText(row).replace(value, "");
          }
        }

        if (!label) {
          label =
            field.getAttribute("aria-label") ||
            field.getAttribute("placeholder") ||
            field.getAttribute("name") ||
            field.id ||
            "Dato";
        }

        pushPair(label, value);
      }

      const rawText = String(
        (root && (root.innerText || root.textContent || "")) || "",
      );
      for (const line of rawText.split(/\r?\n+/)) {
        pushLine(line);
      }

      return lines.join("\n").slice(0, 12000);
    })
    .catch(() => "");
}

function normalizeConfirmationLine(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\u00c2/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainConfirmationLine(value) {
  return normalizeConfirmationLine(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[º°]/g, "o")
    .toLowerCase();
}

function extractValueAfterConfirmationLabel(line, aliases) {
  const clean = normalizeConfirmationLine(line);
  const plain = plainConfirmationLine(clean);

  for (const alias of aliases) {
    const cleanAlias = normalizeConfirmationLine(alias);
    const plainAlias = plainConfirmationLine(cleanAlias);
    if (!plain.startsWith(plainAlias)) continue;

    const colonIndex = clean.indexOf(":");
    const beforeColonPlain =
      colonIndex >= 0 ? plainConfirmationLine(clean.slice(0, colonIndex)) : "";
    if (colonIndex >= 0 && beforeColonPlain === plainAlias) {
      return normalizeConfirmationLine(clean.slice(colonIndex + 1));
    }

    const aliasWordCount = cleanAlias.split(/\s+/).filter(Boolean).length;
    return normalizeConfirmationLine(
      clean
        .split(/\s+/)
        .slice(aliasWordCount)
        .join(" ")
        .replace(/^[:\-]+/, ""),
    );
  }

  return "";
}

function extractAppointmentConfirmationFieldsFromText(text) {
  const fields = {
    justificante: "",
    titular: "",
    telefono: "",
    correo: "",
    direccion: "",
    dia: "",
    hora: "",
    mesa: "",
    presentadorDni: "",
    presentadorNombre: "",
  };
  const specs = [
    [
      "justificante",
      [
        "Nº de Justificante de cita",
        "Nº Justificante",
        "N de Justificante de cita",
        "N Justificante",
        "Numero de Justificante de cita",
        "Numero Justificante",
        "Número de Justificante de cita",
        "Número Justificante",
        "Justificante",
      ],
    ],
    [
      "presentadorDni",
      [
        "DNI/NIE Presentador",
        "NIE/DNI Presentador",
        "DNI / NIE Presentador",
        "NIE / DNI Presentador",
        "DNI NIE Presentador",
        "NIE DNI Presentador",
        "DNI/NIE del Presentador",
        "NIE/DNI del Presentador",
        "DNI Presentador",
        "NIE Presentador",
        "Documento Presentador",
        "Documento del Presentador",
      ],
    ],
    [
      "presentadorNombre",
      [
        "Nombre y Apellido/s del Presentador",
        "Nombre y Apellido/s Presentador",
        "Nombre y Apellido del Presentador",
        "Nombre y Apellido Presentador",
        "Nombre y Apellidos del Presentador",
        "Nombre y Apellidos Presentador",
        "Nombre Apellido/s del Presentador",
        "Nombre Apellidos del Presentador",
        "Nombre Apellidos Presentador",
        "Nombre del Presentador",
      ],
    ],
    ["titular", ["Titular"]],
    ["telefono", ["Teléfono", "Telefono", "Teléfono móvil", "Telefono movil"]],
    ["correo", ["Correo electrónico", "Correo electronico", "Email", "E-mail"]],
    ["direccion", ["Dirección", "Direccion"]],
    ["dia", ["Día de la cita", "Dia de la cita", "Fecha de la cita"]],
    ["hora", ["Hora de la cita", "Hora cita"]],
    ["mesa", ["Mesa"]],
  ];
  const sectionHeaders = new Set([
    "cita confirmada",
    "datos del presentador",
    "datos del certificado digital",
    "certificado digital",
    "datos de la cita",
    "otros datos",
    "nota",
  ]);
  const allAliases = specs.flatMap(([, aliases]) =>
    aliases.map(plainConfirmationLine),
  );
  const startsWithKnownLabel = (line) => {
    const plain = plainConfirmationLine(line);
    return (
      sectionHeaders.has(plain) ||
      allAliases.some((alias) => plain.startsWith(alias))
    );
  };
  const nextContinuationText = (startIndex) => {
    const extra = [];
    for (
      let nextIndex = startIndex + 1;
      nextIndex < lines.length;
      nextIndex++
    ) {
      const nextLine = lines[nextIndex];
      const nextPlain = plainConfirmationLine(nextLine);
      if (!nextLine || startsWithKnownLabel(nextLine)) break;
      if (
        nextPlain.startsWith("es necesario") ||
        nextPlain.startsWith("puedes descargar") ||
        nextPlain.startsWith("tu cita ha sido") ||
        nextPlain.startsWith("importante") ||
        nextPlain.startsWith("si deseas")
      )
        break;
      extra.push(nextLine);
      if (extra.length >= 2) break;
    }
    return normalizeConfirmationLine(extra.join(" "));
  };
  const lines = String(text || "")
    .split(/\r?\n+/)
    .map(normalizeConfirmationLine)
    .filter(Boolean);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const [key, aliases] of specs) {
      if (fields[key]) continue;
      let value = extractValueAfterConfirmationLabel(line, aliases);
      let valueCameFromContinuation = false;
      if (
        !value &&
        aliases.some((alias) =>
          plainConfirmationLine(line).startsWith(plainConfirmationLine(alias)),
        )
      ) {
        value = nextContinuationText(index);
        valueCameFromContinuation = true;
      }
      if (!value) continue;
      if (sectionHeaders.has(plainConfirmationLine(value))) continue;
      if (
        !valueCameFromContinuation &&
        ["presentadorNombre", "direccion"].includes(key)
      ) {
        const continuation = nextContinuationText(index);
        if (continuation)
          value = normalizeConfirmationLine(`${value} ${continuation}`);
      }
      fields[key] = value;
    }
  }

  return fields;
}

function formatAppointmentConfirmationMessage(fields) {
  const value = (key) => normalizeConfirmationLine(fields?.[key] || "");

  return [
    "🔰 CITA CONFIRMADA 🔰",
    "",
    `📝 Nº Justificante: ${value("justificante")}`,
    "",
    `👤 Titular: ${value("titular")}`,
    `📞 Teléfono: ${value("telefono")}`,
    `📧 Correo: ${value("correo")}`,
    "",
    "📌 DATOS DE LA CITA",
    "",
    `📍 Dirección: ${value("direccion")}`,
    `🗓️ Día de la cita: ${value("dia")}`,
    `⏰ Hora de la cita: ${value("hora")}`,
    `🪑 Mesa: ${value("mesa")}`,
    "",
    "📎 Certificado digital:",
    `DNI/NIE Presentador: ${value("presentadorDni")}`,
    `Nombre del Presentador: ${value("presentadorNombre")}`,
  ]
    .join("\n")
    .trim();
}

async function sendFinalAppointmentTelegram(page, data, sourceLabel = "final") {
  await waitForFinalAppointmentDataReady(page, STEP_TIMEOUT_MS);
  const finalText = await extractAppointmentConfirmationTextV2(page);
  const finalFields = extractAppointmentConfirmationFieldsFromText(finalText);
  const message = formatAppointmentConfirmationMessage(finalFields);
  await sendLongMessageToGroup(data["owner"], message);
  // change status
  changeSatus(data["id"], "success");
  console.log(`FINAL_APPOINTMENT_TELEGRAM_SENT: ${sourceLabel}`);
  return { finalText, finalFields };
}

async function sendFinalAppointmentTelegramAndHold(
  page,
  data,
  sourceLabel = "final",
) {
  await sendFinalAppointmentTelegram(page, data, sourceLabel);
  console.log("Done Done Done");
  await holdFinalConfirmedPageOpen(page);
}

async function waitForFinalAppointmentDataReady(
  page,
  timeoutMs = STEP_TIMEOUT_MS,
) {
  const ready = await page
    .waitForFunction(
      () => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();
        const url = window.location.href || "";
        const bodyText = document.body
          ? document.body.innerText || document.body.textContent || ""
          : "";
        const lowerPlain = normalize(bodyText)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        const justificante = normalize(
          document.querySelector("#justificanteFinal")?.innerText ||
            document.querySelector("#justificanteFinal")?.textContent ||
            "",
        );
        const rowCount = document.querySelectorAll(
          "form tr, #mainWindow tr, table.fld tr",
        ).length;
        const valueCount = Array.from(
          document.querySelectorAll("form input, form textarea, form select"),
        ).filter((element) => {
          const type = String(element.getAttribute("type") || "").toLowerCase();
          if (["hidden", "submit", "button", "reset", "image"].includes(type))
            return false;
          return normalize(element.value || element.textContent || "");
        }).length;
        const hasFinalWords =
          lowerPlain.includes("cita confirmada") ||
          lowerPlain.includes("cita grabada") ||
          lowerPlain.includes("justificante de cita") ||
          lowerPlain.includes("datos de la cita");
        const hasAppointmentFields =
          lowerPlain.includes("dia de la cita") ||
          lowerPlain.includes("fecha de la cita") ||
          lowerPlain.includes("hora cita") ||
          lowerPlain.includes("mesa");

        return (
          !!justificante ||
          (url.includes("/acGrabarCita") &&
            hasFinalWords &&
            (rowCount >= 3 || valueCount >= 3 || hasAppointmentFields)) ||
          (!!document.querySelector("#btnImprimir") && hasFinalWords)
        );
      },
      { timeout: timeoutMs, polling: 250 },
    )
    .then(() => true)
    .catch(() => false);

  if (!ready) {
    console.log(
      "FINAL_APPOINTMENT_DATA_READY_TIMEOUT: continuing with best-effort extraction.",
    );
  }

  await page.waitForTimeout(800).catch(() => {});
  return ready;
}

async function getFinalConfirmationDetails(page) {
  return await page
    .evaluate(() => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body
        ? document.body.innerText || document.body.textContent || ""
        : "";
      const text = bodyText.replace(/\s+/g, " ").trim();
      const lower = text.toLowerCase();
      const lowerPlain = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const requestRejected =
        title === "Request Rejected" ||
        text.includes("The requested URL was rejected") ||
        text.includes("Your support ID is") ||
        lower.includes("forbidden") ||
        lower.includes("too many requests") ||
        lower.includes("too many errors");

      const hasConfirmButton = !!document.querySelector("#btnConfirmar");
      const hasCodeInput = !!document.querySelector("#txtCodigoVerificacion");
      const justificanteText = (
        document.querySelector("#justificanteFinal")?.innerText ||
        document.querySelector("#justificanteFinal")?.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      const rowCount = document.querySelectorAll(
        "form tr, #mainWindow tr, table.fld tr",
      ).length;
      const valueCount = Array.from(
        document.querySelectorAll("form input, form textarea, form select"),
      ).filter((element) => {
        const type = String(element.getAttribute("type") || "").toLowerCase();
        if (["hidden", "submit", "button", "reset", "image"].includes(type))
          return false;
        return String(element.value || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
      }).length;
      const strongFinalText =
        lowerPlain.includes("numero de justificante") ||
        lowerPlain.includes("n de justificante") ||
        lowerPlain.includes("nº de justificante") ||
        lowerPlain.includes("justificante de cita") ||
        lower.includes("cita confirmada") ||
        lower.includes("cita grabada");
      const hasAppointmentFields =
        lowerPlain.includes("dia de la cita") ||
        lowerPlain.includes("fecha de la cita") ||
        lowerPlain.includes("hora cita") ||
        lowerPlain.includes("mesa");
      const hasFinalPrintButton = !!document.querySelector("#btnImprimir");
      const finalDataReady =
        !!justificanteText ||
        (strongFinalText &&
          (hasFinalPrintButton ||
            rowCount >= 3 ||
            valueCount >= 3 ||
            hasAppointmentFields));
      const finalDetected =
        finalDataReady &&
        (!hasConfirmButton ||
          hasFinalPrintButton ||
          url.includes("/acGrabarCita"));
      const codeError =
        lowerPlain.includes("codigo") &&
        (lower.includes("incorrect") ||
          lowerPlain.includes("erroneo") ||
          lower.includes("erroneo") ||
          lower.includes("no es correcto"));

      return {
        ok: finalDetected && !requestRejected,
        requestRejected,
        finalDetected,
        hasConfirmButton,
        hasCodeInput,
        codeError,
        justificanteText,
        url,
        title,
        textPreview: text.slice(0, 900),
      };
    })
    .catch((error) => ({
      ok: false,
      requestRejected: false,
      finalDetected: false,
      hasConfirmButton: false,
      hasCodeInput: false,
      codeError: false,
      url: "UNKNOWN",
      title: "UNKNOWN",
      textPreview: `FINAL_CONFIRMATION_READ_FAILED: ${error?.message || error}`,
    }));
}

async function waitForFinalConfirmationOrRetry(
  page,
  timeoutMs = LONG_STEP_TIMEOUT_MS,
) {
  await page
    .waitForFunction(
      () => {
        const url = window.location.href || "";
        const title = document.title || "";
        const bodyText = document.body
          ? document.body.innerText || document.body.textContent || ""
          : "";
        const text = bodyText.replace(/\s+/g, " ").trim();
        const lower = text.toLowerCase();
        const lowerPlain = lower
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        const requestRejected =
          title === "Request Rejected" ||
          text.includes("The requested URL was rejected") ||
          text.includes("Your support ID is") ||
          lower.includes("forbidden") ||
          lower.includes("too many requests") ||
          lower.includes("too many errors");
        const hasConfirmButton = !!document.querySelector("#btnConfirmar");
        const hasCodeInput = !!document.querySelector("#txtCodigoVerificacion");
        const justificanteText = (
          document.querySelector("#justificanteFinal")?.innerText ||
          document.querySelector("#justificanteFinal")?.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        const rowCount = document.querySelectorAll(
          "form tr, #mainWindow tr, table.fld tr",
        ).length;
        const valueCount = Array.from(
          document.querySelectorAll("form input, form textarea, form select"),
        ).filter((element) => {
          const type = String(element.getAttribute("type") || "").toLowerCase();
          if (["hidden", "submit", "button", "reset", "image"].includes(type))
            return false;
          return String(element.value || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
        }).length;
        const strongFinalText =
          lowerPlain.includes("numero de justificante") ||
          lowerPlain.includes("n de justificante") ||
          lowerPlain.includes("nº de justificante") ||
          lowerPlain.includes("justificante de cita") ||
          lower.includes("cita confirmada") ||
          lower.includes("cita grabada");
        const hasAppointmentFields =
          lowerPlain.includes("dia de la cita") ||
          lowerPlain.includes("fecha de la cita") ||
          lowerPlain.includes("hora cita") ||
          lowerPlain.includes("mesa");
        const hasFinalPrintButton = !!document.querySelector("#btnImprimir");
        const finalDataReady =
          !!justificanteText ||
          (strongFinalText &&
            (hasFinalPrintButton ||
              rowCount >= 3 ||
              valueCount >= 3 ||
              hasAppointmentFields));
        const finalDetected =
          finalDataReady &&
          (!hasConfirmButton ||
            hasFinalPrintButton ||
            url.includes("/acGrabarCita"));
        const codeError =
          lowerPlain.includes("codigo") &&
          (lower.includes("incorrect") ||
            lowerPlain.includes("erroneo") ||
            lower.includes("erroneo") ||
            lower.includes("no es correcto"));
        const canRetry = hasConfirmButton && hasCodeInput && codeError;
        return requestRejected || finalDetected || canRetry;
      },
      { timeout: timeoutMs, polling: 500 },
    )
    .catch(() => null);

  return await getFinalConfirmationDetails(page);
}

async function waitForManualOtpAndFinalConfirmation(page, data) {
  console.log(
    "MANUAL_OTP_WAIT: waiting for you to enter SMS OTP and press Confirmar manually.",
  );
  let lastStatus = "";
  let codeErrorNotified = false;

  while (true) {
    if (typeof page.isClosed === "function" && page.isClosed()) {
      throw new Error("MANUAL_OTP_PAGE_CLOSED_RESTART");
    }

    const badPage = await getBadPageDetails(page);
    if (badPage.ok) {
      if (badPage.manualHoldEligible) {
        const recovered = await holdPostSlotBlockedPage(
          page,
          data,
          badPage,
          "after manual OTP Confirmar",
        );
        if (
          recovered?.hasConfirmButton ||
          recovered?.hasVerificationCode ||
          recovered?.hasPrintButton ||
          recovered?.finalConfirmed
        ) {
          continue;
        }
      }
      throw new Error(`BAD_PAGE_${badPage.type}`);
    }

    const details = await getFinalConfirmationDetails(page);
    const status = [
      `ok=${details.ok}`,
      `final=${details.finalDetected}`,
      `confirm=${details.hasConfirmButton}`,
      `code=${details.hasCodeInput}`,
      `codeError=${details.codeError}`,
      `url=${details.url}`,
    ].join(" ");

    if (status !== lastStatus) {
      console.log(`MANUAL_OTP_STATUS: ${status}`);
      console.log(`MANUAL_OTP_TEXT_PREVIEW: ${details.textPreview}`);
      lastStatus = status;
    }

    if (details.ok) {
      return details;
    }

    if (details.codeError && !codeErrorNotified) {
      codeErrorNotified = true;
      await sendMessageToGroup(
        data["owner"],
        `Codigo OTP parece incorrecto. Corrige el codigo manualmente y pulsa Confirmar otra vez.\n\nCITADO: ${data["nombre"]} - ${data["docId"]}`,
      );
    }

    await page.waitForTimeout(1000).catch(() => {});
  }
}

async function holdFinalConfirmedPageOpen(page) {
  console.log(
    "FINAL_CONFIRMED_HOLD_OPEN: final appointment page will stay open until you close it manually.",
  );
  while (true) {
    if (typeof page.isClosed === "function" && page.isClosed()) {
      throw new Error("FINAL_CONFIRMED_PAGE_CLOSED_DONE");
    }
    await page.waitForTimeout(STEP_TIMEOUT_MS).catch(() => {});
  }
}

// Get appointment
export async function getAppointment(
  data,
  proxyInput,
  proxyStartIndex = 0,
  fixedPositionSlot = null,
) {
  let usedOficinas = [];
  const proxyPool = Array.isArray(proxyInput)
    ? proxyInput.map((item) => String(item || "").trim()).filter(Boolean)
    : [String(proxyInput || "").trim()].filter(Boolean);
  let preferredProxyIndex = proxyPool.length
    ? Math.max(0, Number(proxyStartIndex) || 0) % proxyPool.length
    : -1;
  let forceReuseProxyIndex = null;
  // Har running profile ko ek fixed screen slot milta hai.
  // Restart/delete ke baad fresh browser isi same x/y position par open hoga.
  const fixedBrowserPositionSlot = Number.isInteger(fixedPositionSlot)
    ? fixedPositionSlot % BROWSER_POSITIONS.length
    : allocateBrowserPositionSlot();
  console.log(
    `PROFILE_FIXED_POSITION_SLOT_ASSIGNED: ${fixedBrowserPositionSlot + 1}/${BROWSER_POSITIONS.length}`,
  );
  while (true) {
    let browser, page, profileDir, proxyUrl;
    let currentProxyLease = acquireManagedProxy(proxyPool, {
      preferredIndex: preferredProxyIndex,
      forceIndex: forceReuseProxyIndex,
    });
    forceReuseProxyIndex = null;
    const proxy = currentProxyLease?.proxy || "";
    const currentProxyIndex = Number.isInteger(currentProxyLease?.index)
      ? currentProxyLease.index
      : -1;
    const attemptStartedAt = Date.now();
    const cooldownMs =
      currentProxyLease?.stat?.cooldownUntil > Date.now()
        ? currentProxyLease.stat.cooldownUntil - Date.now()
        : 0;
    console.log(
      `PROXY_FOR_ATTEMPT: index=${proxyPool.length ? currentProxyIndex + 1 : 0}/${proxyPool.length} ${maskProxyForLog(proxy)} score=${Math.round(currentProxyLease?.stat?.score || 0)} cooldownMs=${Math.max(0, Math.round(cooldownMs))}`,
    );
    let stage = "START";
    let usuarioClave = { nie: "UNKNOWN", name: "UNKNOWN" };
    let requestHandler;
    let forcedAbortReason = "";
    let forcedAbortDetails = null;
    let stopBadPageWatcher = null;
    let stopProfileLifetimeWatcher = null;
    const abortHandler = async () => {
      console.log("Abort triggered - cleaning up...");
      await closeBrowserFast(browser, "ABORT_HANDLER");
      await closeAnonymizedProxyFast(proxyUrl, "ABORT_HANDLER");
      await deleteProfileFolderFast(profileDir, "ABORT_HANDLER");
    };
    try {
      ({ browser, page, profileDir, proxyUrl } =
        await launchBrowserWithFingerprint(proxy, fixedBrowserPositionSlot));
      stopBadPageWatcher = startPreSlotBadPageWatcher(
        page,
        () => stage,
        (reason, details) => {
          if (!forcedAbortReason) {
            forcedAbortReason = reason;
            forcedAbortDetails = details;
          }
        },
      );
      stopProfileLifetimeWatcher = startProfileSearchLifetimeWatcher(
        page,
        () => stage,
        (reason, details) => {
          if (!forcedAbortReason) {
            forcedAbortReason = reason;
            forcedAbortDetails = details;
          }
        },
      );
      await page.setDefaultNavigationTimeout(STEP_TIMEOUT_MS);
      // REQUEST INTERCEPTION OFF:
      // Browser will load page normally (CSS/fonts/images/media allowed).
      // This is for testing whether URL Rejected is reduced when ICP sees a normal page-load pattern.
      requestHandler = null;
      const cursor = createCursor(page);
      // Build url
      const url = `https://icp.administracionelectronica.gob.es${data["provincia"]}`;
      // ####################################### First page #################################
      stage = "OPEN_PROVINCE";
      let initialNavigationError = null;
      const navigationPromise = page
        .goto(url, {
          waitUntil: "domcontentloaded",
          timeout: INITIAL_NAV_TIMEOUT_MS,
        })
        .catch((error) => {
          initialNavigationError = error;
          console.log(
            "Initial navigation did not finish cleanly:",
            error?.message || error,
          );
          return null;
        });
      await Promise.race([
        navigationPromise,
        page
          .waitForSelector("#btnAceptar", { timeout: STEP_TIMEOUT_MS })
          .catch(() => null),
      ]);
      // Check for the selector
      const navMsg = String(
        initialNavigationError?.message || initialNavigationError || "",
      );
      if (
        /ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|Navigation timeout/i.test(
          navMsg,
        )
      ) {
        throw new Error(`BAD_PAGE_PAGE_UNREACHABLE_${navMsg}`);
      }
      await throwIfRequestRejected(
        page,
        "after initial province load immediate check",
      );
      const aceptarLoaded = await page
        .waitForSelector("#btnAceptar", { timeout: STEP_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (!aceptarLoaded) {
        if (
          /ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|Navigation timeout/i.test(
            navMsg,
          )
        ) {
          throw new Error(`BAD_PAGE_PAGE_UNREACHABLE_${navMsg}`);
        }
        await throwIfRequestRejected(page, "after initial province load");
        await page.waitForSelector("#btnAceptar", { timeout: STEP_TIMEOUT_MS });
      }
      recordManagedProxyProgress(
        currentProxyLease,
        "province_loaded",
        2,
        Date.now() - attemptStartedAt,
      );
      //################################# select option ########
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (element) {
          element.scrollIntoView({ block: "center" });
        }
      }, "#btnAceptar");
      // click cookies if it appear
      if (await page.$("#cookie_action_close_header")) {
        try {
          await page.click("#cookie_action_close_header", { timeout: 2000 });
        } catch {
          console.log("Cookie banner click failed");
        }
      }
      try {
        await waitAndSelectTramite(page, data["tramite"], STEP_TIMEOUT_MS);
      } catch (error) {
        throw new Error(`TRAMITE_SELECT_FAILED_${error?.message || error}`);
      }
      await sleep(500);
      await clickAceptarAfterTramiteSelected(page, data["tramite"]);
      await Promise.race([
        page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: LONG_STEP_TIMEOUT_MS,
          })
          .catch(() => null),
        page
          .waitForSelector("#btnAccesoClave", { timeout: STEP_TIMEOUT_MS })
          .catch(() => null),
        page
          .waitForSelector("#btnEntrar", { timeout: STEP_TIMEOUT_MS })
          .catch(() => null),
        page
          .waitForSelector("#btnEnviar", { timeout: STEP_TIMEOUT_MS })
          .catch(() => null),
        page.waitForTimeout(STEP_TIMEOUT_MS),
      ]);
      // Check title
      let title = await page.title();
      await throwIfRequestRejected(page, "after navigation");
      await throwIfIcpSystemError(page, "after navigation");

      // Cl@ve / certificado digital flow.
      // If acInfo appears, select Presentación con Cl@ve.
      // If Cl@ve gateway appears, click DNIe / Certificado electrónico and wait for manual certificate selection.
      await clickAcInfoClaveIfPresent(page);
      await clickClaveCertificadoIfPresent(page);
      await waitUntilAcEntradaOrEntrarAfterClave(page);
      title = await page.title();
      await throwIfRequestRejected(page, "after acInfo/Cl@ve/certificado");
      await throwIfIcpSystemError(page, "after acInfo/Cl@ve/certificado");

      const isAcEntradaReadyNow = await page
        .evaluate(() => {
          return (
            !!document.querySelector("#btnEnviar") ||
            !!document.querySelector("#txtIdCitado")
          );
        })
        .catch(() => false);

      if (isAcEntradaReadyNow) {
        console.log("ACENTRADA_READY_AFTER_CLAVE_OR_DIRECT");
        await page.waitForSelector("#btnEnviar", { timeout: STEP_TIMEOUT_MS });
      } else {
        await page.waitForSelector("#btnEntrar", {
          timeout: LONG_STEP_TIMEOUT_MS,
        });
        // ##############################################  Second page ######
        // Scroll to the element and center it
        await page.evaluate((selector) => {
          const element = document.querySelector(selector);
          if (element) {
            element.scrollIntoView({ block: "center" });
          }
        }, "#btnEntrar");
        await page.locator("#btnEntrar").click();
        await Promise.race([
          page
            .waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: LONG_STEP_TIMEOUT_MS,
            })
            .catch(() => null),
          page
            .waitForSelector("#btnEnviar", { timeout: STEP_TIMEOUT_MS })
            .catch(() => null),
          page.waitForTimeout(STEP_TIMEOUT_MS),
        ]);
        title = await page.title();
        await throwIfRequestRejected(page, "after btnEntrar navigation");
        await throwIfIcpSystemError(page, "after btnEntrar navigation");
      }

      await page.waitForSelector("#btnEnviar", { timeout: STEP_TIMEOUT_MS });
      recordManagedProxyProgress(
        currentProxyLease,
        "acentrada_ready",
        3,
        Date.now() - attemptStartedAt,
      );
      usuarioClave = await getUsuarioClaveFromAcEntrada(page);
      console.log(`USUARIO_CLAVE_CAPTURED: ${JSON.stringify(usuarioClave)}`);

      // ############################################# Fill in info Page #######
      try {
        await page.click(selectors[data["docType"]], { timeout: 2000 }); // I am here
      } catch (error) {
        console.log("Error clicking the doc type");
      }
      await page.type("#txtIdCitado", data["docId"]); // Doc id
      await page.type("#txtDesCitado", data["nombre"]); // Name
      if (data["anoNacimiento"]) {
        await page.type("#txtAnnoCitado", data["anoNacimiento"]);
      }
      if (data["pais"]) {
        await page.evaluate((pais) => {
          document.querySelector(`option[value="${pais}"]`).selected = true; // back to selector
        }, data["pais"]);
      }
      if (data["fecha"]) {
        await page.type("#txtFecha", data["fecha"]);
      }
      // click continue
      stage = "CLIENT_DATA_SUBMIT";
      await sleep(3500);
      await page.locator("#btnEnviar").click();
      await Promise.race([
        page
          .waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: LONG_STEP_TIMEOUT_MS,
          })
          .catch(() => null),
        page
          .waitForSelector("#btnConsultar", { timeout: STEP_TIMEOUT_MS })
          .catch(() => null),
        page.waitForTimeout(STEP_TIMEOUT_MS),
      ]);
      title = await page.title();
      await throwIfRequestRejected(page, "after navigation");

      await throwIfIcpSystemError(page, "after navigation");
      if (
        await handleClave0019IfPresent(
          page,
          data,
          usuarioClave,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }
      try {
        await page.waitForSelector("#btnConsultar", { timeout: 5000 });
        recordManagedProxyProgress(
          currentProxyLease,
          "client_data_validated",
          3,
          Date.now() - attemptStartedAt,
        );
      } catch (error) {
        try {
          await page.waitForSelector("#btnEnviar", { timeout: 10 });
          await sendMessageToGroup(
            data["owner"],
            `Error in data of client ${data["nombre"]} con ID ${data["docId"]}`,
          );
          changeSatus(data["id"], "dataerror");
          throw new Error("CLIENT_DATA_ERROR_DONE");
        } catch (error) {
          console.log("Data search error");
        }
        throw new Error("Error");
      }

      //#################################### acValidarEntrada AUTO #################################
      // Auto mode here: click Solicitar Cita as soon as the button is visible.
      console.log(
        "acValidarEntrada auto mode: waiting for Solicitar Cita button...",
      );
      await page.waitForFunction(
        () => {
          const text = document.body
            ? document.body.innerText || document.body.textContent || ""
            : "";
          const url = window.location.href;
          const title = document.title || "";
          const buttons = Array.from(
            document.querySelectorAll(
              "button, input[type='button'], input[type='submit'], a",
            ),
          );
          const hasSolicitarButton = buttons.some((btn) => {
            const btnText = String(
              btn.innerText || btn.textContent || btn.value || "",
            )
              .trim()
              .toLowerCase();
            const id = String(btn.id || "");
            const onclick = String(btn.getAttribute("onclick") || "");
            return (
              btnText.includes("solicitar cita") ||
              (id === "btnEnviar" && onclick.includes("solicitud"))
            );
          });
          return (
            hasSolicitarButton ||
            url.includes("/acCitar") ||
            text.includes("Paso 1 de 5") ||
            text.includes(
              "Lo sentimos, pero has superado el máximo de citas",
            ) ||
            text.includes("En este momento no hay citas disponibles") ||
            text.includes("Cod. Oper.") ||
            title === "Request Rejected" ||
            text.includes("The requested URL was rejected") ||
            text.includes("Your support ID is") ||
            text.toLowerCase().includes("forbidden") ||
            text.toLowerCase().includes("too many requests") ||
            text.toLowerCase().includes("too many errors")
          );
        },
        { timeout: LONG_STEP_TIMEOUT_MS, polling: 500 },
      );
      title = await page.title();
      await throwIfRequestRejected(page, "before auto Solicitar Cita click");

      await throwIfIcpSystemError(page, "before auto Solicitar Cita click");
      if (
        await handleClave0019IfPresent(
          page,
          data,
          usuarioClave,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }

      const clickedSolicitarCita = await page
        .evaluate(() => {
          const buttons = Array.from(
            document.querySelectorAll(
              "button, input[type='button'], input[type='submit'], a",
            ),
          );
          const btn = buttons.find((el) => {
            const btnText = String(
              el.innerText || el.textContent || el.value || "",
            )
              .trim()
              .toLowerCase();
            const id = String(el.id || "");
            const onclick = String(el.getAttribute("onclick") || "");
            return (
              btnText.includes("solicitar cita") ||
              (id === "btnEnviar" && onclick.includes("solicitud"))
            );
          });
          if (!btn) return false;
          btn.scrollIntoView({ block: "center" });
          ["mousedown", "mouseup", "click"].forEach((eventName) => {
            btn.dispatchEvent(
              new MouseEvent(eventName, {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
          });
          if (typeof btn.click === "function") btn.click();
          return true;
        })
        .catch(() => false);

      if (!clickedSolicitarCita) {
        console.log(
          "Solicitar Cita button was not clicked because page already moved ahead or button was not found.",
        );
      } else {
        console.log("Solicitar Cita auto-clicked.");
      }

      await page.waitForFunction(
        () => {
          const text = document.body
            ? document.body.innerText || document.body.textContent || ""
            : "";
          const url = window.location.href;
          const title = document.title || "";
          return (
            url.includes("/acCitar") ||
            text.includes("Paso 1 de 5") ||
            text.includes(
              "Lo sentimos, pero has superado el máximo de citas",
            ) ||
            text.includes("En este momento no hay citas disponibles") ||
            text.includes("Cod. Oper.") ||
            title === "Request Rejected" ||
            text.includes("The requested URL was rejected") ||
            text.includes("Your support ID is") ||
            text.toLowerCase().includes("forbidden") ||
            text.toLowerCase().includes("too many requests") ||
            text.toLowerCase().includes("too many errors")
          );
        },
        { timeout: LONG_STEP_TIMEOUT_MS, polling: 500 },
      );
      title = await page.title();
      if (
        await handleAcValidarExactCaducadoIfPresent(
          page,
          data,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }
      await throwIfRequestRejected(page, "after auto Solicitar Cita click");

      await throwIfIcpSystemError(page, "after auto Solicitar Cita click");
      if (
        await handleClave0019IfPresent(
          page,
          data,
          usuarioClave,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }

      if (
        await handleMaxCitasIfPresent(
          page,
          data,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }

      const contentAfterManualClick = await page.content().catch(() => "");
      const hasAppointmentAfterManualClick =
        contentAfterManualClick.includes(
          "Lo sentimos, pero has superado el máximo de citas en vigor para este trámite en la provincia seleccionada.",
        ) ||
        contentAfterManualClick.includes(
          "Lo sentimos, pero has superado el máximo de citas en vigor para un trámite equivalente en la provincia seleccionada.",
        );
      if (hasAppointmentAfterManualClick) {
        if (
          await handleMaxCitasIfPresent(
            page,
            data,
            browser,
            profileDir,
            requestHandler,
          )
        ) {
          return "done";
        }
        throw new Error("MAX_CITAS_TEXT_DETECTED_DONE");
      }

      // Do not delete profile here if Paso 1 is not visible yet.
      // Start the existing refresh/check loop and let it decide after 10 attempts.
      // refresh
      let attempt = 0;
      while (attempt < 10) {
        try {
          await page.waitForSelector("#btnSiguiente", { timeout: 2000 }); // Check if it's open
          break;
        } catch (error) {
          if (
            await handleAcValidarExactCaducadoIfPresent(
              page,
              data,
              browser,
              profileDir,
              requestHandler,
            )
          ) {
            return "done";
          }
          if (
            await handleMaxCitasIfPresent(
              page,
              data,
              browser,
              profileDir,
              requestHandler,
            )
          ) {
            return "done";
          }
          const hasAppointment = await page.evaluate(() => {
            const text = document.body
              ? document.body.innerText || document.body.textContent || ""
              : "";
            return (
              text.includes(
                "Lo sentimos, pero has superado el máximo de citas en vigor para este trámite en la provincia seleccionada.",
              ) ||
              text.includes(
                "Lo sentimos, pero has superado el máximo de citas en vigor para un trámite equivalente en la provincia seleccionada.",
              )
            );
          });
          if (hasAppointment) {
            if (
              await handleMaxCitasIfPresent(
                page,
                data,
                browser,
                profileDir,
                requestHandler,
              )
            ) {
              return "done";
            }
            throw new Error("MAX_CITAS_TEXT_DETECTED_DONE");
          }
          // await sleep(1000);
          attempt += 1;
          await page.reload();
          if (
            await handleAcValidarExactCaducadoIfPresent(
              page,
              data,
              browser,
              profileDir,
              requestHandler,
            )
          ) {
            return "done";
          }
          if (
            await handleMaxCitasIfPresent(
              page,
              data,
              browser,
              profileDir,
              requestHandler,
            )
          ) {
            return "done";
          }
          await throwIfRequestRejected(
            page,
            `after acCitar refresh ${attempt}`,
          );

          await throwIfIcpSystemError(page, `after acCitar refresh ${attempt}`);
          if (
            await handleClave0019IfPresent(
              page,
              data,
              usuarioClave,
              browser,
              profileDir,
              requestHandler,
            )
          ) {
            return "done";
          }
          const content = await page.content().catch(() => "");
          if (!content.includes("Paso 1 de 5")) {
            console.log(
              `After refresh ${attempt}/10, Paso 1 not visible yet. Keeping profile and continuing refresh loop.`,
            );
            continue;
          }
        }
      }
      // If office did not open after exactly 10 refreshes, abort immediately.
      // This closes/deletes the current profile in catch and opens a fresh one without extra waits.
      if (attempt >= 10) {
        console.log(
          "No oficina opened after 10 refreshes. Aborting profile and restarting immediately.",
        );
        throw new Error("ABORT_AFTER_10_REFRESH");
      }

      // ## keep the process
      await page.waitForSelector("#btnSalir", { timeout: 5000 });
      await page.waitForSelector("#btnSiguiente", { timeout: 5000 }); // Check if it's open
      //######################################### select oficina page ###
      const oficinaOptions = await page.$$eval("#idSede option", (options) =>
        options
          .filter((option) => option.value.trim()) // Filter options with non-empty values
          .map((option) => ({
            value: option.value.trim(),
            text: String(option.textContent || option.innerText || "")
              .replace(/\s+/g, " ")
              .trim(),
          })),
      );
      // Pick oficina
      const nonEmptyValues = oficinaOptions.map((option) => option.value);
      let oficinas = mergeOficinas(nonEmptyValues, data["oficina"]);
      oficinas = oficinas.filter((item) => !usedOficinas.includes(item));
      let oficinaCandidates = oficinaOptions.filter((option) =>
        oficinas.includes(option.value),
      );
      const oficinasPreferidas = normalizeOfficeKeywordList(
        data["oficinasPreferidas"] ||
          data["oficinaPreferida"] ||
          process.env.OFICINAS ||
          process.env.OFICINA ||
          process.env.OFICINA_PREFERIDA ||
          "",
      );
      const oficinasExcluidas = normalizeOfficeKeywordList(
        data["oficinasExcluidas"] ||
          process.env.OFICINAS_EXCLUIDAS ||
          process.env.OFICINA_EXCLUIDA ||
          "",
      );

      if (oficinasExcluidas.length > 0) {
        const beforeExcludeCount = oficinaCandidates.length;
        oficinaCandidates = oficinaCandidates.filter(
          (option) => !oficinaMatchesAnyKeyword(option, oficinasExcluidas),
        );
        oficinas = oficinaCandidates.map((option) => option.value);
        console.log(
          `OFICINAS_EXCLUIDAS_MATCH: "${oficinasExcluidas.join(", ")}" removed=${beforeExcludeCount - oficinaCandidates.length}/${beforeExcludeCount}`,
        );
        if (oficinaCandidates.length === 0) {
          console.log(
            `OFICINAS_TODAS_EXCLUIDAS: ${oficinasExcluidas.join(", ")}`,
          );
          console.log(
            `OFICINAS_DISPONIBLES: ${oficinaOptions.map((option) => `${option.value}:${option.text}`).join(" | ")}`,
          );
          usedOficinas = [];
          throw new Error("ALL_OFICINAS_EXCLUDED_RESTART");
        }
      }

      if (oficinasPreferidas.length > 0) {
        const preferredCandidates = oficinaCandidates.filter((option) =>
          oficinaMatchesAnyKeyword(option, oficinasPreferidas),
        );
        console.log(
          `OFICINAS_PREFERIDAS_MATCH: "${oficinasPreferidas.join(", ")}" matches=${preferredCandidates.length}/${oficinaCandidates.length}`,
        );
        if (preferredCandidates.length === 0) {
          console.log(
            `OFICINAS_PREFERIDAS_NOT_FOUND: "${oficinasPreferidas.join(", ")}"`,
          );
          console.log(
            `OFICINAS_DISPONIBLES: ${oficinaCandidates.map((option) => `${option.value}:${option.text}`).join(" | ")}`,
          );
          usedOficinas = [];
          throw new Error("PREFERRED_OFICINA_NOT_AVAILABLE_RESTART");
        }
        oficinaCandidates = preferredCandidates;
        oficinas = oficinaCandidates.map((option) => option.value);
      }
      if (oficinaCandidates.length === 0) {
        usedOficinas = [];
        throw new Error("NO_OFICINAS_AVAILABLE_RESTART");
      }
      console.log(
        `OFICINAS_CANDIDATAS: ${oficinaCandidates.map((option) => `${option.value}:${option.text}`).join(" | ")}`,
      );
      const selectedOficina = oficinaCandidates[0];
      const chooseOficina = selectedOficina.value;
      console.log(
        `OFICINA_SELECTED: value=${chooseOficina} text=${selectedOficina.text}`,
      );
      await page.evaluate((value) => {
        const select = document.querySelector("#idSede");
        const option =
          select &&
          Array.from(select.options || []).find(
            (item) => String(item.value || "") === String(value),
          );
        if (!select || !option) return;
        select.value = value;
        option.selected = true;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, chooseOficina);
      // Find and click the button
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (element) {
          element.scrollIntoView({ block: "center" });
        }
      }, "#btnSiguiente");
      await Promise.all([
        page.locator("#btnSiguiente").click(),
        Promise.race([
          page
            .waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: LONG_STEP_TIMEOUT_MS,
            })
            .catch(() => null),
          page
            .waitForSelector("#txtTelefonoCitado", { timeout: STEP_TIMEOUT_MS })
            .catch(() => null),
          page.waitForTimeout(STEP_TIMEOUT_MS),
        ]),
      ]);
      // Check title
      title = await page.title();
      await throwIfRequestRejected(page, "after navigation");

      await throwIfIcpSystemError(page, "after navigation");
      if (
        await handleClave0019IfPresent(
          page,
          data,
          usuarioClave,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }
      await page.waitForSelector("#txtTelefonoCitado", {
        timeout: STEP_TIMEOUT_MS,
      });
      // ###################################### fill in phone number and email
      let phone = await getFirstNumber();
      if (!phone) {
        await sendMessageToGroup(
          data["owner"],
          `No phone numbers available for ${data["nombre"]} - ${data["docId"]}`,
        );
        throw new Error("NO_PHONE_AVAILABLE_DONE");
      }
      const email = getEmail(data["nombre"]);
      await page.type("#txtTelefonoCitado", `${phone}`);
      await page.type("#emailUNO", email);
      await page.type("#emailDOS", email);
      // write observation
      try {
        await page.type("#txtObservaciones", "Observations");
      } catch (error) {
        console.log("Observations not asked");
      }
      await sleep(2650);
      // click
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (element) {
          element.scrollIntoView({ block: "center" });
        }
      }, "#btnSiguiente");
      await page.locator("#btnSiguiente").click();

      // If phone is wrong or manually deleted, ICP keeps this same acVerFormulario page.
      // In that case, wait 10 minutes here before restarting the profile.
      await page
        .waitForFunction(
          () => {
            const url = window.location.href || "";
            const title = document.title || "";
            const text = document.body
              ? document.body.innerText || document.body.textContent || ""
              : "";
            const lower = text.toLowerCase();

            return (
              url.includes("/acOfertarCita") ||
              !!document.querySelector('img[alt="captcha"]') ||
              title === "Request Rejected" ||
              text.includes("The requested URL was rejected") ||
              text.includes("Your support ID is") ||
              lower.includes("forbidden") ||
              lower.includes("too many requests") ||
              lower.includes("too many errors") ||
              lower.includes("this site can") ||
              lower.includes("err_connection") ||
              lower.includes("err_timed_out") ||
              lower.includes("err_proxy") ||
              text.includes("Se ha producido un error en el sistema") ||
              text.includes("Cod. Oper.")
            );
          },
          { timeout: ACVERFORMULARIO_STUCK_WAIT_MS, polling: 1000 },
        )
        .catch(() => null);

      const stillOnAcVerFormularioPhonePage = await page
        .evaluate(() => {
          const url = window.location.href || "";
          const title = document.title || "";
          const text = document.body
            ? document.body.innerText || document.body.textContent || ""
            : "";

          const requestRejected =
            title === "Request Rejected" ||
            text.includes("The requested URL was rejected") ||
            text.includes("Your support ID is") ||
            text.toLowerCase().includes("forbidden") ||
            text.toLowerCase().includes("too many requests") ||
            text.toLowerCase().includes("too many errors");

          const systemError =
            text.includes("Se ha producido un error en el sistema") ||
            text.includes("Cod. Oper.");

          return (
            !url.includes("/acOfertarCita") &&
            !document.querySelector('img[alt="captcha"]') &&
            !requestRejected &&
            !systemError &&
            !!document.querySelector("#txtTelefonoCitado") &&
            !!document.querySelector("#btnSiguiente")
          );
        })
        .catch(() => false);

      if (stillOnAcVerFormularioPhonePage) {
        console.log(
          "ACVERFORMULARIO_PHONE_WRONG_OR_EMPTY_WAITED_10MIN_RESTART: still on phone page after btnSiguiente.",
        );
        throw new Error(
          "ACVERFORMULARIO_PHONE_WRONG_OR_EMPTY_WAITED_10MIN_RESTART",
        );
      }
      // ######################### select a date ##############""
      // Check title
      title = await page.title();
      await throwIfRequestRejected(page, "after navigation");

      await throwIfIcpSystemError(page, "after navigation");
      if (
        await handleClave0019IfPresent(
          page,
          data,
          usuarioClave,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }

      // Slow profile/proxy safe: wait until acOfertarCita has captcha + available appointment/date/radio slot.
      const acofertaReady = await waitForAcofertaCaptchaAndAppointment(
        page,
        ACOFERTA_READY_WAIT_MS,
      );
      if (acofertaReady.requestRejected) {
        await throwIfRequestRejected(page, "acOfertarCita ready wait");

        await throwIfIcpSystemError(page, "acOfertarCita ready wait");
      }
      if (
        await handleClave0019IfPresent(
          page,
          data,
          usuarioClave,
          browser,
          profileDir,
          requestHandler,
        )
      ) {
        return "done";
      }
      if (await handleTelefono0006IfPresent(page, data, phone)) {
        throw new Error("TELEFONO_0006_NOTIFIED");
      }
      if (acofertaReady.noDisponibleWithCodOper) {
        console.log(
          `ACOFERTA_NO_CITA_DISPONIBLE_COD_OPER: waiting ${ACOFERTA_NO_CITA_DELETE_WAIT_MS}ms before deleting profile.`,
        );
        await page
          .waitForTimeout(ACOFERTA_NO_CITA_DELETE_WAIT_MS)
          .catch(() => {});
        throw new Error("ACOFERTA_NO_CITA_DELETE_AFTER_3S_ALREADY_WAITED");
      }
      if (acofertaReady.noDisponible) {
        console.log(
          "ACOFERTA_NO_CITA_DISPONIBLE: no Cod. Oper. yet. Restarting profile through error handler.",
        );
        throw new Error("ACOFERTA_NO_CITA_DISPONIBLE");
      }
      if (!acofertaReady.ready) {
        console.log(
          `ACOFERTA_NOT_READY_AFTER_${ACOFERTA_READY_WAIT_MS}MS: captcha/date/radio not fully loaded. Restarting profile through error handler.`,
        );
        throw new Error(`ACOFERTA_NOT_READY_AFTER_${ACOFERTA_READY_WAIT_MS}MS`);
      }
      recordManagedProxyProgress(
        currentProxyLease,
        "acoferta_ready",
        5,
        Date.now() - attemptStartedAt,
      );

      // select appointment
      const dateMin = data["minDate"];
      const dateMax = data["maxDate"];
      let selectedSlotForPostSubmit = null;
      const usedCalendarHuecoIds = new Set();

      const selectRadioAndSubmit = async (
        reason = "radio",
        captchaAlreadySolved = false,
      ) => {
        stage = "SLOT_SELECTED";
        const selectedSlot = await selectRandomRadioSlotTrusted(
          page,
          dateMin,
          dateMax,
        );
        if (!selectedSlot.ok) {
          console.log(
            `Appointment not in range for radio slots (${reason}): ${selectedSlot.reason}`,
          );
          return { ok: false, selectedSlot };
        }
        console.log(
          `RADIO_TRUSTED_RANDOM_SELECTION: date=${selectedSlot.dateText} dateCount=${selectedSlot.dateCount} slotsOnDate=${selectedSlot.slotsOnDate} totalSlots=${selectedSlot.totalSlots} label=${selectedSlot.label}`,
        );
        if (!captchaAlreadySolved) {
          const captchaOk = await solveCaptcha(page);
          if (!captchaOk) {
            throw new Error("CAPTCHA_NOT_FILLED_BEFORE_RADIO_SUBMIT");
          }
        }

        stage = "SLOT_SUBMITTED";
        await page.locator("#btnSiguiente").click();
        selectedSlotForPostSubmit = selectedSlot;
        return { ok: true, selectedSlot };
      };

      const selectCalendarSlotOnly = async (reason = "calendar") => {
        const captchaJob = await startCaptchaSolveInBackground(page);
        stage = "SLOT_SELECTED";
        const [selectedSlot, backgroundCaptchaOk] = await Promise.all([
          selectRandomCalendarSlotTurbo(
            page,
            dateMin,
            dateMax,
            Array.from(usedCalendarHuecoIds),
          ),
          captchaJob.promise,
        ]);

        let captchaOk =
          backgroundCaptchaOk &&
          (await page
            .evaluate((expectedImageSrc) => {
              const image = document.querySelector('img[alt="captcha"]');
              const input = document.querySelector("#captcha");
              return !!(
                image &&
                input &&
                String(image.src || "") === expectedImageSrc &&
                String(input.value || "").trim()
              );
            }, captchaJob.imageSrc)
            .catch(() => false));
        if (!captchaOk) {
          console.log("CALENDAR_CAPTCHA_BACKGROUND_RETRY_CURRENT_IMAGE");
          captchaOk = await solveCaptcha(page);
        }
        if (!captchaOk) {
          throw new Error("CAPTCHA_NOT_FILLED_BEFORE_CALENDAR_SLOT");
        }

        if (!selectedSlot.ok) {
          console.log(
            `Appointment not in range for calendar slots (${reason}): ${selectedSlot.reason}`,
          );
          return { ok: false, selectedSlot };
        }

        selectedSlotForPostSubmit = selectedSlot;
        if (selectedSlot.huecoId)
          usedCalendarHuecoIds.add(String(selectedSlot.huecoId));
        console.log(
          `CALENDAR_DOM_RANDOM_SELECTION: mode=${selectedSlot.clickMode || "dom-full-map"} target=${selectedSlot.datePickerTarget || selectedSlot.dateText} date=${selectedSlot.dateText} dateCount=${selectedSlot.dateCount} loadedDateCount=${selectedSlot.loadedDateCount || 0} slotsOnDate=${selectedSlot.slotsOnDate} totalSlots=${selectedSlot.totalSlots} label=${selectedSlot.label}`,
        );
        return { ok: true, selectedSlot };
      };

      const selectAvailableAppointment = async (reason = "initial") => {
        const datePicker = await page.$("#datepicker");
        const slotStateBeforeSelect = await getAcofertaReadyState(page);
        const hasCalendarSlots = slotStateBeforeSelect.dateLinkCount > 0;
        const hasRadioSlots = slotStateBeforeSelect.radioSlotCount > 0;

        console.log(
          `ACOFERTA_SELECT_MODE: reason=${reason} priority=${hasRadioSlots ? "radio" : "calendar"} datePicker=${datePicker !== null} dateLinks=${slotStateBeforeSelect.dateLinkCount} radioSlots=${slotStateBeforeSelect.radioSlotCount}`,
        );

        if (hasRadioSlots) {
          return await selectRadioAndSubmit(reason);
        }

        if (datePicker !== null && hasCalendarSlots) {
          return await selectCalendarSlotOnly(reason);
        }

        console.log("ACOFERTA_NO_SELECTABLE_SLOT_AT_SELECTION_TIME");
        return { ok: false, selectedSlot: { reason: "NO_SELECTABLE_SLOT" } };
      };

      const firstSelection = await selectAvailableAppointment("initial");
      if (!firstSelection.ok) {
        usedOficinas.push(chooseOficina);
        throw new Error("APPOINTMENT_NOT_IN_RANGE_TRY_NEXT_OFFICE");
      }
      recordManagedProxyProgress(
        currentProxyLease,
        "slot_selected",
        12,
        Date.now() - attemptStartedAt,
      );

      const acceptSelectedSlotAndCheckResult = async (reason = "initial") => {
        const modalState = await waitForPostSlotSelector(
          page,
          "div.jconfirm.jconfirm-open div.jconfirm-buttons button, div.jconfirm-buttons button",
          data,
          stage,
          `after slot selection waiting confirmation modal (${reason})`,
          STEP_TIMEOUT_MS,
        );
        if (modalState === "selector" || modalState === "modal") {
          stage = "SLOT_MODAL_ACCEPTED";
          const modalAccepted = await clickJconfirmYesButtonReliable(
            page,
            `slot submit ${reason}`,
          );
          if (!modalAccepted) {
            throw new Error("POST_SLOT_MODAL_YES_CLICK_NOT_CONFIRMED");
          }
        } else {
          console.log(`POST_SLOT_MODAL_SKIPPED_STATE: ${modalState}`);
        }

        const unavailableDetails = await getPostSlotUnavailableDetails(page);
        if (unavailableDetails.ok) {
          console.log(
            `POST_SLOT_UNAVAILABLE_DETECTED: reason=${reason} url=${unavailableDetails.url}`,
          );
          console.log(
            `POST_SLOT_UNAVAILABLE_TEXT: ${unavailableDetails.textPreview}`,
          );
          return "slot_unavailable";
        }

        // #################### final page ############
        // Check title
        title = await page.title();
        stage = "WAIT_CONFIRMATION";
        const blockedContinuation = await throwIfBadPage(
          page,
          "final page after slot submit",
          { data, stage },
        );
        if (blockedContinuation?.hasModalButton) {
          stage = "SLOT_MODAL_ACCEPTED";
          const modalAccepted = await clickJconfirmYesButtonReliable(
            page,
            `blocked continuation ${reason}`,
          );
          if (!modalAccepted) {
            throw new Error(
              "POST_SLOT_MODAL_YES_CLICK_NOT_CONFIRMED_AFTER_BADPAGE_CHECK",
            );
          }
        }

        const unavailableAfterBadPageCheck =
          await getPostSlotUnavailableDetails(page);
        if (unavailableAfterBadPageCheck.ok) {
          console.log(
            `POST_SLOT_UNAVAILABLE_DETECTED_AFTER_BADPAGE_CHECK: reason=${reason} url=${unavailableAfterBadPageCheck.url}`,
          );
          console.log(
            `POST_SLOT_UNAVAILABLE_TEXT: ${unavailableAfterBadPageCheck.textPreview}`,
          );
          return "slot_unavailable";
        }

        await throwIfIcpSystemError(page, "final page");
        if (
          await handleClave0019IfPresent(
            page,
            data,
            usuarioClave,
            browser,
            profileDir,
            requestHandler,
          )
        ) {
          return "done";
        }

        return "continue";
      };

      const isRecoverableCalendarPostSlotError = (error) => {
        const msg = String(error?.message || error || "").toLowerCase();
        if (isManualBrowserCloseError(error)) return false;
        if (msg.includes("bad_page_request_rejected")) return false;
        if (
          msg.includes("forbidden") ||
          msg.includes("too many requests") ||
          msg.includes("too many errors")
        )
          return false;
        if (
          msg.includes("clave_0019") ||
          msg.includes("telefono_0006") ||
          msg.includes("max_citas")
        )
          return false;
        return true;
      };

      let postSlotResult = null;
      let postSlotRetryCount = 0;
      while (true) {
        try {
          const attemptLabel =
            postSlotRetryCount === 0
              ? "initial"
              : `calendar retry ${postSlotRetryCount}`;
          postSlotResult = await acceptSelectedSlotAndCheckResult(attemptLabel);

          if (postSlotResult === "done") {
            return "done";
          }

          if (postSlotResult === "slot_unavailable") {
            throw new Error("POST_SLOT_UNAVAILABLE");
          }

          // check it load next page
          await waitForPostSlotSelector(
            page,
            "#btnConfirmar",
            data,
            stage,
            `waiting btnConfirmar (${attemptLabel})`,
            STEP_TIMEOUT_MS,
          );
          break;
        } catch (postSlotError) {
          if (selectedSlotForPostSubmit?.mode !== "calendar") {
            throw postSlotError;
          }

          if (!isRecoverableCalendarPostSlotError(postSlotError)) {
            throw postSlotError;
          }

          if (postSlotRetryCount >= CALENDAR_POST_SLOT_MAX_RETRIES) {
            throw new Error(
              `CALENDAR_POST_SLOT_RETRIES_EXHAUSTED_AFTER_${postSlotRetryCount}_RETRIES: ${postSlotError?.message || postSlotError}`,
            );
          }

          postSlotRetryCount += 1;
          console.log(
            `CALENDAR_POST_SLOT_RETRY_${postSlotRetryCount}_OF_${CALENDAR_POST_SLOT_MAX_RETRIES}: refreshing offer, solving captcha again, and trying another slot. reason=${postSlotError?.message || postSlotError}`,
          );
          const recoveredState =
            await recoverAcofertaAfterCalendarSlotUnavailable(
              page,
              data,
              stage,
            );
          if (!recoveredState.ready) {
            throw new Error(
              "CALENDAR_POST_SLOT_RECOVERY_NO_AVAILABLE_SLOT_RESTART",
            );
          }

          const retrySelection = await selectAvailableAppointment(
            `calendar post-slot retry ${postSlotRetryCount}`,
          );
          if (!retrySelection.ok) {
            throw new Error(
              "CALENDAR_POST_SLOT_RETRY_NO_SELECTABLE_SLOT_RESTART",
            );
          }
        }
      }
      await page
        .evaluate(() => {
          for (const selector of ["#chkTotal", "#enviarCorreo"]) {
            const el = document.querySelector(selector);
            if (!el) continue;
            if ("checked" in el && !el.checked) {
              el.click();
            } else if (!("checked" in el)) {
              el.click();
            }
          }
        })
        .catch(() => {});

      stage = "WAIT_CONFIRMATION";
      await waitForManualOtpAndFinalConfirmation(page, data);

      await sendFinalAppointmentTelegramAndHold(
        page,
        data,
        "normal OTP confirmation",
      );

      if (false) {
        let finalCodeAttempts = 0;
        let finalConfirmed = false;
        while (finalCodeAttempts < 2) {
          await page
            .evaluate(() => {
              for (const selector of ["#chkTotal", "#enviarCorreo"]) {
                const el = document.querySelector(selector);
                if (!el) continue;
                if ("checked" in el && !el.checked) {
                  el.click();
                } else if (!("checked" in el)) {
                  el.click();
                }
              }
            })
            .catch(() => {});

          await page.waitForFunction(
            () => {
              const input = document.querySelector("#txtCodigoVerificacion");
              return input && input.value.trim().length > 4;
            },
            { timeout: STEP_TIMEOUT_MS },
          );

          stage = "WAIT_CONFIRMATION";
          await Promise.all([
            page
              .waitForNavigation({
                waitUntil: "domcontentloaded",
                timeout: LONG_STEP_TIMEOUT_MS,
              })
              .catch(() => null),
            cursor.click("#btnConfirmar", {
              moveDelay: 0,
              randomizeMoveDelay: false,
            }),
          ]);
          await throwIfBadPage(page, "after final confirmation submit", {
            data,
            stage,
          });

          const finalDetails = await waitForFinalConfirmationOrRetry(
            page,
            LONG_STEP_TIMEOUT_MS,
          );
          console.log(
            `FINAL_CONFIRMATION_STATUS: ok=${finalDetails.ok} final=${finalDetails.finalDetected} confirmButton=${finalDetails.hasConfirmButton} codeInput=${finalDetails.hasCodeInput} codeError=${finalDetails.codeError} url=${finalDetails.url}`,
          );
          console.log(
            `FINAL_CONFIRMATION_TEXT_PREVIEW: ${finalDetails.textPreview}`,
          );

          if (finalDetails.ok) {
            finalConfirmed = true;
            break;
          }

          if (finalDetails.requestRejected) {
            await throwIfBadPage(page, "after final confirmation submit", {
              data,
              stage,
            });
          }

          const canRetryCode =
            finalDetails.hasConfirmButton && finalDetails.hasCodeInput;
          if (!canRetryCode) {
            break;
          }

          await sendMessageToGroup(
            data["owner"],
            `Error in Codigo try again for: CITADO: ${data["nombre"]} - ${data["docId"]}\n\nPhone: ${phone}\nEmail: ${email}`,
          );
          finalCodeAttempts += 1;
          await page
            .reload({
              waitUntil: "domcontentloaded",
              timeout: LONG_STEP_TIMEOUT_MS,
            })
            .catch(() => null);
        }

        if (!finalConfirmed) {
          await sendMessageToGroup(
            data["owner"],
            `Number of codigo tries exceeded for: CITADO: ${data["nombre"]} - ${data["docId"]}\n\nPhone: ${phone}\nEmail: ${email}`,
          );
          throw new Error("CONFIRM_CODE_ATTEMPTS_EXCEEDED");
        }

        const finalText = await extractAppointmentConfirmationText(page);
        await sendMessageToGroup(
          data["owner"],
          `CITA CONFIRMADA\n\nTramite: ${data["tramiteLabel"]}\nProvincia: ${data["provinciaLabel"]}\nCITADO: ${data["nombre"]} - ${data["docId"]}\nPhone: ${phone}\nEmail: ${email}\n\n${finalText || "Final confirmation page loaded, but text extraction returned empty."}`,
        );
        console.log("Done Done Done");
        try {
          page?.off("request", requestHandler);
        } catch (cleanupError) {}
        await closeBrowserFast(browser, "FINAL_CONFIRMED");
        await closeAnonymizedProxyFast(proxyUrl, "FINAL_CONFIRMED");
        await deleteProfileFolderFast(profileDir, "FINAL_CONFIRMED");
        return "done";
      }

      /*
// Legacy PDF/SMS confirmation path disabled. The active path above sends the final
// confirmation page text to Telegram and returns before this block.
// give time for verification
// await page.waitForFunction(
//   () => {
//     const input = document.querySelector("#txtCodigoVerificacion");
//     return input && input.value.trim() !== "";
//   },
//   { timeout: STEP_TIMEOUT_MS },
// );
// test chunck
  let confattempt = 0;
    while (confattempt < 2) {
        // cick buttons
        await page.locator('#chkTotal').click();
        await page.locator('#enviarCorreo').click();
        // give time for verification
        await page.waitForFunction(
          () => {
            const input = document.querySelector('#txtCodigoVerificacion');
            return input && input.value.trim().length > 4;
          },
          { timeout: STEP_TIMEOUT_MS }
        );
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
          cursor.click('#btnConfirmar', {
            moveDelay: 0,
            randomizeMoveDelay: false,
          }),
        ]);
        if (await checkTitleBlocked(page)) {
          throw new Error('Fingerprint detected');
        }
        try {
          await page.waitForSelector('#btnImprimir', { timeout: 2000 });
          break;
        } catch (error) {
          try {
            await page.waitForSelector('#btnConfirmar', { timeout: 2000 });
          } catch (error) {
            confattempt = 5;
          }
          await sendMessageToGroup(
            data['owner'],
            `Error in Codigo try again for : CITADO: ${data['nombre']}  - ${data['docId']}\n\n🏢 Phone: ${phone}\n\n Email: ${email}`
          );
          confattempt += 1;
          await page.reload();
        }
      }
      
    if (confattempt > 2) {
        await sendMessageToGroup(
          data['owner'],
          `Number of codigo try exceded for : CITADO: ${data['nombre']}  - ${data['docId']}\n\n🏢 Phone: ${phone}\n\n Email: ${email}`
        );
        continue;
      }
      // delete data save pdf send notification
      const today = new Date();
      const day = String(today.getDate()).padStart(2, '0'); // Ensure 2 digits
      const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
      const year = today.getFullYear();
      const ownerFolder = `./pdfs/${data['owner']}`;
      if (!fs.existsSync(ownerFolder)) {
        fs.mkdirSync(ownerFolder);
      }
      const folderPath = `${ownerFolder}/${day}-${month}-${year}`;
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath);
      }
      await page.pdf({
        path: `${folderPath}/${data['nombre'].replace(/\s+/g, '-')}-${
          data['docId']
        }.pdf`, // File path to save the PDF
        format: 'A4', // Paper format (e.g., 'A4', 'Letter')
        printBackground: true, // Include background graphics
        margin: {
          top: '20px',
          bottom: '20px',
          left: '20px',
          right: '20px',
        },
      });
      // Send message
      let citaConfirmationDatos = [];
      try {
        citaConfirmationDatos = await Promise.all([
          page.$eval('#justificanteFinal', (el) => el.textContent.trim()),
          page.$eval(
            '#mainWindow > div > div.mf-layout--main > section > div.mf-main--content.ac-custom-content > form > div:nth-child(8) > fieldset > div:nth-child(2) > span.mf-psdinput.mf-input__xl.select2-container',
            (el) => el.textContent.trim()
          ), // direction
          page.$eval(
            '#mainWindow > div > div.mf-layout--main > section > div.mf-main--content.ac-custom-content > form > div:nth-child(8) > fieldset > div:nth-child(3) > span.mf-psdinput',
            (el) => el.textContent.trim()
          ), // cita date
          page.$eval(
            '#mainWindow > div > div.mf-layout--main > section > div.mf-main--content.ac-custom-content > form > div:nth-child(8) > fieldset > div:nth-child(4) > span.mf-psdinput',
            (el) => el.textContent.trim()
          ), // hora cita
          page.$eval(
            '#mainWindow > div > div.mf-layout--main > section > div.mf-main--content.ac-custom-content > form > div:nth-child(8) > fieldset > div:nth-child(5) > span.mf-psdinput.mf-input__m.select2-container',
            (el) => el.textContent.trim()
          ), // Mesa
        ]);
      } catch (error) {
        console.log('fail fetch cita datos');
      }
      await sendMessageToGroup(
        data['owner'],
        `🔔Cita encontrada🔔\n\n📝 Tramite: ${data['tramiteLabel']}\n\n📍 Provincia: ${data['provinciaLabel']}\n\n✅ Nº de Justificante de cita: ${citaConfirmationDatos[0]}\n\n👤 CITADO: ${data['nombre']}  - ${data['docId']}\n\n🏢 Dirección: ${citaConfirmationDatos[1]}\n\n📅 Día de la cita: ${citaConfirmationDatos[2]}\n\n⌚ Hora cita: ${citaConfirmationDatos[3]}\n\nMesa: ${citaConfirmationDatos[4]}`
      );
      await sendPdfToGroup(
        data['owner'],
        `${folderPath}/${data['nombre'].replace(/\s+/g, '-')}-${
          data['docId']
        }.pdf`
      );

    await waitForAcGrabarCitaFinalAndNotify(page, data, phone, email, usuarioClave, STEP_TIMEOUT_MS);
      await waitForAcGrabarCitaFinalAndNotify(page, data, phone, email, usuarioClave, STEP_TIMEOUT_MS);
      console.log("Done Done Done");
      return "done";
*/
    } catch (error) {
      const rawReason = String(error?.message || error || "UNKNOWN_ERROR");
      const reason = forcedAbortReason || rawReason;
      if (forcedAbortReason && rawReason !== forcedAbortReason) {
        console.log("PROFILE_ABORT_REASON_RAW:", rawReason);
      }
      if (forcedAbortDetails) {
        console.log(
          `PROFILE_ABORT_FORCED_BY_WATCHER: ${forcedAbortDetails.type} ${forcedAbortDetails.url}`,
        );
      }
      console.log("PROFILE_ABORT_REASON:", reason);
      const rotateProxyAfterAbort = shouldRotateProxyAfterAbort(reason);

      const manualClosed =
        !forcedAbortReason && isManualBrowserCloseError(error);
      try {
        stopBadPageWatcher?.();
      } catch (cleanupError) {}
      try {
        stopProfileLifetimeWatcher?.();
      } catch (cleanupError) {}
      try {
        page?.off("request", requestHandler);
      } catch (cleanupError) {}
      await closeBrowserFast(browser, "CATCH_RESTART");
      await closeAnonymizedProxyFast(proxyUrl, "CATCH_RESTART");
      if (profileDir) {
        await deleteProfileFolderFast(profileDir, "CATCH_RESTART");
      }
      recordManagedProxyResult(currentProxyLease, reason, {
        blocked: rotateProxyAfterAbort,
        elapsedMs: Date.now() - attemptStartedAt,
        stage,
      });
      releaseManagedProxy(currentProxyLease);

      if (reason.includes("_DONE")) {
        console.log(`TERMINAL_PROFILE_REASON_AFTER_CLEANUP: ${reason}`);
        return "done";
      }

      if (rotateProxyAfterAbort) {
        preferredProxyIndex = proxyPool.length
          ? (currentProxyIndex + 1) % proxyPool.length
          : -1;
        forceReuseProxyIndex = null;
        console.log(
          `PROXY_ROTATE_AFTER_BLOCK: cooldown=${PROXY_BLOCK_COOLDOWN_MS}ms nextPick=best_available preferredIndex=${proxyPool.length ? preferredProxyIndex + 1 : 0}/${proxyPool.length}`,
        );
      } else {
        const repeatKey = getAbortRepeatKey(reason);
        preferredProxyIndex = currentProxyIndex;
        forceReuseProxyIndex = currentProxyIndex;
        console.log(
          `PROXY_REUSE_AFTER_NON_BLOCK_ERROR: errorKey=${repeatKey} index=${proxyPool.length ? currentProxyIndex + 1 : 0}/${proxyPool.length}`,
        );
      }

      if (manualClosed) {
        console.log(
          "MANUAL_PROFILE_CLOSE_DETECTED: opening fresh profile immediately.",
        );
      } else if (reason.includes("ABORT_AFTER_10_REFRESH")) {
        console.log(
          "ABORT_AFTER_10_REFRESH_FAST_RESTART: close/delete timeout protected; opening fresh profile immediately.",
        );
      } else if (
        reason.includes("ACOFERTA_NO_CITA_DELETE_AFTER_3S_ALREADY_WAITED")
      ) {
        console.log(
          "ACOFERTA_NO_CITA_PROFILE_DELETED_AFTER_3S: opening fresh profile immediately.",
        );
      } else if (reason.includes("CLAVE_SERVICE_REDIRECT_TIMEOUT_20S")) {
        console.log(
          "CLAVE_SERVICE_REDIRECT_TIMEOUT_20S_IMMEDIATE_RESTART: opening fresh profile immediately.",
        );
      } else if (reason.includes("PROFILE_LIFETIME_RESTART")) {
        console.log(
          "PROFILE_LIFETIME_RESTART_REUSE_PROXY: opening fresh profile with the same healthy proxy.",
        );
      } else {
        console.log(
          "NO_SLEEP_FAST_RESTART_NO_HANG: opening fresh profile immediately after cleanup attempt.",
        );
      }
    }
  }
}
