const ALLOWED_ORIGINS = [
    "https://5dragons.matkosmo27.workers.dev",
    "https://5dragonsacademy.pl",
    "https://www.5dragonsacademy.pl",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "null"
];

function getCorsOrigin(request) {
    const origin = request.headers.get("Origin");

    if (!origin) {
        return "*";
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
        return origin;
    }

    return "*";
}

function corsHeaders(request) {
    return {
        "Access-Control-Allow-Origin": getCorsOrigin(request),
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
    };
}

function json(request, data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...corsHeaders(request)
        }
    });
}

function errorResponse(request, message, status = 400) {
    return json(request, {
        success: false,
        error: message
    }, status);
}

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

function getPathParts(url) {
    return url.pathname
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .filter(Boolean);
}

function getIdFromPath(parts) {
    const last = parts[parts.length - 1];

    if (!last || !/^\d+$/.test(last)) {
        return null;
    }

    return Number(last);
}

async function sha256(value) {
    const data = new TextEncoder().encode(value);

    const hash = await crypto.subtle.digest(
        "SHA-256",
        data
    );

    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function generateToken() {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

async function getSessionUser(request, env) {
    const authHeader = request.headers.get("Authorization");

    if (!authHeader) {
        return null;
    }

    if (!authHeader.startsWith("Bearer ")) {
        return null;
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
        return null;
    }

    const tokenHash = await sha256(token);

    const result = await env.DB.prepare(`
        SELECT
            users.id,
            users.email,
            users.discord,
            users.cs2_nick,
            users.steam,
            users.role,
            users.team,
            users.created_at,
            sessions.id AS session_id
        FROM sessions
        INNER JOIN users
            ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
          AND sessions.expires_at > CURRENT_TIMESTAMP
        LIMIT 1
    `)
        .bind(tokenHash)
        .first();

    if (!result) {
        return null;
    }

    try {
        await env.DB.prepare(`
            UPDATE sessions
            SET last_used_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `)
            .bind(result.session_id)
            .run();
    } catch {
        // Aktualizacja last_used_at nie może blokować użytkownika.
    }

    return result;
}

async function requireAuth(request, env) {
    const user = await getSessionUser(request, env);

    if (!user) {
        return {
            ok: false,
            response: errorResponse(
                request,
                "Brak autoryzacji.",
                401
            )
        };
    }

    return {
        ok: true,
        user
    };
}

async function requireAdmin(request, env) {
    const auth = await requireAuth(request, env);

    if (!auth.ok) {
        return auth;
    }

    const allowedRoles = [
        "OWNER",
        "ADMIN",
        "MANAGER",
        "COACH",
        "EDITOR"
    ];

    if (!allowedRoles.includes(auth.user.role)) {
        return {
            ok: false,
            response: errorResponse(
                request,
                "Brak uprawnień.",
                403
            )
        };
    }

    return auth;
}

async function tableExists(env, tableName) {
    const result = await env.DB.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
        LIMIT 1
    `)
        .bind(tableName)
        .first();

    return !!result;
}

async function getTableColumns(env, tableName) {
    const result = await env.DB.prepare(
        `PRAGMA table_info(${tableName})`
    ).all();

    return (result.results || []).map(column => column.name);
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
}

function normalizeValue(value) {
    if (value === undefined) {
        return null;
    }

    if (typeof value === "object" && value !== null) {
        return JSON.stringify(value);
    }

    return value;
}

async function dynamicInsert(env, tableName, data) {
    const columns = await getTableColumns(env, tableName);

    const insertColumns = Object.keys(data)
        .filter(key => columns.includes(key));

    if (!insertColumns.length) {
        throw new Error(
            `Brak prawidłowych kolumn dla tabeli ${tableName}.`
        );
    }

    const placeholders = insertColumns
        .map(() => "?")
        .join(", ");

    const values = insertColumns.map(column =>
        normalizeValue(data[column])
    );

    const sql = `
        INSERT INTO ${tableName}
        (${insertColumns.join(", ")})
        VALUES (${placeholders})
    `;

    const result = await env.DB.prepare(sql)
        .bind(...values)
        .run();

    return result;
}

async function syncFaceitPlayer(env, player) {
    if (!env.FACEIT_API_KEY) {
        throw new Error("Brak konfiguracji FACEIT_API_KEY w Workerze.");
    }

    const nickname = String(player.faceit_nickname || "").trim();
    const playerId = String(player.faceit_player_id || "").trim();

    if (!nickname && !playerId) {
        throw new Error("Zawodnik nie ma ustawionego Nicku FACEIT.");
    }

    const headers = {
        "Authorization": `Bearer ${env.FACEIT_API_KEY}`,
        "Accept": "application/json",
        "User-Agent": "5DRAGONS-Worker"
    };

    let faceitPlayer = null;

    if (playerId) {
        const byId = await fetch(
            `https://open.faceit.com/data/v4/players/${encodeURIComponent(playerId)}`,
            { headers }
        );

        if (byId.ok) {
            faceitPlayer = await byId.json();
        } else if (byId.status !== 404) {
            const details = await byId.text();
            throw new Error(`FACEIT API HTTP ${byId.status}${details ? ": " + details.slice(0, 180) : ""}`);
        }
    }

    if (!faceitPlayer && nickname) {
        const searchUrl =
            "https://open.faceit.com/data/v4/players?nickname=" +
            encodeURIComponent(nickname) +
            "&game=cs2";

        const response = await fetch(searchUrl, { headers });

        if (!response.ok) {
            const details = await response.text();
            throw new Error(`FACEIT API HTTP ${response.status}${details ? ": " + details.slice(0, 180) : ""}`);
        }

        faceitPlayer = await response.json();
    }

    if (!faceitPlayer || !faceitPlayer.player_id) {
        throw new Error(`Nie znaleziono zawodnika FACEIT: ${nickname || playerId}`);
    }

    const cs2 = faceitPlayer.games?.cs2;

    if (!cs2) {
        throw new Error("FACEIT nie zwrócił danych CS2 dla tego zawodnika.");
    }

    const update = {
        faceit_player_id: faceitPlayer.player_id,
        faceit_nickname: faceitPlayer.nickname || nickname,
        faceit_level: Number(cs2.skill_level || 0),
        faceit_elo: Number(cs2.faceit_elo || 0),
        faceit_url: faceitPlayer.faceit_url || null,
        faceit_updated_at: new Date().toISOString()
    };

    await dynamicUpdate(env, "players", player.id, update);

    return update;
}

async function dynamicUpdate(env, tableName, id, data) {
    const columns = await getTableColumns(env, tableName);

    const updateColumns = Object.keys(data)
        .filter(key =>
            columns.includes(key) &&
            key !== "id"
        );

    if (!updateColumns.length) {
        throw new Error(
            `Brak pól do aktualizacji w tabeli ${tableName}.`
        );
    }

    const assignments = updateColumns
        .map(column => `${column} = ?`)
        .join(", ");

    const values = updateColumns.map(column =>
        normalizeValue(data[column])
    );

    values.push(id);

    const sql = `
        UPDATE ${tableName}
        SET ${assignments}
        WHERE id = ?
    `;

    return await env.DB.prepare(sql)
        .bind(...values)
        .run();
}

const GENERIC_TABLES = {
    players: "players",
    news: "news",
    matches: "matches",
    recruitment: "recruitment",
    achievements: "achievements",
    recruitmentApplications: "recruitment_applications"
};

export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            const parts = getPathParts(url);
            const method = request.method.toUpperCase();

            if (method === "OPTIONS") {
                return new Response(null, {
                    status: 204,
                    headers: corsHeaders(request)
                });
            }

            /*
             * TEST API
             */
            if (method === "GET" && url.pathname === "/api/test") {
                const tables = await env.DB.prepare(`
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table'
                    ORDER BY name
                `).all();

                return json(request, {
                    success: true,
                    message: "5DRAGONS API działa!",
                    tables: tables.results || []
                });
            }

            /*
             * REGISTER
             *
             * users:
             * id
             * email
             * password_hash
             * discord
             * cs2_nick
             * steam
             * role
             * team
             * created_at
             */
            if (method === "POST" && url.pathname === "/api/register") {
                const body = await readJson(request);

                if (!body) {
                    return errorResponse(
                        request,
                        "Nieprawidłowe dane JSON."
                    );
                }

                const email = String(body.email || "")
                    .trim()
                    .toLowerCase();

                const password = String(body.password || "");

                const discord = String(
                    body.discord ||
                    body.username ||
                    ""
                ).trim();

                const cs2Nick = String(
                    body.cs2_nick ||
                    body.nick ||
                    ""
                ).trim();

                const steam = String(
                    body.steam ||
                    ""
                ).trim();

                if (!email || !password) {
                    return errorResponse(
                        request,
                        "Email i hasło są wymagane."
                    );
                }

                if (password.length < 6) {
                    return errorResponse(
                        request,
                        "Hasło musi mieć minimum 6 znaków."
                    );
                }

                const existing = await env.DB.prepare(`
                    SELECT id
                    FROM users
                    WHERE email = ?
                    LIMIT 1
                `)
                    .bind(email)
                    .first();

                if (existing) {
                    return errorResponse(
                        request,
                        "Konto z tym adresem email już istnieje.",
                        409
                    );
                }

                const passwordHash = await sha256(password);

                const result = await env.DB.prepare(`
                    INSERT INTO users
                    (
                        email,
                        password_hash,
                        discord,
                        cs2_nick,
                        steam,
                        role
                    )
                    VALUES (?, ?, ?, ?, ?, 'MEMBER')
                `)
                    .bind(
                        email,
                        passwordHash,
                        discord || null,
                        cs2Nick || null,
                        steam || null
                    )
                    .run();

                return json(request, {
                    success: true,
                    message: "Konto zostało utworzone.",
                    user_id: result.meta.last_row_id
                }, 201);
            }

            /*
             * LOGIN
             */
            if (method === "POST" && url.pathname === "/api/login") {
                const body = await readJson(request);

                if (!body) {
                    return errorResponse(
                        request,
                        "Nieprawidłowe dane JSON."
                    );
                }

                const email = String(body.email || "")
                    .trim()
                    .toLowerCase();

                const password = String(body.password || "");

                if (!email || !password) {
                    return errorResponse(
                        request,
                        "Email i hasło są wymagane."
                    );
                }

                const passwordHash = await sha256(password);

                const user = await env.DB.prepare(`
                    SELECT
                        id,
                        email,
                        discord,
                        cs2_nick,
                        steam,
                        role,
                        team,
                        created_at
                    FROM users
                    WHERE email = ?
                      AND password_hash = ?
                    LIMIT 1
                `)
                    .bind(email, passwordHash)
                    .first();

                if (!user) {
                    return errorResponse(
                        request,
                        "Nieprawidłowy email lub hasło.",
                        401
                    );
                }

                const token = generateToken();
                const tokenHash = await sha256(token);

                await env.DB.prepare(`
                    INSERT INTO sessions
                    (
                        user_id,
                        token_hash,
                        expires_at
                    )
                    VALUES (
                        ?,
                        ?,
                        datetime('now', '+30 days')
                    )
                `)
                    .bind(user.id, tokenHash)
                    .run();

                return json(request, {
                    success: true,
                    token,
                    user
                });
            }

            /*
             * ME
             */
            if (method === "GET" && url.pathname === "/api/me") {
                const auth = await requireAuth(request, env);

                if (!auth.ok) {
                    return auth.response;
                }

                const userColumns = await getTableColumns(env, "users");
                if (!userColumns.includes("photo")) {
                    try {
                        await env.DB.prepare("ALTER TABLE users ADD COLUMN photo TEXT").run();
                    } catch {}
                }

                const meColumns = await getTableColumns(env, "users");
                const meSelect = ["id", "email", "discord", "cs2_nick", "steam", "role", "team", "created_at", meColumns.includes("photo") ? "photo" : "NULL AS photo"].join(", ");

                const fresh = await env.DB.prepare(
                    "SELECT " + meSelect + " FROM users WHERE id = ? LIMIT 1"
                ).bind(auth.user.id).first();

                return json(request, {
                    success: true,
                    user: fresh || { ...auth.user, photo: "" }
                });
            }

            /*
             * LOGOUT
             */
            if (method === "POST" && url.pathname === "/api/logout") {
                const authHeader = request.headers.get("Authorization");

                if (authHeader?.startsWith("Bearer ")) {
                    const token = authHeader
                        .substring(7)
                        .trim();

                    if (token) {
                        const tokenHash = await sha256(token);

                        await env.DB.prepare(`
                            DELETE FROM sessions
                            WHERE token_hash = ?
                        `)
                            .bind(tokenHash)
                            .run();
                    }
                }

                return json(request, {
                    success: true,
                    message: "Wylogowano."
                });
            }

            /*
             * PROFILE
             */
            if (method === "PATCH" && url.pathname === "/api/profile") {
                const auth = await requireAuth(request, env);
                if (!auth.ok) return auth.response;
                const body = await readJson(request);
                if (!body) return errorResponse(request, "Nieprawidłowe dane JSON.");
                const allowed = ["discord", "cs2_nick", "steam", "team"];
                const updateData = {};
                for (const key of allowed) {
                    if (Object.prototype.hasOwnProperty.call(body, key)) {
                        const value = body[key] == null ? null : String(body[key]).trim();
                        updateData[key] = value || null;
                    }
                }
                const columns = await getTableColumns(env, "users");

                // Profilowe zdjęcie zapisujemy jako zwykły publiczny URL z GitHub.
                // Endpoint /api/upload zwraca taki URL po przesłaniu pliku.
                if (Object.prototype.hasOwnProperty.call(body, "photo")) {
                    if (!columns.includes("photo")) {
                        try {
                            await env.DB.prepare("ALTER TABLE users ADD COLUMN photo TEXT").run();
                        } catch {}
                    }
                    updateData.photo = body.photo == null ? null : String(body.photo).trim() || null;
                }

                if (Object.prototype.hasOwnProperty.call(body, "avatar") && columns.includes("avatar")) {
                    const value = body.avatar == null ? null : String(body.avatar);
                    if (value && (!value.startsWith("data:image/") || value.length > 2500000)) return errorResponse(request, "Zdjęcie profilu jest nieprawidłowe albo za duże. Maksymalnie 2 MB.");
                    updateData.avatar = value || null;
                }

                if (!Object.keys(updateData).length) return errorResponse(request, "Brak danych do zapisania.");

                await dynamicUpdate(env, "users", auth.user.id, updateData);

                const freshColumns = await getTableColumns(env, "users");
                const profileSelect = ["id", "email", "discord", "cs2_nick", "steam", "role", "team", "created_at", freshColumns.includes("photo") ? "photo" : "NULL AS photo"].join(", ");
                const user = await env.DB.prepare(
                    "SELECT " + profileSelect + " FROM users WHERE id = ? LIMIT 1"
                ).bind(auth.user.id).first();

                return json(request, { success: true, message: "Profil został zapisany.", user });
            }

            /*
             * CONTACT
             */
            if (method === "POST" && url.pathname === "/api/contact") {
                const body = await readJson(request);

                if (!body) {
                    return errorResponse(
                        request,
                        "Nieprawidłowe dane formularza."
                    );
                }

                const name = String(body.name || "").trim();
                const email = String(body.email || "").trim();
                const subject = String(body.subject || "Kontakt 5DRAGONS").trim();
                const message = String(body.message || "").trim();

                if (!name || !email || !message) {
                    return errorResponse(
                        request,
                        "Imię, email i wiadomość są wymagane."
                    );
                }

                if (!env.RESEND_API_KEY) {
                    return errorResponse(
                        request,
                        "Brak konfiguracji RESEND_API_KEY.",
                        500
                    );
                }

                const html = `
                    <h2>Nowa wiadomość z formularza 5DRAGONS</h2>

                    <p><strong>Imię:</strong> ${escapeHtml(name)}</p>
                    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
                    <p><strong>Temat:</strong> ${escapeHtml(subject)}</p>

                    <hr>

                    <p style="white-space:pre-wrap;">
                        ${escapeHtml(message)}
                    </p>
                `;

                const text = `
Nowa wiadomość z formularza 5DRAGONS

Imię: ${name}
Email: ${email}
Temat: ${subject}

Wiadomość:
${message}
`;

                const resendResponse = await fetch(
                    "https://api.resend.com/emails",
                    {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            from: "5DRAGONS <onboarding@resend.dev>",
                            to: ["matkosmo27@gmail.com"],
                            reply_to: email,
                            subject: `[5DRAGONS] ${subject}`,
                            html,
                            text
                        })
                    }
                );

                const resendData = await resendResponse.json();

                if (!resendResponse.ok) {
                    return errorResponse(
                        request,
                        resendData?.message ||
                        "Nie udało się wysłać wiadomości.",
                        500
                    );
                }

                return json(request, {
                    success: true,
                    message: "Wiadomość została wysłana."
                });
            }

            /*
             * FACEIT BULK SYNC
             */
            if (
                method === "POST" &&
                url.pathname === "/api/faceit/sync"
            ) {
                const admin = await requireAdmin(request, env);

                if (!admin.ok) {
                    return admin.response;
                }

                const result = await env.DB.prepare(`
                    SELECT *
                    FROM players
                    WHERE status = 'ACTIVE'
                    ORDER BY id ASC
                `).all();

                const synced = [];
                const failed = [];

                for (const player of (result.results || [])) {
                    try {
                        const faceit = await syncFaceitPlayer(env, player);
                        synced.push({
                            id: player.id,
                            nick: player.nick,
                            faceit
                        });
                    } catch (error) {
                        failed.push({
                            id: player.id,
                            nick: player.nick,
                            error: error?.message || "Nie udało się zaktualizować FACEIT."
                        });
                    }
                }

                return json(request, {
                    success: true,
                    message: `Zaktualizowano FACEIT: ${synced.length}, błędy: ${failed.length}.`,
                    synced,
                    failed
                });
            }

            /*
             * PLAYERS
             */
            if (parts[1] === "players") {
                const id = getIdFromPath(parts);

                if (
                    method === "POST" &&
                    parts.length === 4 &&
                    parts[3] === "faceit" &&
                    id
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const player = await env.DB.prepare(`
                        SELECT *
                        FROM players
                        WHERE id = ?
                        LIMIT 1
                    `)
                        .bind(id)
                        .first();

                    if (!player) {
                        return errorResponse(
                            request,
                            "Nie znaleziono zawodnika.",
                            404
                        );
                    }

                    const faceit = await syncFaceitPlayer(env, player);

                    return json(request, {
                        success: true,
                        message: "Dane FACEIT zostały zaktualizowane.",
                        faceit
                    });
                }

                if (method === "GET") {
                    if (id) {
                        const player = await env.DB.prepare(`
                            SELECT *
                            FROM players
                            WHERE id = ?
                            LIMIT 1
                        `)
                            .bind(id)
                            .first();

                        if (!player) {
                            return errorResponse(
                                request,
                                "Nie znaleziono zawodnika.",
                                404
                            );
                        }

                        return json(request, {
                            success: true,
                            player
                        });
                    }

                    const result = await env.DB.prepare(`
                        SELECT *
                        FROM players
                        WHERE status = 'ACTIVE'
                        ORDER BY id ASC
                    `).all();

                    return json(request, {
                        success: true,
                        players: result.results || []
                    });
                }

                if (
                    method === "POST" &&
                    url.pathname === "/api/players"
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane JSON."
                        );
                    }

                    const result = await dynamicInsert(
                        env,
                        "players",
                        body
                    );

                    return json(request, {
                        success: true,
                        message: "Zawodnik został dodany.",
                        id: result.meta.last_row_id
                    }, 201);
                }

                if (
                    (method === "PATCH" || method === "PUT") &&
                    id
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane JSON."
                        );
                    }

                    await dynamicUpdate(
                        env,
                        "players",
                        id,
                        body
                    );

                    return json(request, {
                        success: true,
                        message: "Zawodnik został zaktualizowany."
                    });
                }

                if (method === "DELETE" && id) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    await env.DB.prepare(`
                        UPDATE players
                        SET status = 'INACTIVE'
                        WHERE id = ?
                    `)
                        .bind(id)
                        .run();

                    return json(request, {
                        success: true,
                        message: "Zawodnik został ukryty."
                    });
                }
            }

            /*
             * NEWS
             */
            if (parts[1] === "news") {
                const id = getIdFromPath(parts);
                if (method === "GET") {
                    const result = await env.DB.prepare(`
                        SELECT *
                        FROM news
                        WHERE status = 'PUBLISHED'
                        ORDER BY
                            COALESCE(published_at, created_at) DESC,
                            id DESC
                    `).all();

                    return json(request, {
                        success: true,
                        news: result.results || []
                    });
                }

                if ((method === "PATCH" || method === "PUT" || method === "DELETE") && id) {
                    const admin = await requireAdmin(request, env);
                    if (!admin.ok) return admin.response;
                    if (method === "DELETE") {
                        await env.DB.prepare("UPDATE news SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
                        return json(request, { success: true, message: "News został usunięty." });
                    }
                    const body = await readJson(request);
                    if (!body) return errorResponse(request, "Nieprawidłowe dane JSON.");
                    await dynamicUpdate(env, "news", id, body);
                    return json(request, { success: true, message: "News został zaktualizowany." });
                }

                if (
                    method === "POST" &&
                    url.pathname === "/api/news"
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane JSON."
                        );
                    }

                    const result = await dynamicInsert(
                        env,
                        "news",
                        body
                    );

                    return json(request, {
                        success: true,
                        message: "News został dodany.",
                        id: result.meta.last_row_id
                    }, 201);
                }
            }

            /*
             * MATCHES
             */
            if (parts[1] === "matches") {
                const id = getIdFromPath(parts);
                if (method === "GET") {
                    const result = await env.DB.prepare(`
                        SELECT *
                        FROM matches
                        ORDER BY date ASC, time ASC, id ASC
                    `).all();

                    return json(request, {
                        success: true,
                        matches: result.results || []
                    });
                }

                if ((method === "PATCH" || method === "PUT" || method === "DELETE") && id) {
                    const admin = await requireAdmin(request, env);
                    if (!admin.ok) return admin.response;
                    if (method === "DELETE") {
                        await env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(id).run();
                        return json(request, { success: true, message: "Mecz został usunięty." });
                    }
                    const body = await readJson(request);
                    if (!body) return errorResponse(request, "Nieprawidłowe dane JSON.");
                    await dynamicUpdate(env, "matches", id, body);
                    return json(request, { success: true, message: "Mecz został zaktualizowany." });
                }

                if (
                    method === "POST" &&
                    url.pathname === "/api/matches"
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane JSON."
                        );
                    }

                    const result = await dynamicInsert(
                        env,
                        "matches",
                        body
                    );

                    return json(request, {
                        success: true,
                        message: "Mecz został dodany.",
                        id: result.meta.last_row_id
                    }, 201);
                }
            }

            /*
             * RECRUITMENT
             */
            if (parts[1] === "recruitment") {
                const id = getIdFromPath(parts);
                /*
                 * PUBLIC LISTA REKRUTACJI
                 */
                if (
                    method === "GET" &&
                    url.pathname === "/api/recruitment"
                ) {
                    const result = await env.DB.prepare(`
                        SELECT *
                        FROM recruitment
                        WHERE active = 1
                        ORDER BY id DESC
                    `).all();

                    return json(request, {
                        success: true,
                        recruitment: result.results || []
                    });
                }

                if ((method === "PATCH" || method === "PUT" || method === "DELETE") && id) {
                    const admin = await requireAdmin(request, env);
                    if (!admin.ok) return admin.response;
                    if (method === "DELETE") {
                        await env.DB.prepare("UPDATE recruitment SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
                        return json(request, { success: true, message: "Ogłoszenie zostało wyłączone." });
                    }
                    const body = await readJson(request);
                    if (!body) return errorResponse(request, "Nieprawidłowe dane JSON.");
                    await dynamicUpdate(env, "recruitment", id, body);
                    return json(request, { success: true, message: "Ogłoszenie zostało zaktualizowane." });
                }

                /*
                 * ADMIN: DODAWANIE REKRUTACJI
                 */
                if (
                    method === "POST" &&
                    url.pathname === "/api/recruitment"
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane JSON."
                        );
                    }

                    const result = await dynamicInsert(
                        env,
                        "recruitment",
                        body
                    );

                    return json(request, {
                        success: true,
                        message: "Ogłoszenie rekrutacyjne zostało dodane.",
                        id: result.meta.last_row_id
                    }, 201);
                }

                /*
                 * ZGŁOSZENIE DO REKRUTACJI
                 *
                 * Frontend używa:
                 * /api/recruitment/applications
                 */
                if (
                    method === "POST" &&
                    url.pathname === "/api/recruitment/applications"
                ) {
                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane formularza."
                        );
                    }

                    // Formularz może używać pola "cs2" albo "cs2_nick".
                    // D1 wymaga niepustego cs2_nick, więc normalizujemy dane tutaj,
                    // niezależnie od wersji frontendu/cache przeglądarki.
                    if (
                        (body.cs2_nick === undefined || body.cs2_nick === null || String(body.cs2_nick).trim() === "") &&
                        body.cs2 !== undefined &&
                        body.cs2 !== null
                    ) {
                        body.cs2_nick = String(body.cs2).trim();
                    }

                    if (!body.cs2_nick) {
                        return errorResponse(
                            request,
                            "Nick CS2 jest wymagany."
                        );
                    }

                    delete body.cs2;

                    // Formularz wysyła poziom FACEIT jako "faceit",
                    // natomiast tabela D1 wymaga pola "faceit_level".
                    if (
                        (body.faceit_level === undefined || body.faceit_level === null || String(body.faceit_level).trim() === "") &&
                        body.faceit !== undefined &&
                        body.faceit !== null &&
                        String(body.faceit).trim() !== ""
                    ) {
                        body.faceit_level = Number(body.faceit);
                    }

                    delete body.faceit;

                    const result = await dynamicInsert(
                        env,
                        "recruitment_applications",
                        body
                    );

                    return json(request, {
                        success: true,
                        message: "Zgłoszenie zostało wysłane.",
                        id: result.meta.last_row_id
                    }, 201);
                }

                /*
                 * ADMIN: LISTA ZGŁOSZEŃ
                 */
                if (
                    method === "GET" &&
                    url.pathname === "/api/recruitment/applications"
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const result = await env.DB.prepare(`
                        SELECT *
                        FROM recruitment_applications
                        ORDER BY id DESC
                    `).all();

                    return json(request, {
                        success: true,
                        applications: result.results || []
                    });
                }
            }

            /*
             * ACHIEVEMENTS
             */
            if (parts[1] === "achievements") {
                const id = getIdFromPath(parts);
                if (method === "GET") {
                    const result = await env.DB.prepare(`
                        SELECT *
                        FROM achievements
                        ORDER BY year DESC, id DESC
                    `).all();

                    return json(request, {
                        success: true,
                        achievements: result.results || []
                    });
                }

                if ((method === "PATCH" || method === "PUT" || method === "DELETE") && id) {
                    const admin = await requireAdmin(request, env);
                    if (!admin.ok) return admin.response;
                    if (method === "DELETE") {
                        await env.DB.prepare("DELETE FROM achievements WHERE id = ?").bind(id).run();
                        return json(request, { success: true, message: "Osiągnięcie zostało usunięte." });
                    }
                    const body = await readJson(request);
                    if (!body) return errorResponse(request, "Nieprawidłowe dane JSON.");
                    await dynamicUpdate(env, "achievements", id, body);
                    return json(request, { success: true, message: "Osiągnięcie zostało zaktualizowane." });
                }

                if (
                    method === "POST" &&
                    url.pathname === "/api/achievements"
                ) {
                    const admin = await requireAdmin(request, env);

                    if (!admin.ok) {
                        return admin.response;
                    }

                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane JSON."
                        );
                    }

                    const result = await dynamicInsert(
                        env,
                        "achievements",
                        body
                    );

                    return json(request, {
                        success: true,
                        message: "Osiągnięcie zostało dodane.",
                        id: result.meta.last_row_id
                    }, 201);
                }
            }

            /*
             * USERS
             */
            if (parts[1] === "users") {
                const admin = await requireAdmin(request, env);

                if (!admin.ok) {
                    return admin.response;
                }

                if (
                    method === "GET" &&
                    url.pathname === "/api/users"
                ) {
                    const result = await env.DB.prepare(`
                        SELECT
                            id,
                            email,
                            discord,
                            cs2_nick,
                            steam,
                            role,
                            team,
                            created_at
                        FROM users
                        ORDER BY id DESC
                    `).all();

                    return json(request, {
                        success: true,
                        users: result.results || []
                    });
                }

                if (
                    method === "PATCH" &&
                    parts.length === 3
                ) {
                    const id = getIdFromPath(parts);

                    if (!id) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe ID użytkownika."
                        );
                    }

                    const body = await readJson(request);

                    if (!body) {
                        return errorResponse(
                            request,
                            "Nieprawidłowe dane JSON."
                        );
                    }

                    const allowed = [
                        "discord",
                        "cs2_nick",
                        "steam",
                        "role",
                        "team",
                        "photo"
                    ];

                    const updateData = {};

                    for (const key of allowed) {
                        if (Object.prototype.hasOwnProperty.call(body, key)) {
                            updateData[key] = body[key];
                        }
                    }

                    if (!Object.keys(updateData).length) {
                        return errorResponse(
                            request,
                            "Brak pól do aktualizacji."
                        );
                    }

                    await dynamicUpdate(
                        env,
                        "users",
                        id,
                        updateData
                    );

                    return json(request, {
                        success: true,
                        message: "Użytkownik został zaktualizowany."
                    });
                }
            }

            /*
             * FREE IMAGE UPLOAD
             *
             * Obrazy są zapisywane bezpłatnie w repozytorium GitHub.
             * Wymagany secret Workera: GITHUB_TOKEN.
             */
            if (url.pathname === "/api/upload" && method === "POST") {
                const auth = await requireAuth(request, env);
                if (!auth.ok) return auth.response;
                if (!env.GITHUB_TOKEN) return errorResponse(request, "Brak konfiguracji GITHUB_TOKEN w Workerze.", 500);

                const form = await request.formData();
                const file = form.get("file");
                const folderRaw = String(form.get("folder") || "uploads");
                const requestedFolder = folderRaw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "uploads";
                const adminRoles = ["OWNER", "ADMIN", "MANAGER", "COACH", "EDITOR"];
                if (!adminRoles.includes(auth.user.role) && requestedFolder !== "profile") {
                    return errorResponse(request, "Brak uprawnień do tego rodzaju uploadu.", 403);
                }
                const folder = requestedFolder;

                if (!(file instanceof File)) return errorResponse(request, "Nie wybrano pliku.");
                if (file.size > 10 * 1024 * 1024) return errorResponse(request, "Plik jest za duży. Maksymalnie 10 MB.");
                if (!String(file.type || "").startsWith("image/")) return errorResponse(request, "Dozwolone są tylko pliki graficzne.");

                const extMap = {
                    "image/jpeg": "jpg",
                    "image/png": "png",
                    "image/webp": "webp",
                    "image/gif": "gif",
                    "image/svg+xml": "svg",
                    "image/avif": "avif"
                };
                const ext = extMap[file.type] || "bin";
                const path = `uploads/${folder}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
                const base64 = arrayBufferToBase64(await file.arrayBuffer());

                const ghResponse = await fetch(
                    `https://api.github.com/repos/matkosmo27-byte/5DRAGONS/contents/${path}`,
                    {
                        method: "PUT",
                        headers: {
                            "Accept": "application/vnd.github+json",
                            "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
                            "X-GitHub-Api-Version": "2022-11-28",
                            "User-Agent": "5DRAGONS-Worker",
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            message: `Upload image ${path}`,
                            content: base64,
                            branch: "main"
                        })
                    }
                );

                let ghData = {};
                try { ghData = await ghResponse.json(); } catch {}

                if (!ghResponse.ok) {
                    console.error("GitHub upload failed:", ghResponse.status, ghData);
                    const details = ghData && (ghData.message || ghData.error);
                    return errorResponse(
                        request,
                        `GitHub odrzucił zapis zdjęcia (HTTP ${ghResponse.status})${details ? ": " + String(details).slice(0, 300) : "."}`,
                        502
                    );
                }

                const imageUrl = `https://raw.githubusercontent.com/matkosmo27-byte/5DRAGONS/main/${path}`;

                return json(request, {
                    success: true,
                    url: imageUrl,
                    path,
                    size: file.size,
                    type: file.type
                });
            }

            /*
             * SITE SETTINGS / BRANDING
             *
             * Produkcyjna tabela settings jest singletonem z rekordem id=1.
             * Używamy istniejących kolumn zamiast schematu key/value.
             */
            if (url.pathname === "/api/settings" || url.pathname === "/api/branding") {
                if (method === "GET") {
                    const columns = await getTableColumns(env, "settings");
                    const hasFooterLogo = columns.includes("footer_logo");
                    const hasFavicon = columns.includes("favicon");
                    const selectColumns = ["id","site_name","logo_url",hasFooterLogo ? "footer_logo" : "NULL AS footer_logo",hasFavicon ? "favicon" : "NULL AS favicon"].join(", ");
                    let row = await env.DB.prepare(`SELECT ${selectColumns} FROM settings WHERE id = 1 LIMIT 1`).first();
                    if (!row) {
                        await env.DB.prepare(`INSERT INTO settings (id, site_name) VALUES (1, '5Dragons Academy')`).run();
                        row = await env.DB.prepare(`SELECT ${selectColumns} FROM settings WHERE id = 1 LIMIT 1`).first();
                    }
                    return json(request, { success: true, settings: { site_name: row?.site_name || "5Dragons Academy", site_logo: row?.logo_url || "", footer_logo: row?.footer_logo || "", favicon: row?.favicon || "" } });
                }
                if (method === "PATCH" || method === "POST") {
                    const admin = await requireAdmin(request, env);
                    if (!admin.ok) return admin.response;
                    const body = await readJson(request);
                    if (!body || typeof body !== "object") return errorResponse(request, "Nieprawidłowe dane ustawień.");
                    const columns = await getTableColumns(env, "settings");
                    const updateData = {};
                    if (Object.prototype.hasOwnProperty.call(body, "site_name")) updateData.site_name = String(body.site_name ?? "").trim() || "5Dragons Academy";
                    if (Object.prototype.hasOwnProperty.call(body, "site_logo")) updateData.logo_url = String(body.site_logo ?? "").trim();
                    if (columns.includes("footer_logo") && Object.prototype.hasOwnProperty.call(body, "footer_logo")) updateData.footer_logo = String(body.footer_logo ?? "").trim();
                    if (columns.includes("favicon") && Object.prototype.hasOwnProperty.call(body, "favicon")) updateData.favicon = String(body.favicon ?? "").trim();
                    if (!Object.keys(updateData).length) return errorResponse(request, "Brak ustawień do zapisania.");
                    const existing = await env.DB.prepare(`SELECT id FROM settings WHERE id = 1 LIMIT 1`).first();
                    if (!existing) await env.DB.prepare(`INSERT INTO settings (id, site_name) VALUES (1, '5Dragons Academy')`).run();
                    await dynamicUpdate(env, "settings", 1, updateData);

                    const savedColumns = ["id", "site_name", "logo_url"];
                    if (columns.includes("footer_logo")) savedColumns.push("footer_logo");
                    if (columns.includes("favicon")) savedColumns.push("favicon");

                    const saved = await env.DB.prepare(
                        `SELECT ${savedColumns.join(", ")} FROM settings WHERE id = 1 LIMIT 1`
                    ).first();

                    return json(request, {
                        success: true,
                        message: "Ustawienia strony zostały zapisane.",
                        settings: {
                            site_name: saved?.site_name || "5Dragons Academy",
                            site_logo: saved?.logo_url || "",
                            footer_logo: saved?.footer_logo || "",
                            favicon: saved?.favicon || ""
                        }
                    });
                }
                return errorResponse(request, "Niedozwolona metoda.", 405);
            }

            /*
             * FRONTEND
             *
             * Worker serwuje również statyczny frontend z repozytorium GitHub.
             * Dzięki temu ten sam adres Cloudflare może obsługiwać stronę oraz /api/*.
             */
            const isApiRequest = url.pathname === "/api" || url.pathname.startsWith("/api/");

            if (!isApiRequest && (method === "GET" || method === "HEAD")) {
                const requestedPath = url.pathname === "/"
                    ? "index.html"
                    : url.pathname.replace(/^\/+/, "");

                if (url.pathname === "/") {
                    const rawUrl = "https://raw.githubusercontent.com/matkosmo27-byte/5DRAGONS/main/index.html";
                    const assetResponse = await fetch(rawUrl, {
                        headers: { "User-Agent": "5DRAGONS-Worker" }
                    });

                    if (assetResponse.ok) {
                        const headers = new Headers(assetResponse.headers);
                        headers.delete("Content-Security-Policy");
                        headers.set("Content-Type", "text/html; charset=UTF-8");
                        headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
                        headers.set("X-5DRAGONS-Frontend", "github-main");
                        return new Response(method === "HEAD" ? null : assetResponse.body, {
                            status: assetResponse.status,
                            headers
                        });
                    }
                }

                if (
                    requestedPath &&
                    !requestedPath.includes("..") &&
                    /^[a-zA-Z0-9_./-]+$/.test(requestedPath) &&
                    /\.(html|css|js|png|jpg|jpeg|webp|gif|svg|ico|avif|woff2?|ttf|json)$/i.test(requestedPath)
                ) {
                    const rawUrl = "https://raw.githubusercontent.com/matkosmo27-byte/5DRAGONS/main/" + requestedPath;
                    const assetResponse = await fetch(rawUrl, {
                        headers: { "User-Agent": "5DRAGONS-Worker" }
                    });

                    if (assetResponse.ok) {
                        const headers = new Headers(assetResponse.headers);
                        headers.delete("Content-Security-Policy");

                        const contentTypes = {
                            html: "text/html; charset=UTF-8",
                            css: "text/css; charset=UTF-8",
                            js: "application/javascript; charset=UTF-8",
                            json: "application/json; charset=UTF-8",
                            svg: "image/svg+xml",
                            png: "image/png",
                            jpg: "image/jpeg",
                            jpeg: "image/jpeg",
                            webp: "image/webp",
                            gif: "image/gif",
                            ico: "image/x-icon",
                            avif: "image/avif",
                            woff: "font/woff",
                            woff2: "font/woff2",
                            ttf: "font/ttf"
                        };

                        const extension = requestedPath.split(".").pop().toLowerCase();
                        if (contentTypes[extension]) {
                            headers.set("Content-Type", contentTypes[extension]);
                        }

                        headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
                        headers.set("X-5DRAGONS-Frontend", "github-main");
                        return new Response(method === "HEAD" ? null : assetResponse.body, {
                            status: assetResponse.status,
                            headers
                        });
                    }
                }
            }

            /*
             * ROOT
             */
            if (url.pathname === "/") {
                return json(request, {
                    success: false,
                    error: "Nie znaleziono strony."
                }, 404);
            }

            return errorResponse(
                request,
                "Nie znaleziono endpointu.",
                404
            );

        } catch (error) {
            console.error(error);

            return json(request, {
                success: false,
                error: error?.message ||
                    "Wewnętrzny błąd serwera."
            }, 500);
        }
    }
};

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}