
const { Client } = require('pg');

const projectRef = 'kzxjhjkauvsoipvlusjo';
const password = 'sahyog876737';

const regions = ['ap-south-1', 'ap-southeast-1', 'us-east-1', 'us-west-1', 'eu-central-1', 'eu-west-1', 'ap-northeast-1'];
const configs = [
    {
        name: 'Direct Supabase DB (db.kzxjhjkauvsoipvlusjo.supabase.co:5432)',
        connectionString: `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres`
    },
    ...regions.flatMap(r => [
        {
            name: `Pooler Transaction (${r}:6543)`,
            connectionString: `postgresql://postgres.${projectRef}:${password}@aws-0-${r}.pooler.supabase.com:6543/postgres`
        },
        {
            name: `Pooler Session (${r}:5432)`,
            connectionString: `postgresql://postgres.${projectRef}:${password}@aws-0-${r}.pooler.supabase.com:5432/postgres`
        }
    ])
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
