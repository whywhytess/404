(async function () {
  var platform = window.__wc.params.platform;
  var fetchBlocked = false;
  try {
    await fetch(platform + '/api/auth/me', { credentials: 'include' });
  } catch (e) {
    fetchBlocked = true;
  }
  await window.__wcWaitFor(['connect-src'], 1000);
  window.__wcFinish({
    cookie: document.cookie,
    hasPlatformCookie: /wc\.sid/.test(document.cookie),
    fetchBlocked: fetchBlocked,
  });
})();
