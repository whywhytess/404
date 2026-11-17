(async function () {
  var w = null;
  try {
    w = window.open('https://attacker.test/phish-popup');
  } catch (e) {
    /* blocked */
  }
  await new Promise(function (r) {
    setTimeout(r, 300);
  });
  window.__wcFinish({ popupOpened: w !== null });
})();
