import type { LocalDb, Role } from "./db.js";

/**
 * A tiny supabase-js look-alike that runs against the pglite test database, so route
 * handlers can be exercised with real row-level security. It supports only what the
 * app uses: from().select/insert/update/upsert + eq/in/not/order/limit + single/maybeSingle,
 * rpc(), and auth.getUser().
 */

type Filter = { col: string; op: "=" | "in" | "not in" | "is" | "<" | "@>"; val: unknown };
type Result = { data: unknown; error: { message: string } | null };

class Query implements PromiseLike<Result> {
  private mode: "select" | "insert" | "update" | "upsert" = "select";
  private cols = "*";
  private filters: Filter[] = [];
  private orderBy?: { col: string; asc: boolean };
  private limitN?: number;
  private payload: Record<string, unknown> = {};
  private conflict?: string;
  private returning = false;
  private singleMode: "none" | "one" | "maybe" = "none";

  constructor(
    private readonly client: PgClient,
    private readonly table: string
  ) {}

  select(cols = "*") {
    this.cols = cols;
    if (this.mode !== "select") this.returning = true;
    return this;
  }
  insert(row: Record<string, unknown>) {
    this.mode = "insert";
    this.payload = row;
    return this;
  }
  update(row: Record<string, unknown>) {
    this.mode = "update";
    this.payload = row;
    return this;
  }
  upsert(row: Record<string, unknown>, opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = row;
    this.conflict = opts?.onConflict;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ col, op: "=", val });
    return this;
  }
  in(col: string, val: unknown[]) {
    this.filters.push({ col, op: "in", val });
    return this;
  }
  contains(col: string, val: unknown) {
    this.filters.push({ col, op: "@>", val: JSON.stringify(val) });
    return this;
  }
  lt(col: string, val: unknown) {
    this.filters.push({ col, op: "<", val });
    return this;
  }
  is(col: string, val: null) {
    this.filters.push({ col, op: "is", val });
    return this;
  }
  not(col: string, _op: string, val: string) {
    this.filters.push({ col, op: "not in", val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ col, op: "not in", val: `(${String(val)})` });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  /** Mirrors supabase-js: single() errors unless exactly one row comes back. */
  single() {
    this.singleMode = "one";
    return this;
  }

  private returnCols(): string {
    return this.returning ? this.cols : "id";
  }

  private whereSql(params: unknown[]): string {
    const parts = this.filters.map((f) => {
      if (f.op === "=") {
        params.push(f.val);
        return `"${f.col}" = $${params.length}`;
      }
      if (f.op === "is") return `"${f.col}" IS NULL`;
      if (f.op === "@>") {
        params.push(f.val);
        return `"${f.col}" @> $${params.length}::jsonb`;
      }
      if (f.op === "<") {
        params.push(f.val);
        return `"${f.col}" < $${params.length}`;
      }
      if (f.op === "in") {
        params.push(f.val);
        return `"${f.col}" = ANY($${params.length})`;
      }
      return `"${f.col}" NOT IN ${f.val as string}`;
    });
    return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
  }

  private build(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    // supabase-js sends objects and arrays in a payload as JSON.
    const jsonable = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);
    const keys = Object.keys(this.payload);

    if (this.mode === "select") {
      const where = this.whereSql(params);
      const ord = this.orderBy ? ` ORDER BY "${this.orderBy.col}" ${this.orderBy.asc ? "ASC" : "DESC"}` : "";
      const lim = this.limitN ? ` LIMIT ${this.limitN}` : "";
      return { sql: `SELECT ${this.cols} FROM ${this.table}${where}${ord}${lim}`, params };
    }

    if (this.mode === "update") {
      const sets = keys.map((k) => {
        params.push(jsonable(this.payload[k]));
        return `"${k}" = $${params.length}`;
      });
      const where = this.whereSql(params);
      return { sql: `UPDATE ${this.table} SET ${sets.join(", ")}${where} RETURNING ${this.returnCols()}`, params };
    }

    const placeholders = keys.map((k) => {
      params.push(jsonable(this.payload[k]));
      return `$${params.length}`;
    });
    let sql = `INSERT INTO ${this.table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${placeholders.join(", ")})`;
    if (this.mode === "upsert" && this.conflict) {
      const conflictCols = this.conflict.split(",");
      const sets = keys
        .filter((k) => !conflictCols.includes(k))
        .map((k) => `"${k}" = EXCLUDED."${k}"`)
        .join(", ");
      sql += ` ON CONFLICT (${this.conflict}) DO UPDATE SET ${sets}`;
    }
    return { sql: `${sql} RETURNING ${this.returnCols()}`, params };
  }

  private async run(): Promise<Result> {
    try {
      const { sql, params } = this.build();
      const rows = await this.client.db.as<Record<string, unknown>>(
        this.client.role,
        this.client.userId,
        sql,
        params
      );
      const wantsRows = this.mode === "select" || this.returning;
      if (this.singleMode !== "none") {
        if (rows.length > 1 || (this.singleMode === "one" && rows.length === 0)) {
          return { data: null, error: { message: "single row expected" } };
        }
        return { data: wantsRows ? (rows[0] ?? null) : null, error: null };
      }
      return { data: wantsRows ? rows : null, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export class PgClient {
  constructor(
    readonly db: LocalDb,
    readonly role: Role,
    readonly userId: string | null
  ) {}

  from(table: string) {
    return new Query(this, table);
  }

  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<Result> {
    try {
      const names = Object.keys(args);
      const sql = `SELECT * FROM ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
      const rows = await this.db.as<Record<string, unknown>>(this.role, this.userId, sql, names.map((n) => args[n]));
      // supabase-js returns the bare value for a function that returns a single scalar.
      const only = rows.length === 1 ? Object.keys(rows[0]!) : [];
      if (only.length === 1 && only[0] === fn) return { data: rows[0]![fn], error: null };
      return { data: rows, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  auth = {
    getUser: async () => {
      if (!this.userId) return { data: { user: null } };
      const rows = await this.db.admin<{ email: string }>(`SELECT email FROM auth.users WHERE id = $1`, [this.userId]);
      return { data: { user: { id: this.userId, email: rows[0]?.email, user_metadata: {} } } };
    },
  };
}

export const userClient = (db: LocalDb, userId: string) => new PgClient(db, "authenticated", userId);
export const anonClient = (db: LocalDb) => new PgClient(db, "anon", null);
export const adminClient = (db: LocalDb) => new PgClient(db, "service_role", null);
