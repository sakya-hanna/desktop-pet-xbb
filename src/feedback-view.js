'use strict';
(() => {
  const card = document.getElementById('feedback-card');
  const text = document.getElementById('feedback-text');
  const unsubscribe = window.feedback.onState(value => {
    text.textContent = value === null ? '' : value.text;
    card.hidden = value === null;
  });
  window.addEventListener('pagehide', () => {
    unsubscribe(); text.textContent = ''; card.hidden = true;
  }, { once: true });
})();
