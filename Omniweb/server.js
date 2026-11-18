const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { proxyRequest } = require('./lib/proxy');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.raw({ type: '*/*', limit: '20mb' }));

app.use((req, res, next) => {
    if (!req.cookies.omni_sid) {
        const sid = crypto.randomBytes(16).toString('hex');
        res.cookie('omni_sid', sid, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 86400_000 });
        req.sessionId = sid;
    } else req.sessionId = req.cookies.omni_sid;
    next();
});

// health check
app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// warmup — buka ini sekali abis deploy biar render nggak cold start
app.get('/warmup', (_, res) => res.send('warm'));

app.all('/proxy', async (req, res) => {
    const target = req.query.url;
    if (!target) return res.status(400).send('missing url');
    let parsed;
    try { parsed = new URL(target); } catch { return res.status(400).send('invalid url'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).send('unsupported protocol');
    await proxyRequest(parsed.toString(), req, res, req.sessionId);
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`OmniWeb on :${PORT}`));
