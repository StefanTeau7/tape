// The Tape home page: the typing wall, Rolf, the try-it doc, "What would you
// tape first?" and the waitlist forms. Without JavaScript the page is complete:
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
    { who: 'agent', text: 'Rate limits: 100 requests per minute per key.' },
    { who: 'you', text: 'Errors return JSON with a code and a message.' },
    { who: 'agent', text: 'Webhooks retry three times, then alert the owner.' },
  ];
  const wall = $('[data-wall]');
  if (wall && !reduce) {
    const views = $$('[data-done]', wall);
    const typing = $$('[data-typing]', wall);
    const typingNum = $('[data-typing-num]', wall);
    const chip = $('[data-chip]', wall);
    const who = $('[data-who]', wall);
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
    };
    const showTyping = () => { const text = LINES[step].text.slice(0, n); for (const node of typing) node.textContent = text; };
    const tick = () => {
      const line = LINES[step];
      if (n < line.text.length) n += 1;
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

  // ---- Achievement toast
  const toast = $('[data-toast]');
  let toastTimer = 0;
  const showToast = (title, text) => {
    if (!toast) return;
    $('[data-toast-title]', toast).textContent = title;
    $('[data-toast-text]', toast).textContent = text;
    toast.hidden = true;
    void toast.offsetWidth; // restart the entrance animation
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2900);
  };

  // ---- Go on, tape something: mask, peel, strip and seal one line of a doc.
  const VERSIONS = [
    'Write the launch post. Keep it short and honest.',
    'Launch post: one demo video, one paragraph, zero buzzwords.',
    'Launch post: a 30-second demo, then a list of what it can’t do yet.',
  ];
  const QUESTS = {
    mask: ['Undercover', 'You masked your first line.'],
    peel: ['Clean peel', 'You applied an agent’s draft.'],
    strip: ['No trace', 'You threw a draft away.'],
    seal: ['Locked in', 'You sealed a version.'],
  };
  const play = $('#try');
  if (play && $('[data-verb]', play)) {
    const s = { mode: 'open', ci: 0, ti: 1, rn: 0, last: '', status: 'Pick a verb. Start with Mask it.', done: new Set() };
    const q = (name) => $(`[data-${name}]`, play);
    const verb = (name) => $(`[data-verb="${name}"]`, play);
    let typer = 0;
    const render = () => {
      const target = VERSIONS[s.ti];
      const typedAll = s.rn >= target.length;
      const masked = s.mode === 'masked', sealed = s.mode === 'sealed';
      verb('mask').disabled = s.mode !== 'open';
      verb('peel').disabled = !(masked && typedAll);
      verb('strip').disabled = !masked;
      verb('seal').disabled = s.mode !== 'open';
      verb('seal').hidden = sealed;
      verb('unseal').hidden = !sealed;
      q('hint').hidden = !!s.last;
      q('seal-tape').hidden = !sealed;
      q('file').hidden = sealed;
      q('stamp').hidden = !sealed;
      q('p2').textContent = VERSIONS[s.ci];
      q('masked-label').hidden = !masked;
      q('mask-over').hidden = !masked;
      q('edited').hidden = !(s.ci > 0 && !masked);
      q('draft-box').hidden = !masked;
      q('draft').textContent = target.slice(0, s.rn);
      for (const row of $$('[data-row]', play)) row.classList.toggle('is-last', row.dataset.row === s.last);
      q('status').textContent = s.status;
      for (const item of $$('[data-quest]', play)) item.classList.toggle('is-done', s.done.has(item.dataset.quest));
      q('quest-count').textContent = `${s.done.size} / 4 done`;
      q('all-done').hidden = s.done.size < 4;
    };
    const unlock = (key) => {
      if (s.done.has(key)) return;
      s.done.add(key);
      if (s.done.size === 4) showToast('Tape master', 'All four quests done. Rolf is impressed.');
      else showToast(...QUESTS[key]);
    };
    const typeDraft = () => {
      clearInterval(typer);
      const target = VERSIONS[s.ti];
      if (reduce) { s.rn = target.length; render(); return; }
      typer = setInterval(() => {
        if (s.mode !== 'masked' || s.rn >= target.length) { clearInterval(typer); return; }
        s.rn += 1;
        render();
      }, 55);
    };
    const actions = {
      mask() { Object.assign(s, { mode: 'masked', ti: s.ci === 1 ? 2 : 1, rn: 0, last: 'mask', status: 'Masked. The agent rewrites this line in private.' }); unlock('mask'); typeDraft(); },
      peel() { Object.assign(s, { mode: 'open', ci: s.ti, rn: 0, last: 'peel', status: 'Peeled. The agent’s version is in.' }); unlock('peel'); },
      strip() { Object.assign(s, { mode: 'open', rn: 0, last: 'strip', status: 'Stripped. The draft is gone; nothing changed.' }); unlock('strip'); },
      seal() { Object.assign(s, { mode: 'sealed', last: 'seal', status: 'Sealed. Locked for good.' }); unlock('seal'); },
      unseal() { Object.assign(s, { mode: 'open', last: 'seal', status: 'Unsealed. The sealed version stays on record.' }); },
    };
    for (const button of $$('[data-verb]', play)) {
      button.addEventListener('click', () => {
        const name = button.dataset.verb;
        actions[name]();
        render();
        // Keep keyboard focus on the toolbar when the pressed button disappears.
        if (button.hidden || button.disabled) {
          const next = name === 'seal' ? verb('unseal') : name === 'unseal' ? verb('seal') : $('[data-verb]:not([disabled]):not([hidden])', play);
          if (next) next.focus();
        }
      });
    }
    render();
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
