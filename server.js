import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createExcelHandler } from "./excel-import.js";

const PORT = Number(process.env.PORT || 8080);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ROOT = process.cwd();
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const DB_PATH = join(DATA_DIR, "catalog.sqlite");
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "posventa@cigue.com.ar";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Puente.12";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "posventa@cigue.com.ar";
const WHATSAPP_NUMBER = String(process.env.WHATSAPP_NUMBER || "5490000000000").replace(/\D/g, "");
const WHATSAPP_LABEL = process.env.WHATSAPP_LABEL || "+54 9 000 000-0000";
const loginAttempts = new Map();
const MODEL_GROUPS = {
  Camiones: ["Accelo", "Atego", "Actros", "Arocs", "Axor"],
  Vans: ["Sprinter", "Vito"],
};

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (IS_PRODUCTION && (!process.env.ADMIN_PASSWORD || ADMIN_PASSWORD === "Puente.12")) {
  throw new Error("En producción debés configurar ADMIN_PASSWORD con una contraseña segura.");
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function hashPassword(password, salt = randomBytes(16).toString("base64")) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("base64");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;

  const expected = Buffer.from(hash, "base64");
  const actual = Buffer.from(hashPassword(password, salt).split(":")[1], "base64");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function nowIso() {
  return new Date().toISOString();
}

function inferProductModels(product) {
  const name = `${product.name || ""} ${product.description || ""}`.toLowerCase();
  const application = product.application || "";
  const models = new Set();

  for (const model of [...MODEL_GROUPS.Camiones, ...MODEL_GROUPS.Vans]) {
    if (name.includes(model.toLowerCase())) models.add(model);
  }

  if (models.size > 0) return [...models];
  if (application === "Camiones") return MODEL_GROUPS.Camiones;
  if (application === "Vans") return MODEL_GROUPS.Vans;
  if (application === "Ambos") return [...MODEL_GROUPS.Camiones, ...MODEL_GROUPS.Vans];
  return [];
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      application TEXT NOT NULL,
      models TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL,
      price INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      badge TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      sold INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const productColumns = db.prepare("PRAGMA table_info(products)").all().map((column) => column.name);
  if (!productColumns.includes("models")) {
    db.exec("ALTER TABLE products ADD COLUMN models TEXT NOT NULL DEFAULT '[]'");
  }
  if (!productColumns.includes("stock")) {
    db.exec("ALTER TABLE products ADD COLUMN stock INTEGER NOT NULL DEFAULT 0");
  }

  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount === 0) {
    db.prepare(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)"
    ).run(ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), nowIso());
  }

  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
  if (productCount === 0 && existsSync(join(ROOT, "products.json"))) {
    const seedProducts = JSON.parse(readFileSync(join(ROOT, "products.json"), "utf8"));
    const insert = db.prepare(`
      INSERT INTO products
        (name, category, application, models, description, price, stock, badge, image, status, sold, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?, ?)
    `);
    const timestamp = nowIso();
    for (const product of seedProducts) {
      insert.run(
        product.name || "",
        product.category || "",
        product.application || "",
        JSON.stringify(product.models || []),
        product.description || "",
        Number(product.price || 0),
        Number(product.stock || 0),
        product.badge || "",
        product.image || "",
        timestamp,
        timestamp
      );
    }
  }

  const productsWithoutModels = db
    .prepare("SELECT id, name, application, description FROM products WHERE models = '[]' OR models IS NULL OR models = ''")
    .all();

  const updateModels = db.prepare("UPDATE products SET models = ?, updated_at = ? WHERE id = ?");
  for (const product of productsWithoutModels) {
    const models = inferProductModels(product);
    if (models.length > 0) updateModels.run(JSON.stringify(models), nowIso(), product.id);
  }
}

initDb();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}

function sessionCookie(token, maxAge) {
  return `admin_session=${token ? encodeURIComponent(token) : ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${IS_PRODUCTION ? "; Secure" : ""}`;
}

function loginAllowed(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const key = forwarded || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  if (recent.length >= 10) return false;
  recent.push(now);
  loginAttempts.set(key, recent);
  return true;
}

function clearLoginAttempts(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  loginAttempts.delete(forwarded || req.socket.remoteAddress || "unknown");
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(valueParts.join("="));
  }
  return cookies;
}

function getSessionUser(req) {
  const token = parseCookies(req).admin_session;
  if (!token) return null;

  const session = db
    .prepare(
      `SELECT sessions.token, sessions.expires_at, users.id, users.email, users.role
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ?`
    )
    .get(token);

  if (!session || session.expires_at < Date.now()) {
    if (session) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }

  return {
    token: session.token,
    id: session.id,
    email: session.email,
    role: session.role,
  };
}

function requireAdmin(req, res) {
  const user = getSessionUser(req);
  if (!user || user.role !== "admin") {
    sendError(res, 401, "No autorizado");
    return null;
  }
  return user;
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8 * 1024 * 1024) throw new Error("Payload demasiado grande");
  }
  return body ? JSON.parse(body) : {};
}

function cleanProductPayload(payload) {
  const models = Array.isArray(payload.models)
    ? [...new Set(payload.models.map((model) => String(model || "").trim()).filter(Boolean))]
    : [];

  const product = {
    name: String(payload.name || "").trim(),
    category: String(payload.category || "").trim(),
    application: String(payload.application || "").trim(),
    models,
    description: String(payload.description || "").trim(),
    price: Number(payload.price || 0),
    stock: Number(payload.stock || 0),
    badge: String(payload.badge || "").trim(),
    image: String(payload.image || "").trim(),
    status: payload.status === "inactive" ? "inactive" : "active",
    sold: payload.sold ? 1 : 0,
  };

  if (!product.name) throw new Error("El nombre es obligatorio");
  if (!product.category) throw new Error("La categoría es obligatoria");
  if (!product.application) throw new Error("La aplicación es obligatoria");
  if (product.models.length === 0) throw new Error("Seleccioná al menos un modelo");

  const allowedModels =
    product.application === "Camiones"
      ? MODEL_GROUPS.Camiones
      : product.application === "Vans"
        ? MODEL_GROUPS.Vans
        : [...MODEL_GROUPS.Camiones, ...MODEL_GROUPS.Vans];

  if (!product.models.every((model) => allowedModels.includes(model))) {
    throw new Error("Hay modelos seleccionados que no corresponden a la aplicación");
  }

  if (!product.description) throw new Error("La descripción es obligatoria");
  if (!Number.isFinite(product.price) || product.price < 0) {
    throw new Error("El precio debe ser un número válido");
  }
  if (!Number.isFinite(product.stock) || product.stock < 0) {
    throw new Error("El stock debe ser un número válido");
  }

  product.price = Math.round(product.price);
  product.stock = Math.round(product.stock);
  return product;
}

function mapProduct(row) {
  let models = [];
  try {
    models = JSON.parse(row.models || "[]");
  } catch {
    models = [];
  }

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    application: row.application,
    models,
    description: row.description,
    price: row.price,
    stock: row.stock,
    badge: row.badge,
    image: row.image,
    status: row.status,
    sold: Boolean(row.sold),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listPublicProducts() {
  return db
    .prepare(
      `SELECT * FROM products
       WHERE status = 'active'
       ORDER BY sold ASC, updated_at DESC, id DESC`
    )
    .all()
    .map(mapProduct);
}

function listAdminProducts() {
  return db
    .prepare("SELECT * FROM products ORDER BY updated_at DESC, id DESC")
    .all()
    .map(mapProduct);
}

const handleExcel = createExcelHandler({ db, requireAdmin, sendJson, readJsonBody, cleanProductPayload, listAdminProducts });

async function handleApi(req, res, pathname) {
  if (await handleExcel(req, res, pathname)) return true;
  if (req.method === "GET" && pathname === "/api/health") {
    db.prepare("SELECT 1").get();
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, { email: CONTACT_EMAIL, whatsappNumber: WHATSAPP_NUMBER, whatsappLabel: WHATSAPP_LABEL });
    return true;
  }
  if (req.method === "GET" && pathname === "/api/products") {
    sendJson(res, 200, { products: listPublicProducts() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/admin/login") {
    if (!loginAllowed(req)) {
      sendError(res, 429, "Demasiados intentos. Esperá 15 minutos antes de volver a probar.");
      return true;
    }
    const payload = await readJsonBody(req);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(payload.email || "").trim());
    if (!user || !verifyPassword(String(payload.password || ""), user.password_hash)) {
      sendError(res, 401, "Credenciales inválidas");
      return true;
    }

    const token = randomBytes(32).toString("base64url");
    clearLoginAttempts(req);
    db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
      token,
      user.id,
      Date.now() + SESSION_TTL_MS,
      nowIso()
    );

    res.setHeader("Set-Cookie", sessionCookie(token, SESSION_TTL_MS / 1000));
    sendJson(res, 200, { user: { email: user.email, role: user.role } });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/admin/logout") {
    const token = parseCookies(req).admin_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/admin/me") {
    const user = getSessionUser(req);
    if (!user || user.role !== "admin") {
      sendJson(res, 200, { user: null });
      return true;
    }
    sendJson(res, 200, { user: { email: user.email, role: user.role } });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/admin/products") {
    if (!requireAdmin(req, res)) return true;
    sendJson(res, 200, { products: listAdminProducts() });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/admin/products") {
    if (!requireAdmin(req, res)) return true;
    const product = cleanProductPayload(await readJsonBody(req));
    const timestamp = nowIso();
    const result = db
      .prepare(
        `INSERT INTO products
          (name, category, application, models, description, price, stock, badge, image, status, sold, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        product.name,
        product.category,
        product.application,
        JSON.stringify(product.models),
        product.description,
        product.price,
        product.stock,
        product.badge,
        product.image,
        product.status,
        product.sold,
        timestamp,
        timestamp
      );
    const created = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
    sendJson(res, 201, { product: mapProduct(created) });
    return true;
  }

  const productMatch = pathname.match(/^\/api\/admin\/products\/(\d+)$/);
  if (productMatch && req.method === "PUT") {
    if (!requireAdmin(req, res)) return true;
    const product = cleanProductPayload(await readJsonBody(req));
    const result = db
      .prepare(
        `UPDATE products
         SET name = ?, category = ?, application = ?, description = ?, price = ?, stock = ?, badge = ?,
             models = ?, image = ?, status = ?, sold = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        product.name,
        product.category,
        product.application,
        product.description,
        product.price,
        product.stock,
        product.badge,
        JSON.stringify(product.models),
        product.image,
        product.status,
        product.sold,
        nowIso(),
        Number(productMatch[1])
      );
    if (result.changes === 0) sendError(res, 404, "Producto no encontrado");
    else sendJson(res, 200, { product: mapProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(Number(productMatch[1]))) });
    return true;
  }

  const statusMatch = pathname.match(/^\/api\/admin\/products\/(\d+)\/status$/);
  if (statusMatch && req.method === "PATCH") {
    if (!requireAdmin(req, res)) return true;
    const payload = await readJsonBody(req);
    const updates = [];
    const values = [];

    if (typeof payload.sold === "boolean") {
      updates.push("sold = ?");
      values.push(payload.sold ? 1 : 0);
    }

    if (payload.status === "active" || payload.status === "inactive") {
      updates.push("status = ?");
      values.push(payload.status);
    }

    if (updates.length === 0) {
      sendError(res, 400, "No hay cambios válidos");
      return true;
    }

    updates.push("updated_at = ?");
    values.push(nowIso(), Number(statusMatch[1]));

    const result = db.prepare(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`).run(...values);
    if (result.changes === 0) sendError(res, 404, "Producto no encontrado");
    else sendJson(res, 200, { product: mapProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(Number(statusMatch[1]))) });
    return true;
  }

  return false;
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(ROOT, normalize(requested).replace(/^\/+/, ""));
  const publicFiles = new Set(["/index.html", "/admin.html", "/encuesta.html", "/styles.css", "/script.js", "/admin.js", "/mercedes-brand-logo-symbol-white-design-german-car-automobile-illustration-with-black-background-free-vector.jpg"]);
  const isPublicAsset = requested.startsWith('/assets/') && filePath.startsWith(join(ROOT, 'assets') + '/') && ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico'].includes(extname(filePath).toLowerCase());

  if ((!publicFiles.has(requested) && !isPublicAsset) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
    return;
  }

  const ext = extname(filePath).toLowerCase();
  const cacheControl = [".html", ".css", ".js"].includes(ext) ? "no-cache" : "public, max-age=86400";
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", "Cache-Control": cacheControl });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url.pathname);
      if (!handled) sendError(res, 404, "Endpoint no encontrado");
      return;
    }

    serveStatic(req, res, url.pathname);
  } catch (error) {
    const message = error instanceof SyntaxError ? "JSON inválido" : error.message || "Error interno";
    sendError(res, error.statusCode || 500, message);
  }
});

server.listen(PORT, () => {
  console.log(`Catálogo disponible en http://localhost:${PORT}`);
  console.log(`Panel admin en http://localhost:${PORT}/admin.html`);
  console.log(`Usuario administrador: ${ADMIN_EMAIL}`);
  if (!IS_PRODUCTION) console.log("Entorno local iniciado. Configurá las variables de producción antes de publicar.");
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
