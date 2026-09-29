const pool = require("../db");

const statsEventModel = {
  getAll: async () => {
    const result = await pool.query(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, created_at, updated_at
       FROM stats_events
       ORDER BY end_date DESC, start_date DESC, id DESC`
    );
    return result.rows;
  },

  create: async ({ name, startDate, endDate }) => {
    const result = await pool.query(
      `INSERT INTO stats_events (name, start_date, end_date)
       VALUES ($1, $2, $3)
       RETURNING id, name, start_date::text AS start_date, end_date::text AS end_date, created_at, updated_at`,
      [name, startDate, endDate]
    );
    return result.rows[0];
  },

  deleteById: async (id) => {
    const result = await pool.query(
      "DELETE FROM stats_events WHERE id = $1 RETURNING id",
      [id]
    );
    return result.rowCount === 1;
  },
};

module.exports = statsEventModel;
