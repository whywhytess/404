// F03: fetch() of a local JSON file and a form handled in the page by JavaScript.
let courses = [];
const list = document.getElementById('courses');

function show(items) {
  list.replaceChildren(
    ...items.map((c) => {
      const li = document.createElement('li');
      li.textContent = `${c.code} ${c.title} (${c.credits} credits)`;
      return li;
    }),
  );
}

fetch('data/courses.json')
  .then((r) => r.json())
  .then((data) => {
    courses = data;
    show(courses);
  });

document.getElementById('filter').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.toLowerCase();
  show(courses.filter((c) => `${c.code} ${c.title}`.toLowerCase().includes(q)));
});
