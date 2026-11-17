(async function () {
  var fr = document.createElement('iframe');
  fr.src = 'https://attacker.test/frame.html';
  document.body.appendChild(fr);
  await window.__wcWaitFor(['frame-src']);
  window.__wcFinish({});
})();
