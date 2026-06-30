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

import languages from "./browser-data/languages.js";

puppeteer.use(StealthPlugin());

// Get the current working directory
const owner = "leona"; // sukuna, leona
const captchaUserId = "jaouadeddadsi2016@gmail.com";
const captchaApikey = "qlfsQRF3b4swypsVAcnm";

// Telegram notification function copied from uploaded working script.
// Browser window size/position: 8 browsers on one 1920x1080 screen (4 columns x 2 rows)
const BROWSER_WINDOW = { width: 480, height: 540 };
const BROWSER_POSITIONS = [
  { x: 0, y: 0 },
  { x: 480, y: 0 },
  { x: 960, y: 0 },
  { x: 1440, y: 0 },
  { x: 0, y: 540 },
  { x: 480, y: 540 },
  { x: 960, y: 540 },
  { x: 1440, y: 540 },
];
let NEXT_BROWSER_POSITION_SLOT = 0;
const PAGE_ZOOM = "55%";
const ACVALIDAR_CADUCADO_WAIT_MS = 5000;
const ERROR_RESTART_DELAY_MS = 0; // No sleep mode: deleted profiles restart immediately after cleanup.
const CLAVE_SERVICE_REDIRECT_TIMEOUT_MS = 180000; // 3 minutes: before this Cl@ve redirect must not restart/delete.
const ACOFERTA_NO_CITA_DELETE_WAIT_MS = 3000; // acOfertarCita no-cita page stays visible 3 seconds, then profile is deleted.
const BROWSER_CLOSE_TIMEOUT_MS = 2500; // Do not let browser.close() block restart forever.
const PROFILE_DELETE_TIMEOUT_MS = 4000; // Do not let Windows locked profile folder block restart forever.

// acOfertarCita slow profile safe wait
// Script will wait until captcha + available appointment/date/radio slot are loaded before selecting.
const ACOFERTA_READY_WAIT_MS = 60000;
const ACOFERTA_READY_POLL_MS = 250;
const ACVERFORMULARIO_STUCK_WAIT_MS = 10 * 60 * 1000; // 10 minutes: if phone is wrong/deleted and page stays on acVerFormulario, restart.

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
      data = data.filter((item) => item.owner === owner);
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

export function getEmail() {
  // Use letters and digits for the random string
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  // Randomly select characters and join them into a string
  let randomString = "";
  for (let i = 0; i < 10; i++) {
    randomString += characters.charAt(
      Math.floor(Math.random() * characters.length),
    );
  }
  return `${randomString}@grr.la`;
}

export async function sendMessageToGroup(owner, message) {
  const token = "8064000963:AAFgfMVj-AP_SaNfMAo_ghZVCsYhqGquUsM";
  const chadIds = {
    sukuna: "-1002226967850",
    leona: "-1002316821074",
    jaouad: "-4635162385",
  };
  const chatId = chadIds[owner];
  const safeMessage = String(message || "").slice(0, 3900);
  const bot = new TelegramBot(token);
  if (chatId) {
    bot
      .sendMessage(chatId, safeMessage)
      .then(() => {
        console.log("Message sent successfully!");
      })
      .catch((error) => {
        console.error("Error sending message");
      });
  }
  return;
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
  try {
    const urlCaptcha = "https://api.apitruecaptcha.org/one/gettext";
    const response = await fetch(urlCaptcha, {
      method: "post",
      body: JSON.stringify(params),
    });
    const data = await response.json();
    const code = data.result;
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
  } catch (error) {
    await sendMessageToGroup(owner, "Check True captcha solve");
  }
}

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const [day, month, year] = dateStr.split("/");
  return new Date(`${year}-${month}-${day}`);
};

function mergeOficinas(array1, array2) {
  if (!array2 || array2.length === 0) {
    return array1; // Rule 1: Return array1 if array2 is empty
  } else {
    // Rule 2: Return common values (intersection)
    return array1.filter((item) => array2.includes(item));
  }
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
    console.log(`BROWSER_CLOSE_FAST_TIMEOUT_FORCE_KILL${tag}: ${error?.message || error}`);
    try {
      const proc = typeof browser.process === "function" ? browser.process() : null;
      if (proc && !proc.killed) {
        proc.kill("SIGKILL");
        console.log(`BROWSER_PROCESS_KILLED${tag}`);
      }
    } catch (killError) {
      console.log(`BROWSER_FORCE_KILL_FAILED${tag}: ${killError?.message || killError}`);
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
      console.log(`PROFILE_DELETE_TIMEOUT_NON_BLOCKING${tag}: fresh profile will open immediately; locked folder can be cleaned on next start.`);
    } else {
      console.log(`PROFILE_DELETE_FAST_FAILED_NON_BLOCKING${tag}: ${msg}`);
    }
  }
}

async function launchBrowserWithFingerprint(proxy, fixedPositionSlot = null) {
  const fingerprint = generateFingerprint();
  const newUrl = await proxyChain.anonymizeProxy(proxy);
  const profileDir = "./profiles/profile-" + Math.random();
  const browserPositionSlot = Number.isInteger(fixedPositionSlot)
    ? fixedPositionSlot % BROWSER_POSITIONS.length
    : allocateBrowserPositionSlot();
  const browserPosition = getBrowserPositionBySlot(browserPositionSlot);
  console.log(`BROWSER_FIXED_SLOT: ${browserPositionSlot + 1}/${BROWSER_POSITIONS.length} x=${browserPosition.x} y=${browserPosition.y}`);
  //  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: "/usr/bin/google-chrome",
    userDataDir: profileDir,
    ignoreHTTPSErrors: true,
    args: [
      `--proxy-server=${newUrl}`,
      `--user-agent=${fingerprint.userAgent}`,
      `--window-size=${BROWSER_WINDOW.width},${BROWSER_WINDOW.height}`,
      `--window-position=${browserPosition.x},${browserPosition.y}`,
      `--lang=${fingerprint.language}`,
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--enable-webgl",
      "--use-gl=swiftshader",
      "--ignore-certificate-errors",
      "--disable-gpu", // Disable GPU hardware acceleration
      "--disable-dev-shm-usage", // Disable shared memory (useful in Docker)
      "--disable-setuid-sandbox", // Disable sandbox for security (use with caution)
      "--no-sandbox", // Disable sandbox (use with caution)
      "--no-zygote", // Disable zygote process (reduces memory usage)
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--ozone-platform=x11",
    ],
  });
  const page = await browser.newPage();
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
  await page.evaluate((z) => {
    document.documentElement.style.zoom = z;
    if (document.body) document.body.style.zoom = z;
  }, PAGE_ZOOM).catch(() => {});
  await page.setUserAgent(fingerprint.userAgent);
  await page.setExtraHTTPHeaders({
    "Accept-Language": fingerprint.language,
  });
  await page.emulateTimezone(fingerprint.timezone);
  if (!page.waitForTimeout) {
    page.waitForTimeout = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms));
  }
  return { browser, page, profileDir };
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
    timeout = 30000, // Default 30 second timeout
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
  const bodyText = await page.evaluate(() => {
    return document.body ? (document.body.innerText || document.body.textContent || "") : "";
  }).catch(() => "");

  return (
    title === "Request Rejected" ||
    bodyText.includes("The requested URL was rejected") ||
    bodyText.includes("Your support ID is")
  );
}

async function throwIfRequestRejected(page, label = "") {
  if (await isRequestRejectedPage(page)) {
    console.log(`Request Rejected detected ${label}. Closing browser and deleting profile.`);
    throw new Error("REQUEST_REJECTED");
  }
}

async function getIcpSystemErrorDetails(page) {
  return await page.evaluate(() => {
    const url = window.location.href || "";
    const title = document.title || "";
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    const text = bodyText.replace(/\s+/g, " ").trim();

    const hasSystemError = text.includes("Se ha producido un error en el sistema");
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
  }).catch(() => ({ ok: false }));
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
  return /Target closed|Session closed|Browser disconnected|browser has disconnected|Protocol error.*Target|Protocol error.*closed|Connection closed|Page crashed|Cannot find context|Execution context was destroyed|Navigating frame was detached|Frame was detached/i.test(msg);
}

async function getMaxCitasDetails(page) {
  return await page.evaluate(() => {
    const url = window.location.href || "";
    const title = document.title || "";
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
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
  }).catch(() => ({ ok: false }));
}

async function handleMaxCitasIfPresent(page, data, browser, profileDir, requestHandler) {
  const details = await getMaxCitasDetails(page);
  if (!details.ok) return false;

  console.log("MAX_CITAS_DETECTED_PERMANENT_CLOSE");
  console.log(`MAX_CITAS_URL: ${details.url}`);
  console.log(`MAX_CITAS_TEXT: ${details.textPreview}`);

  const sent = await sendMessageToGroup(
    data["owner"],
    `⚠️ CITA YA EXISTE / MAXIMO DE CITAS ⚠️\n\nNIE: ${data["docId"] || "UNKNOWN"}\nNOMBRE: ${data["nombre"] || "UNKNOWN"}\nRAZON: MAXIMO DE CITAS`,
  );
  console.log(`MAX_CITAS_TELEGRAM_SENT: ${sent}`);

  try { page?.off("request", requestHandler); } catch (error) {}
  await closeBrowserFast(browser, "MAX_CITAS");
  await deleteProfileFolderFast(profileDir, "MAX_CITAS");
  return true;
}



async function getUsuarioClaveFromAcEntrada(page) {
  return await page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

    // ICP acEntrada page shows the certificado/Usuario CLAVE in these two disabled inputs:
    // <input id="idPresentador" ... value="Z0059960G">
    // <input id="desPresentador" ... value="FERNANDO AVALO ZAPATA">
    const readInputValue = (selectors) => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        const value = normalize(el && (el.value || el.getAttribute("value") || el.textContent || ""));
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
  }).catch(() => ({ nie: "UNKNOWN", name: "UNKNOWN" }));
}

async function getClave0019Details(page) {
  return await page.evaluate(() => {
    const url = window.location.href || "";
    const title = document.title || "";
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
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
  }).catch(() => ({ ok: false }));
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

async function handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler) {
  const details = await getClave0019Details(page);
  if (!details.ok) return false;

  console.log("CLAVE_0019_DETECTED_PERMANENT_CLOSE");
  console.log(`CLAVE_0019_URL: ${details.url}`);
  console.log(`CLAVE_0019_TEXT: ${details.textPreview}`);
  console.log(`USUARIO_CLAVE_FOR_0019: ${JSON.stringify(usuarioClave || { nie: "UNKNOWN", name: "UNKNOWN" })}`);

  await sendClave0019Telegram(data, usuarioClave);

  // sendMessageToGroup schedules Telegram send asynchronously, so keep page/profile alive briefly.
  await page.waitForTimeout(2500).catch(() => {});

  try { page?.off("request", requestHandler); } catch (error) {}
  await closeBrowserFast(browser, "CLAVE_0019");
  await deleteProfileFolderFast(profileDir, "CLAVE_0019");
  return true;
}

async function getAcValidarExactCaducadoDetails(page) {
  return await page.evaluate(() => {
    const url = window.location.href || "";
    const title = document.title || "";
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    const text = bodyText.replace(/\s+/g, " ").trim();

    const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
    const hasAceptarButton = buttons.some((btn) => {
      const label = String(btn.innerText || btn.textContent || btn.value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const id = String(btn.id || "").trim().toLowerCase();
      return label === "aceptar" || id === "btnaceptar";
    });

    const exactNoCitaMessage =
      text.includes("En este momento no hay citas disponibles") &&
      text.includes("En breve, la Oficina pondrá a su disposición nuevas citas");
    const hasCodOper = /Cod\.\s*Oper\.\s*:/i.test(text);
    const requestRejected =
      title === "Request Rejected" ||
      text.includes("The requested URL was rejected") ||
      text.includes("Your support ID is");
    const hasPaso1 = text.includes("Paso 1 de 5") || !!document.querySelector("#btnSiguiente") || !!document.querySelector("#idSede");

    return {
      ok: exactNoCitaMessage && hasCodOper && hasAceptarButton && !requestRejected && !hasPaso1,
      url,
      title,
      exactNoCitaMessage,
      hasCodOper,
      hasAceptarButton,
      textPreview: text.slice(0, 700),
    };
  }).catch(() => ({ ok: false }));
}

async function handleAcValidarExactCaducadoIfPresent(page, data, browser, profileDir, requestHandler) {
  const details = await getAcValidarExactCaducadoDetails(page);
  if (!details.ok) return false;

  console.log("ACVALIDAR_NIE_CADUCADO_EXACT_DETECTED");
  console.log(`ACVALIDAR_NIE_CADUCADO_URL: ${details.url}`);
  console.log(`ACVALIDAR_NIE_CADUCADO_TEXT: ${details.textPreview}`);

  const nie = data["docId"] || "UNKNOWN";
  const sent = await sendMessageToGroup(data["owner"], `NIE ERROR

NIE: ${nie}
RAZON: CADUCADO`);
  console.log(`ACVALIDAR_NIE_CADUCADO_TELEGRAM_SENT: ${sent}`);
  console.log(`ACVALIDAR_NIE_CADUCADO_WAIT_${ACVALIDAR_CADUCADO_WAIT_MS}MS_BEFORE_CLOSE`);
  await page.waitForTimeout(ACVALIDAR_CADUCADO_WAIT_MS).catch(() => {});

  try { page?.off("request", requestHandler); } catch (error) {}
  await closeBrowserFast(browser, "ACVALIDAR_CADUCADO");
  await deleteProfileFolderFast(profileDir, "ACVALIDAR_CADUCADO");
  return true;
}


async function getTelefono0006Details(page) {
  return await page.evaluate(() => {
    const url = window.location.href || "";
    const title = document.title || "";
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
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
  }).catch(() => ({ ok: false }));
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
  return await page.evaluate(() => {
    const title = document.title || "";
    const url = window.location.href || "";
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    const normalized = bodyText.replace(/\s+/g, " ").trim();
    const lower = normalized.toLowerCase();

    const requestRejected =
      title === "Request Rejected" ||
      normalized.includes("The requested URL was rejected") ||
      normalized.includes("Your support ID is");

    const noDisponible =
      normalized.includes("En este momento no hay citas disponibles") ||
      lower.includes("no hay citas disponibles") ||
      lower.includes("no hay cita disponible");

    const hasCodOper = /Cod\.\s*Oper\.\s*:/i.test(normalized);
    const noDisponibleWithCodOper = noDisponible && hasCodOper;

    const systemError =
      (normalized.includes("Se ha producido un error en el sistema") || /(?:^|\s)0101(?:\s|$)/.test(normalized)) &&
      hasCodOper;

    const hasCaptcha = !!document.querySelector('img[alt="captcha"]') && !!document.querySelector("#captcha");

    const dateLinks = Array.from(document.querySelectorAll('td[class*="colFecha"] a[role="button"], td[class*="colFecha"] a'))
      .filter((a) => {
        const text = String(a.innerText || a.textContent || "").trim();
        const cls = String(a.className || "").toLowerCase();
        const disabled = a.disabled || a.getAttribute("aria-disabled") === "true" || cls.includes("disabled") || cls.includes("ui-state-disabled");
        return text && !disabled;
      });

    const radioInputs = Array.from(document.querySelectorAll('div[id^="cita_"] input, input[type="radio"], input[type="checkbox"], input[name*="cita"], input[id*="cita"]'))
      .filter((input) => {
        const type = String(input.type || "").toLowerCase();
        if (input.disabled) return false;
        if (type === "hidden" || type === "text" || type === "submit" || type === "button") return false;
        if (input.id === "captcha" || input.name === "captcha") return false;
        return type === "radio" || type === "checkbox" || String(input.name || input.id || "").toLowerCase().includes("cita");
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
  }).catch((error) => ({
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

async function waitForAcofertaCaptchaAndAppointment(page, timeoutMs = ACOFERTA_READY_WAIT_MS) {
  console.log(`ACOFERTA_WAIT_AVAILABLE_ONLY: waiting up to ${timeoutMs}ms until REAL available appointment/date/radio slot appears...`);
  await page.waitForFunction(
    () => {
      const title = document.title || "";
      const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
      const normalized = bodyText.replace(/\s+/g, " ").trim();
      const lower = normalized.toLowerCase();

      const requestRejected =
        title === "Request Rejected" ||
        normalized.includes("The requested URL was rejected") ||
        normalized.includes("Your support ID is");

      const noDisponible =
        normalized.includes("En este momento no hay citas disponibles") ||
        lower.includes("no hay citas disponibles") ||
        lower.includes("no hay cita disponible");

      const hasCodOper = /Cod\.\s*Oper\.\s*:/i.test(normalized);
      const noDisponibleWithCodOper = noDisponible && hasCodOper;
      const telefono0006 = noDisponible && /(?:^|\s)0006(?:\s|$)/.test(normalized);
      const clave0019 =
        /(?:^|\s)0019(?:\s|$)/.test(normalized) ||
        lower.includes("se ha sobrepasado el número permitido de citas") ||
        lower.includes("se ha sobrepasado el numero permitido de citas");

      const systemError =
        (normalized.includes("Se ha producido un error en el sistema") || /(?:^|\s)0101(?:\s|$)/.test(normalized)) &&
        hasCodOper;

      const hasCaptcha = !!document.querySelector('img[alt="captcha"]') && !!document.querySelector("#captcha");

      const dateLinks = Array.from(document.querySelectorAll('td[class*="colFecha"] a[role="button"], td[class*="colFecha"] a'))
        .filter((a) => {
          const text = String(a.innerText || a.textContent || "").trim();
          const cls = String(a.className || "").toLowerCase();
          const disabled = a.disabled || a.getAttribute("aria-disabled") === "true" || cls.includes("disabled") || cls.includes("ui-state-disabled");
          return text && !disabled;
        });

      const radioInputs = Array.from(document.querySelectorAll('div[id^="cita_"] input, input[type="radio"], input[type="checkbox"], input[name*="cita"], input[id*="cita"]'))
        .filter((input) => {
          const type = String(input.type || "").toLowerCase();
          if (input.disabled) return false;
          if (type === "hidden" || type === "text" || type === "submit" || type === "button") return false;
          if (input.id === "captcha" || input.name === "captcha") return false;
          return type === "radio" || type === "checkbox" || String(input.name || input.id || "").toLowerCase().includes("cita");
        });

      // Stop for hard errors, or the final no-cita page with Cod. Oper.
      // Otherwise wait until a real selectable appointment exists.
      return requestRejected || systemError || clave0019 || telefono0006 || noDisponibleWithCodOper || (hasCaptcha && (dateLinks.length > 0 || radioInputs.length > 0));
    },
    { timeout: timeoutMs, polling: ACOFERTA_READY_POLL_MS },
  ).catch(() => null);

  // Extra render-stable wait for slow proxies/layouts.
  await page.waitForTimeout(700).catch(() => {});
  const state = await getAcofertaReadyState(page);
  console.log(`ACOFERTA_READY_STATUS: captcha=${state.hasCaptcha} dateLinks=${state.dateLinkCount} radioSlots=${state.radioSlotCount} noDisponible=${state.noDisponible} codOper=${state.hasCodOper} rejected=${state.requestRejected} systemError=${state.systemError}`);
  if (!state.ready && state.noDisponibleWithCodOper) {
    console.log('ACOFERTA_NO_CITA_WITH_COD_OPER_DETECTED: will delete profile after 3 seconds.');
  } else if (!state.ready && state.noDisponible) {
    console.log('ACOFERTA_WAIT_FINISHED_NO_AVAILABLE_APPOINTMENT: waited full time; no auto select attempted.');
  }
  return state;
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

async function waitAndSelectTramite(page, tramiteCode, timeout = 120000) {
  const tramite = String(tramiteCode || "").trim();
  if (!tramite) return false;

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Waiting/selecting tramite attempt ${attempt}/${maxAttempts}: ${tramite}`);

      await page.waitForFunction(
        (value) => {
          const tramiteSelects = Array.from(document.querySelectorAll('select'))
            .filter((select) => {
              const id = String(select.id || '');
              const name = String(select.name || '');
              return id.startsWith('tramiteGrupo[') || name.startsWith('tramiteGrupo[');
            });

          return tramiteSelects.some((select) => {
            return Array.from(select.options || []).some((option) => String(option.value || '') === value);
          });
        },
        { timeout, polling: 500 },
        tramite,
      );

      const result = await page.evaluate((value) => {
        const tramiteSelects = Array.from(document.querySelectorAll('select'))
          .filter((select) => {
            const id = String(select.id || '');
            const name = String(select.name || '');
            return id.startsWith('tramiteGrupo[') || name.startsWith('tramiteGrupo[');
          });

        for (const select of tramiteSelects) {
          const options = Array.from(select.options || []);
          const optionIndex = options.findIndex((opt) => String(opt.value || '') === value);
          if (optionIndex === -1) continue;

          const option = options[optionIndex];
          select.scrollIntoView({ block: 'center' });
          select.focus();
          select.selectedIndex = optionIndex;
          select.value = value;
          option.selected = true;

          // Fire all events ICP normally listens to.
          ['mousedown', 'mouseup', 'click', 'input', 'change', 'blur'].forEach((eventName) => {
            select.dispatchEvent(new Event(eventName, { bubbles: true, cancelable: true }));
          });

          // If jQuery exists on the ICP page, trigger its change handler too.
          if (window.jQuery) {
            window.jQuery(select).val(value).trigger('change');
          }

          return {
            ok: String(select.value || '') === value,
            id: select.id || '',
            name: select.name || '',
            value: String(select.value || ''),
            text: String(option.textContent || option.innerText || '').trim(),
          };
        }

        return { ok: false, reason: 'tramite select/option not found' };
      }, tramite);

      if (!result || !result.ok) {
        throw new Error(`Tramite option found but not selected: ${JSON.stringify(result)}`);
      }

      await page.waitForFunction(
        (value) => {
          const tramiteSelects = Array.from(document.querySelectorAll('select'))
            .filter((select) => {
              const id = String(select.id || '');
              const name = String(select.name || '');
              return id.startsWith('tramiteGrupo[') || name.startsWith('tramiteGrupo[');
            });

          return tramiteSelects.some((select) => String(select.value || '') === value);
        },
        { timeout: 10000, polling: 250 },
        tramite,
      );

      console.log(`Tramite selected and verified on attempt ${attempt}/${maxAttempts}: ${tramite}`);
      return true;
    } catch (error) {
      lastError = error;
      console.log(`Tramite select attempt ${attempt}/${maxAttempts} failed: ${error.message}`);

      if (attempt < maxAttempts) {
        await page.waitForTimeout(1500);
      }
    }
  }

  throw lastError || new Error(`Tramite not selected after ${maxAttempts} attempts: ${tramite}`);
}

async function clickAceptarAfterTramiteSelected(page, tramiteCode) {
  const maxClicks = 2;

  for (let clickAttempt = 1; clickAttempt <= maxClicks; clickAttempt++) {
    await waitAndSelectTramite(page, tramiteCode, 120000);
    await page.waitForTimeout(800);

    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ block: "center" });
      }
    }, "#btnAceptar");

    await page.locator("#btnAceptar").click();

    await page.waitForTimeout(1200);

    const stillOnTramiteError = await page.evaluate(() => {
      const text = document.body ? (document.body.innerText || document.body.textContent || '') : '';
      return text.includes('Debes seleccionar un trámite') ||
        text.includes('Debes seleccionar un tramite') ||
        text.includes('Por favor, selecciona un trámite') ||
        text.includes('Por favor, selecciona un tramite');
    }).catch(() => false);

    if (!stillOnTramiteError) {
      return true;
    }

    console.log(`Aceptar clicked but ICP still says tramite not selected. Re-selecting tramite (${clickAttempt}/${maxClicks}).`);

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
      const aceptar = buttons.find((btn) => String(btn.innerText || btn.value || '').trim().toLowerCase() === 'aceptar');
      if (aceptar) aceptar.click();
    }).catch(() => {});

    await page.waitForTimeout(1500);
  }

  throw new Error('ICP still says tramite not selected after re-select attempts');
}


async function clickAcInfoClaveIfPresent(page) {
  // acInfo page: select exact "Presentación con Cl@ve" container if it appears.
  const isAcInfoOrClaveBox = await page.evaluate(() => {
    const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    return window.location.href.includes("/acInfo") ||
      !!document.querySelector("#btnAccesoClave") ||
      text.includes("Presentación con Cl@ve") ||
      text.includes("Presentacion con Cl@ve");
  }).catch(() => false);

  if (!isAcInfoOrClaveBox) return false;

  await page.waitForSelector("#btnAccesoClave", { timeout: 20000 }).catch(() => null);

  const clicked = await page.evaluate(() => {
    const claveBox = document.querySelector("#btnAccesoClave");
    if (!claveBox) return false;

    claveBox.scrollIntoView({ block: "center" });
    const accesoInput = claveBox.querySelector('input[name="acceso"], #acceso');
    if (accesoInput) {
      accesoInput.value = "N";
      accesoInput.dispatchEvent(new Event("input", { bubbles: true }));
      accesoInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    ["mousedown", "mouseup", "click"].forEach((eventName) => {
      claveBox.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
    });

    return true;
  }).catch(() => false);

  if (!clicked) return false;

  console.log("ACINFO_CLAVE_CLICKED");
  await Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null),
    page.waitForSelector("#btnEntrar", { timeout: 25000 }).catch(() => null),
    page.waitForSelector("#btnEnviar", { timeout: 25000 }).catch(() => null),
    page.waitForFunction(() => {
      const url = window.location.href || "";
      const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
      return url.includes("pasarela.clave.gob.es") ||
        url.includes("/Proxy2/ServiceProvider") ||
        text.includes("Acceso DNIe / Certificado electrónico") ||
        text.includes("Acceso DNIe / Certificado electronico") ||
        text.includes("Se ha producido un error en el sistema") ||
        text.includes("Cod. Oper.");
    }, { timeout: 25000, polling: 500 }).catch(() => null),
    page.waitForTimeout(8000),
  ]);
  await throwIfRequestRejected(page, "after acInfo Cl@ve click");
  await throwIfIcpSystemError(page, "after acInfo Cl@ve click");
  return true;
}

async function clickClaveCertificadoIfPresent(page) {
  // Cl@ve gateway page: click "Acceso DNIe / Certificado electrónico" if it appears.
  const isClaveGateway = await page.evaluate(() => {
    const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    return window.location.href.includes("pasarela.clave.gob.es") ||
      window.location.href.includes("/Proxy2/ServiceProvider") ||
      text.includes("Acceso DNIe / Certificado electrónico") ||
      text.includes("Acceso DNIe / Certificado electronico");
  }).catch(() => false);

  if (!isClaveGateway) return false;

  console.log("CLAVE_GATEWAY_DETECTED");

  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
      return buttons.some((btn) => {
        const text = String(btn.innerText || btn.textContent || btn.value || "");
        const onclick = String(btn.getAttribute("onclick") || "");
        return text.includes("Acceso DNIe / Certificado electrónico") ||
          text.includes("Acceso DNIe / Certificado electronico") ||
          onclick.includes("selectedIdP('AFIRMA')") ||
          onclick.includes('selectedIdP("AFIRMA")');
      });
    },
    { timeout: 30000, polling: 500 },
  ).catch(() => null);

  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
    const certButton = buttons.find((btn) => {
      const text = String(btn.innerText || btn.textContent || btn.value || "");
      const onclick = String(btn.getAttribute("onclick") || "");
      return text.includes("Acceso DNIe / Certificado electrónico") ||
        text.includes("Acceso DNIe / Certificado electronico") ||
        onclick.includes("selectedIdP('AFIRMA')") ||
        onclick.includes('selectedIdP("AFIRMA")');
    });

    if (!certButton) return false;
    certButton.scrollIntoView({ block: "center" });
    ["mousedown", "mouseup", "click"].forEach((eventName) => {
      certButton.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
    });
    if (typeof certButton.click === "function") certButton.click();
    return true;
  }).catch(() => false);

  if (!clicked) {
    console.log("CLAVE_CERT_BUTTON_NOT_CLICKED_KEEP_WAIT");
    return false;
  }

  console.log("CLAVE_CERT_CLICKED_WAIT_ACENTRADA");
  // Native certificate popup is manual; do not timeout while user selects certificate.
  await waitUntilAcEntradaOrEntrarAfterClave(page);
  await throwIfRequestRejected(page, "after Cl@ve certificado click");
  await throwIfIcpSystemError(page, "after Cl@ve certificado click");
  return true;
}

async function waitUntilAcEntradaOrEntrarAfterClave(page) {
  console.log(`WAIT_ACENTRADA_OR_ENTRAR_AFTER_CLAVE: max ${CLAVE_SERVICE_REDIRECT_TIMEOUT_MS}ms / 3 minutes`);
  const ok = await page.waitForFunction(
    () => {
      const url = window.location.href || "";
      const title = document.title || "";
      const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
      return (
        url.includes("/acEntrada") ||
        !!document.querySelector("#btnEnviar") ||
        !!document.querySelector("#txtIdCitado") ||
        !!document.querySelector("#btnEntrar") ||
        title === "Request Rejected" ||
        text.includes("The requested URL was rejected") ||
        text.includes("Your support ID is") ||
        text.includes("Se ha producido un error en el sistema") ||
        text.includes("Cod. Oper.")
      );
    },
    { timeout: CLAVE_SERVICE_REDIRECT_TIMEOUT_MS, polling: 500 },
  ).then(() => true).catch(() => false);

  if (!ok) {
    console.log("CLAVE_SERVICE_REDIRECT_TIMEOUT_3MIN");
    throw new Error("CLAVE_SERVICE_REDIRECT_TIMEOUT_3MIN");
  }
}


async function waitForAcGrabarCitaFinalAndNotify(page, data, phone, email, usuarioClave = { nie: "UNKNOWN", name: "UNKNOWN" }, timeoutMs = 900000) {
  console.log(`ACGRABAR_WAIT_AFTER_SMS_CODE: waiting up to ${timeoutMs}ms for acGrabarCita / final confirmation...`);

  await page.waitForFunction(
    () => {
      const url = window.location.href || "";
      const title = document.title || "";
      const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
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
  ).catch(() => null);

  const details = await page.evaluate(() => {
    const url = window.location.href || "";
    const title = document.title || "";
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
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
  }).catch(() => ({ ok: false, requestRejected: false, clave0019: false, url: "UNKNOWN", title: "UNKNOWN", textPreview: "READ_FAILED" }));

  console.log(`ACGRABAR_STATUS: ok=${details.ok} rejected=${details.requestRejected} clave0019=${details.clave0019} url=${details.url}`);
  console.log(`ACGRABAR_TEXT_PREVIEW: ${details.textPreview}`);

  if (details.clave0019) {
    console.log("CLAVE_0019_DETECTED_AFTER_SMS_CODE");
    await sendClave0019Telegram(data, usuarioClave);
    throw new Error("CLAVE_0019_NOTIFIED");
  }

  if (details.requestRejected) {
    console.log("ACGRABAR_REQUEST_REJECTED_DETECTED: no final Telegram sent. Profile will restart by error handler.");
    throw new Error("ACGRABAR_REQUEST_REJECTED");
  }

  if (!details.ok) {
    console.log("ACGRABAR_NOT_REACHED_AFTER_SMS: final page not detected, no final Telegram sent.");
    return false;
  }

  const sent = await sendMessageToGroup(
    data["owner"],
    `✅ CITA GRABADA ✅\n\n📝 Tramite: ${data["tramiteLabel"]}\n\n📍CITADO: ${data["nombre"]} - ${data["docId"]}\n\n🏢 Phone: ${phone}\n\nEmail: ${email}`,
  );
  console.log(`ACGRABAR_FINAL_TELEGRAM_SENT: ${sent}`);
  return true;
}

// Get appointment
export async function getAppointment(data, proxy) {
  let usedOficinas = [];
  // Har running profile ko ek fixed screen slot milta hai.
  // Restart/delete ke baad fresh browser isi same x/y position par open hoga.
  const fixedBrowserPositionSlot = allocateBrowserPositionSlot();
  console.log(`PROFILE_FIXED_POSITION_SLOT_ASSIGNED: ${fixedBrowserPositionSlot + 1}/${BROWSER_POSITIONS.length}`);
  while (true) {
    let browser, page, profileDir;
    let usuarioClave = { nie: "UNKNOWN", name: "UNKNOWN" };
    let requestHandler;
    const abortHandler = async () => {
      console.log("Abort triggered - cleaning up...");
      await closeBrowserFast(browser, "ABORT_HANDLER");
      await deleteProfileFolderFast(profileDir, "ABORT_HANDLER");
    };
    try {
      ({ browser, page, profileDir } =
        await launchBrowserWithFingerprint(proxy, fixedBrowserPositionSlot));
      await page.setDefaultNavigationTimeout(15000);
      // REQUEST INTERCEPTION OFF:
      // Browser will load page normally (CSS/fonts/images/media allowed).
      // This is for testing whether URL Rejected is reduced when ICP sees a normal page-load pattern.
      requestHandler = null;
      const cursor = createCursor(page);
      // Build url
      const url = `https://icp.administracionelectronica.gob.es${data["provincia"]}`;
      // ####################################### First page #################################
      const navigationPromise = page.goto(url, {
        waitUntil: "domcontentloaded",
      });
      await Promise.race([
        navigationPromise,
        page.waitForSelector("#btnAceptar", { timeout: 30000 }),
      ]);
      // Check for the selector
      await page.waitForSelector("#btnAceptar", { timeout: 30000 });
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
        await waitAndSelectTramite(page, data["tramite"], 120000);
      } catch (error) {
        await sendMessageToGroup(
          data["owner"],
          `Tramite not loaded/selected after wait:\n Provincia: ${data["provinciaLabel"]} \n Tramite: ${data["tramiteLabel"]}`,
        );
        continue;
      }
      await sleep(500);
      await clickAceptarAfterTramiteSelected(page, data["tramite"]);
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.waitForSelector("#btnAccesoClave", { timeout: 25000 }),
        page.waitForSelector("#btnEntrar", { timeout: 25000 }),
        page.waitForSelector("#btnEnviar", { timeout: 25000 }),
        page.waitForTimeout(10000),
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

      const isAcEntradaReadyNow = await page.evaluate(() => {
        const url = window.location.href || "";
        return url.includes("/acEntrada") ||
          !!document.querySelector("#btnEnviar") ||
          !!document.querySelector("#txtIdCitado");
      }).catch(() => false);

      if (isAcEntradaReadyNow) {
        console.log("ACENTRADA_READY_AFTER_CLAVE_OR_DIRECT");
        await page.waitForSelector("#btnEnviar", { timeout: 25000 });
      } else {
        await page.waitForSelector("#btnEntrar", { timeout: 0 });
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
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.waitForSelector("#btnEnviar", { timeout: 25000 }),
          page.waitForTimeout(10000),
        ]);
        title = await page.title();
        await throwIfRequestRejected(page, "after btnEntrar navigation");
        await throwIfIcpSystemError(page, "after btnEntrar navigation");
      }

      await page.waitForSelector("#btnEnviar", { timeout: 5000 });
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
      await sleep(3500);
      await page.locator("#btnEnviar").click();
      await Promise.race([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.waitForSelector("#btnConsultar", { timeout: 15000 }),
        page.waitForTimeout(10000),
      ]);
      title = await page.title();
      await throwIfRequestRejected(page, "after navigation");

      await throwIfIcpSystemError(page, "after navigation");
      if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
        return "done";
      }
      try {
        await page.waitForSelector("#btnConsultar", { timeout: 5000 });
      } catch (error) {
        try {
          await page.waitForSelector("#btnEnviar", { timeout: 10 });
          await sendMessageToGroup(
            data["owner"],
            `Error in data of client ${data["nombre"]} con ID ${data["docId"]}`,
          );
          return "done";
        } catch (error) {
          console.log("Data search error");
        }
        throw new Error("Error");
      }

      //#################################### acValidarEntrada AUTO #################################
      // Auto mode here: click Solicitar Cita as soon as the button is visible.
      console.log("acValidarEntrada auto mode: waiting for Solicitar Cita button...");
      await page.waitForFunction(
        () => {
          const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
          const url = window.location.href;
          const title = document.title || "";
          const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
          const hasSolicitarButton = buttons.some((btn) => {
            const btnText = String(btn.innerText || btn.textContent || btn.value || "").trim().toLowerCase();
            const id = String(btn.id || "");
            const onclick = String(btn.getAttribute("onclick") || "");
            return btnText.includes("solicitar cita") ||
              (id === "btnEnviar" && onclick.includes("solicitud"));
          });
          return (
            hasSolicitarButton ||
            url.includes("/acCitar") ||
            text.includes("Paso 1 de 5") ||
            text.includes("Lo sentimos, pero has superado el máximo de citas") ||
            text.includes("En este momento no hay citas disponibles") ||
            text.includes("Cod. Oper.") ||
            title === "Request Rejected" ||
            text.includes("The requested URL was rejected") ||
            text.includes("Your support ID is")
          );
        },
        { timeout: 0, polling: 500 },
      );
      title = await page.title();
      await throwIfRequestRejected(page, "before auto Solicitar Cita click");

      await throwIfIcpSystemError(page, "before auto Solicitar Cita click");
      if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
        return "done";
      }

      const clickedSolicitarCita = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a"));
        const btn = buttons.find((el) => {
          const btnText = String(el.innerText || el.textContent || el.value || "").trim().toLowerCase();
          const id = String(el.id || "");
          const onclick = String(el.getAttribute("onclick") || "");
          return btnText.includes("solicitar cita") ||
            (id === "btnEnviar" && onclick.includes("solicitud"));
        });
        if (!btn) return false;
        btn.scrollIntoView({ block: "center" });
        ["mousedown", "mouseup", "click"].forEach((eventName) => {
          btn.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window }));
        });
        if (typeof btn.click === "function") btn.click();
        return true;
      }).catch(() => false);

      if (!clickedSolicitarCita) {
        console.log("Solicitar Cita button was not clicked because page already moved ahead or button was not found.");
      } else {
        console.log("Solicitar Cita auto-clicked.");
      }

      await page.waitForFunction(
        () => {
          const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
          const url = window.location.href;
          const title = document.title || "";
          return (
            url.includes("/acCitar") ||
            text.includes("Paso 1 de 5") ||
            text.includes("Lo sentimos, pero has superado el máximo de citas") ||
            text.includes("En este momento no hay citas disponibles") ||
            text.includes("Cod. Oper.") ||
            title === "Request Rejected" ||
            text.includes("The requested URL was rejected") ||
            text.includes("Your support ID is")
          );
        },
        { timeout: 0, polling: 500 },
      );
      title = await page.title();
      if (await handleAcValidarExactCaducadoIfPresent(page, data, browser, profileDir, requestHandler)) {
        return "done";
      }
      await throwIfRequestRejected(page, "after auto Solicitar Cita click");

      await throwIfIcpSystemError(page, "after auto Solicitar Cita click");
      if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
        return "done";
      }

      if (await handleMaxCitasIfPresent(page, data, browser, profileDir, requestHandler)) {
        return "done";
      }

      const contentAfterManualClick = await page.content().catch(() => "");
      const hasAppointmentAfterManualClick = contentAfterManualClick.includes(
        "Lo sentimos, pero has superado el máximo de citas en vigor para este trámite en la provincia seleccionada."
      ) || contentAfterManualClick.includes(
        "Lo sentimos, pero has superado el máximo de citas en vigor para un trámite equivalente en la provincia seleccionada."
      );
      if (hasAppointmentAfterManualClick) {
        if (await handleMaxCitasIfPresent(page, data, browser, profileDir, requestHandler)) {
          return "done";
        }
        return "done";
      }

      // Do not delete profile here if Paso 1 is not visible yet.
      // Start the existing refresh/check loop and let it decide after 10 attempts.
      // refresh
      let attempt = 0;
      while (attempt < 10) {
        try {
          await page.waitForSelector("#btnSiguiente", { timeout: 4000 }); // Check if it's open
          break;
        } catch (error) {
          if (await handleAcValidarExactCaducadoIfPresent(page, data, browser, profileDir, requestHandler)) {
            return "done";
          }
          if (await handleMaxCitasIfPresent(page, data, browser, profileDir, requestHandler)) {
            return "done";
          }
          const hasAppointment = await page.evaluate(() => {
            const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
            return text.includes("Lo sentimos, pero has superado el máximo de citas en vigor para este trámite en la provincia seleccionada.") ||
              text.includes("Lo sentimos, pero has superado el máximo de citas en vigor para un trámite equivalente en la provincia seleccionada.");
          });
          if (hasAppointment) {
            if (await handleMaxCitasIfPresent(page, data, browser, profileDir, requestHandler)) {
              return "done";
            }
            return "done";
          }
          // await sleep(1000);
          attempt += 1;
          await page.reload();
          if (await handleAcValidarExactCaducadoIfPresent(page, data, browser, profileDir, requestHandler)) {
            return "done";
          }
          if (await handleMaxCitasIfPresent(page, data, browser, profileDir, requestHandler)) {
            return "done";
          }
          await throwIfRequestRejected(page, `after acCitar refresh ${attempt}`);

          await throwIfIcpSystemError(page, `after acCitar refresh ${attempt}`);
          if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
            return "done";
          }
          const content = await page.content().catch(() => "");
          if (!content.includes("Paso 1 de 5")) {
            console.log(`After refresh ${attempt}/10, Paso 1 not visible yet. Keeping profile and continuing refresh loop.`);
            continue;
          }
        }
      }
      // If office did not open after exactly 10 refreshes, abort immediately.
      // This closes/deletes the current profile in catch and opens a fresh one without extra waits.
      if (attempt >= 10) {
        console.log("No oficina opened after 10 refreshes. Aborting profile and restarting immediately.");
        throw new Error("ABORT_AFTER_10_REFRESH");
      }

      // ## keep the process
      await page.waitForSelector("#btnSalir", { timeout: 100 });
      await page.waitForSelector("#btnSiguiente", { timeout: 100 }); // Check if it's open
      //######################################### select oficina page ###
      const nonEmptyValues = await page.$$eval(
        "#idSede option",
        (options) =>
          options
            .filter((option) => option.value.trim()) // Filter options with non-empty values
            .map((option) => option.value), // Extract value and text
      );
      // Pick oficina
      let oficinas = mergeOficinas(nonEmptyValues, data["oficina"]);
      oficinas = oficinas.filter((item) => !usedOficinas.includes(item));
      if (oficinas.length === 0) {
        await sendMessageToGroup(
          data["owner"],
          `Out of range oficina, nonEmpty ${nonEmptyValues}`,
        );
        continue;
      }
      console.log(oficinas);
      const chooseOficina = oficinas[0];
      await page.evaluate((value) => {
        document.querySelector(`option[value="${value}"]`).selected = true; // back to selector
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
          page.waitForNavigation({ waitUntil: "domcontentloaded" }),
          page.waitForSelector("#txtTelefonoCitado", { timeout: 15000 }),
          page.waitForTimeout(10000),
        ]),
      ]);
      // Check title
      title = await page.title();
      await throwIfRequestRejected(page, "after navigation");

      await throwIfIcpSystemError(page, "after navigation");
      if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
        return "done";
      }
      await page.waitForSelector("#txtTelefonoCitado", { timeout: 10000 });
      // ###################################### fill in phone number and email
      let phone = await getFirstNumber();
      if (!phone) {
        await sendMessageToGroup(
          data["owner"],
          "Can't get phone number check credit",
        );
        continue;
      }
      const email = getEmail();
      await page.type("#txtTelefonoCitado", `${phone}`);
      await page.type("#emailUNO", email);
      await page.type("#emailDOS", email);
      // write observation
      try {
        await page.type("#txtObservaciones", "Observations");
      } catch (error) {
        console.log("Observations not asked");
      }
      await sleep(2600);
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
      await page.waitForFunction(
        () => {
          const url = window.location.href || "";
          const title = document.title || "";
          const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";

          return (
            url.includes("/acOfertarCita") ||
            !!document.querySelector('img[alt="captcha"]') ||
            title === "Request Rejected" ||
            text.includes("The requested URL was rejected") ||
            text.includes("Your support ID is") ||
            text.includes("Se ha producido un error en el sistema") ||
            text.includes("Cod. Oper.")
          );
        },
        { timeout: ACVERFORMULARIO_STUCK_WAIT_MS, polling: 1000 },
      ).catch(() => null);

      const stillOnAcVerFormularioPhonePage = await page.evaluate(() => {
        const url = window.location.href || "";
        const title = document.title || "";
        const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";

        const requestRejected =
          title === "Request Rejected" ||
          text.includes("The requested URL was rejected") ||
          text.includes("Your support ID is");

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
      }).catch(() => false);

      if (stillOnAcVerFormularioPhonePage) {
        console.log("ACVERFORMULARIO_PHONE_WRONG_OR_EMPTY_WAITED_10MIN_RESTART: still on phone page after btnSiguiente.");
        throw new Error("ACVERFORMULARIO_PHONE_WRONG_OR_EMPTY_WAITED_10MIN_RESTART");
      }
      // ######################### select a date ##############""
      // Check title
      title = await page.title();
      await throwIfRequestRejected(page, "after navigation");

      await throwIfIcpSystemError(page, "after navigation");
      if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
        return "done";
      }

      // Slow profile/proxy safe: wait until acOfertarCita has captcha + available appointment/date/radio slot.
      const acofertaReady = await waitForAcofertaCaptchaAndAppointment(page, ACOFERTA_READY_WAIT_MS);
      if (acofertaReady.requestRejected) {
        await throwIfRequestRejected(page, "acOfertarCita ready wait");

        await throwIfIcpSystemError(page, "acOfertarCita ready wait");
      }
      if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
        return "done";
      }
      if (await handleTelefono0006IfPresent(page, data, phone)) {
        throw new Error("TELEFONO_0006_NOTIFIED");
      }
      if (acofertaReady.noDisponibleWithCodOper) {
        console.log(`ACOFERTA_NO_CITA_DISPONIBLE_COD_OPER: waiting ${ACOFERTA_NO_CITA_DELETE_WAIT_MS}ms before deleting profile.`);
        await page.waitForTimeout(ACOFERTA_NO_CITA_DELETE_WAIT_MS).catch(() => {});
        throw new Error("ACOFERTA_NO_CITA_DELETE_AFTER_3S_ALREADY_WAITED");
      }
      if (acofertaReady.noDisponible) {
        console.log("ACOFERTA_NO_CITA_DISPONIBLE: no Cod. Oper. yet. Restarting profile through error handler.");
        throw new Error("ACOFERTA_NO_CITA_DISPONIBLE");
      }
      if (!acofertaReady.ready) {
        console.log("ACOFERTA_NOT_READY_AFTER_60S: captcha/date/radio not fully loaded. Restarting profile through error handler.");
        throw new Error("ACOFERTA_NOT_READY_AFTER_60S");
      }

      // select appointment
      const datePicker = await page.$("#datepicker");
      const dateMin = data["minDate"];
      const dateMax = data["maxDate"];
      // working here
      if (datePicker !== null) {
        const dayDatesElements = await page.$$('th[class^="colFecha"]');
        const dayDates = await Promise.all(
          dayDatesElements.map(async (element) => {
            return await element.evaluate((el) => [
              el.className,
              el.textContent.trim(),
            ]);
          }),
        );
        // scroll to the end
        let lastHeight = await page.evaluate("document.body.scrollHeight");
        while (true) {
          await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
          await page.waitForTimeout(500); // Wait for content to load
          const newHeight = await page.evaluate("document.body.scrollHeight");
          if (newHeight === lastHeight) break;
          lastHeight = newHeight;
        }
        let availabelDates = []; // back to it
        for (const dayDate of dayDates) {
          const links = await page.$$(`td.${dayDate[0]} a[role="button"]`);
          for await (const el of links) {
            availabelDates.push([dayDate[1], el]);
          }
        }
        availabelDates = availabelDates.filter((el) => {
          if (!el[0]) return false;
          const currentDate = parseDate(el[0]);
          const minDate = parseDate(dateMin);
          const maxDate = parseDate(dateMax);
          return (
            (!minDate || currentDate >= minDate) &&
            (!maxDate || currentDate <= maxDate)
          );
        });
        if (availabelDates.length === 0) {
          console.log("Apointment not in range");
          usedOficinas.push(chooseOficina);
          if (oficinas.length === 0) {
            break;
          }
          continue;
        }
        const randomLink =
          availabelDates[Math.floor(Math.random() * availabelDates.length)][1];
        await solveCaptcha(page);
        await randomLink.click();
      } else {
        const citasDivs = await page.$$('div[id^="cita_"]');
        const filteredAppointments = (
          await Promise.all(
            citasDivs.map(async (div) => {
              const spanText = await div
                .$eval("span:nth-of-type(2)", (span) => span.textContent.trim())
                .catch(() => null);
              const inputElement = await div.$("input").catch(() => null);
              return { spanText, inputElement }; // Return as object for clarity
            }),
          )
        )
          .filter(({ spanText }) => {
            if (!spanText) return false; // Skip if no date
            const currentDate = parseDate(spanText);
            const minDate = parseDate(dateMin);
            const maxDate = parseDate(dateMax);
            // Check if currentDate is within range (handles empty min/max)
            return (
              (!minDate || currentDate >= minDate) &&
              (!maxDate || currentDate <= maxDate)
            );
          })
          .map(({ spanText, inputElement }) => inputElement);
        if (filteredAppointments.length === 0) {
          console.log("Apointment not in range");
          usedOficinas.push(chooseOficina);
          if (oficinas.length === 0) {
            break;
          }
          continue;
        }
        const randomLink =
          filteredAppointments[
            Math.floor(Math.random() * filteredAppointments.length)
          ];
        await randomLink.click();
        await solveCaptcha(page);
        // await sleep(500); // check this
        //btnSiguiente
        await page.locator("#btnSiguiente").click();
      }
      await page.waitForSelector("div.jconfirm-buttons > button:nth-child(1)", {
        timeout: 5000,
      });
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2" }),
        cursor.click("div.jconfirm-buttons > button:nth-child(1)", {
          moveDelay: 0,
          randomizeMoveDelay: false,
        }),
      ]);
      // #################### final page ############
      // Check title
      title = await page.title();
      await throwIfRequestRejected(page, "final page");

      await throwIfIcpSystemError(page, "final page");
      if (await handleClave0019IfPresent(page, data, usuarioClave, browser, profileDir, requestHandler)) {
        return "done";
      }
      // check it load next page
      await page.waitForSelector("#btnConfirmar", { timeout: 5000 });
      await sendMessageToGroup(
        data["owner"],
        `🔔Cita encontrada🔔\n\n📝 Tramite: ${data["tramiteLabel"]}\n\n📍CITADO: ${data["nombre"]}  - ${data["docId"]}\n\n🏢 Phone: ${phone}\n\n Email: ${email}`,
      );
      
// give time for verification
await page.waitForFunction(
  () => {
    const input = document.querySelector("#txtCodigoVerificacion");
    return input && input.value.trim() !== "";
  },
  { timeout: 900000 }, // 15 minutes
);

await waitForAcGrabarCitaFinalAndNotify(page, data, phone, email, usuarioClave, 900000);
      await waitForAcGrabarCitaFinalAndNotify(page, data, phone, email, usuarioClave, 900000);
      console.log("Done Done Done");
      return "done";
    } catch (error) {
      const reason = String(error?.message || error || "UNKNOWN_ERROR");
      console.log("PROFILE_ABORT_REASON:", reason);

      const manualClosed = isManualBrowserCloseError(error);
      try { page?.off("request", requestHandler); } catch (cleanupError) {}
      await closeBrowserFast(browser, "CATCH_RESTART");
      if (profileDir) {
        await deleteProfileFolderFast(profileDir, "CATCH_RESTART");
      }

      if (manualClosed) {
        console.log("MANUAL_PROFILE_CLOSE_DETECTED: opening fresh profile immediately.");
      } else if (reason.includes("ABORT_AFTER_10_REFRESH")) {
        console.log("ABORT_AFTER_10_REFRESH_FAST_RESTART: close/delete timeout protected; opening fresh profile immediately.");
      } else if (reason.includes("ACOFERTA_NO_CITA_DELETE_AFTER_3S_ALREADY_WAITED")) {
        console.log("ACOFERTA_NO_CITA_PROFILE_DELETED_AFTER_3S: opening fresh profile immediately.");
      } else if (reason.includes("CLAVE_SERVICE_REDIRECT_TIMEOUT_3MIN")) {
        console.log("CLAVE_SERVICE_REDIRECT_TIMEOUT_3MIN_IMMEDIATE_RESTART: opening fresh profile immediately.");
      } else {
        console.log("NO_SLEEP_FAST_RESTART_NO_HANG: opening fresh profile immediately after cleanup attempt.");
      }
    }
  }
}
