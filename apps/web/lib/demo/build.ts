/**
 * Builds the demo dataset: a small fintech ("acme/shop") evolving over six revisions. Each revision
 * is a real repository tree that is written to a temp dir and scanned by the real scanner, so the
 * demo shows exactly what Trailmap produces. Run `npm run demo:build` to regenerate
 * `demo-data.json`; a test fails if the committed file is out of date.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scan } from "@trailmap/scanner";
import type { DependencyGraph } from "@trailmap/graph";

type Files = Record<string, string>;

const SERVICE_PKG = (name: string, deps: Record<string, string>) =>
  JSON.stringify({ name: `@shop/${name}`, scripts: { start: "node dist/index.js" }, dependencies: { express: "^4.19.0", ...deps } }, null, 2) + "\n";

const compose = (extraPayments: string[] = [], extraOrders: string[] = [], extraServices = "") => `services:
  gateway:
    build: ./services/gateway
    ports:
      - "3000:3000"
    environment:
      ORDERS_URL: http://orders:3001
      PAYMENTS_URL: http://payments:3002
  orders:
    build: ./services/orders
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/orders
      PAYMENTS_URL: http://payments:3002
${extraOrders.map((l) => `      ${l}`).join("\n")}${extraOrders.length ? "\n" : ""}  payments:
    build: ./services/payments
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/payments
${extraPayments.map((l) => `      ${l}`).join("\n")}${extraPayments.length ? "\n" : ""}  db:
    image: postgres:15
${extraServices}`;

const BASE: Files = {
  "package.json": JSON.stringify({ name: "shop", private: true, workspaces: ["services/*"] }, null, 2) + "\n",
  "docker-compose.yml": compose(),
  "services/gateway/package.json": SERVICE_PKG("gateway", {}),
  "services/gateway/Dockerfile": "FROM node:20\nEXPOSE 3000\n",
  "services/gateway/src/index.ts": `import express from "express";

const app = express();

app.get("/orders", async (_req, res) => {
  const r = await fetch(process.env.ORDERS_URL + "/orders");
  res.json(await r.json());
});

app.get("/health", async (_req, res) => {
  const r = await fetch(\`\${process.env.PAYMENTS_URL}/health\`);
  res.status(r.status).end();
});

app.listen(3000);
`,
  "services/orders/package.json": SERVICE_PKG("orders", { pg: "^8.11.0" }),
  "services/orders/Dockerfile": "FROM node:20\nEXPOSE 3001\n",
  "services/orders/src/index.ts": `import express from "express";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post("/orders", async (req, res) => {
  const { rows } = await pool.query("insert into orders(total) values($1) returning id", [req.body.total]);
  await fetch(process.env.PAYMENTS_URL + "/charge", { method: "POST", body: JSON.stringify({ order: rows[0].id }) });
  res.json(rows[0]);
});

app.listen(3001);
`,
  "services/payments/package.json": SERVICE_PKG("payments", { pg: "^8.11.0" }),
  "services/payments/Dockerfile": "FROM node:20\nEXPOSE 3002\n",
  "services/payments/src/index.ts": `import express from "express";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post("/charge", async (req, res) => {
  await pool.query("insert into payments(order_id, amount) values($1, $2)", [req.body.order, req.body.amount]);
  res.json({ ok: true });
});

app.listen(3002);
`,
  "services/payments/migrations/001_init.sql": `CREATE TABLE payments (
  id serial PRIMARY KEY,
  order_id integer NOT NULL,
  amount integer NOT NULL
);
`,
};

const PAYMENTS_STRIPE = `import express from "express";
import { Pool } from "pg";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post("/charge", async (req, res) => {
  const intent = await stripe.paymentIntents.create({ amount: req.body.amount, currency: "usd" });
  await pool.query("insert into payments(order_id, intent_id) values($1, $2)", [req.body.order, intent.id]);
  res.json({ ok: true });
});

app.listen(3002);
`;

const PAYMENTS_SEGMENT = `import express from "express";
import { Pool } from "pg";
import Stripe from "stripe";
import { Analytics } from "@segment/analytics-node";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const analytics = new Analytics({ writeKey: process.env.SEGMENT_WRITE_KEY as string });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();

app.post("/charge", async (req, res) => {
  const intent = await stripe.paymentIntents.create({ amount: req.body.amount, currency: "usd" });
  await pool.query("insert into payments(order_id, intent_id) values($1, $2)", [req.body.order, intent.id]);
  analytics.identify({ userId: req.body.user, traits: { email: req.body.email } });
  res.json({ ok: true });
});

app.listen(3002);
`;

const CUSTOMERS_SQL = `CREATE TABLE payments (
  id serial PRIMARY KEY,
  order_id integer NOT NULL,
  intent_id text
);

CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text NOT NULL,
  phone_number text
);

CREATE TABLE payment_methods (
  id serial PRIMARY KEY,
  customer_id integer REFERENCES customers(id),
  card_number text
);
`;

const TERRAFORM = (publicDb: boolean) => `provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "private_a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
}

resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "db"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
${publicDb ? '    cidr_blocks = ["0.0.0.0/0"]' : "    security_groups = [aws_security_group.web.id]"}
  }
}

resource "aws_lb" "web" {
  name               = "web"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.web.id]
  subnets            = [aws_subnet.public_a.id]
}

resource "aws_lb_target_group" "gateway" {
  name     = "gateway"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }
}

resource "aws_db_instance" "main" {
  identifier             = "shop-db"
  engine                 = "postgres"
  instance_class         = "db.t3.micro"
  publicly_accessible    = ${publicDb}
  vpc_security_group_ids = [aws_security_group.db.id]
}

resource "aws_s3_bucket" "statements" {
  bucket = "acme-statements"
}

resource "aws_ecs_task_definition" "gateway" {
  family = "gateway"
  container_definitions = jsonencode([
    {
      name  = "gateway"
      image = "acme/gateway:latest"
      environment = [
        { name = "DB_HOST", value = aws_db_instance.main.address },
        { name = "STATEMENTS_BUCKET", value = aws_s3_bucket.statements.id },
      ]
    }
  ])
}

resource "aws_ecs_service" "gateway" {
  name            = "gateway"
  task_definition = aws_ecs_task_definition.gateway.arn

  load_balancer {
    target_group_arn = aws_lb_target_group.gateway.arn
    container_name   = "gateway"
    container_port   = 3000
  }
}
`;

const ORDERS_KAFKA_TWILIO = `import express from "express";
import { Pool } from "pg";
import { Kafka } from "kafkajs";
import twilio from "twilio";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const kafka = new Kafka({ brokers: [process.env.KAFKA_BROKERS as string] });
const producer = kafka.producer();
const sms = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const app = express();

app.post("/orders", async (req, res) => {
  const { rows } = await pool.query("insert into orders(total) values($1) returning id", [req.body.total]);
  await producer.send({ topic: "orders.created", messages: [{ value: JSON.stringify(rows[0]) }] });
  await sms.messages.create({ to: req.body.phone, from: process.env.TWILIO_PHONE_NUMBER, body: "Order received" });
  res.json(rows[0]);
});

app.listen(3001);
`;

const PAYMENTS_KAFKA = PAYMENTS_SEGMENT.replace('import Stripe from "stripe";', 'import Stripe from "stripe";\nimport { Kafka } from "kafkajs";').replace("const app = express();", 'const consumer = new Kafka({ brokers: [process.env.KAFKA_BROKERS as string] }).consumer({ groupId: "payments" });\nconst app = express();');

const POLICY = `version: 1
on_drift: failure
scopes:
  - name: PCI cardholder data environment
    nodes: ["service:services/payments", "db:postgres"]
`;

function revisions(): Array<{ label: string; date: string; commit: string; files: Files }> {
  const withStripe: Files = { ...BASE, "services/payments/src/index.ts": PAYMENTS_STRIPE, "services/payments/package.json": SERVICE_PKG("payments", { pg: "^8.11.0", stripe: "^14.0.0" }), "docker-compose.yml": compose(["STRIPE_SECRET_KEY: sk_test_placeholder"]) };
  const withSegment: Files = {
    ...withStripe,
    "services/payments/src/index.ts": PAYMENTS_SEGMENT,
    "services/payments/package.json": SERVICE_PKG("payments", { pg: "^8.11.0", stripe: "^14.0.0", "@segment/analytics-node": "^1.1.0" }),
    "services/payments/migrations/001_init.sql": CUSTOMERS_SQL,
    "docker-compose.yml": compose(["STRIPE_SECRET_KEY: sk_test_placeholder", "SEGMENT_WRITE_KEY: wk_placeholder"]),
  };
  const withInfra: Files = { ...withSegment, "infra/main.tf": TERRAFORM(false) };
  const withEvents: Files = {
    ...withInfra,
    "services/orders/src/index.ts": ORDERS_KAFKA_TWILIO,
    "services/orders/package.json": SERVICE_PKG("orders", { pg: "^8.11.0", kafkajs: "^2.2.4", twilio: "^5.0.0" }),
    "services/payments/src/index.ts": PAYMENTS_KAFKA,
    "services/payments/package.json": SERVICE_PKG("payments", { pg: "^8.11.0", stripe: "^14.0.0", "@segment/analytics-node": "^1.1.0", kafkajs: "^2.2.4" }),
    "docker-compose.yml": compose(["STRIPE_SECRET_KEY: sk_test_placeholder", "SEGMENT_WRITE_KEY: wk_placeholder", "KAFKA_BROKERS: kafka:9092"], ["KAFKA_BROKERS: kafka:9092", "TWILIO_ACCOUNT_SID: ACplaceholder"], "  kafka:\n    image: confluentinc/cp-kafka:7.6.0\n"),
    ".trailmap.yml": POLICY,
  };
  const exposed: Files = { ...withEvents, "infra/main.tf": TERRAFORM(true) };
  return [
    { label: "Rev A", date: "2026-01-12T09:00:00.000Z", commit: "a1f3c09b7d52", files: BASE },
    { label: "Rev B", date: "2026-02-16T09:00:00.000Z", commit: "b27d4e18c9a0", files: withStripe },
    { label: "Rev C", date: "2026-03-23T09:00:00.000Z", commit: "c39e5f29d0b1", files: withSegment },
    { label: "Rev D", date: "2026-04-20T09:00:00.000Z", commit: "d4a06f3ae1c2", files: withInfra },
    { label: "Rev E", date: "2026-05-25T09:00:00.000Z", commit: "e5b17a4bf2d3", files: withEvents },
    { label: "Rev F", date: "2026-06-29T09:00:00.000Z", commit: "f6c28b5c03e4", files: exposed },
  ];
}

async function scanFiles(files: Files, date: string): Promise<DependencyGraph> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trailmap-demo-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return await scan({ rootDir: dir, repoName: "acme/shop", scannedAt: date });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface DemoData {
  repo: { fullName: string; defaultBranch: string };
  revisions: Array<{ label: string; date: string; commit: string; graph: DependencyGraph }>;
  scope: { name: string; nodeIds: string[] };
  /** The head graph of a pull request that adds an analytics vendor and opens the database to the internet. */
  pullRequest: { number: number; title: string; headSha: string; graph: DependencyGraph };
  vendorMeta: Array<{ vendorId: string; purpose: string; region: string; dpaOnFile: boolean }>;
  policy: string;
}

/** The repository tree of each revision, for tools that need to "clone" the demo repository. */
export function demoRevisionFiles(): Array<{ label: string; date: string; commit: string; files: Files }> {
  return revisions();
}

/** The tree of pull request #12: the current revision plus an analytics vendor. */
export function demoPullRequestFiles(): Files {
  const current = revisions().at(-1)!;
  return {
    ...current.files,
    "services/gateway/src/index.ts": `import express from "express";
import mixpanel from "mixpanel";

const tracker = mixpanel.init(process.env.MIXPANEL_TOKEN as string);
const app = express();

app.get("/orders", async (req, res) => {
  tracker.track("orders.list", { email: req.query.email });
  const r = await fetch(process.env.ORDERS_URL + "/orders");
  res.json(await r.json());
});

app.listen(3000);
`,
    "services/gateway/package.json": SERVICE_PKG("gateway", { mixpanel: "^0.18.0" }),
    "docker-compose.yml": compose(["STRIPE_SECRET_KEY: sk_test_placeholder", "SEGMENT_WRITE_KEY: wk_placeholder", "KAFKA_BROKERS: kafka:9092"], ["KAFKA_BROKERS: kafka:9092", "TWILIO_ACCOUNT_SID: ACplaceholder"], "  kafka:\n    image: confluentinc/cp-kafka:7.6.0\n").replace("      PAYMENTS_URL: http://payments:3002\n  orders:", "      PAYMENTS_URL: http://payments:3002\n      MIXPANEL_TOKEN: mp_placeholder\n  orders:"),
  };
}

export async function buildDemoData(): Promise<DemoData> {
  const revs = [];
  for (const r of revisions()) revs.push({ label: r.label, date: r.date, commit: r.commit, graph: await scanFiles(r.files, r.date) });
  const prFiles = demoPullRequestFiles();
  return {
    repo: { fullName: "acme/shop", defaultBranch: "main" },
    revisions: revs,
    scope: { name: "PCI cardholder data environment", nodeIds: ["service:services/payments", "db:postgres"] },
    pullRequest: { number: 12, title: "Track order list views in Mixpanel", headSha: "9c1d2e3f4a5b", graph: await scanFiles(prFiles, "2026-07-02T09:00:00.000Z") },
    vendorMeta: [
      { vendorId: "stripe", purpose: "Card payments and refunds", region: "US", dpaOnFile: true },
      { vendorId: "segment", purpose: "Product analytics", region: "US", dpaOnFile: true },
      { vendorId: "twilio", purpose: "Order SMS notifications", region: "US", dpaOnFile: false },
    ],
    policy: POLICY,
  };
}
