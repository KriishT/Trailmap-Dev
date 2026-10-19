import express from "express";

const app = express();

app.get("/orders", async (_req, res) => {
  const r = await fetch(process.env.ORDERS_URL + "/orders");
  res.json(await r.json());
});

app.get("/health", async (_req, res) => {
  const r = await fetch(`${process.env.PAYMENTS_URL}/health`);
  res.status(r.status).end();
});

app.listen(3000);
