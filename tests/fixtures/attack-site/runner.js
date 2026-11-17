// Shared attack harness (SRD 3.10). Written for this project; synthetic.
// Records CSP violations and loads attacks/<case>.js, chosen by <html data-case="...">.
// Each attack sets window.__wc.done = true when its attempt is complete. A missing
// result counts as a failure in the test, so a crashed script can never pass.
(function () {
  window.__wc = {
    done: false,
    violations: [],
    params: Object.fromEntries(new URLSearchParams(location.search)),
  };
  document.addEventListener('securitypolicyviolation', function (e) {
    window.__wc.violations.push({ directive: e.effectiveDirective, blocked: String(e.blockedURI) });
  });
  window.__wcWaitFor = function (directives, ms) {
    var until = Date.now() + (ms || 2000);
    return new Promise(function (resolve) {
      (function poll() {
        var seen = window.__wc.violations.map(function (v) {
          return v.directive;
        });
        if (
          directives.every(function (d) {
            return seen.indexOf(d) !== -1;
          }) ||
          Date.now() > until
        )
          return resolve();
        setTimeout(poll, 25);
      })();
    });
  };
  window.__wcFinish = function (fields) {
    Object.assign(window.__wc, fields || {}, { done: true });
    document.title = 'done';
  };
  var name = document.documentElement.dataset.case;
  if (name) {
    var s = document.createElement('script');
    s.src = 'attacks/' + name + '.js';
    document.head.appendChild(s);
  }
})();
