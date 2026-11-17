(async function () {
  document.getElementById('b').click();
  var evalRan = false;
  try {
    evalRan = eval('1 + 1') === 2;
  } catch (e) {
    /* blocked */
  }
  var fnRan = false;
  try {
    fnRan = new Function('return 1')() === 1;
  } catch (e) {
    /* blocked */
  }
  await window.__wcWaitFor(['script-src-elem', 'script-src-attr', 'script-src']);
  window.__wcFinish({
    inlineRan: !!window.__inlineRan,
    handlerRan: !!window.__handlerRan,
    evalRan: evalRan,
    fnRan: fnRan,
  });
})();
