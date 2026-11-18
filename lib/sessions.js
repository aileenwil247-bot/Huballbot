const { CookieJar } = require('tough-cookie');

const jars = new Map();

function getJar(sessionId) {
    if (!jars.has(sessionId)) jars.set(sessionId, new CookieJar());
    return jars.get(sessionId);
}

module.exports = { getJar };
