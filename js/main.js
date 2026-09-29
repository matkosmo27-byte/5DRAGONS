const API_URL = 'https://calm-sunset-b06e.matkosmo27.workers.dev';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];


/* =========================================================
   API
========================================================= */

async function api(path, options = {}) {
    const token = localStorage.getItem('5d_token');

    const headers = {
        'Accept': 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
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
                        src="assets/logo5drag-transparent.png"
                        onerror="this.style.display='none'"
                    >
                    <span data-site-name>5DRAGONS</span>
                </a>

                <div class="links">
                    <a data-nav href="index.html">HOME</a><a data-nav href="team.html">TEAM</a><a data-nav href="academy.html">ACADEMY</a><a data-nav href="matches.html">MATCHES</a><a data-nav href="news.html">NEWS</a><a data-nav href="recruitment.html">RECRUITMENT</a><a data-nav href="about.html">ABOUT</a><a data-nav href="contact.html">CONTACT</a><a data-nav href="profile.html">PROFILE</a><a data-login-link href="login.html">LOGIN</a>
                </div>
                <a class="btn nav-join" href="recruitment.html">JOIN US</a>
                <button class="mobile-toggle" type="button" aria-label="Otwórz menu" aria-expanded="false"><span></span><span></span><span></span></button>
                <div class="mobile-panel"><div class="mobile-links"><a data-nav href="index.html">HOME</a><a data-nav href="team.html">TEAM</a><a data-nav href="academy.html">ACADEMY</a><a data-nav href="matches.html">MATCHES</a><a data-nav href="news.html">NEWS</a><a data-nav href="recruitment.html">RECRUITMENT</a><a data-nav href="about.html">ABOUT</a><a data-nav href="contact.html">CONTACT</a><a data-nav href="profile.html">PROFILE</a><a data-login-link href="login.html">LOGIN</a><a class="btn" href="recruitment.html">JOIN 5DRAGONS</a></div></div>

            </div>
        </nav>
    `;

    nav();
    updateLoginLink();

    const toggle = $('.mobile-toggle');
    const panel = $('.mobile-panel');
    if (toggle && panel) {
        toggle.addEventListener('click', () => {
            const open = document.body.classList.toggle('menu-open');
            toggle.classList.toggle('is-open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Zamknij menu' : 'Otwórz menu');
        });
        $('.mobile-panel a').forEach(link => {
            link.addEventListener('click', () => {
                document.body.classList.remove('menu-open');
                toggle.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
            });
        });
    }
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
                <span data-site-name>5DRAGONS Academy</span>. All rights reserved.
            </div>
        </footer>
    `;
}




async function loadBranding() {
    try {
        const response = await fetch(API_URL + '/api/settings?_=' + Date.now(), {
            method: 'GET',
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) return;
        const data = await response.json();
        const s = data.settings || {};

        if (s.site_name) {
            document.title = s.site_name;
            document.querySelectorAll('[data-site-name]').forEach(el => {
                el.textContent = s.site_name;
            });
        }

        const siteLogo = 'assets/logo5drag-transparent.png';

        document.querySelectorAll('.brand img, img[data-site-logo]').forEach(img => {
            img.src = siteLogo + (siteLogo.includes('?') ? '&' : '?') + 'v=' + Date.now();
            img.removeAttribute('onerror');
            img.style.display = '';
        });

        if (s.footer_logo) {
            document.querySelectorAll('img[data-footer-logo]').forEach(img => {
                img.src = s.footer_logo;
            });
        }

        if (s.favicon) {
            let link = document.querySelector('link[rel="icon"]');
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.head.appendChild(link);
            }
            link.href = s.favicon;
        }
    } catch (error) {
        console.warn('Branding load failed:', error);
    }
}

function updateLoginLink() {
    const link = $('[data-login-link]');
    if (!link) return;
    link.textContent = localStorage.getItem('5d_token') ? 'LOGOUT' : 'LOGIN';
    link.href = localStorage.getItem('5d_token') ? '#' : 'login.html';
    if (localStorage.getItem('5d_token')) link.onclick = event => { event.preventDefault(); logout(); };
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
                        src="${player.photo || 'assets/logo5drag-transparent.png'}"
                        alt="${player.nick || 'Player'}"
                        onerror="this.src='assets/logo5drag-transparent.png'"
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

        // Baza używa nazwy cs2_nick, a formularz ma pole cs2.
        // Mapujemy je przed wysłaniem, żeby INSERT trafił w wymaganą kolumnę.
        if (data.cs2 !== undefined) {
            data.cs2_nick = data.cs2;
            delete data.cs2;
        }

        // Nazwy pól FACEIT i pozostałych danych pozostają zgodne z API/bazą.
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
   CINEMATIC NAVIGATION TRANSITIONS
========================================================= */
function pageTransitions() {
    /*
     * 5DRAGONS CINEMATIC ROUTER
     * Pełnoekranowy transition jest renderowany inline, więc nie zależy
     * od wersji CSS z CDN. Strona wychodzi z ruchem i głębią, a nowa
     * strona otwiera się przez dwa "shuttery" z czerwonym światłem.
     */
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }

    const style = document.createElement('style');
    style.textContent = `
        :root {
            --five-red: #e50914;
            --five-black: #050506;
        }

        .five-transition {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            pointer-events: none;
            overflow: hidden;
            opacity: 1;
            visibility: visible;
            background: #050506;
            perspective: 1400px;
        }

        .five-transition .five-shutter {
            position: absolute;
            top: -8%;
            bottom: -8%;
            width: 53%;
            background:
                linear-gradient(135deg, rgba(255,255,255,.018), transparent 24%),
                linear-gradient(160deg, #0b0b0d 0%, #050506 58%, #100708 100%);
            box-shadow:
                inset 0 0 90px rgba(0,0,0,.72),
                0 0 80px rgba(0,0,0,.35);
            will-change: transform;
        }

        .five-transition .five-shutter::before {
            content: "";
            position: absolute;
            inset: 0;
            background:
                linear-gradient(90deg, transparent 0 96%, rgba(229,9,20,.7) 97%, transparent 99%),
                repeating-linear-gradient(0deg, transparent 0 7px, rgba(255,255,255,.022) 8px),
                linear-gradient(115deg, transparent 0 42%, rgba(229,9,20,.055) 50%, transparent 58%);
            opacity: .9;
        }

        .five-transition .five-shutter::after {
            content: "";
            position: absolute;
            inset: 0;
            background:
                linear-gradient(90deg, rgba(229,9,20,.10), transparent 35%),
                radial-gradient(circle at 75% 50%, rgba(229,9,20,.13), transparent 28%);
            mix-blend-mode: screen;
        }

        .five-transition .five-left {
            left: -3%;
            transform: translateX(0) skewX(-7deg);
            transform-origin: left center;
        }

        .five-transition .five-right {
            right: -3%;
            transform: translateX(0) skewX(7deg);
            transform-origin: right center;
        }

        .five-transition .five-center {
            position: absolute;
            left: 50%;
            top: 50%;
            width: 2px;
            height: 62vh;
            transform: translate(-50%, -50%) scaleY(0);
            transform-origin: center;
            background: linear-gradient(180deg, transparent, rgba(229,9,20,.45) 18%, #fff 50%, rgba(229,9,20,.45) 82%, transparent);
            box-shadow: 0 0 16px rgba(229,9,20,.9), 0 0 70px rgba(229,9,20,.45);
            opacity: 0;
        }

        .five-transition .five-beam {
            position: absolute;
            left: 50%;
            top: 50%;
            width: 140vw;
            height: 1px;
            transform: translate(-50%, -50%) scaleX(.08);
            background: linear-gradient(90deg, transparent, rgba(229,9,20,.15), #e50914 38%, #fff 50%, #e50914 62%, rgba(229,9,20,.15), transparent);
            box-shadow: 0 0 28px rgba(229,9,20,.8);
            opacity: 0;
        }

        .five-transition .five-grid {
            position: absolute;
            inset: 0;
            opacity: .16;
            background-image:
                linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
            background-size: 72px 72px;
            transform: scale(1.12);
        }

        .five-transition .five-caption {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            color: rgba(255,255,255,.92);
            font: 700 11px/1.2 Inter, Arial, sans-serif;
            letter-spacing: .34em;
            text-transform: uppercase;
            white-space: nowrap;
            opacity: 0;
            text-shadow: 0 0 22px rgba(229,9,20,.55);
        }

        .five-transition .five-caption b {
            color: #e50914;
            font-weight: 800;
        }

        .five-transition.is-opening .five-left {
            transform: translateX(-108%) skewX(-7deg);
        }

        .five-transition.is-opening .five-right {
            transform: translateX(108%) skewX(7deg);
        }

        .five-transition.is-opening .five-center {
            opacity: 1;
            animation: fiveCenterOpen .68s cubic-bezier(.16,1,.3,1) both;
        }

        .five-transition.is-opening .five-beam {
            opacity: 1;
            animation: fiveBeamOpen .72s cubic-bezier(.16,1,.3,1) both;
        }

        .five-transition.is-opening .five-grid {
            animation: fiveGridOpen .9s cubic-bezier(.16,1,.3,1) both;
        }

        .five-transition.is-opening .five-caption {
            animation: fiveCaptionOpen .68s .05s cubic-bezier(.16,1,.3,1) both;
        }

        .five-transition.is-closing .five-left {
            animation: fiveLeftClose .62s cubic-bezier(.76,0,.24,1) both;
        }

        .five-transition.is-closing .five-right {
            animation: fiveRightClose .62s cubic-bezier(.76,0,.24,1) both;
        }

        .five-transition.is-closing .five-center {
            opacity: 1;
            animation: fiveCenterClose .58s cubic-bezier(.16,1,.3,1) both;
        }

        .five-transition.is-closing .five-beam {
            opacity: 1;
            animation: fiveBeamClose .58s cubic-bezier(.16,1,.3,1) both;
        }

        .five-transition.is-closing .five-grid {
            animation: fiveGridClose .62s cubic-bezier(.16,1,.3,1) both;
        }

        .five-transition.is-closing .five-caption {
            animation: fiveCaptionClose .42s cubic-bezier(.76,0,.24,1) both;
        }

        @keyframes fiveLeftClose {
            from { transform: translateX(-108%) skewX(-7deg); }
            to { transform: translateX(0) skewX(-7deg); }
        }

        @keyframes fiveRightClose {
            from { transform: translateX(108%) skewX(7deg); }
            to { transform: translateX(0) skewX(7deg); }
        }

        @keyframes fiveCenterOpen {
            0% { transform: translate(-50%,-50%) scaleY(.8); }
            35% { transform: translate(-50%,-50%) scaleY(1); }
            100% { transform: translate(-50%,-50%) scaleY(0); opacity: 0; }
        }

        @keyframes fiveCenterClose {
            from { transform: translate(-50%,-50%) scaleY(0); }
            to { transform: translate(-50%,-50%) scaleY(1); }
        }

        @keyframes fiveBeamOpen {
            0% { transform: translate(-50%,-50%) scaleX(1); opacity: 1; }
            100% { transform: translate(-50%,-50%) scaleX(.03); opacity: 0; }
        }

        @keyframes fiveBeamClose {
            from { transform: translate(-50%,-50%) scaleX(.03); }
            to { transform: translate(-50%,-50%) scaleX(1); }
        }

        @keyframes fiveGridOpen {
            from { opacity: .28; transform: scale(1); }
            to { opacity: 0; transform: scale(1.16); }
        }

        @keyframes fiveGridClose {
            from { opacity: 0; transform: scale(1.16); }
            to { opacity: .28; transform: scale(1); }
        }

        @keyframes fiveCaptionOpen {
            0% { opacity: 0; transform: translate(-50%,-50%) scale(.92); letter-spacing: .48em; }
            35% { opacity: 1; }
            100% { opacity: 0; transform: translate(-50%,-50%) scale(1.04); letter-spacing: .34em; }
        }

        @keyframes fiveCaptionClose {
            from { opacity: 0; transform: translate(-50%,-50%) scale(1.08); }
            to { opacity: .9; transform: translate(-50%,-50%) scale(1); }
        }

        body.five-page-exit {
            overflow: hidden;
        }

        body.five-page-exit > *:not(.five-transition) {
            animation: fivePageExit .5s cubic-bezier(.76,0,.24,1) both;
        }

        @keyframes fivePageExit {
            to {
                opacity: 0;
                transform: translate3d(0,-22px,0) scale(.97);
                filter: blur(7px) brightness(.7);
            }
        }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'five-transition is-opening';
    overlay.innerHTML = `
        <div class="five-shutter five-left"></div>
        <div class="five-shutter five-right"></div>
        <div class="five-grid"></div>
        <div class="five-center"></div>
        <div class="five-beam"></div>
        <div class="five-caption"><b>05</b> / 5DRAGONS ACADEMY</div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.classList.add('is-opening');
        });
    });

    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        if (
            !href ||
            href.startsWith('#') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            link.target === '_blank' ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        ) return;

        let url;
        try {
            url = new URL(href, location.href);
        } catch {
            return;
        }

        if (
            url.origin !== location.origin ||
            (url.pathname === location.pathname && url.search === location.search)
        ) return;

        event.preventDefault();

        overlay.classList.remove('is-opening');
        overlay.classList.add('is-closing');
        document.body.classList.add('five-page-exit');

        setTimeout(() => {
            location.href = url.href;
        }, 610);
    });
}

/* =========================================================
   START
========================================================= */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        renderNav();
        footer();

        // Dane strony muszą działać niezależnie od animacji przejść.
        loadBranding();
        loadPlayers();
        loadNews();
        loadMatches();

        recruitment();
        contact();

        auth();
        article();
        profile();

        try {
            pageTransitions();
        } catch (error) {
            console.warn('Page transitions failed:', error);
        }

    }
);