
const { Client } = require('pg');

const projectRef = 'kzxjhjkauvsoipvlusjo';
const password = 'sahyog876737';

const configs = [
    {
        name: 'Global Pooler (pooler.supabase.com)',
        connectionString: `postgresql://postgres.${projectRef}:${password}@pooler.supabase.com:6543/postgres`
    },
    {
        name: 'Global Pooler Session (pooler.supabase.com:5432)',
        connectionString: `postgresql://postgres.${projectRef}:${password}@pooler.supabase.com:5432/postgres`
    }
];

async function testAll() {
    console.log('Testing Global Pooler...');

    for (const config of configs) {
        console.log(`\nTesting: ${config.name}`);
        const client = new Client({
            connectionString: config.connectionString,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000,
        });

        try {
            await client.connect();
            console.log('✅ SUCCESS! Working configuration found.');
            console.log('--------------------------------------------------');
            console.log(`DATABASE_URL=${config.connectionString}`);
            console.log('--------------------------------------------------');
            await client.end();
            process.exit(0);
        } catch (err) {
            console.log(`❌ Failed: ${err.message}`);
            await client.end().catch(() => { });
        }
    }
    console.log('\n❌ All attempts failed.');
}

testAll();
