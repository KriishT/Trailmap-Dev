import type { DataClass } from "@trailmap/graph";
import { tokenize, langForFile, type Lang, type Token } from "./tokenize.js";
import { maskDeadBlocks } from "./extract.js";

/** A column / model field found in a schema, ORM model or API schema. */
export interface SchemaField {
  entity: string;
  field: string;
  file: string;
  line: number;
  /** Declared type (Django `EmailField`, SQL `varchar`, ...), when known. */
  typeHint?: string;
  /** Datastore engine this schema is for, when the file says so (Prisma provider, Rails adapter). */
  engine?: string;
}

// ---- field name classification -------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const PAN_EXACT = new Set(["pan", "cvv", "cvc", "cvv2", "cvc2"]);
const PAN_SUBSTR = ["cardnumber", "creditcard", "ccnumber", "ccnum", "cardno", "primaryaccount", "pannumber", "debitcard"];
const PHI_SUBSTR = ["diagnos", "medicalrecord", "patientid", "patientname", "prescription", "medication", "icd10", "healthcondition", "treatment", "allerg", "bloodtype", "healthinsurance"];
const CRED_EXACT = new Set(["secret", "salt", "token", "passwd", "pwd"]);
const CRED_SUBSTR = ["password", "passhash", "pwdhash", "apikey", "secretkey", "clientsecret", "accesstoken", "refreshtoken", "authtoken", "sessiontoken", "privatekey", "otpsecret", "mfasecret"];
const PII_EXACT = new Set(["ssn", "dob", "address", "street", "zip", "phone", "email", "gender", "birthday"]);
const PII_SUBSTR = [
  "email", "phonenumber", "mobilenumber", "ssn", "socialsecurity", "dateofbirth", "birthdate", "firstname", "lastname",
  "fullname", "streetaddress", "homeaddress", "billingaddress", "shippingaddress", "postalcode", "zipcode",
  "passport", "driverslicense", "drivinglicense", "taxid", "nationalid", "ipaddress", "givenname", "familyname",
];

const TYPE_HINTS: Record<string, DataClass> = {
  emailfield: "PII",
  phonenumberfield: "PII",
  genericipaddressfield: "PII",
};

export function classifyField(field: string, typeHint?: string): DataClass | null {
  const n = norm(field);
  if (!n) return null;
  if (typeHint) {
    const h = TYPE_HINTS[norm(typeHint)];
    if (h) return h;
  }
  if (PAN_EXACT.has(n) || PAN_SUBSTR.some((s) => n.includes(s))) return "PAN";
  if (PHI_SUBSTR.some((s) => n.includes(s))) return "PHI";
  if (CRED_EXACT.has(n) || CRED_SUBSTR.some((s) => n.includes(s))) return "CREDENTIALS";
  if (PII_EXACT.has(n) || PII_SUBSTR.some((s) => n.includes(s))) return "PII";
  return null;
}

// ---- schema extraction -----------------------------------------------------------------

function lines(content: string): string[] {
  return content.split("\n");
}

function prismaFields(file: string, content: string): SchemaField[] {
  const out: SchemaField[] = [];
  const provider = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/.exec(content)?.[1];
  const engine =
    provider === "postgresql" || provider === "cockroachdb" ? "postgres"
    : provider === "mysql" ? "mysql"
    : provider === "sqlite" ? "sqlite"
    : provider === "sqlserver" ? "mssql"
    : provider === "mongodb" ? "mongodb"
    : undefined;
  let model: string | null = null;
  lines(content).forEach((raw, idx) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const open = /^model\s+(\w+)\s*\{/.exec(line);
    if (open) { model = open[1]!; return; }
    if (line === "}") { model = null; return; }
    if (!model || line.startsWith("@@")) return;
    const m = /^(\w+)\s+(\w+)/.exec(line);
    if (m) out.push({ entity: model, field: m[1]!, file, line: idx + 1, typeHint: m[2], engine });
  });
  return out;
}

function sqlFields(file: string, content: string): SchemaField[] {
  const out: SchemaField[] = [];
  const src = content.replace(/--.*$/gm, "");
  const offsets = lines(src);
  let table: string | null = null;
  let depth = 0;
  offsets.forEach((raw, idx) => {
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`[]?([\w.]+)["`\]]?\s*\(/i.exec(raw);
    if (create) { table = create[1]!; depth = 0; }
    const alter = /alter\s+table\s+["`[]?([\w.]+)["`\]]?\s+add\s+(?:column\s+)?["`[]?(\w+)["`\]]?\s+(\w+)/i.exec(raw);
    if (alter) out.push({ entity: alter[1]!, field: alter[2]!, file, line: idx + 1, typeHint: alter[3] });
    if (table) {
      for (const ch of raw) { if (ch === "(") depth++; else if (ch === ")") depth--; }
      const col = /^\s*["`[]?(\w+)["`\]]?\s+([A-Za-z]+)/.exec(create ? raw.slice(raw.indexOf("(") + 1) : raw);
      if (col && !/^(primary|foreign|unique|constraint|key|index|check|create)$/i.test(col[1]!)) {
        out.push({ entity: table, field: col[1]!, file, line: idx + 1, typeHint: col[2] });
      }
      if (depth <= 0 && !create) table = null;
      if (create && depth <= 0) table = null;
    }
  });
  return out;
}

function railsSchemaFields(file: string, content: string): SchemaField[] {
  const out: SchemaField[] = [];
  let table: string | null = null;
  lines(content).forEach((raw, idx) => {
    const line = raw.replace(/#.*$/, "");
    const t = /create_table\s+["'](\w+)["']/.exec(line);
    if (t) { table = t[1]!; return; }
    if (/^\s*end\b/.test(line)) { table = null; return; }
    const col = /^\s*t\.(\w+)\s+["'](\w+)["']/.exec(line);
    if (table && col) out.push({ entity: table, field: col[2]!, file, line: idx + 1, typeHint: col[1] });
  });
  return out;
}

function openApiFields(file: string, content: string): SchemaField[] {
  const out: SchemaField[] = [];
  const ls = lines(content);
  let schemaName: string | null = null;
  let inProps = false;
  let propIndent = -1;
  let inSchemas = false;
  for (let idx = 0; idx < ls.length; idx++) {
    const raw = ls[idx]!;
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (/^schemas\s*:/.test(trimmed)) { inSchemas = true; continue; }
    if (!inSchemas) continue;
    const schemaHead = /^"?([A-Za-z0-9_.-]+)"?\s*:\s*$/.exec(trimmed);
    if (schemaHead && indent === 4 && !inProps) schemaName = schemaHead[1]!;
    if (/^properties\s*:/.test(trimmed)) { inProps = true; propIndent = indent; continue; }
    if (inProps) {
      if (trimmed && indent <= propIndent) { inProps = false; continue; }
      const prop = /^"?([A-Za-z0-9_]+)"?\s*:\s*$/.exec(trimmed);
      if (prop && indent === propIndent + 2 && schemaName) out.push({ entity: schemaName, field: prop[1]!, file, line: idx + 1 });
    }
  }
  return out;
}

// Token-based extraction for code files ----------------------------------------------------

function tokenFields(file: string, lang: Lang, tokens: Token[]): SchemaField[] {
  const out: SchemaField[] = [];
  const n = tokens.length;
  const is = (i: number, v: string) => tokens[i]?.v === v && tokens[i]?.t === "p";
  const isId = (i: number, v?: string) => tokens[i]?.t === "id" && (v === undefined || tokens[i]!.v === v);

  if (lang === "py") {
    let cls: string | null = null;
    for (let i = 0; i < n; i++) {
      if (isId(i, "class") && isId(i + 1)) { cls = tokens[i + 1]!.v; continue; }
      // field = Column(...) | models.XField(...) | mapped_column(...)
      if (cls && isId(i) && is(i + 1, "=") && tokens[i]!.col > 0) {
        let j = i + 2;
        const chain: string[] = [];
        while (isId(j)) { chain.push(tokens[j]!.v); j++; if (is(j, ".")) j++; else break; }
        const callee = chain[chain.length - 1];
        if (is(j, "(") && callee && /^(Column|mapped_column|Field|\w+Field|\w+Column)$/.test(callee)) {
          out.push({ entity: cls, field: tokens[i]!.v, file, line: tokens[i]!.line, typeHint: callee });
        }
      }
    }
  } else if (lang === "js") {
    let cls: string | null = null;
    for (let i = 0; i < n; i++) {
      if (isId(i, "class") && isId(i + 1)) cls = tokens[i + 1]!.v;
      // TypeORM / class-validator decorators: @Column(...) email: string
      if (is(i, "@") && isId(i + 1) && /^(Column|PrimaryColumn|Prop|Field|PrimaryGeneratedColumn)$/.test(tokens[i + 1]!.v)) {
        let j = i + 2;
        if (is(j, "(")) { let d = 0; for (; j < n; j++) { if (is(j, "(")) d++; else if (is(j, ")")) { d--; if (d === 0) { j++; break; } } } }
        while (is(j, "@")) { j++; while (isId(j)) j++; if (is(j, "(")) { let d = 0; for (; j < n; j++) { if (is(j, "(")) d++; else if (is(j, ")")) { d--; if (d === 0) { j++; break; } } } } }
        while (isId(j) && /^(public|private|protected|readonly)$/.test(tokens[j]!.v)) j++;
        if (isId(j) && (is(j + 1, ":") || is(j + 1, "!") || is(j + 1, "?"))) {
          out.push({ entity: cls ?? "entity", field: tokens[j]!.v, file, line: tokens[j]!.line });
        }
      }
      // Mongoose / Sequelize: email: { type: String } | email: String | email: DataTypes.STRING
      if (isId(i) && is(i + 1, ":") && tokens[i]!.col > 0) {
        const a = tokens[i + 2];
        const typedObj = is(i + 2, "{") && isId(i + 3, "type") && is(i + 4, ":");
        const typedShort = a?.t === "id" && /^(String|Number|Boolean|Date|Buffer|DataTypes|Schema)$/.test(a.v);
        if ((typedObj || typedShort) && !/^(type|default|required|unique|index|ref|enum)$/.test(tokens[i]!.v)) {
          out.push({ entity: cls ?? "schema", field: tokens[i]!.v, file, line: tokens[i]!.line });
        }
      }
    }
  } else if (lang === "java") {
    let cls: string | null = null;
    for (let i = 0; i < n; i++) {
      if (isId(i, "class") && isId(i + 1)) { cls = tokens[i + 1]!.v; continue; }
      if (isId(i) && /^(private|protected|public)$/.test(tokens[i]!.v)) {
        let j = i + 1;
        while (isId(j) && /^(final|static|transient|volatile)$/.test(tokens[j]!.v)) j++;
        const typeTok = tokens[j];
        if (typeTok?.t !== "id") continue;
        j++;
        if (is(j, "<")) { let d = 0; for (; j < n; j++) { if (is(j, "<")) d++; else if (is(j, ">")) { d--; if (d === 0) { j++; break; } } } }
        if (isId(j) && (is(j + 1, ";") || is(j + 1, "="))) {
          out.push({ entity: cls ?? "entity", field: tokens[j]!.v, file, line: tokens[j]!.line, typeHint: typeTok.v });
        }
      }
    }
  } else if (lang === "cs") {
    let cls: string | null = null;
    for (let i = 0; i < n; i++) {
      if (isId(i, "class") && isId(i + 1)) { cls = tokens[i + 1]!.v; continue; }
      if (isId(i, "public") && !isId(i + 1, "class")) {
        let j = i + 1;
        while (isId(j) && /^(virtual|override|required|static|sealed)$/.test(tokens[j]!.v)) j++;
        if (!isId(j)) continue;
        const typeTok = tokens[j]!;
        j++;
        if (is(j, "<")) { let d = 0; for (; j < n; j++) { if (is(j, "<")) d++; else if (is(j, ">")) { d--; if (d === 0) { j++; break; } } } }
        if (is(j, "?")) j++;
        if (isId(j) && is(j + 1, "{") && isId(j + 2, "get")) {
          out.push({ entity: cls ?? "entity", field: tokens[j]!.v, file, line: tokens[j]!.line, typeHint: typeTok.v });
        }
      }
    }
  } else if (lang === "go") {
    let struct: string | null = null;
    for (let i = 0; i < n; i++) {
      if (isId(i, "type") && isId(i + 1) && isId(i + 2, "struct")) { struct = tokens[i + 1]!.v; continue; }
      // FieldName Type `db:"email" json:"email"`
      if (struct && isId(i) && tokens[i + 2]?.t === "str" && tokens[i + 2]!.line === tokens[i]!.line) {
        const tag = tokens[i + 2]!.v;
        const col = /(?:db|gorm|bson|column):"?(?:column:)?([A-Za-z0-9_]+)/.exec(tag);
        if (col) out.push({ entity: struct, field: col[1]!, file, line: tokens[i]!.line });
      }
    }
  }
  return out;
}

/** Does this file look like it defines a schema or ORM models worth scanning for fields? */
function isSchemaCandidate(rel: string, lang: Lang | null, content: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  if (base === "schema.prisma" || base.endsWith(".prisma")) return true;
  if (base.endsWith(".sql")) return /create\s+table|alter\s+table/i.test(content);
  if (base === "schema.rb") return true;
  if (/(openapi|swagger)\.(ya?ml)$/i.test(base)) return true;
  if (lang === "py") return /(Column|mapped_column|models\.\w+Field)\(/.test(content);
  if (lang === "js") return /@Column|@Entity|mongoose|Schema\(|sequelize|DataTypes/.test(content);
  if (lang === "java") return /@Entity|@Table|@Document/.test(content);
  if (lang === "cs") return /DbContext|DbSet<|\[Table|\[Key\]|Entity/.test(content) || /(^|\/)(models|entities|domain)\//i.test(rel);
  if (lang === "go") return /(db|gorm|bson):"/.test(content);
  return false;
}

export function findSchemaFields(rel: string, content: string): SchemaField[] {
  const base = rel.split("/").pop() ?? rel;
  const lang = langForFile(rel);
  if (!isSchemaCandidate(rel, lang, content)) return [];
  if (base.endsWith(".prisma")) return prismaFields(rel, content);
  if (base.endsWith(".sql")) return sqlFields(rel, content);
  if (base === "schema.rb") {
    const engine = undefined;
    return railsSchemaFields(rel, content).map((f) => ({ ...f, engine }));
  }
  if (/(openapi|swagger)\.ya?ml$/i.test(base)) return openApiFields(rel, content);
  if (!lang) return [];
  return tokenFields(rel, lang, maskDeadBlocks(tokenize(content, lang), lang));
}
