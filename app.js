const view = document.getElementById('view');
const addr = document.getElementById('addrBar');
let currentUrl = '';

function normalize(input) {
    input = input.trim();
    if (!input) return null;
    if (/\s/.test(input) || !/\.[a-z]{2,}/i.test(input)) {
        return 'https://duckduckgo.com/html/?q=' + encodeURIComponent(input);
    }
    if (!/^https?:\/\//i.test(input)) return 'https://' + input;
    return input;
}

function navigate(url) {
    currentUrl = url;
    addr.value = url;
    view.src = '/proxy?url=' + encodeURIComponent(url);
}

document.getElementById('goBtn').onclick = () => {
    const url = normalize(addr.value);
    if (url) navigate(url);
};

addr.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('goBtn').click();
});

document.getElementById('reloadBtn').onclick = () => {
    if (currentUrl) view.src = '/proxy?url=' + encodeURIComponent(currentUrl + (currentUrl.includes('?') ? '&' : '?') + '_t=' + Date.now());
};

document.getElementById('backBtn').onclick = () => {
    // iframe tidak punya history API cross-origin, jadi reload homepage
    navigate('https://duckduckgo.com');
};

// auto-load dari ?url= atau ?site=brazzers
const params = new URLSearchParams(location.search);
const start = params.get('url');
const site = params.get('site');

if (start) navigate(start);
else if (site === 'brazzers') navigate('https://www.brazzers.com/video');
else navigate('https://duckduckgo.com');
