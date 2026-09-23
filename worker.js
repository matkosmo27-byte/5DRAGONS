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

                return json(request, {
                    success: true,
                    user: auth.user
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
             * PLAYERS
             */
            if (parts[1] === "players") {
                const id = getIdFromPath(parts);

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
                        "team"
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
             * ROOT
             */
            if (url.pathname === "/") {
                return json(request, {
                    success: false,
                    error: "Nie znaleziono endpointu."
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