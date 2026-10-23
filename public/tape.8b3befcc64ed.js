// The Tape home page: the typing wall, Rolf, "What would you tape first?"
// and the waitlist forms. Without JavaScript the page is complete:
// the wall shows its last frame, the pick is a plain radio group sent with the
// closing form, and both forms post to /api/waitlist, which answers with a page.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- Reading progress, for browsers without scroll-driven animations
  const progress = $('.progress');
  if (progress && !reduce && !(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'))) {
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  // ---- The wall: an agent and a person take turns typing into one document,
  // and all four places show every keystroke.
  const LINES = [
    { who: 'agent', text: 'Rate limit: 100 per minute.' },
    { who: 'you', text: 'Errors come back as JSON.' },
    { who: 'agent', text: 'Webhooks retry 3 times.' },
  ];
  const wall = $('[data-wall]');
  if (wall && !reduce) {
    const views = $$('[data-done]', wall);
    const typing = $$('[data-typing]', wall);
    const typingNum = $('[data-typing-num]', wall);
    const chip = $('[data-chip]', wall);
    const who = $('[data-who]', wall);
    const avatars = $$('[data-av]', wall);
    const lives = $$('.live', wall);
    const doneLine = (kind, line, index) => {
      if (kind === 'term') {
        const row = el('div');
        row.append(el('span', 'term-p', '›'), ` ${line.text}`);
        return row;
      }
      if (kind === 'ed') {
        const row = el('div', 'ed-line');
        row.append(el('span', 'ed-num', String(index + 3)), el('span', 'ed-txt', line.text));
        return row;
      }
      return el('div', '', line.text);
    };
    let step = 0, n = 0, hold = 0, timer = 0, visible = false;
    const showStep = () => {
      for (const view of views) view.replaceChildren(...LINES.slice(0, step).map((line, i) => doneLine(view.dataset.done, line, i)));
      if (typingNum) typingNum.textContent = String(step + 3);
      const agent = LINES[step].who === 'agent';
      chip.classList.toggle('is-you', !agent);
      who.textContent = agent ? 'Agent is writing' : 'You are writing';
      for (const av of avatars) av.classList.toggle('is-on', av.dataset.av === LINES[step].who);
      for (const live of lives) live.classList.remove('flash');
    };
    const showTyping = () => { const text = LINES[step].text.slice(0, n); for (const node of typing) node.textContent = text; };
    const tick = () => {
      const line = LINES[step];
      if (n < line.text.length) {
        n += 1;
        // The line is done: it lands in all four places at once.
        if (n === line.text.length) for (const live of lives) live.classList.add('flash');
      }
      else if (hold < 34) { hold += 1; return; }
      else { step = (step + 1) % LINES.length; n = 0; hold = 0; showStep(); }
      showTyping();
    };
    const run = () => {
      const should = visible && document.visibilityState === 'visible';
      if (should && !timer) timer = setInterval(tick, 55);
      if (!should && timer) { clearInterval(timer); timer = 0; }
    };
    showStep();
    showTyping();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); run(); }).observe(wall);
    } else {
      visible = true;
    }
    document.addEventListener('visibilitychange', run);
    run();
  }

  // ---- Rolf
  const SAYINGS = ['poke me', 'Hi! I’m Rolf.', 'I tape things. Everywhere.', 'Please stop making copies.', 'Same document. I checked.', 'Hehe. That tickles.'];
  const rolf = $('[data-rolf]');
  const rolfSay = $('[data-rolf-say]');
  if (rolf && rolfSay) {
    let say = 0;
    rolf.addEventListener('click', () => {
      say = say + 1 >= SAYINGS.length ? 1 : say + 1;
      rolfSay.textContent = SAYINGS[say];
    });
  }

  // ---- What would you tape first?
  const PICK_LABELS = { memory: 'agent memory', plan: 'a shared plan', spec: 'a team spec', notes: 'phone notes' };
  const pickInputs = $$('input[name="pick"]');
  const pickLine = $('[data-pick-line]');
  const firstUp = $('[data-first-up]');
  let joinedEmail = '';
  const currentPick = () => { const checked = pickInputs.find((input) => input.checked); return checked ? checked.value : ''; };
  const showPick = () => {
    const pick = currentPick();
    for (const input of pickInputs) input.closest('.pick').classList.toggle('is-picked', input.checked);
    if (pickLine) pickLine.textContent = !pick ? 'Tap one. It helps us decide who gets in first.' : joinedEmail ? 'Noted. Thanks, that helps.' : 'Noted. Now tape yourself in below.';
    if (firstUp) {
      firstUp.hidden = !pick || !!joinedEmail;
      $('[data-pick-label]', firstUp).textContent = PICK_LABELS[pick] || '';
    }
  };
  for (const input of pickInputs) {
    input.addEventListener('change', () => {
      showPick();
      // Joined before picking: add the answer to the sign-up. Same request as
      // a sign-up; the server only fills in an answer that is still empty.
      if (joinedEmail && currentPick()) {
        fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ email: joinedEmail, pick: currentPick(), source: 'closing', hp_ref: '' }) }).catch(() => {});
      }
    });
  }
  showPick();

  // ---- Waitlist forms. Both forms share one state: once you're in, both say so.
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const MESSAGES = {
    invalid: 'That doesn’t look like an email address. Check it and try again.',
    limited: 'Too many sign-ups from this connection today. Try again tomorrow.',
    failed: 'Couldn’t tape you in just now. Check your connection and try again in a minute.',
  };
  const ctaSay = $('[data-cta-say]');
  const joinedState = (form, email) => {
    joinedEmail = email;
    root.classList.add('is-joined');
    for (const box of $$('[data-join]')) {
      const boxForm = $('form', box);
      const message = $('[data-joined]', box);
      if (boxForm) boxForm.hidden = true;
      if (message) message.hidden = false;
    }
    if (ctaSay) ctaSay.textContent = 'yay! see you soon';
    showPick();
    const message = $('[data-joined]', form.closest('[data-join]'));
    if (message) message.focus();
  };
  for (const form of $$('form[data-waitlist]')) {
    const input = $('input[type=email]', form);
    const button = $('button[type=submit]', form);
    const status = $('.frm-status', form);
    const trap = $('input[name=hp_ref]', form);
    const source = $('input[name=source]', form);
    let busy = false;
    const show = (text, isError) => { status.textContent = text; status.classList.toggle('is-error', !!isError); };
    const invalid = () => { input.setAttribute('aria-invalid', 'true'); show(MESSAGES.invalid, true); input.focus(); };
    input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); if (status.classList.contains('is-error')) show('', false); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const email = input.value.trim();
      if (!EMAIL.test(email) || email.length > 254) { invalid(); return; }
      // aria-disabled rather than disabled, so the focused button keeps focus.
      busy = true;
      button.setAttribute('aria-disabled', 'true');
      const label = button.textContent;
      button.textContent = 'Taping…';
      show('', false);
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ email, hp_ref: trap ? trap.value : '', source: source ? source.value : '', pick: currentPick() }),
        });
        if (response.ok) { joinedState(form, email); return; }
        if (response.status === 400) invalid();
        else if (response.status === 429) show(MESSAGES.limited, true);
        else show(MESSAGES.failed, true);
      } catch {
        show(MESSAGES.failed, true);
      } finally {
        busy = false;
        button.removeAttribute('aria-disabled');
        button.textContent = label;
      }
    });
  }
})();
