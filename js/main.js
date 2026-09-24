const API_URL = 'https://calm-sunset-b06e.matkosmo27.workers.dev';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];


/* =========================================================
   API
========================================================= */

async function api(path, options = {}) {
    const token = localStorage.getItem('5d_token');

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(API_URL + path, {
        ...options,
        headers
    });

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

    if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Błąd API.');
    }

    return data;
}


/* =========================================================
   NAVIGATION
========================================================= */

function nav() {
    const file =
        location.pathname.split('/').pop() || 'index.html';

    $$('[data-nav]').forEach(link => {
        if (link.getAttribute('href') === file) {
            link.classList.add('active');
        }
    });
}


function renderNav() {
    const root = $('[data-nav-root]');

    if (!root) {
        return;
    }

    root.innerHTML = `
        <nav class="nav">
            <div class="container nav-inner">

                <a class="brand" href="index.html">
                    <img
                        src="assets/logo.png"
                        onerror="this.style.display='none'"
                    >
                    <span>
                        5<span>DRAGONS</span>
                    </span>
                </a>

                <div class="links">
                    <a data-nav href="index.html">HOME</a>
                    <a data-nav href="team.html">TEAM</a>
                    <a data-nav href="academy.html">ACADEMY</a>
                    <a data-nav href="matches.html">MATCHES</a>
                    <a data-nav href="news.html">NEWS</a>
                    <a data-nav href="recruitment.html">RECRUITMENT</a>
                    <a data-nav href="about.html">ABOUT</a>
                    <a data-nav href="contact.html">CONTACT</a>
                    <a data-nav href="login.html">LOGIN</a>
                </div>

                <a class="btn" href="recruitment.html">
                    JOIN US
                </a>

            </div>
        </nav>
    `;

    nav();
}


/* =========================================================
   FOOTER
========================================================= */

function footer() {
    const root = $('[data-footer]');

    if (!root) {
        return;
    }

    root.innerHTML = `
        <footer class="footer">
            <div class="container">
                © ${new Date().getFullYear()}
                5DRAGONS Academy. All rights reserved.
            </div>
        </footer>
    `;
}


/* =========================================================
   PLAYERS
========================================================= */

async function loadPlayers() {
    const box = $('[data-players]');

    if (!box) {
        return;
    }

    try {
        const data = await api('/api/players');

        const players = Array.isArray(data.players)
            ? data.players
            : [];

        if (!players.length) {
            box.innerHTML = `
                <p class="muted">
                    Brak zawodników.
                </p>
            `;
            return;
        }

        box.innerHTML = players.map(player => `
            <div class="card">

                <div class="player">

                    <img
                        class="avatar"
                        src="${player.photo || 'assets/logo.png'}"
                        alt="${player.nick || 'Player'}"
                        onerror="this.src='assets/logo.png'"
                    >

                    <div>
                        <h3>
                            ${player.nick || 'Unknown'}
                        </h3>

                        <span class="tag">
                            ${player.role || 'RIFLER'}
                        </span>

                        <div class="muted">
                            ${player.team || 'MAIN'}
                        </div>
                    </div>

                </div>

                <div class="stats">

                    <div class="stat">
                        <strong>
                            ${player.faceit_elo || 0}
                        </strong>
                        <small>ELO</small>
                    </div>

                    <div class="stat">
                        <strong>
                            ${player.faceit_level || 0}
                        </strong>
                        <small>FACEIT</small>
                    </div>

                </div>

            </div>
        `).join('');

    } catch (error) {
        box.innerHTML = `
            <p class="muted">
                ${escapeHtml(error.message)}
            </p>
        `;
    }
}


/* =========================================================
   NEWS
========================================================= */

async function loadNews() {
    const box = $('[data-news]');

    if (!box) {
        return;
    }

    try {
        const data = await api('/api/news');

        const news = Array.isArray(data.news)
            ? data.news
            : [];

        if (!news.length) {
            box.innerHTML = `
                <p class="muted">
                    Brak newsów.
                </p>
            `;
            return;
        }

        box.innerHTML = news.map(item => `
            <a
                class="card"
                href="article.html?id=${encodeURIComponent(item.id)}"
            >

                <span class="tag">
                    ${escapeHtml(item.category || 'NEWS')}
                </span>

                <h3>
                    ${escapeHtml(item.title || '')}
                </h3>

                <p>
                    ${escapeHtml(item.excerpt || '')}
                </p>

                <small class="muted">
                    ${escapeHtml(item.created_at || '')}
                </small>

            </a>
        `).join('');

    } catch (error) {
        box.innerHTML = `
            <p class="muted">
                ${escapeHtml(error.message)}
            </p>
        `;
    }
}


/* =========================================================
   MATCHES
========================================================= */

async function loadMatches() {
    const box = $('[data-matches]');

    if (!box) {
        return;
    }

    try {
        const data = await api('/api/matches');

        const matches = Array.isArray(data.matches)
            ? data.matches
            : [];

        if (!matches.length) {
            box.innerHTML = `
                <p class="muted">
                    Brak meczów.
                </p>
            `;
            return;
        }

        box.innerHTML = matches.map(match => `
            <div class="card">

                <span class="tag">
                    ${escapeHtml(match.status || 'UPCOMING')}
                </span>

                <h3>
                    5DRAGONS
                    <span class="muted">vs</span>
                    ${escapeHtml(match.opponent || 'TBA')}
                </h3>

                <p>
                    ${escapeHtml(match.competition || '')}
                    ${match.map ? ` · ${escapeHtml(match.map)}` : ''}
                </p>

                <strong>
                    ${
                        match.our_score !== null &&
                        match.our_score !== undefined &&
                        match.opponent_score !== null &&
                        match.opponent_score !== undefined
                            ? `${match.our_score}:${match.opponent_score}`
                            : '—'
                    }
                </strong>

                <div class="muted">
                    ${escapeHtml(match.date || '')}
                    ${escapeHtml(match.time || '')}
                </div>

            </div>
        `).join('');

    } catch (error) {
        box.innerHTML = `
            <p class="muted">
                ${escapeHtml(error.message)}
            </p>
        `;
    }
}


/* =========================================================
   RECRUITMENT
========================================================= */

function recruitment() {
    const form = $('#recruitment-form');

    if (!form) {
        return;
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();

        const status = $('#form-status');

        const data = Object.fromEntries(
            new FormData(form).entries()
        );

        delete data.agreement;

        if (data.faceit !== undefined && data.faceit !== '') {
            data.faceit = Number(data.faceit);
        }

        if (data.age !== undefined && data.age !== '') {
            data.age = Number(data.age);
        }

        status.textContent = 'Wysyłanie...';

        try {
            await api('/api/recruitment/applications', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            form.reset();

            status.textContent =
                'Zgłoszenie zostało wysłane.';

        } catch (error) {
            status.textContent = error.message;
        }
    });
}


/* =========================================================
   CONTACT
========================================================= */

function contact() {
    const form = $('#contact-form');

    if (!form) {
        return;
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();

        const status = $('#form-status');

        const data = Object.fromEntries(
            new FormData(form).entries()
        );

        status.textContent = 'Wysyłanie...';

        try {
            await api('/api/contact', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            form.reset();

            status.textContent =
                'Wiadomość została wysłana.';

        } catch (error) {
            status.textContent = error.message;
        }
    });
}


/* =========================================================
   LOGIN + REGISTER
========================================================= */

function auth() {

    const loginForm = $('#login-form');

    if (loginForm) {

        loginForm.addEventListener('submit', async event => {

            event.preventDefault();

            const status = $('#form-status');

            const emailInput =
                loginForm.querySelector('[name="email"]');

            const passwordInput =
                loginForm.querySelector('[name="password"]');

            const email =
                emailInput?.value.trim() || '';

            const password =
                passwordInput?.value || '';

            if (!email || !password) {
                status.textContent =
                    'Wpisz email i hasło.';
                return;
            }

            status.textContent =
                'Logowanie...';

            try {

                const response = await api('/api/login', {
                    method: 'POST',
                    body: JSON.stringify({
                        email,
                        password
                    })
                });

                if (!response.token) {
                    throw new Error(
                        'Serwer nie zwrócił tokenu logowania.'
                    );
                }

                localStorage.setItem(
                    '5d_token',
                    response.token
                );

                status.textContent =
                    'Zalogowano.';

                window.location.href =
                    'profile.html';

            } catch (error) {

                status.textContent =
                    error.message;
            }
        });
    }


    const registerForm = $('#register-form');

    if (registerForm) {

        registerForm.addEventListener(
            'submit',
            async event => {

                event.preventDefault();

                const status = $('#form-status');

                const data = Object.fromEntries(
                    new FormData(registerForm).entries()
                );

                /*
                 * Formularz używa pola "username",
                 * ale baza użytkowników ma kolumnę "discord".
                 * Worker obsługuje username jako alias podczas rejestracji.
                 */

                status.textContent =
                    'Tworzenie konta...';

                try {

                    await api('/api/register', {
                        method: 'POST',
                        body: JSON.stringify(data)
                    });

                    status.textContent =
                        'Konto utworzone. Przechodzenie do logowania...';

                    setTimeout(() => {
                        window.location.href =
                            'login.html';
                    }, 700);

                } catch (error) {

                    status.textContent =
                        error.message;
                }
            }
        );
    }
}


/* =========================================================
   ARTICLE
========================================================= */

async function article() {
    const box = $('[data-article]');

    if (!box) {
        return;
    }

    try {

        const id =
            new URLSearchParams(location.search)
                .get('id');

        if (!id) {
            box.innerHTML = `
                <p>
                    Nie znaleziono artykułu.
                </p>
            `;
            return;
        }

        const data =
            await api('/api/news');

        const news =
            Array.isArray(data.news)
                ? data.news
                : [];

        const item =
            news.find(
                newsItem =>
                    String(newsItem.id) === String(id)
            );

        if (!item) {
            box.innerHTML = `
                <p>
                    Nie znaleziono artykułu.
                </p>
            `;
            return;
        }

        box.innerHTML = `
            <article class="article">

                <span class="tag">
                    ${escapeHtml(item.category || 'NEWS')}
                </span>

                <h1>
                    ${escapeHtml(item.title || '')}
                </h1>

                <p class="muted">
                    ${escapeHtml(item.created_at || '')}
                </p>

                ${
                    item.image
                        ? `
                            <img
                                src="${escapeHtml(item.image)}"
                                alt=""
                            >
                        `
                        : ''
                }

                <div class="article-body">
                    ${formatArticleContent(
                        item.content ||
                        item.excerpt ||
                        ''
                    )}
                </div>

            </article>
        `;

    } catch (error) {

        box.innerHTML = `
            <p>
                ${escapeHtml(error.message)}
            </p>
        `;
    }
}


/* =========================================================
   PROFILE
========================================================= */

async function profile() {

    const box = $('[data-profile]');

    if (!box) {
        return;
    }

    try {

        const data =
            await api('/api/me');

        const user =
            data.user;

        const displayName =
            user.cs2_nick ||
            user.discord ||
            user.email ||
            'Użytkownik';

        box.innerHTML = `
            <div class="card">

                <h2>
                    ${escapeHtml(displayName)}
                </h2>

                <p>
                    ${escapeHtml(user.email || '')}
                </p>

                <span class="tag">
                    ${escapeHtml(user.role || 'MEMBER')}
                </span>

                ${
                    user.team
                        ? `
                            <p class="muted">
                                Team:
                                ${escapeHtml(user.team)}
                            </p>
                        `
                        : ''
                }

            </div>
        `;

    } catch {

        localStorage.removeItem('5d_token');

        box.innerHTML = `
            <div class="notice">
                Nie jesteś zalogowany.
                <a href="login.html">
                    Zaloguj się
                </a>.
            </div>
        `;
    }
}


/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

    const token =
        localStorage.getItem('5d_token');

    if (!token) {
        return;
    }

    try {
        await api('/api/logout', {
            method: 'POST'
        });
    } catch {
        // Nawet jeśli API odpowie błędem,
        // lokalny token zostanie usunięty.
    }

    localStorage.removeItem('5d_token');

    window.location.href =
        'login.html';
}


/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(value) {

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


function formatArticleContent(value) {

    return escapeHtml(value)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '<br>');
}


/* =========================================================
   START
========================================================= */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        renderNav();
        footer();

        loadPlayers();
        loadNews();
        loadMatches();

        recruitment();
        contact();

        auth();
        article();
        profile();

    }
);