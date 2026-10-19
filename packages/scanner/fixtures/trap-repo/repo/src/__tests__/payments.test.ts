import Stripe from "stripe";
import { Pool } from "pg";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await fetch("https://api.sendgrid.com/v3/mail/send");
