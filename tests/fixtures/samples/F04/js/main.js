// F04: a locally included third-party library (Bootstrap 5, MIT) with interactive components.
document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('thanks').textContent =
    `Thank you, ${document.getElementById('name').value}!`;
});
