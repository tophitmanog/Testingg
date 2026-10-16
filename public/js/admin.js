// Bookings dashboard: sign in, manage bookings, set availability.
(() => {
  const $ = id => document.getElementById(id);
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
  const niceTime = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const longDate = d => { const x = parse(d); return `${DAYS[x.getUTCDay()]}, ${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`; };
  const LABEL = { new: 'New', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
  let settings = null, timer = null, openIds = new Set();

  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api/admin/' + path, {
      ...opts,
      headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      credentials: 'same-origin',
    });
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // ---------------------------------------------------------------- sign in
  function showLogin() { $('dash').hidden = true; $('login').hidden = false; clearInterval(timer); $('pw').focus(); }
  function showDash() { $('login').hidden = true; $('dash').hidden = false; loadBookings(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden && !$('tab-bookings').hidden) loadBookings(true); }, 60000); }

  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('loginErr').textContent = '';
    const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pw').value }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { $('pw').value = ''; showDash(); return; }
    $('loginErr').textContent = {
      wrong_password: 'That password is not right.',
      rate_limited: 'Too many tries. Please wait a minute.',
      not_configured: 'The dashboard password hasn\'t been set up yet (ADMIN_PASSWORD in Cloudflare).',
    }[data.error] || 'Could not sign in. Please try again.';
  });
  $('logout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); showLogin(); });

  // ---------------------------------------------------------------- tabs
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    $('tab-bookings').hidden = b.dataset.tab !== 'bookings';
    $('tab-hours').hidden = b.dataset.tab !== 'hours';
    if (b.dataset.tab === 'hours') loadSettings(); else loadBookings();
  }));

  // ---------------------------------------------------------------- bookings
  const filters = () => {
    const p = new URLSearchParams();
    p.set('view', document.querySelector('[name=view]:checked').value);
    if ($('statusFilter').value) p.set('status', $('statusFilter').value);
    if ($('search').value.trim()) p.set('q', $('search').value.trim());
    return p.toString();
  };

  async function loadBookings(quiet) {
    let out;
    try { out = await api('bookings?' + filters()); } catch { return; }
    const { bookings = [], stats = {} } = out.data;
    $('sNew').textContent = stats.newCount ?? 0;
    $('sToday').textContent = stats.today ?? 0;
    $('sUpcoming').textContent = stats.upcoming ?? 0;
    $('sTotal').textContent = stats.total ?? 0;
    $('refreshed').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every minute`;
    document.title = (stats.newCount ? `(${stats.newCount}) ` : '') + 'Bookings dashboard · Dental with Stephanie';
    renderList(bookings);
    if (!quiet) window.scrollTo({ top: 0 });
  }

  function renderList(list) {
    if (!list.length) {
      $('list').innerHTML = `<div class="empty-state"><p>No bookings here yet.</p><span class="muted">New bookings appear here as soon as they're made.</span></div>`;
      return;
    }
    let html = '', lastDay = '';
    for (const b of list) {
      if (b.date !== lastDay) { html += `<h3 class="day-head">${longDate(b.date)}</h3>`; lastDay = b.date; }
      const tel = b.phone.replace(/[^\d+]/g, '');
      const urgent = b.service === 'Toothache or emergency';
      const ins = b.insurance === 'Yes' && b.provider ? `Yes (${b.provider})` : b.insurance;
      html += `<details class="bk" data-id="${b.id}" ${openIds.has(b.id) ? 'open' : ''}>
        <summary>
          <div class="bw"><b>${niceTime(b.time)}</b><span>${MONTHS[parse(b.date).getUTCMonth()]} ${parse(b.date).getUTCDate()}</span></div>
          <div class="who"><b>${esc(b.name)}</b><span class="${urgent ? 'urgent-tag' : ''}">${esc(b.service)}</span> <span>· ${esc(b.patient)} · ${esc(b.people)}</span></div>
          <span class="pill ${b.status}">${LABEL[b.status]}</span>
        </summary>
        <div class="body">
          <div class="quick">
            <a class="btn btn-dark sm" href="tel:${esc(tel)}">Call</a>
            <a class="btn btn-clay sm" href="sms:${esc(tel)}">Text</a>
            ${b.email ? `<a class="btn btn-line sm" href="mailto:${esc(b.email)}">Email</a>` : ''}
          </div>
          <dl>
            <div><dt>Phone</dt><dd>${esc(b.phone)}</dd></div>
            <div><dt>Email</dt><dd>${esc(b.email || '—')}</dd></div>
            <div><dt>Prefers</dt><dd>${esc(b.contactBy)}</dd></div>
            <div><dt>Insurance</dt><dd>${esc(ins)}</dd></div>
            <div><dt>Reference</dt><dd>${esc(b.ref)}</dd></div>
            <div><dt>Booked</dt><dd>${new Date(b.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd></div>
          </dl>
          ${b.message ? `<p class="note">${esc(b.message)}</p>` : ''}
          <label class="lbl" for="n-${b.id}">Your notes</label>
          <textarea id="n-${b.id}" data-notes placeholder="e.g. Called, booked in with the hygienist">${esc(b.notes)}</textarea>
          <div class="actions">
            ${b.status !== 'confirmed' && b.status !== 'completed' ? `<button class="btn btn-dark sm" data-status="confirmed">Mark confirmed</button>` : ''}
            ${b.status === 'confirmed' ? `<button class="btn btn-line sm" data-status="completed">Mark completed</button>` : ''}
            ${b.status !== 'cancelled' ? `<button class="btn btn-line sm" data-status="cancelled">Cancel booking</button>` : `<button class="btn btn-line sm" data-status="new">Restore</button>`}
            <button class="btn btn-line sm" data-save>Save notes</button>
            <button class="del" data-delete>Delete</button>
          </div>
        </div>
      </details>`;
    }
    $('list').innerHTML = html;
  }

  $('list').addEventListener('toggle', e => {
    const d = e.target.closest('details.bk');
    if (d) d.open ? openIds.add(+d.dataset.id) : openIds.delete(+d.dataset.id);
  }, true);

  $('list').addEventListener('click', async e => {
    const card = e.target.closest('.bk');
    if (!card) return;
    const id = card.dataset.id;
    const notes = card.querySelector('[data-notes]').value;
    const statusBtn = e.target.closest('[data-status]');
    if (statusBtn || e.target.closest('[data-save]')) {
      const body = statusBtn ? { status: statusBtn.dataset.status, notes } : { notes };
      const { status, data } = await api('bookings/' + id, { method: 'PATCH', body: JSON.stringify(body) }).catch(() => ({}));
      if (status === 200) { toast(statusBtn ? `Marked ${LABEL[data.booking.status].toLowerCase()}` : 'Notes saved'); loadBookings(true); }
      else if (data?.error === 'slot_taken') toast('That time has been booked by someone else');
      else toast('Could not save. Please try again.');
    }
    if (e.target.closest('[data-delete]')) {
      if (!confirm('Delete this booking permanently? This cannot be undone.')) return;
      const { status } = await api('bookings/' + id, { method: 'DELETE' }).catch(() => ({}));
      if (status === 200) { toast('Booking deleted'); openIds.delete(+id); loadBookings(true); } else toast('Could not delete.');
    }
  });

  document.querySelectorAll('[name=view]').forEach(r => r.addEventListener('change', () => loadBookings()));
  $('statusFilter').addEventListener('change', () => loadBookings());
  let typing;
  $('search').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => loadBookings(true), 300); });

  // ---------------------------------------------------------------- availability
  async function loadSettings() {
    let out;
    try { out = await api('settings'); } catch { return; }
    settings = out.data.settings;
    renderSettings();
  }

  function renderSettings() {
    const order = [1, 2, 3, 4, 5, 6, 0];
    $('week').innerHTML = order.map(d => {
      const w = settings.weekly[d];
      return `<div class="wk ${w.open ? '' : 'off'}" data-day="${d}">
        <b>${DAYS[d]}</b>
        <label class="switch"><input type="checkbox" data-open ${w.open ? 'checked' : ''} aria-label="Open on ${DAYS[d]}"> ${w.open ? 'Open' : 'Closed'}</label>
        <div class="times-in"><input type="time" data-start value="${w.start}" step="900" aria-label="${DAYS[d]} start"> to <input type="time" data-end value="${w.end}" step="900" aria-label="${DAYS[d]} end"></div>
      </div>`;
    }).join('');
    $('slotMinutes').value = settings.slotMinutes;
    $('perSlot').value = settings.perSlot;
    $('daysAhead').value = settings.daysAhead;
    $('minNoticeHours').value = settings.minNoticeHours;
    renderBlocked();
  }

  function renderBlocked() {
    $('blocked').innerHTML = settings.blocked.length
      ? settings.blocked.map(d => `<li>${longDate(d)} <button type="button" data-unblock="${d}" aria-label="Remove ${longDate(d)}">&times;</button></li>`).join('')
      : '<li class="none">No days off added.</li>';
  }

  $('week').addEventListener('change', e => {
    const row = e.target.closest('.wk');
    if (e.target.matches('[data-open]')) {
      row.classList.toggle('off', !e.target.checked);
      e.target.parentElement.lastChild.textContent = e.target.checked ? ' Open' : ' Closed';
    }
  });
  $('addBlock').addEventListener('click', () => {
    const d = $('blockDate').value;
    if (!d) return;
    settings.blocked = [...new Set([...settings.blocked, d])].sort();
    $('blockDate').value = '';
    renderBlocked();
  });
  $('blocked').addEventListener('click', e => {
    const b = e.target.closest('[data-unblock]');
    if (!b) return;
    settings.blocked = settings.blocked.filter(x => x !== b.dataset.unblock);
    renderBlocked();
  });

  $('hoursForm').addEventListener('submit', async e => {
    e.preventDefault();
    const weekly = {};
    document.querySelectorAll('.wk').forEach(r => {
      weekly[r.dataset.day] = { open: r.querySelector('[data-open]').checked, start: r.querySelector('[data-start]').value, end: r.querySelector('[data-end]').value };
    });
    const body = { weekly, slotMinutes: +$('slotMinutes').value, perSlot: +$('perSlot').value, daysAhead: +$('daysAhead').value, minNoticeHours: +$('minNoticeHours').value, blocked: settings.blocked };
    const { status, data } = await api('settings', { method: 'PUT', body: JSON.stringify(body) }).catch(() => ({}));
    if (status === 200) { settings = data.settings; renderSettings(); $('hoursMsg').textContent = ''; toast('Availability saved'); }
    else $('hoursMsg').textContent = (data?.errors || ['Could not save. Check the hours and try again.']).join(' ');
  });

  // ---------------------------------------------------------------- start
  fetch('/api/admin/session', { credentials: 'same-origin' }).then(r => (r.ok ? showDash() : showLogin())).catch(showLogin);
})();
