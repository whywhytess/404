(async function () {
  var s = document.createElement('script');
  s.src = 'https://attacker.test/evil.js';
  document.head.appendChild(s);
  await window.__wcWaitFor(['script-src-elem']);
  window.__wcFinish({ evilRan: !!window.__evilRan });
})();
