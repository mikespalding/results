// ============================================================
// ACQ NEW HIRE DASHBOARD PROXY — Google Apps Script Web App
// ============================================================
// Deploy as Web App (Execute as: Me, Access: Anyone) and paste
// the resulting /exec URL into PROXY_URL inside
// acq_newhire_dashboard.html.
//
// Caching strategy (added to avoid Metabase bandwidth quota):
//   1. CacheService — short-lived (CACHE_TTL_SEC) per-feed cache.
//      Every page load now hits Metabase at most once per feed
//      per TTL window across ALL viewers.
//   2. PropertiesService — durable last-known-good snapshot per
//      feed. Used as a stale fallback when Metabase returns an
//      error (e.g. "Bandwidth quota exceeded") or non-200.
//
// To force a refresh, append &nocache=1 to the request, or run
// primeCache() from the Apps Script editor.

const FEEDS = {
  // ── ROSTER ──
  roster:                 'https://rebuilt.metabaseapp.com/public/question/b7bcb242-37bb-40dd-abbd-09257c2415c0.csv',

  // ── EFFORT ──
  rts_time:               'https://rebuilt.metabaseapp.com/public/question/6e8f2d07-b284-4f4f-858f-590448e1ad7c.csv',

  // ── OUTCOME ──
  contracts:              'https://rebuilt.metabaseapp.com/public/question/f91e5849-e29b-40ed-ae72-c7401c92008d.csv',
  contracts_to_mktg:      'https://rebuilt.metabaseapp.com/public/question/4af46d6f-a077-4378-95f3-f28021dd8491.csv',
  assignments_and_fees:   'https://rebuilt.metabaseapp.com/public/question/2a68613c-af4a-44f3-a879-d64e542462f8.csv',
  pos_spread_deals:       'https://rebuilt.metabaseapp.com/public/question/caf2e083-3711-471c-90b3-7438b0d17e68.csv',

  // ── QUALITY ──
  prospect_creation_rate: 'https://rebuilt.metabaseapp.com/public/question/3a722788-60fe-4e13-aa5c-82637b6135d1.csv',
};

// ── ACCESS LOGGING ── (shared with pacesetter)
const LOG_SHEET_URL  = 'https://docs.google.com/spreadsheets/d/17UcBetUqnGFzyC9vodsvf-HIJpfQAOZpYVXulTyifvI/edit?usp=sharing';
const LOG_TAB_NAME   = 'views';
const ALLOWED_DOMAIN = '@rebuilt.com';

// ── CACHING ──
const CACHE_TTL_SEC = 6 * 60 * 60;      // 6h — CacheService max
const CACHE_CHUNK   = 95 * 1024;        // <100KB per cache key
const PROP_CHUNK    = 450 * 1024;       // <500KB per property value

// ============================================================
function doGet(e) {
  const action = (e.parameter.action || '').trim();
  if (action === 'log_view') return logView(e);

  const feed = (e.parameter.feed || '').trim();
  if (!feed) return jsonResponse({ feeds: Object.keys(FEEDS) });
  if (!FEEDS[feed]) return jsonResponse({ error: 'Unknown feed: ' + feed });

  const noCache = e.parameter.nocache === '1';
  const csv = getFeedCsv(feed, noCache);
  if (csv && csv.text) {
    return ContentService
      .createTextOutput(csv.text)
      .setMimeType(ContentService.MimeType.TEXT);
  }
  return jsonResponse({ error: csv && csv.error ? csv.error : 'Unknown error' });
}

// Returns { text, source } on success, { error } on failure.
// source is 'cache' | 'live' | 'stale'.
function getFeedCsv(feed, noCache) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'feed:' + feed;

  if (!noCache) {
    const hit = readChunked(cache, cacheKey);
    if (hit) return { text: hit, source: 'cache' };
  }

  // Use a lock so a stampede of viewers doesn't all hit Metabase.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (_) { /* proceed without lock */ }

  // Re-check cache after acquiring the lock — a sibling request
  // may have populated it while we were waiting.
  if (!noCache) {
    const hit2 = readChunked(cache, cacheKey);
    if (hit2) { try { lock.releaseLock(); } catch (_) {} return { text: hit2, source: 'cache' }; }
  }

  let live = null;
  let liveErr = null;
  try {
    const response = UrlFetchApp.fetch(FEEDS[feed], { muteHttpExceptions: true });
    const code = response.getResponseCode();
    const body = response.getContentText();
    if (code === 200 && !looksLikeUpstreamError(body)) {
      live = body;
    } else {
      liveErr = code === 200
        ? 'Metabase error body: ' + body.slice(0, 300)
        : 'Metabase returned HTTP ' + code;
    }
  } catch (err) {
    liveErr = err.toString();
  }

  if (live) {
    writeChunked(cache, cacheKey, live, CACHE_TTL_SEC, CACHE_CHUNK);
    writeStale(feed, live);
    try { lock.releaseLock(); } catch (_) {}
    return { text: live, source: 'live' };
  }

  // Live fetch failed — fall back to last-known-good snapshot.
  const stale = readStale(feed);
  try { lock.releaseLock(); } catch (_) {}
  if (stale) return { text: stale, source: 'stale' };
  return { error: liveErr || 'fetch failed' };
}

// Metabase public CSV endpoints sometimes return a JSON error body
// with a 200 status (e.g. bandwidth quota exceeded). Detect that.
function looksLikeUpstreamError(body) {
  if (!body) return true;
  const head = body.slice(0, 200).trim();
  if (head.startsWith('{') && head.indexOf('"error"') !== -1) return true;
  return false;
}

// ── chunked CacheService read/write (handles >100KB CSVs) ──
function writeChunked(cache, key, text, ttl, chunkSize) {
  const total = Math.ceil(text.length / chunkSize) || 1;
  const map = { __n: String(total) };
  for (let i = 0; i < total; i++) {
    map[key + ':' + i] = text.slice(i * chunkSize, (i + 1) * chunkSize);
  }
  map[key + ':meta'] = JSON.stringify({ n: total, len: text.length });
  cache.putAll(map, ttl);
}
function readChunked(cache, key) {
  const meta = cache.get(key + ':meta');
  if (!meta) return null;
  let n;
  try { n = JSON.parse(meta).n; } catch (_) { return null; }
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const parts = cache.getAll(keys);
  let out = '';
  for (let i = 0; i < n; i++) {
    const p = parts[key + ':' + i];
    if (p == null) return null;  // partial eviction — treat as miss
    out += p;
  }
  return out;
}

// ── chunked PropertiesService stale snapshot ──
function writeStale(feed, text) {
  try {
    const props = PropertiesService.getScriptProperties();
    const total = Math.ceil(text.length / PROP_CHUNK) || 1;
    const map = {};
    map['stale:' + feed + ':n'] = String(total);
    map['stale:' + feed + ':at'] = String(Date.now());
    for (let i = 0; i < total; i++) {
      map['stale:' + feed + ':' + i] = text.slice(i * PROP_CHUNK, (i + 1) * PROP_CHUNK);
    }
    props.setProperties(map, false);
  } catch (err) {
    // PropertiesService has size limits; if writing fails, log and move on.
    console.warn('writeStale failed for ' + feed + ': ' + err);
  }
}
function readStale(feed) {
  try {
    const props = PropertiesService.getScriptProperties();
    const n = parseInt(props.getProperty('stale:' + feed + ':n') || '0', 10);
    if (!n) return null;
    let out = '';
    for (let i = 0; i < n; i++) {
      const p = props.getProperty('stale:' + feed + ':' + i);
      if (p == null) return null;
      out += p;
    }
    return out;
  } catch (_) {
    return null;
  }
}

// Run manually from the editor to warm the cache + stale snapshot
// for every feed. Useful after the bandwidth quota resets.
function primeCache() {
  Object.keys(FEEDS).forEach(function (feed) {
    const r = getFeedCsv(feed, true);
    console.log(feed + ': ' + (r.text ? r.text.length + ' bytes (' + r.source + ')' : 'ERR ' + r.error));
  });
}

function logView(e) {
  try {
    const email = (e.parameter.email || '').toLowerCase().trim();
    const page  = (e.parameter.page  || '').trim().slice(0, 50);
    const ua    = (e.parameter.ua    || '').slice(0, 500);
    const ref   = (e.parameter.ref   || '').slice(0, 500);

    if (!email || !email.endsWith(ALLOWED_DOMAIN)) {
      return jsonResponse({ ok: false, error: 'invalid email' });
    }

    const ss    = SpreadsheetApp.openByUrl(LOG_SHEET_URL);
    const sheet = ss.getSheetByName(LOG_TAB_NAME) || ss.getSheets()[0];
    sheet.appendRow([new Date(), email, page, ua, ref]);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
