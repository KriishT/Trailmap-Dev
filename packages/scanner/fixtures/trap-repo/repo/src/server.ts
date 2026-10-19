import express from "express";
import { classify } from "./patterns";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, kind: classify("hello") });
});

app.listen(4000);
