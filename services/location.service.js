const { createClient } = require('redis');

let redisClient;
let pubClient;
let _connecting = false;

const LOCATION_TTL = 30 * 60; // 30 minutes in seconds
const CHANNEL_NAME = 'location:updates';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const initRedis = async () => {
    if (redisClient && redisClient.isOpen) return;
    if (_connecting) return; // prevent concurrent init calls
    _connecting = true;

    try {
        redisClient = createClient({ url: REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) } });
        pubClient = createClient({ url: REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) } });

        redisClient.on('error', (err) => console.error('Redis client error:', err.message));
        pubClient.on('error', (err) => console.error('Redis pub error:', err.message));
        redisClient.on('reconnecting', () => console.log('Redis client reconnecting...'));

        await redisClient.connect();
        await pubClient.connect();
        console.log('✅ Redis connected for Location Service');
    } catch (err) {
        console.error('❌ Redis init failed:', err.message);
        redisClient = null;
        pubClient = null;
    } finally {
        _connecting = false;
    }
};

const _ensureRedis = async () => {
    if (!redisClient || !redisClient.isOpen) await initRedis();
    if (!redisClient || !redisClient.isOpen) throw new Error('Redis unavailable');
};

const updateLocation = async (userId, role, lat, lng, name) => {
    await _ensureRedis();

    const timestamp = Date.now();
    const userKey = `user:${userId}`;
    const roleKey = `active:${role}s`; // e.g. active:citizens, active:volunteers, active:coordinators

    const geoData = { longitude: parseFloat(lng), latitude: parseFloat(lat), member: userKey };

    // 1. GEOADD to global set
    await redisClient.geoAdd('live:locations', geoData);
    await redisClient.zAdd('live:locations:timestamps', { score: timestamp, value: userKey });

    // 2. GEOADD to role-specific set
    await redisClient.geoAdd(roleKey, geoData);
    await redisClient.zAdd(`${roleKey}:timestamps`, { score: timestamp, value: userKey });

    const payload = JSON.stringify({ userId, role, lat: parseFloat(lat), lng: parseFloat(lng), name: name || '', timestamp });

    // 3. Store full data with TTL for easy list retrieval
    await redisClient.set(`location:${userId}`, payload, { EX: LOCATION_TTL });

    // 4. Publish to Pub/Sub channel
    await pubClient.publish(CHANNEL_NAME, payload);

    // Probabilistic cleanup (~10% of requests)
    if (Math.random() < 0.1) {
        cleanupOldLocations().catch(console.error);
    }
};

const cleanupOldLocations = async () => {
    if (!redisClient || !redisClient.isOpen) return;

    const expiredTs = Date.now() - (LOCATION_TTL * 1000);
    const oldUsers = await redisClient.zRangeByScore('live:locations:timestamps', 0, expiredTs);

    if (oldUsers && oldUsers.length > 0) {
        const roleSets = ['live:locations', 'active:citizens', 'active:volunteers', 'active:coordinators'];
        for (const set of roleSets) {
            await redisClient.zRem(set, oldUsers).catch(() => { });
            await redisClient.zRem(`${set}:timestamps`, oldUsers).catch(() => { });
        }
    }
};

const getNearbyUsers = async (lat, lng, radiusKm) => {
    await _ensureRedis();
    try {
        const results = await redisClient.geoSearchWith(
            'live:locations',
            { latitude: parseFloat(lat), longitude: parseFloat(lng) },
            { radius: parseFloat(radiusKm), unit: 'km' },
            ['WITHCOORD', 'WITHDIST']
        );

        // Enrich with stored data (name, role)
        const enriched = [];
        for (const r of results) {
            const uid = r.member.replace('user:', '');
            let extra = {};
            try {
                const raw = await redisClient.get(`location:${uid}`);
                if (raw) extra = JSON.parse(raw);
            } catch (_) { }
            enriched.push({
                userId: uid,
                role: extra.role || 'unknown',
                name: extra.name || '',
                lat: r.coordinates.latitude,
                lng: r.coordinates.longitude,
                distance: r.distance,
                timestamp: extra.timestamp || null,
            });
        }
        return enriched;
    } catch (err) {
        console.error('Error in getNearbyUsers:', err.message);
        return [];
    }
};

const getAllActiveLocations = async () => {
    await _ensureRedis();
    const keys = await redisClient.keys('location:*');
    if (!keys || keys.length === 0) return [];

    const values = await redisClient.mGet(keys);
    return values.map(v => { try { return JSON.parse(v); } catch (_) { return null; } }).filter(Boolean);
};

const getLocationsByRole = async (role) => {
    const all = await getAllActiveLocations();
    return all.filter(l => l.role === role);
};

const getRedisClient = () => redisClient;

module.exports = {
    initRedis,
    updateLocation,
    getNearbyUsers,
    getAllActiveLocations,
    getLocationsByRole,
    getRedisClient,
};
