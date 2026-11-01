const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  socketPath: process.env.DB_SOCKET || '/var/run/mysqld/mysqld.sock',
  user: process.env.DB_USER || 'cs_wkr',
  password: process.env.DB_PASSWORD || 'wkr_password',
  database: process.env.DB_NAME || 'classicmodels',
  waitForConnections: true,
  connectionLimit: 5,
  dateStrings: ['DATE'],
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

module.exports = { pool, query };
