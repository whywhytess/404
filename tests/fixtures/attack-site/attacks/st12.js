(async function () {
  var registered = false;
  var error = null;
  try {
    await navigator.serviceWorker.register('sw.js');
    registered = true;
  } catch (e) {
    error = e.name;
  }
  var count = (await navigator.serviceWorker.getRegistrations()).length;
  await window.__wcWaitFor(['worker-src'], 1000);
  window.__wcFinish({ registered: registered, error: error, registrations: count });
})();
