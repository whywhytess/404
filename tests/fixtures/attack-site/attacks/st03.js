(function () {
  var r = { readDom: false, readUrl: false, errors: [] };
  try {
    r.title = window.parent.document.title;
    r.readDom = true;
  } catch (e) {
    r.errors.push(e.name);
  }
  try {
    r.url = String(window.parent.location.href);
    r.readUrl = true;
  } catch (e) {
    r.errors.push(e.name);
  }
  window.__wcFinish(r);
})();
