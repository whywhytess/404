/**
 * Archive fixtures for the validator tests and for manual demos (ST-13 – ST-15).
 * All content is synthetic and written for this project.
 */
import { randomBytes } from 'node:crypto';
import { buildZip, type ZipEntrySpec } from './zip-writer.js';

const PAGE =
  '<!doctype html><html><head><link rel="stylesheet" href="css/style.css"></head><body><h1>Hi</h1><script src="js/app.js"></script></body></html>';
// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const site = (prefix = ''): ZipEntrySpec[] => [
  { name: `${prefix}index.html`, data: PAGE },
  { name: `${prefix}css/style.css`, data: 'body{font-family:sans-serif}' },
  { name: `${prefix}js/app.js`, data: 'document.querySelector("h1").textContent = "Hello";' },
  { name: `${prefix}img/logo.png`, data: PNG, method: 0 },
];

export const FIXTURES: Record<string, () => Buffer> = {
  'valid-site': () => buildZip(site()),
  'valid-wrapped': () =>
    buildZip([
      { name: 'my-site/' },
      ...site('my-site/'),
      { name: 'my-site/.DS_Store', data: 'junk' },
      { name: '__MACOSX/my-site/._index.html', data: 'junk' },
    ]),
  'zipslip-parent': () => buildZip([...site(), { name: '../evil.html', data: 'pwned' }]),
  'zipslip-nested': () => buildZip([...site(), { name: 'css/../../evil.js', data: 'pwned' }]),
  'zipslip-absolute': () => buildZip([...site(), { name: '/etc/evil.txt', data: 'pwned' }]),
  'zipslip-drive': () => buildZip([...site(), { name: 'C:/Windows/evil.txt', data: 'pwned' }]),
  'zipslip-backslash': () => buildZip([...site(), { name: '..\\evil.html', data: 'pwned' }]),
  symlink: () =>
    buildZip([...site(), { name: 'secret.txt', data: '/etc/passwd', unixMode: 0o120777 }]),
  'forbidden-type': () =>
    buildZip([...site(), { name: 'shell.php', data: '<?php system($_GET["c"]); ?>' }]),
  'hidden-file': () => buildZip([...site(), { name: '.htaccess', data: 'Options +Indexes' }]),
  'disguised-html': () =>
    buildZip([
      ...site(),
      { name: 'img/photo.png', data: '<script>alert(document.domain)</script>' },
    ]),
  duplicate: () => buildZip([...site(), { name: 'index.html', data: 'second copy' }]),
  'case-conflict': () => buildZip([...site(), { name: 'Index.html', data: 'other' }]),
  encrypted: () => buildZip([...site(), { name: 'secret.html', data: 'x', encryptedFlag: true }]),
  'nul-name': () => buildZip([...site(), { name: 'a\u0000.html', data: 'x' }]),
  'legacy-encoding': () =>
    buildZip([
      ...site(),
      {
        name: Buffer.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x68, 0x74, 0x6d, 0x6c]),
        data: 'x',
        utf8: false,
      },
    ]),
  'no-index': () => buildZip([{ name: 'home.html', data: PAGE }]),
  'index-wrong-case': () => buildZip([{ name: 'Index.HTML', data: PAGE }]),
  'index-too-deep': () => buildZip(site('project/site/')),
  empty: () => buildZip([]),
  'bomb-ratio': () =>
    buildZip([...site(), { name: 'data.txt', data: Buffer.alloc(4 * 1024 * 1024, 0x20) }]),
  'lying-size': () =>
    buildZip([...site(), { name: 'big.txt', data: randomBytes(64 * 1024), declaredSize: 100 }]),
  'too-many-files': () =>
    buildZip([
      ...site(),
      ...Array.from({ length: 501 }, (_, i) => ({ name: `pages/p${i}.html`, data: `<p>${i}</p>` })),
    ]),
  'oversize-file': () =>
    buildZip([...site(), { name: 'video.mp4', data: randomBytes(5 * 1024 * 1024 + 1), method: 0 }]),
  'warnings-site': () =>
    buildZip([
      {
        name: 'index.html',
        data: `<!doctype html><html><head>
<link rel="stylesheet" href="https://cdn.example.com/bootstrap.css">
<link rel="stylesheet" href="/css/style.css">
<script src="https://cdn.example.com/jquery.js"></script>
<script type="application/json" id="data">{"ok":true}</script>
<script>console.log("inline")</script>
<style>body{background:url(https://tracker.example/bg.png)}</style>
</head><body>
<!-- <script>console.log("commented out")</script> -->
<button onclick="go()">Go</button>
<a href="javascript:void(0)">x</a>
<a href="About.html">About</a>
<a href="contact.html">Contact</a>
<a href="https://www.usm.my">USM</a>
<img src="img/missing.png">
<iframe src="https://www.youtube.com/embed/x"></iframe>
<form action="https://evil.example/collect"><input name="q"></form>
<script src="js/app.js"></script>
</body></html>`,
      },
      { name: 'about.html', data: '<p>About</p>' },
      {
        name: 'css/style.css',
        data: '@import "https://fonts.example/f.css"; h1{background:url(../img/logo.png)}',
      },
      { name: 'img/logo.png', data: PNG, method: 0 },
      {
        name: 'js/app.js',
        data: 'fetch("https://api.example.com/data").then(r=>r.json()); eval("1+1"); const w = new Worker("w.js"); img.src = URL.createObjectURL(blob);',
      },
    ]),
};

export const NOT_A_ZIP = Buffer.from('This is a plain text file, not a ZIP archive.');
