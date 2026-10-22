import type { Column, Table } from "./ir";
import { DAY, fakerFn, type Env, type Gen, type GenFactory } from "./env";
import { isIntegral, isNumeric, isTemporal, isTextual } from "./types";
import type { Value } from "./value";

/* Column-name heuristics: first match wins. Names are lower-cased and split on `_`. */

const norm = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

const has = (n: string, ...words: string[]): boolean => words.some((w) => new RegExp(`(^|_)${w}(_|$)`).test(n));
const ends = (n: string, ...words: string[]): boolean => words.some((w) => n === w || n.endsWith(`_${w}`));

const faker = (path: string, post?: (s: string) => string): GenFactory => (env) => {
  const fn = fakerFn(env.faker, path);
  return post ? () => post(String(fn())) : () => String(fn());
};

const pick = (items: readonly string[]): GenFactory => (env) => () => env.rng.pick(items);

const code = (length: number, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"): GenFactory => (env) => () => {
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[env.rng.int(0, alphabet.length - 1)];
  return s;
};

const sku: GenFactory = (env) => () => {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let a = "";
  for (let i = 0; i < 3; i++) a += letters[env.rng.int(0, letters.length - 1)];
  return `${a}-${String(env.rng.int(0, 99999)).padStart(5, "0")}`;
};

const hex = (length: number): GenFactory => (env) => () => {
  let s = "";
  for (let i = 0; i < length; i++) s += "0123456789abcdef"[env.rng.int(0, 15)];
  return s;
};

const sentence = (words: [number, number]): GenFactory => (env) => {
  const fn = fakerFn(env.faker, "word.words");
  return () => {
    const s = String(fn({ count: { min: words[0], max: words[1] } }));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
};

const paragraph = (sentences: [number, number]): GenFactory => (env) => {
  const phrase = fakerFn(env.faker, "company.catchPhrase");
  return () => {
    const n = env.rng.int(sentences[0], sentences[1]);
    return Array.from({ length: n }, () => `${String(phrase())}.`).join(" ");
  };
};

const productDescription: GenFactory = (env) => {
  const fn = fakerFn(env.faker, "commerce.productDescription");
  return () => String(fn());
};

const CARRIERS = ["UPS", "FedEx", "DHL Express", "USPS", "Royal Mail", "Canada Post", "Aramex"];
const WAREHOUSES = ["Berlin DC", "Dallas DC", "Rotterdam DC", "Singapore DC", "Reno DC", "Osaka DC", "Lyon DC"];
const STATUSES = ["active", "pending", "inactive", "archived", "suspended"];

const PERSON_TABLE = /(user|customer|person|people|employee|member|author|contact|owner|account|profile|student|patient|staff|admin|lead|client)/;
const ORG_TABLE = /(company|companies|org|organi[sz]ation|vendor|supplier|brand|store|shop|merchant|team|workspace|tenant|business|employer|agency)/;
const PRODUCT_TABLE = /(product|item|plan|sku|good|merchandise|offer|service|course|book|movie|album|recipe)/;

export function textGenerator(table: Table, col: Column): GenFactory | undefined {
  const n = norm(col.name);
  const t = norm(table.name);
  if (has(n, "email") || ends(n, "email_address")) return faker("internet.email", (s) => s.toLowerCase());
  if (ends(n, "first_name", "given_name", "forename") || n === "firstname") return faker("person.firstName");
  if (ends(n, "last_name", "surname", "family_name") || n === "lastname") return faker("person.lastName");
  if (ends(n, "full_name", "display_name", "contact_name", "owner_name", "customer_name", "author_name")) return faker("person.fullName");
  if (n === "username" || ends(n, "username", "handle", "login", "nickname")) return faker("internet.username");
  if (has(n, "phone", "mobile", "tel", "telephone", "fax", "cell")) return faker("phone.number");
  if (ends(n, "job_title", "position", "occupation", "role_title")) return faker("person.jobTitle");
  if (ends(n, "company", "company_name", "organization", "organisation", "employer", "business_name", "vendor_name", "supplier_name", "brand")) return faker("company.name");
  if (ends(n, "street", "address", "address_line", "address_line1", "address1", "street_address", "address_line_1")) return faker("location.streetAddress");
  if (ends(n, "address_line2", "address2", "address_line_2", "apartment", "suite")) return faker("location.secondaryAddress");
  if (ends(n, "city", "town")) return faker("location.city");
  if (ends(n, "state", "province", "region", "county")) return faker("location.state");
  if (ends(n, "country_code", "country_iso", "iso_country") || (n === "country" && (col.type.length ?? 99) <= 3)) return faker("location.countryCode", (s) => s.slice(0, col.type.length ?? 2));
  if (ends(n, "country", "nationality")) return faker("location.country");
  if (ends(n, "zip", "zip_code", "zipcode", "postal_code", "postcode", "postal")) return faker("location.zipCode");
  if (ends(n, "timezone", "time_zone", "tz")) return faker("location.timeZone");
  if (ends(n, "language", "locale", "lang")) return pick(["en", "en-US", "de", "fr", "es", "pt-BR", "ja", "nl"]);
  if (ends(n, "currency", "currency_code")) return faker("finance.currencyCode");
  if (ends(n, "iban")) return faker("finance.iban");
  if (ends(n, "avatar", "avatar_url", "photo", "photo_url", "picture", "image", "image_url", "thumbnail")) return faker("image.avatar");
  if (ends(n, "url", "website", "homepage", "link", "href", "uri", "permalink")) return faker("internet.url");
  if (ends(n, "tag", "tags", "keyword", "keywords", "label", "labels", "topic", "topics")) return faker("word.noun", (w) => w.toLowerCase());
  if (ends(n, "slug")) return (env) => {
    const words = fakerFn(env.faker, "word.words");
    return () => String(words({ count: 3 })).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  };
  if (ends(n, "domain", "hostname", "host")) return faker("internet.domainName");
  if (ends(n, "ip", "ip_address", "ipv4", "remote_ip", "client_ip")) return faker("internet.ipv4");
  if (ends(n, "user_agent", "ua")) return faker("internet.userAgent");
  if (ends(n, "mac", "mac_address")) return faker("internet.mac");
  if (ends(n, "color", "colour")) return faker("color.rgb");
  if (ends(n, "file_name", "filename")) return faker("system.fileName");
  if (ends(n, "mime_type", "content_type", "mimetype")) return faker("system.mimeType");
  if (ends(n, "version")) return faker("system.semver");
  if (ends(n, "sku", "product_code")) return sku;
  if (ends(n, "tracking_code", "tracking_number", "tracking", "waybill")) return code(12);
  if (ends(n, "reference", "ref", "reference_number", "order_number", "invoice_number", "confirmation_code", "transaction_id")) return code(10);
  if (ends(n, "token", "api_key", "secret", "access_token", "refresh_token", "session_id")) return hex(40);
  if (ends(n, "password", "password_hash", "hashed_password", "pwd")) return hex(60);
  if (ends(n, "carrier", "shipping_method", "courier")) return pick(CARRIERS);
  if (ends(n, "warehouse", "location_name", "depot")) return pick(WAREHOUSES);
  if (ends(n, "status", "state_name")) return pick(STATUSES);
  if (ends(n, "gender", "sex")) return pick(["female", "male", "non-binary", "unspecified"]);
  if (ends(n, "category", "department", "genre", "kind", "type")) return faker("commerce.department");
  if (ends(n, "title", "subject", "headline", "heading")) {
    return PRODUCT_TABLE.test(t) ? faker("commerce.productName") : sentence([3, 7]);
  }
  if (ends(n, "description", "summary", "bio", "about", "body", "content", "details", "message", "comment", "notes", "note", "remarks", "text", "review")) {
    if (PRODUCT_TABLE.test(t) && ends(n, "description", "summary", "details")) return productDescription;
    return /(note|comment|remark|message)/.test(n) ? paragraph([1, 2]) : paragraph([2, 4]);
  }
  if (n === "name" || ends(n, "name", "label")) {
    if (PERSON_TABLE.test(t)) return faker("person.fullName");
    if (ORG_TABLE.test(t)) return faker("company.name");
    if (PRODUCT_TABLE.test(t)) return faker("commerce.productName");
    return sentence([1, 3]);
  }
  return undefined;
}

type Range = [number, number];

const rangeRules: Array<[(n: string) => boolean, Range]> = [
  [(n) => ends(n, "salary", "wage", "compensation"), [30000, 150000]],
  [(n) => ends(n, "revenue", "budget", "arr", "mrr", "gmv"), [1000, 100000]],
  [(n) => ends(n, "balance", "credit", "limit"), [0, 10000]],
  [(n) => ends(n, "total", "subtotal", "grand_total", "total_amount", "order_total"), [10, 2000]],
  [(n) => ends(n, "price", "unit_price", "list_price", "msrp", "rate", "cost", "unit_cost"), [2, 500]],
  [(n) => ends(n, "amount", "fee", "tax", "shipping", "discount", "refund", "payment", "charge", "paid", "due"), [1, 1000]],
  [(n) => ends(n, "quantity", "qty", "units_ordered"), [1, 20]],
  [(n) => ends(n, "count", "stock", "on_hand", "inventory", "units", "available", "reserved", "reorder_level"), [0, 500]],
  [(n) => ends(n, "age"), [18, 80]],
  [(n) => ends(n, "rating", "stars"), [1, 5]],
  [(n) => ends(n, "score", "percent", "percentage", "pct", "progress", "completion"), [0, 100]],
  [(n) => ends(n, "year"), [1990, 2025]],
  [(n) => ends(n, "points", "loyalty_points", "karma", "xp"), [0, 5000]],
  [(n) => ends(n, "weight", "weight_kg", "height", "length", "width", "depth", "size"), [1, 100]],
  [(n) => ends(n, "latitude", "lat"), [-60, 70]],
  [(n) => ends(n, "longitude", "lng", "lon"), [-170, 175]],
  [(n) => ends(n, "port"), [1024, 65535]],
  [(n) => ends(n, "duration", "seconds", "duration_seconds", "elapsed"), [1, 3600]],
  [(n) => ends(n, "priority", "level", "rank", "tier"), [1, 5]],
  [(n) => ends(n, "position", "sort_order", "order_index", "ordinal", "sequence", "seq"), [0, 100]],
  [(n) => ends(n, "version", "revision"), [1, 10]],
];

export function rangeFor(col: Column): Range | undefined {
  const n = norm(col.name);
  for (const [test, range] of rangeRules) if (test(n)) return range;
  return undefined;
}

/** Probability that a boolean column is true. */
export function boolProbability(col: Column): number {
  const n = norm(col.name);
  if (has(n, "deleted", "archived", "banned", "blocked", "suspended", "spam", "flagged", "disabled", "locked", "expired", "cancelled", "canceled", "refunded")) return 0.05;
  if (has(n, "active", "enabled", "verified", "published", "visible", "confirmed", "approved", "subscribed", "public", "available", "default")) return 0.85;
  return 0.5;
}

/** Offsets (ms from the reference date) a temporal column should fall in. */
export function timeWindow(col: Column): [number, number] {
  const n = norm(col.name);
  if (has(n, "birth", "birthday", "dob", "birthdate")) return [-70 * 365 * DAY, -18 * 365 * DAY];
  if (has(n, "expires", "expiry", "expiration", "valid_until", "due", "renews", "ends", "end")) return [0, 365 * DAY];
  return [-730 * DAY, 0];
}

export function jsonGenerator(col: Column): GenFactory {
  const n = norm(col.name);
  return (env) => {
    const word = fakerFn(env.faker, "word.noun");
    return (): Value => {
      const o: Record<string, Value> = {};
      if (has(n, "settings", "preferences", "config", "options", "flags")) {
        o.theme = env.rng.pick(["light", "dark", "system"]);
        o.notifications = env.rng.bool(0.7);
        o.pageSize = env.rng.pick([10, 25, 50, 100]);
      } else if (has(n, "tags", "labels")) {
        return [String(word()), String(word())];
      } else {
        o.label = String(word());
        o.score = env.rng.int(0, 100);
        o.enabled = env.rng.bool(0.8);
        o.tags = [String(word()), String(word())];
      }
      return o;
    };
  };
}

/** Does the heuristic layer even apply to this column's type? */
export function heuristicApplies(col: Column): "text" | "number" | "bool" | "time" | "json" | undefined {
  const k = col.type.kind;
  if (isTextual(k)) return "text";
  if (isNumeric(k)) return "number";
  if (k === "bool") return "bool";
  if (isTemporal(k)) return "time";
  if (k === "json" || k === "jsonb") return "json";
  return undefined;
}

export const integralKind = (col: Column): boolean => isIntegral(col.type.kind);

export type { Gen };
export type { Env };
