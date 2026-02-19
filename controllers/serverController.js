const os = require('os');
const db = require('../config/db');

const getServerStats = async (req, res) => {
    try {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const loadAvg = os.loadavg();

        const procMem = process.memoryUsage();

        let dbStats = { connected: false, totalUsers: 0 };
        try {
            const result = await db.query('SELECT COUNT(*)::int AS count FROM users');
            dbStats = { connected: true, totalUsers: result.rows[0]?.count || 0 };
        } catch (dbErr) {
            console.error('[serverStats] DB query failed:', dbErr?.message);
            dbStats = { connected: false, totalUsers: 0, error: dbErr?.message };
        }

        res.json({
            cpu: {
                count: cpus.length,
                model: cpus[0]?.model || 'Unknown',
                loadAvg: {
                    '1m': parseFloat(loadAvg[0].toFixed(2)),
                    '5m': parseFloat(loadAvg[1].toFixed(2)),
                    '15m': parseFloat(loadAvg[2].toFixed(2)),
                },
                usagePercent: parseFloat(
                    (
                        cpus.reduce((acc, cpu) => {
                            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
                            const idle = cpu.times.idle;
                            return acc + ((total - idle) / total) * 100;
                        }, 0) / cpus.length
                    ).toFixed(1)
                ),
            },
            memory: {
                totalMB: Math.round(totalMem / 1024 / 1024),
                freeMB: Math.round(freeMem / 1024 / 1024),
                usedMB: Math.round(usedMem / 1024 / 1024),
                usagePercent: parseFloat(((usedMem / totalMem) * 100).toFixed(1)),
            },
            process: {
                heapUsedMB: Math.round(procMem.heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(procMem.heapTotal / 1024 / 1024),
                rssMB: Math.round(procMem.rss / 1024 / 1024),
                uptimeSeconds: Math.round(process.uptime()),
            },
            system: {
                platform: os.platform(),
                arch: os.arch(),
                hostname: os.hostname(),
                uptimeSeconds: Math.round(os.uptime()),
                nodeVersion: process.version,
            },
            db: dbStats,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[500] Server stats error:', err?.message || err);
        res.status(500).json({ message: 'Failed to collect server stats', error: err?.message });
    }
};

module.exports = { getServerStats };
