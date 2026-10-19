import Redis from "ioredis";
const r = new Redis(process.env.REDIS_URL);
