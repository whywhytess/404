// F03: a GET form submitted to another page of the same site; the query is read here.
const code = new URLSearchParams(location.search).get('code') || '';
fetch('data/courses.json')
  .then((r) => r.json())
  .then((courses) => {
    const hit = courses.find((c) => c.code.toLowerCase() === code.toLowerCase());
    document.getElementById('result').textContent = hit
      ? `${hit.code}: ${hit.title}`
      : `No course ${code}`;
  });
