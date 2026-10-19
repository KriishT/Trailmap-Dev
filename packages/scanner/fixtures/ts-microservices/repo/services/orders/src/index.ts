import express from "express";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post("/orders", async (req, res) => {
  const { rows } = await pool.query("insert into orders(total) values($1) returning id", [req.body.total]);
  await fetch(process.env.PAYMENTS_URL + "/charge", { method: "POST", body: JSON.stringify({ order: rows[0].id }) });
  res.json(rows[0]);
});

app.listen(3001);
