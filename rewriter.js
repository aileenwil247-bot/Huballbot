const cheerio = require('cheerio');

const PROXY_PREFIX = '/proxy?url=';

// rewrite setiap URL absolut/relatif jadi lewat /proxy
function proxify(url, base) {
    try {
        const abs = new URL(url, base).toString();
        if (abs.startsWith('data:') || abs.startsWith('blob:') || abs.startsWith('javascript:') || abs.startsWith('#')) {
            return url;
        }
        return PROXY_PREFIX + encodeURIComponent(abs);
    } catch {
        return url;
    }
}

function rewriteHtml(html, pageUrl) {
    const $ = cheerio.load(html, { decodeEntities: false });

    // <base> supaya relative URL tetap konsisten
    $('head').prepend(`<base href="${pageUrl}">`);

    // remove framing blockers kalau ada di meta
    $('meta[http-equiv="X-Frame-Options"]').remove();
    $('meta[http-equiv="Content-Security-Policy"]').remove();

    // rewrite semua atribut URL
    const attrs = ['src', 'href', 'action', 'data-src', 'poster', 'formaction'];
    $(`[${attrs.join('],[')}]`).each((_, el) => {
        for (const a of attrs) {
            const v = $(el).attr(a);
            if (v) $(el).attr(a, proxify(v, pageUrl));
        }
    });

    // srcset
    $('[srcset]').each((_, el) => {
        const srcset = $(el).attr('srcset');
        const rewritten = srcset.split(',').map(part => {
            const [u, size] = part.trim().split(/\s+/);
            return `${proxify(u, pageUrl)} ${size || ''}`.trim();
        }).join(', ');
        $(el).attr('srcset', rewritten);
    });

    // inline CSS url() dan rewrite stylesheet references
    $('style').each((_, el) => {
        const css = $(el).html();
        if (css) $(el).html(rewriteCss(css, pageUrl));
    });

    // JS shims — override fetch, XHR, WebSocket ke proxy kalau eksternal
    const shim = `
<script>
(function(){
  const PROXY = ${JSON.stringify(PROXY_PREFIX)};
  const PAGE_URL = ${JSON.stringify(pageUrl)};
  function wrap(u) {
    try {
      const abs = new URL(u, PAGE_URL).toString();
      if (abs.startsWith('data:') || abs.startsWith('blob:') || abs.startsWith(PROXY)) return u;
      return PROXY + encodeURIComponent(abs);
    } catch { return u; }
  }
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') input = wrap(input);
    else if (input instanceof Request) input = new Request(wrap(input.url), input);
    return _fetch.call(this, input, init);
  };
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u, ...rest) {
    return _open.call(this, m, wrap(u), ...rest);
  };
})();
</script>`;
    $('head').prepend(shim);

    return $.html();
}

function rewriteCss(css, pageUrl) {
    return css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, u) => {
        return `url(${q}${proxify(u, pageUrl)}${q})`;
    });
}

module.exports = { rewriteHtml, rewriteCss, proxify };
