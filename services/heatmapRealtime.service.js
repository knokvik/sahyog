const { createClient } = require('redis');
const db = require('../config/db');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const GEO_KEY = process.env.HEATMAP_GEO_KEY || 'live:locations';
const LOCATION_KEY_MATCH = process.env.HEATMAP_LOCATION_KEY_MATCH || 'location:*';
const EMIT_INTERVAL_MS = Number(process.env.HEATMAP_EMIT_INTERVAL_MS || 3000);
const CELL_PRECISION = Number(process.env.HEATMAP_CELL_PRECISION || 3);
const GEO_RADIUS_KM = Number(process.env.HEATMAP_RADIUS_KM || 0.6);
const GEO_RADIUS_MAX = Number(process.env.HEATMAP_RADIUS_MAX || 300);
const SHELTER_CACHE_MS = Number(process.env.HEATMAP_SHELTER_CACHE_MS || 60000);
const DB_FALLBACK_CACHE_MS = Number(process.env.HEATMAP_DB_FALLBACK_CACHE_MS || 5000);
const EVENT_NAME = 'heatmap:update';

const ROLE_BASE_SEVERITY = {
  user: 3,
  citizen: 3,
  volunteer: 5,
  coordinator: 7,
  admin: 8,
  ngo_admin: 8,
  district_admin: 8,
};

let redisClient;
let emitTimer;
let emitInFlight = false;
let sheltersCache = [];
let sheltersLastLoadedAt = 0;
let dbFallbackCache = [];
let dbFallbackLastLoadedAt = 0;

let latestSnapshot = {
  updatedAt: new Date().toISOString(),
  points: [],
  shelters: [],
};

function clampSeverity(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function roundCoord(value) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(CELL_PRECISION));
}

function parseLocationRecord(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (_) {
    return null;
  }

  const lat = Number(parsed.lat ?? parsed.latitude);
  const lng = Number(parsed.lng ?? parsed.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const count = Number(parsed.count);
  const explicitSeverity = Number(parsed.severity);
  const role = String(parsed.role || '').toLowerCase();

  const baseSeverity = Number.isFinite(explicitSeverity)
    ? explicitSeverity
    : ROLE_BASE_SEVERITY[role] || 4;

  return {
    lat,
    lng,
    count: Number.isFinite(count) && count > 0 ? count : 1,
    severity: clampSeverity(baseSeverity),
  };
}

async function ensureRedis() {
  if (redisClient?.isOpen) return redisClient;

  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => {
      console.error('[heatmap] Redis error:', err?.message || err);
    });
  }

  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log('[heatmap] Redis connected');
  }

  return redisClient;
}

async function listLocationKeys(client) {
  if (typeof client.scanIterator === 'function') {
    const keys = [];
    for await (const batch of client.scanIterator({ MATCH: LOCATION_KEY_MATCH, COUNT: 250 })) {
      if (Array.isArray(batch)) {
        keys.push(...batch.filter((key) => typeof key === 'string'));
      } else if (typeof batch === 'string') {
        keys.push(batch);
      }
    }
    return keys;
  }

  return client.keys(LOCATION_KEY_MATCH);
}

async function fetchLiveLocations(client) {
  if (!client) return [];
  const keys = await listLocationKeys(client);
  if (!keys.length) return [];

  const values = await client.mGet(keys);
  return values
    .map(parseLocationRecord)
    .filter(Boolean);
}

async function georadiusCount(client, lat, lng) {
  if (!client) return 0;
  try {
    const args = [
      GEO_KEY,
      String(lng),
      String(lat),
      String(GEO_RADIUS_KM),
      'km',
      'COUNT',
      String(GEO_RADIUS_MAX),
    ];
    const result = await client.sendCommand(['GEORADIUS', ...args]);
    return Array.isArray(result) ? result.length : 0;
  } catch (err) {
    console.error('[heatmap] GEORADIUS failed:', err?.message || err);
    return 0;
  }
}

async function fetchDbFallbackLocations() {
  const now = Date.now();
  if (now - dbFallbackLastLoadedAt < DB_FALLBACK_CACHE_MS) {
    return dbFallbackCache;
  }

  let userRows = [];
  let sosRows = [];

  try {
    const usersResult = await db.query(
      `SELECT ST_Y(u.current_location::geometry) AS lat,
              ST_X(u.current_location::geometry) AS lng,
              u.role
       FROM users u
       WHERE u.current_location IS NOT NULL
         AND COALESCE(u.is_active, true) = true
       LIMIT 1000`
    );
    userRows = usersResult.rows;
  } catch (err) {
    console.warn('[heatmap] users fallback query failed:', err?.message || err);
  }

  try {
    const sosResult = await db.query(
      `SELECT ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lng
       FROM sos_alerts s
       WHERE s.location IS NOT NULL
         AND COALESCE(s.status, 'triggered') NOT IN ('resolved', 'cancelled')
       ORDER BY s.created_at DESC
       LIMIT 500`
    );
    sosRows = sosResult.rows;
  } catch (err) {
    // Some deployments may not have sos_alerts yet; keep this non-fatal.
    console.warn('[heatmap] sos fallback query failed:', err?.message || err);
  }

  const normalizedUsers = userRows
    .map((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const role = String(row.role || '').toLowerCase();
      return {
        lat,
        lng,
        count: 1,
        severity: clampSeverity(ROLE_BASE_SEVERITY[role] || 4),
      };
    })
    .filter(Boolean);

  const normalizedSos = sosRows
    .map((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return {
        lat,
        lng,
        count: 2,
        severity: 9,
      };
    })
    .filter(Boolean);

  dbFallbackCache = [...normalizedUsers, ...normalizedSos];
  dbFallbackLastLoadedAt = now;
  return dbFallbackCache;
}

async function fetchShelters() {
  const now = Date.now();
  if (now - sheltersLastLoadedAt < SHELTER_CACHE_MS) {
    return sheltersCache;
  }

  try {
    const result = await db.query(
      `SELECT id,
              name,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lng,
              capacity,
              current_occupancy
       FROM shelters
       WHERE status = 'active'
         AND location IS NOT NULL
       ORDER BY name ASC
       LIMIT 500`
    );

    sheltersCache = result.rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        lat: Number(row.lat),
        lng: Number(row.lng),
        capacity: row.capacity,
        occupancy: row.current_occupancy,
      }))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));

    sheltersLastLoadedAt = now;
  } catch (err) {
    console.error('[heatmap] Failed loading shelters:', err?.message || err);
    sheltersCache = [];
    sheltersLastLoadedAt = now;
  }

  return sheltersCache;
}

async function buildSnapshot() {
  let client = null;
  try {
    client = await ensureRedis();
  } catch (err) {
    console.warn('[heatmap] Redis unavailable, using DB fallback only:', err?.message || err);
  }

  const [redisLocations, dbFallbackLocations, shelters] = await Promise.all([
    fetchLiveLocations(client),
    fetchDbFallbackLocations(),
    fetchShelters(),
  ]);

  const locations = [...redisLocations, ...dbFallbackLocations];

  if (!locations.length) {
    return {
      updatedAt: new Date().toISOString(),
      points: [],
      shelters,
    };
  }

  const buckets = new Map();

  for (const loc of locations) {
    const lat = roundCoord(loc.lat);
    const lng = roundCoord(loc.lng);
    if (lat === null || lng === null) continue;

    const key = `${lat}:${lng}`;
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, {
        lat,
        lng,
        count: loc.count,
        severityWeightedSum: loc.severity * loc.count,
        weight: loc.count,
      });
      continue;
    }

    existing.count += loc.count;
    existing.severityWeightedSum += loc.severity * loc.count;
    existing.weight += loc.count;
  }

  const points = await Promise.all(
    Array.from(buckets.values()).map(async (bucket) => {
      const localDensity = await georadiusCount(client, bucket.lat, bucket.lng);
      const finalCount = Math.max(bucket.count, localDensity);
      const avgSeverity = bucket.weight > 0 ? bucket.severityWeightedSum / bucket.weight : 1;
      const severity = clampSeverity((avgSeverity + Math.min(10, finalCount)) / 2);

      return {
        lat: bucket.lat,
        lng: bucket.lng,
        count: finalCount,
        severity,
      };
    })
  );

  points.sort((a, b) => b.count - a.count);

  return {
    updatedAt: new Date().toISOString(),
    points,
    shelters,
  };
}

async function emitSnapshot(io) {
  if (!io || emitInFlight) return;

  emitInFlight = true;
  try {
    latestSnapshot = await buildSnapshot();
    io.emit(EVENT_NAME, latestSnapshot);
  } catch (err) {
    console.error('[heatmap] emit failed:', err?.message || err);
  } finally {
    emitInFlight = false;
  }
}

function startHeatmapEmitter(io) {
  if (!io || emitTimer) return;

  emitSnapshot(io).catch((err) => {
    console.error('[heatmap] initial emit failed:', err?.message || err);
  });

  emitTimer = setInterval(() => {
    emitSnapshot(io).catch((err) => {
      console.error('[heatmap] interval emit failed:', err?.message || err);
    });
  }, EMIT_INTERVAL_MS);

  console.log(`[heatmap] emitter started (${EMIT_INTERVAL_MS}ms)`);
}

function stopHeatmapEmitter() {
  if (emitTimer) {
    clearInterval(emitTimer);
    emitTimer = null;
  }

  if (redisClient?.isOpen) {
    redisClient.quit().catch(() => {});
  }

  redisClient = null;
}

function emitLatestToSocket(socket) {
  if (!socket || !latestSnapshot) return;
  socket.emit(EVENT_NAME, latestSnapshot);
}

module.exports = {
  EVENT_NAME,
  startHeatmapEmitter,
  stopHeatmapEmitter,
  emitLatestToSocket,
};
