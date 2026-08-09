import fs from "fs";
import {
  fetchData,
  deleteFolderRecursive,
  readFileLines,
  getAppointment,
} from "./help.js";

const BOT_BUILD_ID = "BOT_BASE_CALENDARIO_DOM_CAPTCHA_PARALLEL_2026-07-21";
console.log(`BOT_BUILD_ID: ${BOT_BUILD_ID}`);

const provinciesList = {
  "A Coruña": "/icpplus/citar?p=15&locale=es",
  Albacete: "/icpplus/citar?p=2&locale=es",
  Alicante: "/icpco/citar?p=3&locale=es",
  Almería: "/icpplus/citar?p=4&locale=es",
  Araba: "/icpplus/citar?p=1&locale=es",
  Asturias: "/icpplus/citar?p=33&locale=es",
  Ávila: "/icpplus/citar?p=5&locale=es",
  Badajoz: "/icpplus/citar?p=6&locale=es",
  Barcelona: "/icpplustieb/citar?p=8&locale=es",
  Bizkaia: "/icpplus/citar?p=48&locale=es",
  Burgos: "/icpplus/citar?p=9&locale=es",
  Cáceres: "/icpplus/citar?p=10&locale=es",
  Cádiz: "/icpplus/citar?p=11&locale=es",
  Cantabria: "/icpplus/citar?p=39&locale=es",
  Castellón: "/icpplus/citar?p=12&locale=es",
  Ceuta: "/icpplus/citar?p=51&locale=es",
  "Ciudad Real": "/icpplus/citar?p=13&locale=es",
  Córdoba: "/icpplus/citar?p=14&locale=es",
  Cuenca: "/icpplus/citar?p=16&locale=es",
  Gipuzkoa: "/icpplus/citar?p=20&locale=es",
  Girona: "/icpplus/citar?p=17&locale=es",
  Granada: "/icpplus/citar?p=18&locale=es",
  Guadalajara: "/icpplus/citar?p=19&locale=es",
  Huelva: "/icpplus/citar?p=21&locale=es",
  Huesca: "/icpplus/citar?p=22&locale=es",
  "Illes Balears": "/icpco/citar?p=7&locale=es",
  Jaén: "/icpplus/citar?p=23&locale=es",
  "La Rioja": "/icpplus/citar?p=26&locale=es",
  "Las Palmas": "/icpco/citar?p=35&locale=es",
  León: "/icpplus/citar?p=24&locale=es",
  Lleida: "/icpplus/citar?p=25&locale=es",
  Lugo: "/icpplus/citar?p=27&locale=es",
  Madrid: "/icpplustiem/citar?p=28&locale=es",
  Málaga: "/icpco/citar?p=29&locale=es",
  Melilla: "/icpplus/citar?p=52&locale=es",
  Murcia: "/icpplus/citar?p=30&locale=es",
  Navarra: "/icpplus/citar?p=31&locale=es",
  Ourense: "/icpplus/citar?p=32&locale=es",
  Palencia: "/icpplus/citar?p=34&locale=es",
  Pontevedra: "/icpplus/citar?p=36&locale=es",
  Salamanca: "/icpplus/citar?p=37&locale=es",
  "S.Cruz Tenerife": "/icpco/citar?p=38&locale=es",
  Segovia: "/icpplus/citar?p=40&locale=es",
  Sevilla: "/icpplus/citar?p=41&locale=es",
  Soria: "/icpplus/citar?p=42&locale=es",
  Tarragona: "/icpplus/citar?p=43&locale=es",
  Teruel: "/icpplus/citar?p=44&locale=es",
  Toledo: "/icpplus/citar?p=45&locale=es",
  Valencia: "/icpplus/citar?p=46&locale=es",
  Valladolid: "/icpplus/citar?p=47&locale=es",
  Zamora: "/icpplus/citar?p=49&locale=es",
  Zaragoza: "/icpplus/citar?p=50&locale=es",
};

// Max concurrent workers
const maxConcurrant = Number(process.env.MAX_CONCURRENT || 8);

// Put province names here, not URLs. Examples:
// const provinciaNames = ["Barcelona"];
// const provinciaNames = ["Madrid", "Soria"];
// const provinciaNames = []; // all provinces
const provinciaNames = ["barcelona"]; //barcelona murcia

// Optional office filters. Put one word or part of each office name.
// Preferidas: if any are set, only offices matching at least one word are accepted.
// Excluidas: always skipped, even if no preferred offices are set.
// Examples:
// const oficinasPreferidas = ["Aluche", "Leganes"];
// const oficinasExcluidas = ["Mallorca"];
const oficinasPreferidas = [];
const oficinasExcluidas = [];

const provinceUrlByName = {
  "a coruna": "/icpplus/citar?p=15&locale=es",
  albacete: "/icpplus/citar?p=2&locale=es",
  alicante: "/icpco/citar?p=3&locale=es",
  almeria: "/icpplus/citar?p=4&locale=es",
  araba: "/icpplus/citar?p=1&locale=es",
  asturias: "/icpplus/citar?p=33&locale=es",
  avila: "/icpplus/citar?p=5&locale=es",
  badajoz: "/icpplus/citar?p=6&locale=es",
  barcelona: "/icpplustieb/citar?p=8&locale=es",
  bizkaia: "/icpplus/citar?p=48&locale=es",
  burgos: "/icpplus/citar?p=9&locale=es",
  caceres: "/icpplus/citar?p=10&locale=es",
  cadiz: "/icpplus/citar?p=11&locale=es",
  cantabria: "/icpplus/citar?p=39&locale=es",
  castellon: "/icpplus/citar?p=12&locale=es",
  ceuta: "/icpplus/citar?p=51&locale=es",
  "ciudad real": "/icpplus/citar?p=13&locale=es",
  cordoba: "/icpplus/citar?p=14&locale=es",
  cuenca: "/icpplus/citar?p=16&locale=es",
  gipuzkoa: "/icpplus/citar?p=20&locale=es",
  girona: "/icpplus/citar?p=17&locale=es",
  granada: "/icpplus/citar?p=18&locale=es",
  guadalajara: "/icpplus/citar?p=19&locale=es",
  huelva: "/icpplus/citar?p=21&locale=es",
  huesca: "/icpplus/citar?p=22&locale=es",
  "illes balears": "/icpco/citar?p=7&locale=es",
  jaen: "/icpplus/citar?p=23&locale=es",
  "la rioja": "/icpplus/citar?p=26&locale=es",
  "las palmas": "/icpco/citar?p=35&locale=es",
  leon: "/icpplus/citar?p=24&locale=es",
  lleida: "/icpplus/citar?p=25&locale=es",
  lugo: "/icpplus/citar?p=27&locale=es",
  madrid: "/icpplustiem/citar?p=28&locale=es",
  malaga: "/icpco/citar?p=29&locale=es",
  melilla: "/icpplus/citar?p=52&locale=es",
  murcia: "/icpplus/citar?p=30&locale=es",
  navarra: "/icpplus/citar?p=31&locale=es",
  ourense: "/icpplus/citar?p=32&locale=es",
  palencia: "/icpplus/citar?p=34&locale=es",
  pontevedra: "/icpplus/citar?p=36&locale=es",
  salamanca: "/icpplus/citar?p=37&locale=es",
  "s.cruz tenerife": "/icpco/citar?p=38&locale=es",
  "s cruz tenerife": "/icpco/citar?p=38&locale=es",
  "santa cruz tenerife": "/icpco/citar?p=38&locale=es",
  segovia: "/icpplus/citar?p=40&locale=es",
  sevilla: "/icpplus/citar?p=41&locale=es",
  soria: "/icpplus/citar?p=42&locale=es",
  tarragona: "/icpplus/citar?p=43&locale=es",
  teruel: "/icpplus/citar?p=44&locale=es",
  toledo: "/icpplus/citar?p=45&locale=es",
  valencia: "/icpplus/citar?p=46&locale=es",
  valladolid: "/icpplus/citar?p=47&locale=es",
  zamora: "/icpplus/citar?p=49&locale=es",
  zaragoza: "/icpplus/citar?p=50&locale=es",
};

function normalizeProvinceName(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getSelectedProvinceNames() {
  if (process.env.PROVINCIAS && process.env.PROVINCIAS.trim()) {
    return process.env.PROVINCIAS.split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return provinciaNames;
}

function normalizeListInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getSelectedOfficeFilters() {
  const preferredFromEnv =
    process.env.OFICINAS ||
    process.env.OFICINA ||
    process.env.OFICINA_PREFERIDA ||
    "";
  const excludedFromEnv =
    process.env.OFICINAS_EXCLUIDAS || process.env.OFICINA_EXCLUIDA || "";
  return {
    preferidas: normalizeListInput(preferredFromEnv || oficinasPreferidas),
    excluidas: normalizeListInput(excludedFromEnv || oficinasExcluidas),
  };
}

function resolveProvincia(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (value.startsWith("/")) return value;

  const normalized = normalizeProvinceName(value);
  const url = provinceUrlByName[normalized];
  if (!url) {
    const available = Object.keys(provinceUrlByName).sort().join(", ");
    throw new Error(
      `Provincia no encontrada: "${value}". Opciones: ${available}`,
    );
  }
  return url;
}

const provincias = getSelectedProvinceNames()
  .map(resolveProvincia)
  .filter(Boolean);

function isPendingRecord(data) {
  const status = String(data?.status || "pending")
    .trim()
    .toLowerCase();
  return status === "pending";
}

function applyRuntimeFilters(datos, selectedOfficeFilters) {
  let filtered = datos.filter(isPendingRecord);

  if (
    selectedOfficeFilters.preferidas.length > 0 ||
    selectedOfficeFilters.excluidas.length > 0
  ) {
    filtered = filtered.map((item) => ({
      ...item,
      oficinasPreferidas: selectedOfficeFilters.preferidas,
      oficinasExcluidas: selectedOfficeFilters.excluidas,
    }));
  }

  if (provincias.length > 0) {
    filtered = filtered.filter((item) =>
      provincias.includes(item["provincia"]),
    );
  }

  return filtered;
}

async function runLimited(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  async function runNext() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      try {
        results[index] = {
          status: "fulfilled",
          value: await worker(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}

async function main() {
  // clear profiles
  if (fs.existsSync("./profiles")) {
    await deleteFolderRecursive("./profiles");
  }
  fs.mkdirSync("profiles", { recursive: true });
  // read proxies
  const proxies = await readFileLines("./proxies/proxies.txt").catch(
    (error) => {
      console.error(
        "Failed to read proxies/proxies.txt:",
        error?.message || error,
      );
      return [];
    },
  );
  if (proxies.length === 0) {
    console.warn(
      "No proxies loaded. Workers will launch without a configured proxy.",
    );
  }
  const selectedOfficeFilters = getSelectedOfficeFilters();
  if (
    selectedOfficeFilters.preferidas.length > 0 ||
    selectedOfficeFilters.excluidas.length > 0
  ) {
    console.log(
      `OFICINAS_PREFERIDAS_CONFIG: ${selectedOfficeFilters.preferidas.join(", ") || "(ninguna)"}`,
    );
    console.log(
      `OFICINAS_EXCLUIDAS_CONFIG: ${selectedOfficeFilters.excluidas.join(", ") || "(ninguna)"}`,
    );
  }

  const datos = applyRuntimeFilters(await fetchData(), selectedOfficeFilters);

  if (datos.length === 0) {
    console.log("No Pending data to search, plz add data to the app");
    return "Done";
  }

  const results = await runLimited(datos, maxConcurrant, (data, index) =>
    getAppointment(data, proxies, index, index),
  );

  return results.map((result) => {
    if (result.status === "fulfilled") return result.value;
    return { error: result.reason?.message || String(result.reason) };
  });
}

main()
  .then((result) => {
    console.log(result);
  })
  .catch((error) => {
    console.log(error);
  });
