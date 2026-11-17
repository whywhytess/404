// F02: local JavaScript, DOM updates, localStorage and alert()/confirm().
const KEY = 'f02-tasks';
const list = document.getElementById('tasks');
const count = document.getElementById('count');
let tasks = JSON.parse(localStorage.getItem(KEY) || '[]');

function save() {
  localStorage.setItem(KEY, JSON.stringify(tasks));
}

function render() {
  list.replaceChildren(
    ...tasks.map((t, i) => {
      const li = document.createElement('li');
      li.textContent = t.text;
      if (t.done) li.classList.add('done');
      li.addEventListener('click', () => {
        tasks[i].done = !tasks[i].done;
        save();
        render();
      });
      return li;
    }),
  );
  count.textContent = String(tasks.length);
}

document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('task');
  tasks.push({ text: input.value, done: false });
  input.value = '';
  save();
  render();
});

document.getElementById('clear').addEventListener('click', () => {
  if (confirm('Delete all tasks?')) {
    tasks = [];
    save();
    render();
    alert('All tasks deleted.');
  }
});

render();
