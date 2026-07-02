/* ============================================================
   BioVirtua app.js: cart, drawer, checkout, forms, chrome, reveals.
   Vanilla JS, no framework. Persists cart in localStorage.
   ============================================================ */
(function () {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MOBILE = window.matchMedia('(max-width: 860px)').matches;
  const money = (n) => '$' + Number(n).toFixed(0);

  /* ---------- product catalog (mirror of content.mjs, for cart math) ---------- */
  const CATALOG = {
    'meridian': { name: 'BioVirtua Meridian', price: 599, finish: true, type: 'device' },
    'wall-mount': { name: 'BioVirtua Meridian Wall Mount', price: 69, finish: false, type: 'accessory' },
    'field-case': { name: 'BioVirtua Field Case', price: 59, finish: false, type: 'accessory' },
    'home-studio-bundle': { name: 'Meridian Home Studio Bundle', price: 649, finish: true, type: 'bundle' },
    'pro-traveler-bundle': { name: 'Meridian Pro Traveler Bundle', price: 639, finish: true, type: 'bundle' },
    'coaching-library': { name: 'BioVirtua Coaching Library', price: 8, finish: false, type: 'subscription', unit: '/mo' }
  };

  /* ---------- cart state ---------- */
  const KEY = 'biovirtua_cart_v1';
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(cart)) cart = []; } catch (e) { cart = []; }

  function saveCart() { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) {} }
  function cartCount() { return cart.reduce((s, i) => s + i.qty, 0); }
  function cartSubtotal() { return cart.reduce((s, i) => s + i.price * i.qty, 0); }

  function lineKey(id, finish) { return id + '::' + (finish || '-'); }

  function addToCart(id, finish, qty) {
    const p = CATALOG[id];
    if (!p) return;
    qty = qty || 1;
    const fin = p.finish ? (finish || 'Graphite') : null;
    const k = lineKey(id, fin);
    const existing = cart.find((i) => lineKey(i.id, i.finish) === k);
    if (existing) existing.qty += qty;
    else cart.push({ id: id, name: p.name, price: p.price, finish: fin, qty: qty, unit: p.unit || '', type: p.type });
    saveCart();
    renderCart();
    pulseCount();
  }
  function setQty(k, delta) {
    const line = cart.find((i) => lineKey(i.id, i.finish) === k);
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) cart = cart.filter((i) => lineKey(i.id, i.finish) !== k);
    saveCart(); renderCart();
  }
  function removeLine(k) { cart = cart.filter((i) => lineKey(i.id, i.finish) !== k); saveCart(); renderCart(); }

  /* ---------- header count ---------- */
  function pulseCount() {
    document.querySelectorAll('.cart-count').forEach((el) => {
      el.classList.remove('pulse');
      void el.offsetWidth;
      el.classList.add('pulse');
    });
  }
  function updateCountBadges() {
    const c = cartCount();
    document.querySelectorAll('.cart-count').forEach((el) => {
      el.textContent = c;
      el.hidden = c === 0;
    });
  }

  /* ---------- cart drawer ---------- */
  const scrim = document.querySelector('.drawer-scrim');
  const drawer = document.querySelector('.cart-drawer');
  function openDrawer() {
    if (!drawer) return;
    scrim.classList.add('open'); drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('lenis-stopped');
    if (window.__lenis) window.__lenis.stop();
    const close = drawer.querySelector('.cart-close');
    if (close) close.focus();
  }
  function closeDrawer() {
    if (!drawer) return;
    scrim.classList.remove('open'); drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('lenis-stopped');
    if (window.__lenis) window.__lenis.start();
  }
  window.__openCart = openDrawer;

  function miniThumb(item) {
    const bone = item.finish === 'Bone' ? ' bone' : '';
    return '<span class="thumb' + bone + '"><span class="mini-slab"></span><span class="mini-led"></span></span>';
  }

  function renderCart() {
    updateCountBadges();
    const itemsEl = drawer ? drawer.querySelector('.cart-items') : null;
    const footEl = drawer ? drawer.querySelector('.cart-foot') : null;
    if (itemsEl) {
      if (cart.length === 0) {
        itemsEl.innerHTML = '<div class="cart-empty"><span class="mono">Your cart is empty</span><p>Add the Meridian to begin.</p><a class="btn btn-sm" href="/shop/"><span class="lbl">Shop the system</span></a></div>';
        if (footEl) footEl.style.display = 'none';
      } else {
        itemsEl.innerHTML = cart.map((item) => {
          const k = lineKey(item.id, item.finish);
          const fin = item.finish ? '<div class="cl-finish">Finish: ' + item.finish + '</div>' : '';
          const unit = item.unit ? '<span style="font-size:0.7em;color:var(--muted)">' + item.unit + '</span>' : '';
          return '<div class="cart-line" data-k="' + k + '">' +
            miniThumb(item) +
            '<div><div class="cl-name">' + item.name + '</div>' + fin +
            '<div class="qty"><button data-act="dec" aria-label="Decrease quantity">&minus;</button><span class="q-val">' + item.qty + '</span><button data-act="inc" aria-label="Increase quantity">+</button></div>' +
            '<button class="cl-remove" data-act="rm">Remove</button></div>' +
            '<div class="cl-price">' + money(item.price * item.qty) + unit + '</div>' +
            '</div>';
        }).join('');
        if (footEl) footEl.style.display = 'block';
        const stv = drawer.querySelector('.st-val');
        if (stv) stv.textContent = money(cartSubtotal());
      }
    }
    // update any on-page summaries (checkout)
    if (window.__renderCheckoutSummary) window.__renderCheckoutSummary();
  }

  if (drawer) {
    drawer.querySelector('.cart-items').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const line = btn.closest('.cart-line');
      const k = line.getAttribute('data-k');
      const act = btn.getAttribute('data-act');
      if (act === 'inc') setQty(k, 1);
      else if (act === 'dec') setQty(k, -1);
      else if (act === 'rm') removeLine(k);
    });
    const closeBtn = drawer.querySelector('.cart-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  }
  if (scrim) scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  // header cart buttons open drawer
  document.querySelectorAll('[data-open-cart]').forEach((b) => b.addEventListener('click', openDrawer));

  /* ---------- add-to-cart buttons (delegated) ---------- */
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    e.preventDefault();
    const id = btn.getAttribute('data-add');
    // finish: from button, else from a nearby active chip, else Graphite
    let finish = btn.getAttribute('data-finish') || null;
    if (!finish && CATALOG[id] && CATALOG[id].finish) {
      const scope = btn.closest('[data-finish-scope]') || document;
      const active = scope.querySelector('.chip.active[data-finish], .chip[aria-pressed="true"][data-finish]');
      finish = active ? active.getAttribute('data-finish') : 'Graphite';
    }
    addToCart(id, finish, 1);
    // morph feedback
    const original = btn.getAttribute('data-label') || btn.querySelector('.lbl') && btn.querySelector('.lbl').textContent || btn.textContent;
    const lbl = btn.querySelector('.lbl');
    const setTxt = (t) => { if (lbl) lbl.textContent = t; else btn.textContent = t; };
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', original.trim());
    btn.classList.add('added');
    setTxt('Added ✓');
    btn.setAttribute('aria-live', 'polite');
    clearTimeout(btn.__t);
    btn.__t = setTimeout(function () {
      btn.classList.remove('added');
      setTxt(btn.getAttribute('data-label'));
    }, 1500);
    const openAfter = btn.getAttribute('data-open') !== 'false';
    if (openAfter) setTimeout(openDrawer, 260);
  });

  /* ---------- finish chips (product cards + pdp + home dock) ---------- */
  document.querySelectorAll('[data-finish-scope]').forEach((scope) => {
    const chips = scope.querySelectorAll('.chip[data-finish]');
    chips.forEach((chip) => {
      chip.addEventListener('click', function () {
        chips.forEach((c) => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
        chip.classList.add('active'); chip.setAttribute('aria-pressed', 'true');
        const f = chip.getAttribute('data-finish');
        // notify 3D scene in this scope
        const evt = new CustomEvent('bv:finish', { detail: { finish: f }, bubbles: true });
        scope.dispatchEvent(evt);
        // update add button's finish + any price ref
        const addBtn = scope.querySelector('[data-add]');
        if (addBtn) addBtn.setAttribute('data-finish', f);
      });
    });
  });

  /* ---------- SMS opt-in form ---------- */
  function wireSms(form) {
    const phone = form.querySelector('[name="sms_phone"]');
    const c1 = form.querySelector('[name="sms_agree_terms"]');
    const c2 = form.querySelector('[name="sms_agree_marketing"]');
    const msg = form.querySelector('.form-msg');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const digits = (phone.value || '').replace(/\D/g, '');
      msg.className = 'form-msg';
      msg.textContent = '';
      if (digits.length < 10) { msg.classList.add('error'); msg.textContent = 'Enter a valid phone number.'; phone.focus(); return; }
      if (!c1.checked || !c2.checked) { msg.classList.add('error'); msg.textContent = 'Please agree to both to continue.'; return; }
      const wrap = form.parentElement;
      const done = document.createElement('div');
      done.className = 'sms-success';
      done.textContent = "You're on the list. Watch for a confirmation text.";
      form.replaceWith(done);
    });
  }
  document.querySelectorAll('form[data-sms]').forEach(wireSms);

  /* ---------- generic contact form ---------- */
  const contactForm = document.querySelector('form[data-contact]');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      let ok = true;
      const fields = contactForm.querySelectorAll('[data-required]');
      fields.forEach((f) => {
        const val = (f.value || '').trim();
        const isEmail = f.type === 'email';
        const bad = !val || (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val));
        f.closest('.field').classList.toggle('invalid', bad);
        if (bad) ok = false;
      });
      const msg = contactForm.querySelector('.form-msg');
      if (!ok) { msg.className = 'form-msg error'; msg.textContent = 'Please complete the required fields with a valid email.'; return; }
      const wrap = contactForm.parentElement;
      const done = document.createElement('div');
      done.className = 'sms-success';
      done.textContent = 'Thanks. Your message is on its way, and we will get back to you soon.';
      contactForm.replaceWith(done);
    });
    contactForm.querySelectorAll('[data-required]').forEach((f) => {
      f.addEventListener('input', () => f.closest('.field').classList.remove('invalid'));
    });
  }

  /* ---------- header scroll shrink ---------- */
  const header = document.querySelector('.site-header');
  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 24);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- mobile menu ---------- */
  const menuToggle = document.querySelector('.menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      const open = document.body.classList.toggle('menu-open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.querySelectorAll('.nav-links .nav-link').forEach((l) => l.addEventListener('click', () => {
      document.body.classList.remove('menu-open');
      menuToggle.setAttribute('aria-expanded', 'false');
    }));
  }

  /* ---------- init cart on load ---------- */
  renderCart();

  /* ============================================================
     Lenis + GSAP + reveals: lazy after first paint, never blocks.
     ============================================================ */
  function initMotion() {
    // Lenis smooth scroll (UMD global may be window.Lenis or window.Lenis.default)
    try {
      const LenisCtor = window.Lenis && (typeof window.Lenis === 'function' ? window.Lenis : window.Lenis.default);
      if (!REDUCED && typeof LenisCtor === 'function') {
        const lenis = new LenisCtor({ duration: 1.05, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
        window.__lenis = lenis;
        if (window.gsap && window.ScrollTrigger) {
          // drive Lenis from the GSAP ticker so ScrollTrigger + Lenis stay in sync (single loop)
          lenis.on('scroll', window.ScrollTrigger.update);
          window.gsap.ticker.add((t) => { lenis.raf(t * 1000); });
          window.gsap.ticker.lagSmoothing(0);
        } else {
          // no gsap: drive Lenis with its own rAF loop
          const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
          requestAnimationFrame(raf);
        }
      }
    } catch (e) { /* smooth scroll optional */ }

    // GSAP ScrollTrigger reveals
    try {
      if (window.gsap && window.ScrollTrigger) {
        window.gsap.registerPlugin(window.ScrollTrigger);
      }
    } catch (e) {}

    setupReveals();
    setupTextHover();
    setupCountUps();
    setupScanRail();
    setupStickyBuy();
    setupHeroHeadline();
  }

  /* ---------- section reveals (distinct choreographies via data-reveal type) ---------- */
  function setupReveals() {
    const items = Array.from(document.querySelectorAll('[data-reveal]'));
    if (REDUCED || !window.gsap) {
      items.forEach((el) => el.classList.add('revealed'));
      return;
    }
    const gsap = window.gsap;
    items.forEach((el) => {
      const type = el.getAttribute('data-reveal') || 'rise';
      const delay = parseFloat(el.getAttribute('data-reveal-delay') || '0');
      let fromVars = { opacity: 0 };
      let toExtra = {};
      if (type === 'rise') fromVars.y = 40;
      else if (type === 'fade') fromVars.y = 0;
      else if (type === 'left') fromVars.x = -50;
      else if (type === 'right') fromVars.x = 50;
      else if (type === 'scale') { fromVars.scale = 0.9; fromVars.transformOrigin = 'center'; }
      else if (type === 'clip') { fromVars.clipPath = 'inset(0 0 100% 0)'; fromVars.y = 20; toExtra.clipPath = 'inset(0 0 0% 0)'; }
      else if (type === 'blur') { fromVars.filter = 'blur(12px)'; fromVars.y = 20; toExtra.filter = 'blur(0px)'; }
      else if (type === 'rotate') { fromVars.rotationX = 40; fromVars.transformPerspective = 800; fromVars.transformOrigin = 'top'; }
      else fromVars.y = 40;

      const stagger = el.getAttribute('data-stagger');
      if (stagger) {
        const kids = el.children;
        gsap.set(kids, fromVars);
        window.ScrollTrigger.create({
          trigger: el, start: 'top 82%', once: true,
          onEnter: () => {
            el.classList.add('revealed');
            gsap.to(kids, Object.assign({ opacity: 1, x: 0, y: 0, scale: 1, rotationX: 0, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out', stagger: 0.09, delay: delay }, toExtra));
          }
        });
      } else {
        gsap.set(el, fromVars);
        window.ScrollTrigger.create({
          trigger: el, start: 'top 85%', once: true,
          onEnter: () => {
            el.classList.add('revealed');
            gsap.to(el, Object.assign({ opacity: 1, x: 0, y: 0, scale: 1, rotationX: 0, filter: 'blur(0px)', duration: 0.75, ease: 'expo.out', delay: delay }, toExtra));
          }
        });
      }
    });
  }

  /* ---------- count ups ---------- */
  function setupCountUps() {
    const els = document.querySelectorAll('[data-countup]');
    els.forEach((el) => {
      const target = el.getAttribute('data-countup');
      const isNum = /^\d+$/.test(target);
      if (REDUCED || !window.gsap || !isNum) { el.textContent = target; return; }
      const end = parseInt(target, 10);
      const obj = { v: 0 };
      el.textContent = '0';
      window.ScrollTrigger.create({
        trigger: el, start: 'top 88%', once: true,
        onEnter: () => {
          window.gsap.to(obj, { v: end, duration: 1.4, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(obj.v); } });
        }
      });
    });
  }

  /* ---------- scan-rail progress ---------- */
  function setupScanRail() {
    const rail = document.querySelector('.scan-rail');
    if (!rail) return;
    const fill = rail.querySelector('.fill');
    function upd() {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const p = h > 0 ? Math.min(1, window.scrollY / h) : 0;
      fill.style.height = (p * 100) + '%';
      rail.classList.toggle('show', window.scrollY > window.innerHeight * 0.5);
    }
    upd();
    window.addEventListener('scroll', upd, { passive: true });
  }

  /* ---------- sticky buy bar on PDP (mobile) ---------- */
  function setupStickyBuy() {
    const bar = document.querySelector('.sticky-buy');
    const anchor = document.querySelector('[data-buy-anchor]');
    if (!bar || !anchor) return;
    function upd() {
      const r = anchor.getBoundingClientRect();
      bar.classList.toggle('show', r.bottom < 0);
    }
    upd();
    window.addEventListener('scroll', upd, { passive: true });
  }

  /* ---------- hero headline word entrance ---------- */
  function setupHeroHeadline() {
    const h = document.querySelector('.hero-headline');
    if (!h || REDUCED || !window.gsap) return;
    const words = h.querySelectorAll('.word');
    if (!words.length) return;
    window.gsap.set(words, { y: '110%', opacity: 0 });
    window.gsap.to(words, { y: '0%', opacity: 1, duration: 1.0, ease: 'expo.out', stagger: 0.12, delay: 0.15 });
  }

  /* ---------- per-page unique text hover ---------- */
  function setupTextHover() {
    const mode = document.body.getAttribute('data-texthover');
    if (!mode || REDUCED) return;

    if (mode === 'scramble') {
      // decode/scramble settle for headings marked data-scramble
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#*';
      document.querySelectorAll('[data-scramble]').forEach((el) => {
        const original = el.textContent;
        let raf = null, frame = 0;
        function run() {
          frame = 0;
          const len = original.length;
          cancelAnimationFrame(raf);
          function step() {
            let out = '';
            for (let i = 0; i < len; i++) {
              if (original[i] === ' ') { out += ' '; continue; }
              if (i < frame / 2) out += original[i];
              else out += chars[Math.floor(Math.random() * chars.length)];
            }
            el.textContent = out;
            frame++;
            if (frame / 2 < len) raf = requestAnimationFrame(step);
            else el.textContent = original;
          }
          step();
        }
        el.addEventListener('mouseenter', run);
        el.addEventListener('focus', run);
      });
    }
    // 'spacing', 'weight', 'tilt', 'duotone' are handled purely in CSS per page via body[data-texthover]
  }

  /* ---------- kick off after first paint ---------- */
  let motionStarted = false;
  function startMotionOnce() { if (motionStarted) return; motionStarted = true; try { initMotion(); } catch (e) { revealAll(); } }
  function revealAll() { document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('revealed')); }
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => window.requestAnimationFrame(startMotionOnce), { timeout: 500 });
  } else {
    window.addEventListener('load', () => window.setTimeout(startMotionOnce, 60));
  }
  // failsafe: if motion never initialized (JS delayed/broken), force content visible so nothing stays hidden
  window.setTimeout(function () { if (!motionStarted) { startMotionOnce(); revealAll(); } }, 2600);

  // expose for scenes.js
  window.BV = { addToCart: addToCart, openCart: openDrawer, CATALOG: CATALOG, REDUCED: REDUCED, MOBILE: MOBILE, money: money };

})();
