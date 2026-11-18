const cheerio = require('cheerio');

const PROXY_PREFIX = '/proxy?url=';

function proxify(url, base) {
    try {
        const abs = new URL(url, base).toString();
        if (abs.startsWith('data:') || abs.startsWith('blob:') || abs.startsWith('javascript:') || abs.startsWith('#')) return url;
        return PROXY_PREFIX + encodeURIComponent(abs);
    } catch { return url; }
}

function stripAgeGate($) {
    const selectors = [
        '[class*="age-gate" i]', '[id*="age-gate" i]',
        '[class*="agegate" i]', '[id*="agegate" i]',
        '[class*="age-verify" i]', '[id*="age-verify" i]',
        '[class*="age-check" i]', '[id*="age-check" i]',
        '[class*="over18" i]', '[id*="over18" i]',
        '[class*="enter-site" i]', '[id*="enter-site" i]',
        '[class*="disclaimer" i]', '[id*="disclaimer" i]',
        '[class*="cookie-banner" i]', '[class*="cookie-consent" i]',
        '[id*="cookie-banner" i]', '[id*="cookie-consent" i]',
        '[class*="gdpr" i]', '[id*="gdpr" i]',
        'div[role="dialog"]'
    ];
    $(selectors.join(',')).each((_, el) => $(el).remove());

    $('body').css({ 'overflow': 'auto', 'position': 'static', 'filter': 'none', 'pointer-events': 'auto' });
    $('html').css({ 'overflow': 'auto', 'pointer-events': 'auto' });
}

function rewriteHtml(html, pageUrl) {
    const $ = cheerio.load(html, { decodeEntities: false });

    stripAgeGate($);

    $('head').prepend(`<base href="${pageUrl}">`);
    $('meta[http-equiv="X-Frame-Options"]').remove();
    $('meta[http-equiv="Content-Security-Policy"]').remove();

    const attrs = ['src', 'href', 'action', 'data-src', 'poster', 'formaction', 'data-original'];
    $(`[${attrs.join('],[')}]`).each((_, el) => {
        for (const a of attrs) {
            const v = $(el).attr(a);
            if (v) $(el).attr(a, proxify(v, pageUrl));
        }
    });

    $('[srcset]').each((_, el) => {
        const srcset = $(el).attr('srcset');
        const rewritten = srcset.split(',').map(part => {
            const [u, size] = part.trim().split(/\s+/);
            return `${proxify(u, pageUrl)} ${size || ''}`.trim();
        }).join(', ');
        $(el).attr('srcset', rewritten);
    });

    $('style').each((_, el) => {
        const css = $(el).html();
        if (css) $(el).html(rewriteCss(css, pageUrl));
    });

    const shim = `<script>
(function(){
  const PROXY=${JSON.stringify(PROXY_PREFIX)};
  const PAGE=${JSON.stringify(pageUrl)};
  function wrap(u){
    try{const a=new URL(u,PAGE).toString();
      if(a.startsWith('data:')||a.startsWith('blob:')||a.startsWith(PROXY))return u;
      return PROXY+encodeURIComponent(a);
    }catch{return u}
  }
  const _f=window.fetch;
  window.fetch=function(i,o){
    if(typeof i==='string')i=wrap(i);
    else if(i instanceof Request)i=new Request(wrap(i.url),i);
    return _f.call(this,i,o)
  };
  const _o=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u,...r){return _o.call(this,m,wrap(u),...r)};
})();
</script>`;
    $('head').prepend(shim);

    return $.html();
}

function rewriteCss(css, pageUrl) {
    return css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, u) => `url(${q}${proxify(u, pageUrl)}${q})`);
}

module.exports = { rewriteHtml, rewriteCss, proxify };
