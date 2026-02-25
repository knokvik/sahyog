const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set in environment');
}

const pool = new Pool({
  connectionString,
  // Allow SSL in production environments if configured via DB_SSL env var
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

/**
 * Execute a single query
 */
const query = (text, params) => {
  return pool.query(text, params);
};

/**
 * Get a client from the pool for transactions
 */
const getClient = () => {
  return pool.connect();
};

/**
 * Execute multiple queries in a transaction
 * @param {Function} callback - async function receiving (client) that performs queries
 * @returns {Promise<any>} - Result from callback
 * 
 * Usage:
 * const result = await db.transaction(async (client) => {
 *   await client.query('INSERT INTO ...', [...]);
 *   await client.query('UPDATE ...', [...]);
 *   return { success: true };
 * });
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  query,
  getClient,
  transaction,
};

