const { CookieJar } = require('tough-cookie');

const jars = new Map();

function getJar(sessionId) {
    if (!jars.has(sessionId)) {
        jars.set(sessionId, new CookieJar());
    }
    return jars.get(sessionId);
}

function cleanup(maxAgeMs = 3600_000) {
    const now = Date.now();
    for (const [k, v] of jars.entries()) {
        if (v._lastUsed && now - v._lastUsed > maxAgeMs) jars.delete(k);
    }
}
setInterval(cleanup, 600_000).unref();

module.exports = { getJar };
