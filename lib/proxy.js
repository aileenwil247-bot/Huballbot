const fetch = require('node-fetch');
const { getJar } = require('./sessions');
const { rewriteHtml, rewriteCss } = require('./rewriter');

const SKIP_REQ_HEADERS = new Set([
    'host','connection','content-length','transfer-encoding','content-encoding',
    'accept-encoding','cf-connecting-ip','cf-ray','x-forwarded-for','x-forwarded-proto',
    'x-real-ip','accept-charset','keep-alive','upgrade','te','trailer','cookie',
    'sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-fetch-user'
]);

const STRIP_RES_HEADERS = new Set([
    'content-security-policy','content-security-policy-report-only','x-frame-options',
    'content-encoding','transfer-encoding','content-length','connection','keep-alive',
    'strict-transport-security','clear-site-data','set-cookie',
    'cross-origin-embedder-policy','cross-origin-opener-policy',
    'cross-origin-resource-policy','permissions-policy','report-to','nel',
    'alt-svc','link'
]);

const CF_COOKIES = (process.env.CF_COOKIES || '').trim();
const UPSTREAM_PROXY = (process.env.UPSTREAM_PROXY || '').trim();

function getDispatcher() {
    if (!UPSTREAM_PROXY) return undefined;
    try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        return new HttpsProxyAgent(UPSTREAM_PROXY);
    } catch { return undefined; }
}

// fetch with hard timeout — never hang past 15s
function fetchWithTimeout(url, opts, ms = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...opts, signal: controller.signal })
        .finally(() => clearTimeout(timer));
}

async function proxyRequest(targetUrl, req, res, sessionId) {
    try {
        const jar = getJar(sessionId);
        const jarCookies = await jar.getCookieString(targetUrl);
        const cookieParts = [jarCookies, CF_COOKIES].filter(Boolean);

        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (!SKIP_REQ_HEADERS.has(k.toLowerCase())) headers[k] = v;
        }
        headers['user-agent'] = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
        headers['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
        headers['accept-language'] = 'en-US,en;q=0.9';
        headers['sec-ch-ua'] = '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"';
        headers['sec-ch-ua-mobile'] = '?1';
        headers['sec-ch-ua-platform'] = '"Android"';
        headers['upgrade-insecure-requests'] = '1';
        // NO 'br' — node-fetch v2 cannot decompress brotli
        headers['accept-encoding'] = 'gzip, deflate';
        if (cookieParts.length) headers['cookie'] = cookieParts.join('; ');

        let body;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            if (req.is('application/json')) body = JSON.stringify(req.body);
            else if (req.is('application/x-www-form-urlencoded')) body = new URLSearchParams(req.body).toString();
            else if (Buffer.isBuffer(req.body)) body = req.body;
            else body = req.body ? JSON.stringify(req.body) : undefined;
        }

        let upstream;
        try {
            upstream = await fetchWithTimeout(targetUrl, {
                method: req.method, headers, body,
                redirect: 'manual',
                agent: getDispatcher()
            });
        } catch (e) {
            console.error('[proxy fetch fail]', targetUrl, e.message);
            return res.status(502).send(`Proxy error: ${e.message}`);
        }

        // CF challenge
        if (upstream.status === 403 || upstream.status === 503) {
            const serverHeader = upstream.headers.get('server') || '';
            if (/cloudflare/i.test(serverHeader)) {
                return res.status(503).send(`
                    <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee">
                    <h2>Cloudflare challenge blocked</h2>
                    <p>Set env <code>CF_COOKIES</code> (cf_clearance) or <code>UPSTREAM_PROXY</code>.</p>
                    </body></html>
                `);
            }
        }

        // redirect — route via proxy
        if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
            const loc = upstream.headers.get('location');
            const abs = new URL(loc, targetUrl).toString();
            return res.redirect(`/proxy?url=${encodeURIComponent(abs)}`);
        }

        // cookies
        const setCookie = upstream.headers.raw()['set-cookie'];
        if (setCookie) {
            for (const c of setCookie) {
                try { await jar.setCookie(c, targetUrl); } catch {}
            }
        }

        // copy safe headers only
        for (const [k, v] of upstream.headers.raw()) {
            if (STRIP_RES_HEADERS.has(k.toLowerCase())) continue;
            try { res.setHeader(k, v.join(', ')); } catch {}
        }

        const contentType = upstream.headers.get('content-type') || '';

        // read body safely
        let buffer;
        try {
            buffer = Buffer.from(await upstream.arrayBuffer());
        } catch (e) {
            console.error('[proxy body read fail]', targetUrl, e.message);
            return res.status(502).send(`Body read error: ${e.message}`);
        }

        if (contentType.includes('text/html')) {
            try {
                const html = buffer.toString('utf-8');
                const rewritten = rewriteHtml(html, targetUrl);
                res.setHeader('content-type', 'text/html; charset=utf-8');
                return res.send(rewritten);
            } catch (e) {
                console.error('[proxy html rewrite fail]', targetUrl, e.message);
                // fallback: send raw HTML unchanged
                res.setHeader('content-type', 'text/html; charset=utf-8');
                return res.send(buffer);
            }
        }

        if (contentType.includes('text/css')) {
            try {
                const rewritten = rewriteCss(buffer.toString('utf-8'), targetUrl);
                res.setHeader('content-type', 'text/css; charset=utf-8');
                return res.send(rewritten);
            } catch {
                return res.send(buffer);
            }
        }

        return res.send(buffer);
    } catch (e) {
        console.error('[proxy uncaught]', e);
        if (!res.headersSent) res.status(500).send(`Internal proxy error: ${e.message}`);
    }
}

module.exports = { proxyRequest };
