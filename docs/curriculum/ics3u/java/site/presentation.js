(() => {
  const sections = [...document.querySelectorAll('.lesson-section')];
  const reading = document.getElementById('reading');
  const present = document.getElementById('present');
  const options = document.getElementById('options');
  const fullscreen = document.getElementById('fullscreen');
  const progress = document.getElementById('progress');
  const notes = document.getElementById('notes');
  const themeChoices = [...document.querySelectorAll('[data-theme-choice]')];
  const initialUrl = new URL(location.href);
  const isNotes = initialUrl.searchParams.get('notes') === '1';
  const sessionId = initialUrl.searchParams.get('session') || crypto.randomUUID();
  let channel = null;
  let index = Math.max(0, sections.findIndex(section => '#' + section.id === location.hash));
  let presenting = !isNotes && initialUrl.searchParams.get('view') === 'present';
  let framePending = false;

  function update() {
    document.body.classList.toggle('presenting', presenting);
    sections.forEach((section, number) => { section.hidden = presenting && number !== index; });
    reading.setAttribute('aria-pressed', String(!presenting));
    present.setAttribute('aria-pressed', String(presenting));
    progress.textContent = `${index + 1} / ${sections.length}`;
    const notesUrl = new URL(location.href);
    notesUrl.searchParams.delete('view');
    notesUrl.searchParams.set('session', sessionId);
    notesUrl.searchParams.set('notes', '1');
    notesUrl.hash = sections[index].id;
    notes.href = notesUrl;
    notes.target = 'java-notes-' + sessionId;
    publish();
  }
  function publish() {
    if (!isNotes) channel?.postMessage({ type: 'state', index, theme: document.documentElement.dataset.theme });
  }
  function setView(asPresentation) {
    presenting = asPresentation;
    options.open = false;
    const url = new URL(location.href);
    if (presenting) url.searchParams.set('view', 'present');
    else url.searchParams.delete('view');
    url.hash = sections[index].id;
    history.replaceState(null, '', url);
    update();
    if (presenting) window.scrollTo({ top: 0, behavior: 'instant' });
    else sections[index].scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function move(change) {
    index = Math.max(0, Math.min(sections.length - 1, index + change));
    update();
    const url = new URL(location.href);
    url.hash = sections[index].id;
    history.replaceState(null, '', url);
    if (presenting) window.scrollTo({ top: 0, behavior: 'instant' });
    else sections[index].scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeChoices.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
    try { localStorage.setItem('java-lesson-theme', theme); } catch { /* Device preference is optional. */ }
    publish();
  }
  let savedTheme = 'light';
  try { savedTheme = localStorage.getItem('java-lesson-theme') || savedTheme; } catch { /* Use the default. */ }
  setTheme(savedTheme === 'dark' ? 'dark' : 'light');
  themeChoices.forEach(button => button.addEventListener('click', () => {
    setTheme(button.dataset.themeChoice);
    options.open = false;
    options.querySelector('summary').focus();
  }));
  reading.addEventListener('click', () => setView(false));
  present.addEventListener('click', () => setView(true));
  notes.addEventListener('click', event => {
    options.open = false;
    const current = new URL(location.href);
    current.searchParams.set('session', sessionId);
    history.replaceState(null, '', current);
    const notesUrl = new URL(current);
    notesUrl.searchParams.delete('view');
    notesUrl.searchParams.set('notes', '1');
    notesUrl.hash = sections[index].id;
    const opened = window.open(notesUrl, 'java-notes-' + sessionId, 'popup,width=720,height=900');
    if (opened) event.preventDefault();
  });
  document.getElementById('print').addEventListener('click', () => { options.open = false; window.print(); });
  fullscreen.addEventListener('click', () => {
    options.open = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const active = !!document.fullscreenElement;
    const label = active ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreen.setAttribute('aria-label', label);
    fullscreen.title = label;
    fullscreen.querySelector('.icon-maximize').hidden = active;
    fullscreen.querySelector('.icon-minimize').hidden = !active;
  });
  document.addEventListener('click', event => { if (!options.contains(event.target)) options.open = false; });
  document.addEventListener('focusin', event => { if (!options.contains(event.target)) options.open = false; });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && options.open) {
      options.open = false;
      options.querySelector('summary').focus();
      event.preventDefault();
      return;
    }
    if ((!presenting && !isNotes) || options.open || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && !isNotes) { setView(false); reading.focus(); }
    if (['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      const change = ['ArrowRight', 'PageDown'].includes(event.key) ? 1 : -1;
      if (isNotes && channel) channel.postMessage({ type: 'move', change });
      else move(change);
    }
  });
  function syncReadingPage() {
    framePending = false;
    if (presenting || isNotes) return;
    const match = sections.findIndex(section => section.getBoundingClientRect().bottom > innerHeight * .25);
    if (match >= 0) index = match;
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 4) index = sections.length - 1;
    update();
  }
  window.addEventListener('scroll', () => {
    if (!presenting && !framePending) { framePending = true; requestAnimationFrame(syncReadingPage); }
  }, { passive: true });
  window.addEventListener('hashchange', () => {
    const match = sections.findIndex(section => '#' + section.id === location.hash);
    if (match >= 0) { index = match; update(); }
  });
  window.addEventListener('beforeprint', () => { sections.forEach(section => { section.hidden = false; }); });
  window.addEventListener('afterprint', update);
  if (isNotes) {
    document.body.classList.add('notes-window');
    document.title = 'Java explained · Presenter’s notes';
  }
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel('java-presenter-' + sessionId);
    channel.addEventListener('message', ({ data }) => {
      if (!data || typeof data !== 'object') return;
      if (!isNotes && data.type === 'hello') publish();
      if (!isNotes && data.type === 'move' && (data.change === 1 || data.change === -1)) move(data.change);
      if (isNotes && data.type === 'state' && Number.isInteger(data.index) && data.index >= 0 && data.index < sections.length) {
        index = data.index;
        if (data.theme === 'light' || data.theme === 'dark') setTheme(data.theme);
        update();
        sections.forEach((section, number) => section.classList.toggle('current-note', number === index));
        sections[index].scrollIntoView({ block: 'start', behavior: 'instant' });
        const url = new URL(location.href);
        url.hash = sections[index].id;
        history.replaceState(null, '', url);
      }
    });
    if (isNotes) channel.postMessage({ type: 'hello' });
  }
  update();
})();
