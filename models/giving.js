const pool = require("../db");

const INSERT_QUERY = `INSERT INTO confgive (name, amount, currency, date, phone_number, email, receipt, paymentType, upload, receiptName, nationalid, company, taxid, note, campus, tp_trade_id, is_success, env, imported, siyuan_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, COALESCE($21, NOW()))`;

function buildInsertParams({
  name,
  amount,
  currency,
  date,
  phoneNumber,
  email,
  receipt,
  paymentType,
  upload,
  receiptName,
  nationalid,
  company,
  taxid,
  note,
  campus,
  tpTradeID,
  isSuccess,
  env,
  imported = false,
  siyuanId = null,
  createdAt = null,
}) {
  return [
    name,
    amount,
    currency,
    date,
    phoneNumber,
    email,
    receipt,
    paymentType,
    upload,
    receiptName,
    nationalid,
    company,
    taxid,
    note,
    campus,
    tpTradeID,
    isSuccess,
    env,
    imported,
    siyuanId,
    createdAt,
  ];
}

const givingModel = {
  add: async (
    name,
    amount,
    currency,
    date,
    phone_number,
    email,
    receipt,
    paymentType,
    upload,
    receiptName,
    nationalid,
    company,
    taxid,
    note,
    campus,
    tpTradeID,
    isSuccess,
    env,
    imported = false,
    siyuanId = null,
    createdAt = null
  ) => {
    try {
      await pool.query(
        INSERT_QUERY,
        buildInsertParams({
          name,
          amount,
          currency,
          date,
          phoneNumber: phone_number,
          email,
          receipt,
          paymentType,
          upload,
          receiptName,
          nationalid,
          company,
          taxid,
          note,
          campus,
          tpTradeID,
          isSuccess,
          env,
          imported,
          siyuanId,
          createdAt,
        })
      );
      console.log("Data inserted with success");
    } catch (err) {
      console.error("Error executing query in givingModel.add:", err);
      throw err;
    }
  },
  bulkInsertImported: async (records = []) => {
    if (!Array.isArray(records) || records.length === 0) {
      return { inserted: 0 };
    }

    const client = await pool.connect();
    let inserted = 0;
    let deleted = 0;
    try {
      await client.query("BEGIN");
      const deleteResult = await client.query(
        "DELETE FROM confgive WHERE upload = $1",
        ["siyuan_csv"]
      );
      deleted = deleteResult.rowCount || 0;

      for (const record of records) {
        await client.query(INSERT_QUERY, buildInsertParams(record));
        inserted += 1;
      }
      await client.query("COMMIT");
      return { inserted, deleted };
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(
        "Error executing bulk insert in givingModel.bulkInsertImported:",
        err
      );
      throw err;
    } finally {
      client.release();
    }
  },
  get: async (lastRowID) => {
    try {
      const res = await pool.query(
        "SELECT * FROM confgive WHERE id > $1 AND env = 'production' AND amount >= 1 ORDER BY id",
        [lastRowID]
      );
      return res.rows;
    } catch (e) {
      console.log(e);
      throw e;
    }
  },
  getAll: async () => {
    try {
      const res = await pool.query(
        "SELECT * FROM confgive WHERE env = 'production' AND is_success = true ORDER BY date ASC"
      );
      return res.rows;
    } catch (e) {
      console.log(e);
      throw e;
    }
  },
};

module.exports = givingModel;
