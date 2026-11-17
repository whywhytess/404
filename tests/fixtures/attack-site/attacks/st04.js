(function () {
  var w = null;
  try {
    w = window.open('https://attacker.test/popup-direct');
  } catch (e) {
    /* blocked */
  }
  window.__wcFinish({ popupOpened: w !== null, isTop: window.top === window });
})();
