(() => {
  const text = document.getElementById('speech-text');
  const close = document.getElementById('speech-close');
  let currentId = null;
  window.speech.onState(state => {
    currentId = state.id;
    text.textContent = state.text;
    text.scrollTop = 0;
  });
  close.addEventListener('click', () => {
    if (currentId !== null) window.speech.dismiss(currentId);
  });
})();
