const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { proxyRequest } = require('./lib/proxy');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.raw({ type: '*/*', limit: '50mb' }));

// session
app.use((req, res, next) => {
    if (!req.cookies.omni_sid) {
        const sid = crypto.randomBytes(16).toString('hex');
        res.cookie('omni_sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: 86400_000 });
        req.sessionId = sid;
    } else {
        req.sessionId = req.cookies.omni_sid;
    }
    next();
});

// proxy endpoint
app.all('/proxy', async (req, res) => {
    const target = req.query.url;
    if (!target) return res.status(400).send('missing url');

    let parsed;
    try {
        parsed = new URL(target);
    } catch {
        return res.status(400).send('invalid url');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).send('unsupported protocol');
    }

    await proxyRequest(parsed.toString(), req, res, req.sessionId);
});

// search endpoint
app.get('/api/search', async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'missing q' });
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    res.json({ url: `/proxy?url=${encodeURIComponent(url)}` });
});

// static
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`OmniWeb running → http://localhost:${PORT}`);
});
