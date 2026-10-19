import express from "express";
import { Pool } from "pg";
import Stripe from "stripe";
import { Analytics } from "@segment/analytics-node";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const analytics = new Analytics({ writeKey: process.env.SEGMENT_WRITE_KEY as string });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post("/charge", async (req, res) => {
  const intent = await stripe.paymentIntents.create({ amount: req.body.amount, currency: "usd" });
  await pool.query("insert into payments(intent_id) values($1)", [intent.id]);
  analytics.identify({ userId: req.body.user, traits: { email: req.body.email } });
  res.json({ ok: true });
});

app.listen(3002);
