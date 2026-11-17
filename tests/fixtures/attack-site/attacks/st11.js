(function () {
  function attack() {
    var r = { error: null };
    // Signal the attempt first: a successful navigation would unload this page.
    window.__wcFinish({ attempted: true });
    try {
      if (window.__wc.params.mode === 'self') location.href = 'https://attacker.test/phish-self';
      else window.top.location.href = 'https://attacker.test/phish-top';
    } catch (e) {
      r.error = e.name;
    }
    window.__wc.navError = r.error;
  }
  if (window.__wc.params.mode === 'self') {
    attack();
  } else {
    // Run on a real click, so the browser's own "no top navigation without user activation"
    // rule is not what stops the attack — only the sandbox can.
    document.getElementById('go').addEventListener('click', attack);
    window.__wc.ready = true;
  }
})();
