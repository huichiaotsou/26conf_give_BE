const { BetaAnalyticsDataClient } = require("@google-analytics/data");

const CACHE_TTL_MS = 5 * 60 * 1000;
const reportCache = new Map();

function getConfiguration() {
  const propertyId = String(process.env.GA4_PROPERTY_ID || "").trim();
  const rawCredentials = String(process.env.GA4_SERVICE_ACCOUNT_JSON || "").trim();
  const donationEvent = String(process.env.GA4_DONATION_EVENT || "purchase").trim();

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

  return { propertyId, credentials, donationEvent };
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

function parsePostEffect(response, donationEvent) {
  return {
    donationEvent,
    rows: (response.rows || [])
      .map((row) => {
        const donationDate = ga4DateToIso(row.dimensionValues?.[0]?.value);
        const firstSessionDate = ga4DateToIso(row.dimensionValues?.[1]?.value);
        const daysToDonation = Math.round(
          (Date.parse(`${donationDate}T00:00:00Z`) -
            Date.parse(`${firstSessionDate}T00:00:00Z`)) /
            (24 * 60 * 60 * 1000)
        );
        return {
          donationDate,
          firstSessionDate,
          daysToDonation,
          donationEvents: Number(valueAt(row, 0)),
        };
      })
      .filter((row) => Number.isFinite(row.daysToDonation) && row.daysToDonation >= 0),
  };
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

  const [summaryResponse, dailyResponse, postEffectResponse] = await Promise.all([
    client.runReport(requestBase),
    client.runReport({
      ...requestBase,
      dimensions: [{ name: "date" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
    client.runReport({
      property: requestBase.property,
      dateRanges: requestBase.dateRanges,
      dimensions: [{ name: "date" }, { name: "firstSessionDate" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          stringFilter: {
            matchType: "EXACT",
            value: configuration.donationEvent,
          },
        },
      },
      orderBys: [{ dimension: { dimensionName: "date" } }],
    }),
  ]);

  const value = {
    available: true,
    message: null,
    summary: parseSummary(summaryResponse[0]),
    daily: parseDaily(dailyResponse[0]),
    postEffect: parsePostEffect(postEffectResponse[0], configuration.donationEvent),
  };
  reportCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}

module.exports = { getReport };
