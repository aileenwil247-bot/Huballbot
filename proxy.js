const fetch = require('node-fetch');
const { getJar } = require('./sessions');
const { rewriteHtml, rewriteCss } = require('./rewriter');

const SKIP_HEADERS = new Set([
    'host', 'connection', 'content-length', 'transfer-encoding',
    'content-encoding', 'accept-encoding', 'cf-connecting-ip',
    'cf-ray', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip',
    'accept-charset', 'keep-alive', 'upgrade', 'te', 'trailer'
]);

const STRIP_RESPONSE_HEADERS = new Set([
    'content-security-policy', 'content-security-policy-report-only',
    'x-frame-options', 'content-encoding', 'transfer-encoding',
    'strict-transport-security', 'clear-site-data',
    'cross-origin-embedder-policy', 'cross-origin-opener-policy',
    'cross-origin-resource-policy', 'permissions-policy'
]);

async function proxyRequest(targetUrl, req, res, sessionId) {
    const jar = getJar(sessionId);

    // cookies
    const cookieHeader = await jar.getCookieString(targetUrl);

    // build forward headers
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (!SKIP_HEADERS.has(k.toLowerCase())) headers[k] = v;
    }
    headers['user-agent'] = headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    if (cookieHeader) headers['cookie'] = cookieHeader;
    headers['accept-encoding'] = 'gzip, deflate, br';

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.is('application/json')) {
            body = JSON.stringify(req.body);
        } else if (req.is('application/x-www-form-urlencoded')) {
            body = new URLSearchParams(req.body).toString();
        } else if (Buffer.isBuffer(req.body)) {
            body = req.body;
        } else {
            body = req.body ? JSON.stringify(req.body) : undefined;
        }
    }

    let upstream;
    try {
        upstream = await fetch(targetUrl, {
            method: req.method,
            headers,
            body,
            redirect: 'manual',
            follow: 0
        });
    } catch (e) {
        res.status(502).send(`Proxy error: ${e.message}`);
        return;
    }

    // handle redirects — kirim balik lewat proxy juga
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
        const loc = upstream.headers.get('location');
        const abs = new URL(loc, targetUrl).toString();
        res.redirect(`/proxy?url=${encodeURIComponent(abs)}`);
        return;
    }

    // store cookies
    const setCookie = upstream.headers.raw()['set-cookie'];
    if (setCookie) {
        for (const c of setCookie) {
            try { await jar.setCookie(c, targetUrl); } catch {}
        }
    }

    // copy response headers (minus blocked)
    for (const [k, v] of upstream.headers.raw()) {
        if (STRIP_RESPONSE_HEADERS.has(k.toLowerCase())) continue;
        try { res.setHeader(k, v.join(', ')); } catch {}
    }

    const contentType = upstream.headers.get('content-type') || '';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    // rewrite sesuai tipe konten
    if (contentType.includes('text/html')) {
        const html = buffer.toString('utf-8');
        res.send(rewriteHtml(html, targetUrl));
    } else if (contentType.includes('text/css')) {
        res.send(rewriteCss(buffer.toString('utf-8'), targetUrl));
    } else if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
        // JS cuma di-rewrite kalau reference external
        res.send(buffer);
    } else {
        res.send(buffer);
    }
}

module.exports = { proxyRequest };
