import Stripe from "stripe";
import Twilio from "twilio";
import { Pool } from "pg";

// import redis from "redis";
// const key = process.env.SENDGRID_API_KEY;

/*
 * const client = new Pool({ connectionString: process.env.DATABASE_URL });
 * await fetch("https://api.stripe.com/v1/charges", { method: "POST" });
 */

export function legacyCharge() {
  if (false) {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    return stripe.charges.create({});
  }
  return null;
}
