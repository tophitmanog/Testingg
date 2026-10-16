// Booking flow: visit → date & time (live availability) → details → confirm → saved.
(() => {
  const PHONE = '+16476296061';
  const DRAFT = 'cd-booking-draft';
  const form = document.getElementById('bookForm');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const panes = [...form.querySelectorAll('.pane')];
  const steps = [...form.querySelectorAll('.progress li')];
  const next = $('next'), back = $('back'), msg = $('msg'), fallback = $('fallback');
  const started = Date.now();
  let step = 0, avail = null, month = null, slotMinutes = 30;
  const state = { date: '', time: '' };

  // ---------------------------------------------------------------- formatting
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const parse = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
  const key = dt => dt.toISOString().slice(0, 10);
  const niceDate = d => { const x = parse(d); return `${DAYS[x.getUTCDay()]}, ${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`; };
  const shortDate = d => { const x = parse(d); return `${DAYS[x.getUTCDay()].slice(0, 3)}, ${MONTHS[x.getUTCMonth()].slice(0, 3)} ${x.getUTCDate()}`; };
  const niceTime = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const val = name => { const el = form.elements[name]; return el instanceof RadioNodeList ? el.value : (el.type === 'checkbox' ? el.checked : el.value.trim()); };

  // ---------------------------------------------------------------- availability
  async function loadAvailability() {
    try {
      const res = await fetch('/api/availability', { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!data.ok) throw new Error('bad');
      avail = data.days;
      slotMinutes = data.slotMinutes || 30;
      const first = avail.find(d => d.times.length);
      const nextSlot = $('nextSlot');
      if (first && nextSlot) {
        nextSlot.querySelector('b').textContent = `${shortDate(first.date)} · ${niceTime(first.times[0])}`;
        nextSlot.hidden = false;
      }
      if (state.date && !(avail.find(d => d.date === state.date)?.times.includes(state.time))) state.time = '';
      if (!month) month = (first ? first.date : avail[0].date).slice(0, 7);
      renderCalendar();
    } catch {
      avail = null;
      $('times').innerHTML = `<p class="empty">Online booking isn't loading right now. Please call or text <a href="tel:${PHONE}">647-629-6061</a>.</p>`;
    }
  }

  function renderCalendar() {
    if (!avail) return;
    const byDate = new Map(avail.map(d => [d.date, d.times]));
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    $('calTitle').textContent = `${MONTHS[m - 1]} ${y}`;
    const months = [...new Set(avail.map(d => d.date.slice(0, 7)))];
    $('calPrev').disabled = months.indexOf(month) <= 0;
    $('calNext').disabled = months.indexOf(month) >= months.length - 1;
    const today = avail[0].date;
    let html = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => `<span class="dow" aria-hidden="true" title="${DAYS[i]}">${d}</span>`).join('');
    for (let i = 0; i < first.getUTCDay(); i++) html += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const open = (byDate.get(date) || []).length > 0;
      const cls = [open && 'open', date === today && 'today', date === state.date && 'sel'].filter(Boolean).join(' ');
      html += `<button type="button" class="${cls}" data-date="${date}" ${open ? '' : 'disabled'} aria-label="${niceDate(date)}${open ? '' : ', no times'}" ${date === state.date ? 'aria-pressed="true"' : ''}>${d}</button>`;
    }
    $('cal').innerHTML = html;
    if (state.date && byDate.has(state.date)) renderTimes(state.date);
    else {
      const firstOpen = avail.find(x => x.date.startsWith(month) && x.times.length);
      if (firstOpen && !state.date) { state.date = firstOpen.date; renderCalendar(); return; }
      $('times').innerHTML = `<p class="empty">Choose a day to see open times.</p>`;
    }
  }

  function renderTimes(date) {
    const times = avail.find(d => d.date === date)?.times || [];
    const groups = [['Morning', t => t < '12:00'], ['Afternoon', t => t >= '12:00' && t < '17:00'], ['Evening', t => t >= '17:00']];
    let html = `<h4>${niceDate(date)}</h4><p class="tz">Times are in Toronto time · ${slotMinutes}-minute visits</p>`;
    if (!times.length) html += `<p class="empty">No open times left on this day.</p>`;
    for (const [label, test] of groups) {
      const list = times.filter(test);
      if (!list.length) continue;
      html += `<div class="slot-group"><span>${label}</span><div class="slots">${list.map(t => `<button type="button" data-time="${t}" class="${t === state.time ? 'sel' : ''}" aria-pressed="${t === state.time}">${niceTime(t)}</button>`).join('')}</div></div>`;
    }
    $('times').innerHTML = html;
  }

  $('cal').addEventListener('click', e => {
    const b = e.target.closest('button.open');
    if (!b) return;
    state.date = b.dataset.date; state.time = '';
    renderCalendar(); recap(); clearErr('slot'); save();
  });
  $('times').addEventListener('click', e => {
    const b = e.target.closest('button[data-time]');
    if (!b) return;
    state.time = b.dataset.time;
    renderTimes(state.date); recap(); clearErr('slot'); save();
  });
  const shiftMonth = dir => {
    const months = [...new Set(avail.map(d => d.date.slice(0, 7)))];
    const i = months.indexOf(month) + dir;
    if (i < 0 || i >= months.length) return;
    month = months[i];
    const firstOpen = avail.find(x => x.date.startsWith(month) && x.times.length);
    state.date = firstOpen ? firstOpen.date : ''; state.time = '';
    renderCalendar(); recap();
  };
  $('calPrev').addEventListener('click', () => shiftMonth(-1));
  $('calNext').addEventListener('click', () => shiftMonth(1));

  // ---------------------------------------------------------------- recap + steps
  function recap() {
    const set = (id, text, empty) => { const el = $(id); el.textContent = text || empty; el.classList.toggle('empty', !text); };
    set('rVisit', val('service'), 'Not chosen yet');
    set('rDate', state.date && state.time ? niceDate(state.date) : '', '—');
    set('rTime', state.time ? niceTime(state.time) : '', '—');
  }

  function go(i, focus = true) {
    step = i;
    panes.forEach((p, n) => p.classList.toggle('on', n === i));
    steps.forEach((s, n) => { s.classList.toggle('on', n === i); s.classList.toggle('done', n < i); });
    back.hidden = i === 0 || i >= 4;
    $('controls').hidden = i >= 4;
    next.firstChild.textContent = i === 3 ? 'Confirm booking ' : 'Continue ';
    msg.textContent = ''; fallback.hidden = true;
    if (i === 1 && avail) renderCalendar();
    if (i === 3) review();
    if (focus) {
      const h = panes[i].querySelector('h3');
      document.getElementById('booker').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    }
  }

  // ---------------------------------------------------------------- validation
  const errEl = n => form.querySelector(`[data-err="${n}"]`);
  function setErr(n, text) {
    const el = errEl(n);
    if (!el) return;
    el.textContent = text || '';
    el.closest('.field')?.classList.toggle('invalid', !!text);
    const input = form.elements[n];
    if (input && input.setAttribute) input.setAttribute('aria-invalid', text ? 'true' : 'false');
  }
  const clearErr = n => setErr(n, '');
  const PANE_OF = { service: 0, slot: 1, name: 2, phone: 2, email: 2, consent: 3 };
  function check(i) {
    const errs = {};
    if (i === 0 && !val('service')) errs.service = 'Please choose what you would like to book.';
    if (i === 1 && !(state.date && state.time)) errs.slot = 'Please choose a day and a time.';
    if (i === 2) {
      if (val('name').length < 2) errs.name = 'Please enter your name.';
      const p = val('phone'), digits = p.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15 || !/^[\d\s()+.\-x]+$/i.test(p)) errs.phone = 'Please enter a valid phone number.';
      const e = val('email');
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) errs.email = 'Please check your email address.';
      if (!e && val('contactBy') === 'Email') errs.email = 'Add an email so I can reply by email.';
    }
    if (i === 3 && !val('consent')) errs.consent = 'Please tick the box so I can contact you.';
    Object.keys(PANE_OF).filter(k => PANE_OF[k] === i).forEach(k => setErr(k, errs[k]));
    const first = Object.keys(errs)[0];
    if (first) (form.elements[first]?.focus ? form.elements[first] : errEl(first))?.focus?.();
    return !first;
  }

  // ---------------------------------------------------------------- review
  function review() {
    const ins = val('insurance') === 'Yes' && val('provider') ? `Yes (${val('provider')})` : val('insurance');
    const rows = [
      ['Visit', `${val('service')} · ${val('patient')}`, 0],
      ['When', `${niceDate(state.date)} at ${niceTime(state.time)}`, 1],
      ['Name', val('name'), 2],
      ['Contact', `${val('contactBy')} · ${val('phone')}${val('email') ? ' · ' + val('email') : ''}`, 2],
      ['Details', `${val('people')} · Insurance: ${ins}`, 2],
      ...(val('message') ? [['Note', val('message'), 2]] : []),
    ];
    $('review').innerHTML = rows.map(([k, v, s]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd><button type="button" data-goto="${s}" aria-label="Edit ${k.toLowerCase()}">Edit</button></div>`).join('');
  }
  $('review').addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) go(+b.dataset.goto); });

  // ---------------------------------------------------------------- submit
  function payload() {
    return {
      _ts: started, website: form.elements.website.value,
      service: val('service'), patient: val('patient'), date: state.date, time: state.time,
      name: val('name'), phone: val('phone'), email: val('email'), contactBy: val('contactBy'),
      people: val('people'), insurance: val('insurance'), provider: val('provider'), message: val('message'), consent: val('consent'),
    };
  }

  async function submit() {
    next.disabled = true; next.firstChild.textContent = 'Booking… ';
    msg.textContent = ''; fallback.hidden = true;
    let res, data = {};
    try {
      res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload()) });
      data = await res.json().catch(() => ({}));
    } catch { res = null; }
    next.disabled = false; next.firstChild.textContent = 'Confirm booking ';
    if (res && res.ok && data.ok) return done(data.booking);
    if (res && res.status === 409) {
      state.time = ''; recap();
      await loadAvailability();
      go(1);
      setErr('slot', 'Sorry, that time was just taken. Please choose another.');
      return;
    }
    if (res && res.status === 422 && data.fields) {
      const keys = Object.keys(data.fields);
      const pane = Math.min(...keys.map(k => PANE_OF[k] ?? 3));
      go(pane);
      keys.forEach(k => setErr(k, data.fields[k]));
      return;
    }
    if (res && res.status === 429) { msg.textContent = 'Too many tries. Please wait a minute and try again.'; return; }
    msg.textContent = "Sorry, your booking didn't go through. You can text it to me in one tap:";
    const body = `Hi Stephanie, I'd like to book ${val('service')} on ${niceDate(state.date)} at ${niceTime(state.time)}. ${val('name')}, ${val('phone')}.`;
    $('smsFallback').href = `sms:${PHONE}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(body)}`;
    fallback.hidden = false;
  }

  function done(b) {
    const first = val('name').split(/\s+/)[0];
    const how = { Call: 'call', Text: 'text', Email: 'email' }[val('contactBy')] || 'contact';
    $('doneTitle').textContent = `You're booked in${first ? ', ' + first : ''}.`;
    $('doneText').textContent = `I've saved this time for you and I'll ${how} you soon to confirm. — Stephanie`;
    $('ticket').innerHTML = [['Visit', val('service')], ['When', `${niceDate(state.date)}, ${niceTime(state.time)}`], ['Where', '9000 Jane Street, Concord'], ['Reference', b.ref]]
      .map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('');
    // Calendar links (clinic time zone).
    const start = state.date.replace(/-/g, '') + 'T' + state.time.replace(':', '') + '00';
    const [h, m] = state.time.split(':').map(Number);
    const endMin = h * 60 + m + slotMinutes;
    const end = state.date.replace(/-/g, '') + 'T' + String(Math.floor(endMin / 60)).padStart(2, '0') + String(endMin % 60).padStart(2, '0') + '00';
    const title = `Dental visit: ${val('service')}`;
    const where = 'Charisma Dental, 9000 Jane Street, Concord, ON L4K 0M6';
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Charisma Dental//Booking//EN', 'BEGIN:VEVENT',
      `UID:${b.ref}@charisma-booking`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;TZID=America/Toronto:${start}`, `DTEND;TZID=America/Toronto:${end}`,
      `SUMMARY:${title}`, `LOCATION:${where.replace(/,/g, '\\,')}`, `DESCRIPTION:Reference ${b.ref}. Questions? Call or text 647-629-6061.`,
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    $('icsLink').href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    $('gcalLink').href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&ctz=America/Toronto&location=${encodeURIComponent(where)}&details=${encodeURIComponent('Reference ' + b.ref)}`;
    try { localStorage.removeItem(DRAFT); } catch {}
    go(4);
    panes[4].focus();
  }

  next.addEventListener('click', () => {
    if (!check(step)) return;
    if (step < 3) go(step + 1); else submit();
  });
  back.addEventListener('click', () => go(Math.max(0, step - 1)));
  $('again').addEventListener('click', () => {
    form.reset(); state.date = ''; state.time = '';
    $('urgent').hidden = true; $('providerRow').hidden = true;
    recap(); loadAvailability(); go(0);
  });

  form.addEventListener('change', e => {
    const n = e.target.name;
    if (n === 'service') { $('urgent').hidden = e.target.value !== 'Toothache or emergency'; clearErr('service'); recap(); }
    if (n === 'insurance') $('providerRow').hidden = e.target.value !== 'Yes';
    if (n === 'consent' && e.target.checked) clearErr('consent');
    save();
  });
  form.addEventListener('input', e => { if (errEl(e.target.name)?.textContent) clearErr(e.target.name); save(); });
  form.addEventListener('submit', e => e.preventDefault());

  // "Book" arrows on the services list pre-select the visit.
  document.querySelectorAll('[data-service]').forEach(a => a.addEventListener('click', () => {
    const r = [...form.elements.service].find(x => x.value === a.dataset.service);
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    go(0, false);
  }));

  // ---------------------------------------------------------------- draft (survives a refresh)
  function save() {
    const d = { date: state.date, time: state.time };
    for (const el of form.elements) {
      if (!el.name || el.name === 'website' || el.name === 'consent') continue;
      if (el.type === 'radio') { if (el.checked) d[el.name] = el.value; } else d[el.name] = el.value;
    }
    try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch {}
  }
  function restore() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch {}
    if (!d) return;
    for (const el of form.elements) {
      if (!el.name || !(el.name in d) || el.name === 'website') continue;
      if (el.type === 'radio') el.checked = el.value === d[el.name]; else el.value = d[el.name];
    }
    state.date = d.date || ''; state.time = d.time || '';
    if (state.date) month = state.date.slice(0, 7);
    $('urgent').hidden = val('service') !== 'Toothache or emergency';
    $('providerRow').hidden = val('insurance') !== 'Yes';
  }

  restore();
  recap();
  go(0, false);
  loadAvailability();
})();
