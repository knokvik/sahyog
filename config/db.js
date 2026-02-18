const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in environment');
}

const pool = new Pool({
  connectionString,
  // Allow SSL in production environments like Render/Heroku
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

const query = (text, params) => {
  return pool.query(text, params);
};

module.exports = {
  pool,
  query,
};

