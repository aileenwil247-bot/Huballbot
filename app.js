const tabs = [];
let activeTab = 0;

function createTab(url) {
    const tab = { url: url || 'https://duckduckgo.com', history: [], histIdx: -1, id: 'tab_' + Date.now() };
    tabs.push(tab);
    switchTo(tabs.length - 1);
}

function switchTo(idx) {
    activeTab = idx;
    const tab = tabs[idx];
    document.getElementById('addrBar').value = tab.url || '';
    const iframe = document.getElementById('view');
    if (tab.url) {
        const proxied = '/proxy?url=' + encodeURIComponent(tab.url);
        iframe.src = proxied;
        tab.history = tab.history.slice(0, tab.histIdx + 1);
        tab.history.push(tab.url);
        tab.histIdx = tab.history.length - 1;
    }
    renderTabs();
}

function renderTabs() {
    const bar = document.getElementById('tabBar');
    bar.innerHTML = '';
    tabs.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = 'tab' + (i === activeTab ? ' active' : '');
        el.innerHTML = `<span>${new URL(t.url).hostname || 'new tab'}</span>`;
        el.onclick = () => switchTo(i);
        bar.appendChild(el);
    });
}

function normalizeInput(input) {
    input = input.trim();
    if (!input) return null;
    // kalau ada spasi atau tidak ada titik → search
    if (/\s/.test(input) || !/\.[a-z]{2,}/i.test(input)) {
        return 'https://duckduckgo.com/html/?q=' + encodeURIComponent(input);
    }
    if (!/^https?:\/\//i.test(input)) return 'https://' + input;
    return input;
}

document.getElementById('goBtn').onclick = () => {
    const input = document.getElementById('addrBar').value;
    const url = normalizeInput(input);
    if (!url) return;
    tabs[activeTab].url = url;
    switchTo(activeTab);
};

document.getElementById('addrBar').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('goBtn').click();
});

document.getElementById('backBtn').onclick = () => {
    const t = tabs[activeTab];
    if (t.histIdx > 0) {
        t.histIdx--;
        const iframe = document.getElementById('view');
        iframe.src = '/proxy?url=' + encodeURIComponent(t.history[t.histIdx]);
        document.getElementById('addrBar').value = t.history[t.histIdx];
    }
};

document.getElementById('fwdBtn').onclick = () => {
    const t = tabs[activeTab];
    if (t.histIdx < t.history.length - 1) {
        t.histIdx++;
        const iframe = document.getElementById('view');
        iframe.src = '/proxy?url=' + encodeURIComponent(t.history[t.histIdx]);
        document.getElementById('addrBar').value = t.history[t.histIdx];
    }
};

document.getElementById('reloadBtn').onclick = () => {
    const iframe = document.getElementById('view');
    const t = tabs[activeTab];
    iframe.src = '/proxy?url=' + encodeURIComponent(t.url + '?t=' + Date.now());
};

// init
createTab('https://duckduckgo.com');
