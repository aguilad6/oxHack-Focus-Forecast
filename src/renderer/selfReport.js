// Self-report pop-up page: shows the question from the URL and sends the clicked rating to main.js.

document.getElementById('question').textContent =
  new URLSearchParams(location.search).get('q');

for (const button of document.querySelectorAll('button')) {
  button.addEventListener('click', () =>
    window.focusApi.answerSelfReport(Number(button.dataset.rating)));
}
