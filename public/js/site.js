// Page behaviour: open/closed status, today's hours, header, menu highlight, services photo, reveals.
(() => {
  const HOURS = { 0: [8, 18], 1: [9, 21], 2: [9, 21], 3: [9, 21], 4: [9, 21], 5: [9, 21], 6: [8, 18] };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Clinic time (Toronto), whatever the visitor's own time zone.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const hour = Number(parts.hour) + Number(parts.minute) / 60;
  const fmt = h => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  if (day >= 0) {
    const [open, close] = HOURS[day];
    const status = document.getElementById('status');
    const isOpen = hour >= open && hour < close;
    status.classList.toggle('closed', !isOpen);
    status.querySelector('span').textContent = isOpen ? `Open now · until ${fmt(close)}`
      : hour < open ? `Opens today at ${fmt(open)}` : `Closed now · opens tomorrow at ${fmt(HOURS[(day + 1) % 7][0])}`;
    document.querySelectorAll('#hours [data-days]').forEach(r => r.classList.toggle('today', r.dataset.days.split(',').map(Number).includes(day)));
  }

  // Header border once scrolled, and the menu link for the section in view.
  const header = document.getElementById('header');
  const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const links = [...document.querySelectorAll('nav.main a')];
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.hash === '#' + e.target.id));
    }), { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(a => { const s = document.querySelector(a.hash); if (s) spy.observe(s); });
  }

  // Services: the photo follows the row you hover or focus (desktop).
  const photo = document.getElementById('svcPhoto');
  if (photo) {
    const [a, b] = photo.querySelectorAll('img');
    const cap = photo.querySelector('figcaption');
    let front = a;
    const show = row => {
      document.querySelectorAll('.svc').forEach(r => r.classList.toggle('on', r === row));
      cap.textContent = row.dataset.cap;
      if (front.getAttribute('src') === row.dataset.img) return;
      const back = front === a ? b : a;
      back.src = row.dataset.img;
      back.classList.add('on');
      front.classList.remove('on');
      front = back;
    };
    document.querySelectorAll('.svc').forEach(row => {
      row.addEventListener('mouseenter', () => show(row));
      row.addEventListener('focusin', () => show(row));
    });
  }

  // Fade sections in as they scroll into view.
  const items = document.querySelectorAll('.reveal');
  if (!reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    items.forEach(el => io.observe(el));
  } else items.forEach(el => el.classList.add('in'));
})();
