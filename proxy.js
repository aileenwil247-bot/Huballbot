const fetch = require('node-fetch');
const { getJar } = require('./sessions');
const { rewriteHtml, rewriteCss } = require('./rewriter');

const SKIP_REQ_HEADERS = new Set([
    'host','connection','content-length','transfer-encoding','content-encoding',
    'accept-encoding','cf-connecting-ip','cf-ray','x-forwarded-for','x-forwarded-proto',
    'x-real-ip','accept-charset','keep-alive','upgrade','te','trailer','cookie'
]);

const STRIP_RES_HEADERS = new Set([
    'content-security-policy','content-security-policy-report-only','x-frame-options',
    'content-encoding','transfer-encoding','strict-transport-security','clear-site-data',
    'cross-origin-embedder-policy','cross-origin-opener-policy',
    'cross-origin-resource-policy','permissions-policy','report-to','nel'
]);

const CF_COOKIES = (process.env.CF_COOKIES || '').trim(); // isi manual via env
const UPSTREAM_PROXY = (process.env.UPSTREAM_PROXY || '').trim(); // optional residential proxy

function getDispatcher() {
    if (!UPSTREAM_PROXY) return undefined;
    try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        return new HttpsProxyAgent(UPSTREAM_PROXY);
    } catch { return undefined; }
}

async function proxyRequest(targetUrl, req, res, sessionId) {
    const jar = getJar(sessionId);
    const jarCookies = await jar.getCookieString(targetUrl);
    const cookieParts = [jarCookies, CF_COOKIES].filter(Boolean);

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (!SKIP_REQ_HEADERS.has(k.toLowerCase())) headers[k] = v;
    }
    headers['user-agent'] = 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    headers['accept'] = headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
    headers['accept-language'] = headers['accept-language'] || 'en-US,en;q=0.9';
    headers['sec-ch-ua'] = '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"';
    headers['sec-ch-ua-mobile'] = '?1';
    headers['sec-ch-ua-platform'] = '"Android"';
    headers['sec-fetch-dest'] = 'document';
    headers['sec-fetch-mode'] = 'navigate';
    headers['sec-fetch-site'] = 'none';
    headers['upgrade-insecure-requests'] = '1';
    headers['accept-encoding'] = 'gzip, deflate, br';
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
        upstream = await fetch(targetUrl, {
            method: req.method, headers, body,
            redirect: 'manual',
            agent: getDispatcher()
        });
    } catch (e) {
        return res.status(502).send(`Proxy error: ${e.message}`);
    }

    // CF challenge detection
    if (upstream.status === 403 || upstream.status === 503) {
        const serverHeader = upstream.headers.get('server') || '';
        if (/cloudflare/i.test(serverHeader)) {
            return res.status(503).send(`
                <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee">
                <h2>Cloudflare challenge blocked</h2>
                <p>Server ini kena Cloudflare challenge dari target.</p>
                <p>Fix: tambahkan env <code>CF_COOKIES</code> berisi cookie <code>cf_clearance</code> dari browser kamu.</p>
                <p>Atau set env <code>UPSTREAM_PROXY</code> dengan residential proxy URL.</p>
                </body></html>
            `);
        }
    }

    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
        const loc = upstream.headers.get('location');
        const abs = new URL(loc, targetUrl).toString();
        return res.redirect(`/proxy?url=${encodeURIComponent(abs)}`);
    }

    const setCookie = upstream.headers.raw()['set-cookie'];
    if (setCookie) {
        for (const c of setCookie) {
            try { await jar.setCookie(c, targetUrl); } catch {}
        }
    }

    for (const [k, v] of upstream.headers.raw()) {
        if (STRIP_RES_HEADERS.has(k.toLowerCase())) continue;
        try { res.setHeader(k, v.join(', ')); } catch {}
    }

    const contentType = upstream.headers.get('content-type') || '';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    if (contentType.includes('text/html')) {
        res.send(rewriteHtml(buffer.toString('utf-8'), targetUrl));
    } else if (contentType.includes('text/css')) {
        res.send(rewriteCss(buffer.toString('utf-8'), targetUrl));
    } else {
        res.send(buffer);
    }
}

module.exports = { proxyRequest };
