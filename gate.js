/* Shared @rebuilt.com email gate + page-view logger.
   Usage: <script src="gate.js" defer></script> in <head>.
   Pages that need to wait can: await window.RebuiltGate.ready
   Pages can override the page label by setting window.REBUILT_GATE_PAGE before this script loads. */
(function () {
  'use strict';

  const STORAGE_KEY = 'rebuilt_email';
  const DOMAIN      = '@rebuilt.com';
  // Single audit endpoint. Apps Script handles ?action=log_view.
  const LOG_URL = 'https://script.google.com/macros/s/AKfycbwXVXMT8n3pYitrU7e2OZ3JLkey-PXXPRfDKeh2sa1DGUc51r39CytWiZkMWPMWUTc3dw/exec';

  const PAGE = (typeof window.REBUILT_GATE_PAGE === 'string' && window.REBUILT_GATE_PAGE) ||
               (location.pathname.split('/').pop() || 'index').replace(/\.html?$/i, '') ||
               'index';

  // Per-page allowlists. Pages not listed here are open to any @rebuilt.com address.
  // Note: client-side enforcement only — for hard restrictions, gate the data source too.
  const RESTRICTED_USERS = [
    'mike.spalding@rebuilt.com',
    'al@rebuilt.com',
    'scott@rebuilt.com',
    'brandon@rebuilt.com',
    'patrick.solomon@rebuilt.com',
    'melanie.blaszczak@rebuilt.com',
    'aj@rebuilt.com',
    'rob.gorski@rebuilt.com',
  ];
  const OWNER_ONLY = ['mike.spalding@rebuilt.com'];
  const RESTRICTIONS = {
    newhire_dashboard:       RESTRICTED_USERS,
    list_depletion_analyzer: OWNER_ONLY,
    'c2c-forecast':          OWNER_ONLY,
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = e => EMAIL_RE.test(e) && e.endsWith(DOMAIN);
  const isAllowedFor = (page, email) => {
    const list = RESTRICTIONS[page];
    return !list || list.indexOf(email) !== -1;
  };

  function logView(email) {
    try {
      const params = new URLSearchParams({
        action: 'log_view',
        email:  email,
        page:   PAGE,
        ua:     (navigator.userAgent || '').slice(0, 300),
        ref:    (document.referrer || '').slice(0, 300),
      });
      fetch(LOG_URL + '?' + params.toString(), { method: 'GET', cache: 'no-store' })
        .catch(err => console.warn('[RebuiltGate] view-log failed:', err));
    } catch (e) {
      console.warn('[RebuiltGate] view-log threw:', e);
    }
  }

  const CSS = `
.rg-backdrop{position:fixed;inset:0;background:rgba(15,25,32,0.85);z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px);font-family:'DM Sans',system-ui,-apple-system,sans-serif;}
.rg-card{background:#fff;border-radius:12px;max-width:440px;width:100%;padding:32px 34px;box-shadow:0 20px 60px rgba(0,0,0,0.35);color:#1f3540;}
.rg-title{font-size:18px;font-weight:700;margin-bottom:6px;letter-spacing:-0.3px;}
.rg-sub{font-size:13px;color:#7a8a94;line-height:1.5;margin-bottom:20px;}
.rg-label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7a8a94;margin-bottom:6px;}
.rg-input{width:100%;border:1px solid #e3dfd9;border-radius:6px;padding:10px 12px;font-family:inherit;font-size:14px;color:#1f3540;outline:none;transition:border-color .15s;box-sizing:border-box;}
.rg-input:focus{border-color:#21a9e1;}
.rg-err{display:none;font-size:12px;color:#e05252;margin-top:8px;}
.rg-btn{width:100%;margin-top:16px;padding:11px;background:#21a9e1;color:#fff;border:none;border-radius:6px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:background .15s;}
.rg-btn:hover{background:#35baf0;}
.rg-note{font-size:11px;color:#b0b8c1;margin-top:14px;text-align:center;line-height:1.5;}
.rg-deny .rg-card{max-width:460px;text-align:center;}
.rg-deny .rg-title{font-size:20px;margin-bottom:10px;}
.rg-deny .rg-sub{margin-bottom:18px;}
.rg-who{font-size:12px;color:#1f3540;background:#f5f3ef;border-radius:6px;padding:8px 10px;margin-bottom:14px;word-break:break-all;}
.rg-actions{display:flex;gap:8px;}
.rg-btn-secondary{flex:1;margin-top:0;background:#fff;color:#1f3540;border:1px solid #e3dfd9;}
.rg-btn-secondary:hover{background:#f5f3ef;}
.rg-btn-primary{flex:1;margin-top:0;}
`;

  function injectCss() {
    if (document.getElementById('rg-css')) return;
    const style = document.createElement('style');
    style.id = 'rg-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function showModal() {
    return new Promise(resolve => {
      injectCss();
      const wrap = document.createElement('div');
      wrap.className = 'rg-backdrop';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.innerHTML =
        '<div class="rg-card">' +
          '<div class="rg-title">Rebuilt Dashboards</div>' +
          '<div class="rg-sub">Please enter your Rebuilt email address to access this dashboard.</div>' +
          '<label class="rg-label" for="rg-input">Email</label>' +
          '<input class="rg-input" id="rg-input" type="email" autocomplete="email" placeholder="you@rebuilt.com" />' +
          '<div class="rg-err" id="rg-err"></div>' +
          '<button class="rg-btn" id="rg-btn" type="button">Continue</button>' +
          '<div class="rg-note">Restricted to <strong>@rebuilt.com</strong> accounts &middot; Access is logged for audit purposes.</div>' +
        '</div>';
      document.body.appendChild(wrap);

      const input = wrap.querySelector('#rg-input');
      const btn   = wrap.querySelector('#rg-btn');
      const err   = wrap.querySelector('#rg-err');
      setTimeout(() => input.focus(), 30);

      const submit = () => {
        const val = (input.value || '').toLowerCase().trim();
        if (!EMAIL_RE.test(val)) {
          err.textContent = 'Please enter a valid email address.';
          err.style.display = 'block';
          return;
        }
        if (!val.endsWith(DOMAIN)) {
          err.textContent = 'Access is restricted to ' + DOMAIN + ' email addresses.';
          err.style.display = 'block';
          return;
        }
        err.style.display = 'none';
        localStorage.setItem(STORAGE_KEY, val);
        wrap.remove();
        resolve(val);
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    });
  }

  function showDenied(email) {
    injectCss();
    const wrap = document.createElement('div');
    wrap.className = 'rg-backdrop rg-deny';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML =
      '<div class="rg-card">' +
        '<div class="rg-title">Access restricted</div>' +
        '<div class="rg-sub">This dashboard is limited to a specific group. If you need access, contact Mike Spalding.</div>' +
        '<div class="rg-who">Signed in as <strong>' + email.replace(/[<>&"]/g, '') + '</strong></div>' +
        '<div class="rg-actions">' +
          '<button class="rg-btn rg-btn-secondary" id="rg-home" type="button">Back to dashboards</button>' +
          '<button class="rg-btn rg-btn-primary" id="rg-switch" type="button">Switch account</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelector('#rg-home').addEventListener('click', () => { location.href = 'index.html'; });
    wrap.querySelector('#rg-switch').addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
  }

  function whenBodyReady() {
    if (document.body) return Promise.resolve();
    return new Promise(r => document.addEventListener('DOMContentLoaded', () => r(), { once: true }));
  }

  const ready = (async () => {
    const stored = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase().trim();
    let email = isValid(stored) ? stored : null;
    if (!email) {
      await whenBodyReady();
      email = await showModal();
    }
    logView(email);
    if (!isAllowedFor(PAGE, email)) {
      await whenBodyReady();
      showDenied(email);
      // Hang the promise so callers awaiting RebuiltGate.ready never proceed to render data.
      await new Promise(() => {});
    }
    return email;
  })();

  window.RebuiltGate = {
    ready,
    page: PAGE,
    getEmail: () => {
      const e = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase().trim();
      return isValid(e) ? e : null;
    },
    isAllowedFor: isAllowedFor,
    restrictions: RESTRICTIONS,
    signOut: () => { localStorage.removeItem(STORAGE_KEY); location.reload(); },
  };
})();
