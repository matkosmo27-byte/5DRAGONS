const ALLOWED_ORIGINS = [
  "https://5dragonsacademy.pl",
  "https://www.5dragonsacademy.pl",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null"
];

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function cors(request) {
  const origin = request.headers.get("Origin") || "null";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
  };
}

function response(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...cors(request) }
  });
}

function ok(data, request, status = 200) { return response({ success: true, ...data }, status, request); }
function fail(error, request, status = 400) { return response({ success: false, error }, status, request); }

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function hash(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

function safeText(v, max = 10000) {
  return String(v ?? "").trim().slice(0, max);
}

function allowedTable(name) {
  return ["players","news","matches","recruitment","achievements","users"].includes(name);
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nickname TEXT, role TEXT, team TEXT DEFAULT 'Main', avatar TEXT, faceit TEXT, steam TEXT, kd REAL DEFAULT 0, adr REAL DEFAULT 0, elo INTEGER DEFAULT 0, level INTEGER DEFAULT 0, bio TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, excerpt TEXT, content TEXT, image TEXT, category TEXT DEFAULT 'News', author TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, opponent TEXT NOT NULL, event TEXT, date TEXT, time TEXT, map TEXT, result TEXT, score TEXT, status TEXT DEFAULT 'upcoming', logo TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS recruitment (id INTEGER PRIMARY KEY AUTOINCREMENT, discord TEXT, cs2 TEXT, faceit INTEGER, role TEXT, faceit_url TEXT, steam TEXT, age INTEGER, about TEXT, availability TEXT, status TEXT DEFAULT 'new', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, icon TEXT, date TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)`)
  ]);
}

async function currentUser(env, request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const row = await env.DB.prepare(`SELECT u.id,u.username,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`).bind(token, Date.now()).first();
  return row || null;
}

function requireAdmin(user, request) {
  if (!user || !["admin","owner","staff"].includes(user.role)) return fail("Brak uprawnień administratora.", request, 403);
  return null;
}

async function list(env, table, request) {
  if (!allowedTable(table)) return fail("Nieprawidłowa tabela.", request, 400);
  const result = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 200`).all();
  return ok({ data: result.results || [] }, request);
}

async function insert(env, table, data, request) {
  if (!allowedTable(table)) return fail("Nieprawidłowa tabela.", request, 400);
  const columns = Object.keys(data || {}).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k));
  if (!columns.length) return fail("Brak prawidłowych danych.", request, 400);
  const placeholders = columns.map(() => "?").join(",");
  const values = columns.map(k => data[k]);
  const result = await env.DB.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`).bind(...values).run();
  return ok({ id: result.meta?.last_row_id || null }, request, 201);
}

async function remove(env, table, id, request) {
  if (!allowedTable(table)) return fail("Nieprawidłowa tabela.", request, 400);
  await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
  return ok({}, request);
}

async function sendContact(env, data, request) {
  const name = safeText(data.name, 120);
  const email = safeText(data.email, 200);
  const subject = safeText(data.subject, 200);
  const message = safeText(data.message, 5000);
  if (!name || !email || !message) return fail("Uzupełnij wymagane pola.", request, 400);
  if (!env.RESEND_API_KEY) return fail("Brak konfiguracji poczty.", request, 500);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "5DRAGONS <onboarding@resend.dev>",
      to: ["matkosmo27@gmail.com"],
      reply_to: email,
      subject: `5DRAGONS | ${subject || "Kontakt"}`,
      text: `Nowa wiadomość z formularza 5DRAGONS\n\nImię: ${name}\nEmail: ${email}\nTemat: ${subject}\n\n${message}`
    })
  });
  if (!r.ok) return fail("Nie udało się wysłać wiadomości.", request, 502);
  return ok({ message: "Wiadomość została wysłana." }, request);
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
      await ensureSchema(env);
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, "") || "/";
      const method = request.method;

      if (path === "/" && method === "GET") return ok({ message: "5DRAGONS API działa!" }, request);
      if (path === "/api/test" && method === "GET") {
        const tables = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
        return ok({ message: "5DRAGONS API działa!", tables: tables.results || [] }, request);
      }

      if (path === "/api/register" && method === "POST") {
        const d = await readJson(request);
        const username = safeText(d?.username, 50);
        const email = safeText(d?.email, 200).toLowerCase();
        const password = String(d?.password || "");
        if (!username || !email || password.length < 6) return fail("Podaj nazwę, email i hasło (min. 6 znaków).", request);
        const exists = await env.DB.prepare(`SELECT id FROM users WHERE username=? OR email=?`).bind(username, email).first();
        if (exists) return fail("Użytkownik już istnieje.", request, 409);
        const result = await env.DB.prepare(`INSERT INTO users(username,email,password_hash,role) VALUES(?,?,?,?)`).bind(username,email,await hash(password),"user").run();
        return ok({ id: result.meta?.last_row_id }, request, 201);
      }

      if (path === "/api/login" && method === "POST") {
        const d = await readJson(request);
        const login = safeText(d?.login || d?.username || d?.email, 200);
        const password = String(d?.password || "");
        const user = await env.DB.prepare(`SELECT * FROM users WHERE username=? OR email=?`).bind(login, login.toLowerCase()).first();
        if (!user || user.password_hash !== await hash(password)) return fail("Nieprawidłowy login lub hasło.", request, 401);
        const token = crypto.randomUUID() + crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)`).bind(token,user.id,Date.now()+1000*60*60*24*30).run();
        return ok({ token, user: { id:user.id, username:user.username, email:user.email, role:user.role } }, request);
      }

      if (path === "/api/me" && method === "GET") {
        const user = await currentUser(env, request);
        if (!user) return fail("Brak aktywnej sesji.", request, 401);
        return ok({ user }, request);
      }

      if (path === "/api/logout" && method === "POST") {
        const auth = request.headers.get("Authorization") || "";
        if (auth.startsWith("Bearer ")) await env.DB.prepare(`DELETE FROM sessions WHERE token=?`).bind(auth.slice(7)).run();
        return ok({}, request);
      }

      if (path === "/api/contact" && method === "POST") return await sendContact(env, await readJson(request) || {}, request);

      if (path === "/api/recruitment" && method === "GET") return await list(env,"recruitment",request);
      if ((path === "/api/recruitment" || path === "/api/recruitment/applications") && method === "POST") {
        const d = await readJson(request);
        if (!d) return fail("Nieprawidłowe dane JSON.", request);
        return await insert(env,"recruitment",d,request);
      }

      const single = path.match(/^\/api\/(players|news|matches|recruitment|achievements)\/(\d+)$/);
      if (single && method === "DELETE") return await remove(env,single[1],single[2],request);
      const collection = path.match(/^\/api\/(players|news|matches|recruitment|achievements)$/);
      if (collection && method === "GET") return await list(env,collection[1],request);
      if (collection && method === "POST") {
        const user = await currentUser(env,request);
        const admin = requireAdmin(user,request);
        if (admin) return admin;
        return await insert(env,collection[1],await readJson(request) || {},request);
      }

      return fail("Nie znaleziono endpointu.", request, 404);
    } catch (e) {
      return fail(e?.message || "Błąd serwera.", request, 500);
    }
  }
};
