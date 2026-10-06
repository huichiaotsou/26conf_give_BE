const { BetaAnalyticsDataClient } = require("@google-analytics/data");
const cityCoordinateRecords = require("cities.json");

const CACHE_TTL_MS = 5 * 60 * 1000;
const reportCache = new Map();
const cityCoordinatesByCountry = new Map();
const countryCoordinateTotals = new Map();

function normalizeLocationName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\b(city|district|county|municipality)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

for (const record of cityCoordinateRecords) {
  const latitude = Number(record.lat);
  const longitude = Number(record.lng);
  const countryCode = String(record.country || "").toUpperCase();
  if (!countryCode || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

  const name = normalizeLocationName(record.name);
  if (name) {
    const countryCities = cityCoordinatesByCountry.get(countryCode) || new Map();
    if (!countryCities.has(name)) countryCities.set(name, { latitude, longitude });
    cityCoordinatesByCountry.set(countryCode, countryCities);
  }

  const total = countryCoordinateTotals.get(countryCode) || { latitude: 0, longitude: 0, count: 0 };
  total.latitude += latitude;
  total.longitude += longitude;
  total.count += 1;
  countryCoordinateTotals.set(countryCode, total);
}

function getCountryCoordinates(countryCode) {
  const total = countryCoordinateTotals.get(countryCode);
  if (!total) return null;
  return { latitude: total.latitude / total.count, longitude: total.longitude / total.count };
}

function getCityCoordinates(countryCode, city, region) {
  const countryCities = cityCoordinatesByCountry.get(countryCode);
  if (!countryCities) return null;

  for (const candidate of [city, region]) {
    const coordinates = countryCities.get(normalizeLocationName(candidate));
    if (coordinates) return coordinates;
  }
  return null;
}

function getConfiguration() {
  const propertyId = String(process.env.GA4_PROPERTY_ID || "").trim();
  const rawCredentials = String(process.env.GA4_SERVICE_ACCOUNT_JSON || "").trim();

  if (!propertyId || !rawCredentials) {
    return null;
  }

  if (!/^\d+$/.test(propertyId)) {
    throw new Error("GA4_PROPERTY_ID must contain only the numeric GA4 property ID.");
  }

  let credentials;
  try {
    credentials = JSON.parse(rawCredentials);
  } catch (error) {
    throw new Error("GA4_SERVICE_ACCOUNT_JSON must be valid JSON.");
  }

  return { propertyId, credentials };
}

function valueAt(row, index) {
  return row?.metricValues?.[index]?.value || "0";
}

function ga4DateToIso(date) {
  const value = String(date || "");
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function parseSummary(response) {
  const row = response.rows?.[0];
  return {
    activeUsers: Number(valueAt(row, 0)),
    newUsers: Number(valueAt(row, 1)),
    sessions: Number(valueAt(row, 2)),
    pageViews: Number(valueAt(row, 3)),
  };
}

function parseDaily(response) {
  return (response.rows || []).map((row) => ({
    date: ga4DateToIso(row.dimensionValues?.[0]?.value),
    activeUsers: Number(valueAt(row, 0)),
    newUsers: Number(valueAt(row, 1)),
    sessions: Number(valueAt(row, 2)),
    pageViews: Number(valueAt(row, 3)),
  }));
}

function parseGeography(visitsResponse) {
  const geography = new Map();
  const getRow = (countryCode, country) => {
    if (!/^[A-Z]{2}$/.test(countryCode)) return null;
    const existing = geography.get(countryCode) || {
      countryCode,
      country: country || countryCode,
      activeUsers: 0,
      sessions: 0,
    };
    if (country) existing.country = country;
    geography.set(countryCode, existing);
    return existing;
  };

  for (const row of visitsResponse.rows || []) {
    const entry = getRow(
      String(row.dimensionValues?.[0]?.value || "").toUpperCase(),
      row.dimensionValues?.[1]?.value
    );
    if (!entry) continue;
    entry.activeUsers = Number(valueAt(row, 0));
    entry.sessions = Number(valueAt(row, 1));
  }

  return Array.from(geography.values())
    .map((entry) => ({ ...entry, coordinates: getCountryCoordinates(entry.countryCode) }))
    .sort((a, b) => b.activeUsers - a.activeUsers);
}

function parseCityGeography(visitsResponse) {
  const cities = new Map();
  const getRow = (countryCode, country, region, city) => {
    if (!/^[A-Z]{2}$/.test(countryCode) || !city || city === "(not set)") {
      return null;
    }
    const key = `${countryCode}:${city}`;
    const existing = cities.get(key) || {
      countryCode,
      country: country || countryCode,
      region: region || "",
      city,
      activeUsers: 0,
      sessions: 0,
    };
    if (country) existing.country = country;
    if (region) existing.region = region;
    cities.set(key, existing);
    return existing;
  };

  for (const row of visitsResponse.rows || []) {
    const entry = getRow(
      String(row.dimensionValues?.[0]?.value || "").toUpperCase(),
      row.dimensionValues?.[1]?.value,
      row.dimensionValues?.[2]?.value,
      row.dimensionValues?.[3]?.value
    );
    if (!entry) continue;
    entry.activeUsers = Number(valueAt(row, 0));
    entry.sessions = Number(valueAt(row, 1));
  }

  return Array.from(cities.values())
    .map((entry) => ({ ...entry, coordinates: getCityCoordinates(entry.countryCode, entry.city, entry.region) }))
    .sort((a, b) => b.activeUsers - a.activeUsers);
}

async function getReport({ startDate, endDate }) {
  const configuration = getConfiguration();
  if (!configuration) {
    return {
      available: false,
      message: "尚未設定 GA4_PROPERTY_ID 或 GA4_SERVICE_ACCOUNT_JSON。",
      summary: null,
      daily: [],
      postEffect: null,
      geography: [],
      cities: [],
    };
  }

  const cacheKey = `${configuration.propertyId}:${startDate}:${endDate}`;
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const client = new BetaAnalyticsDataClient({
    credentials: configuration.credentials,
  });
  const requestBase = {
    property: `properties/${configuration.propertyId}`,
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
    ],
  };

  const [summaryResponse, dailyResponse, visitsByCountryResponse, visitsByCityResponse] = await Promise.all([
    client.runReport(requestBase),
    client.runReport({
      ...requestBase,
      dimensions: [{ name: "date" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
    client.runReport({
      property: requestBase.property,
      dateRanges: requestBase.dateRanges,
      dimensions: [{ name: "countryId" }, { name: "country" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 250,
    }),
    client.runReport({
      property: requestBase.property,
      dateRanges: requestBase.dateRanges,
      dimensions: [{ name: "countryId" }, { name: "country" }, { name: "region" }, { name: "city" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 1000,
    }),
  ]);

  const value = {
    available: true,
    message: null,
    summary: parseSummary(summaryResponse[0]),
    daily: parseDaily(dailyResponse[0]),
    geography: parseGeography(visitsByCountryResponse[0]),
    cities: parseCityGeography(visitsByCityResponse[0]),
  };
  reportCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}

module.exports = { getReport };
