(function () {
  if (window.__wc.params.mode === 'write') {
    localStorage.setItem('wc-secret', 'from-A');
    document.cookie = 'wcA=1; path=/';
    window.__wcFinish({
      wrote: localStorage.getItem('wc-secret') === 'from-A' && /wcA=1/.test(document.cookie),
    });
  } else {
    window.__wcFinish({ storage: localStorage.getItem('wc-secret'), cookie: document.cookie });
  }
})();
