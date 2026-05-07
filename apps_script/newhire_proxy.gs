// ============================================================
// ACQ NEW HIRE DASHBOARD PROXY — Google Apps Script Web App
// ============================================================
// Deploy as Web App (Execute as: Me, Access: Anyone) and paste
// the resulting /exec URL into PROXY_URL inside
// acq_newhire_dashboard.html.

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

  // ── CC DASHBOARD: WATERFALL ROOT CAUSE ──
  waterfall_events:       'https://rebuilt.metabaseapp.com/public/question/a26c897b-90ff-4524-8536-ac45e86e0628.csv',
};

// ── ACCESS LOGGING ── (shared with pacesetter)
const LOG_SHEET_URL  = 'https://docs.google.com/spreadsheets/d/17UcBetUqnGFzyC9vodsvf-HIJpfQAOZpYVXulTyifvI/edit?usp=sharing';
const LOG_TAB_NAME   = 'views';
const ALLOWED_DOMAIN = '@rebuilt.com';

// ============================================================
function doGet(e) {
  const action = (e.parameter.action || '').trim();
  if (action === 'log_view') return logView(e);

  const feed = (e.parameter.feed || '').trim();
  if (!feed) return jsonResponse({ feeds: Object.keys(FEEDS) });
  if (!FEEDS[feed]) return jsonResponse({ error: 'Unknown feed: ' + feed });

  try {
    const response = UrlFetchApp.fetch(FEEDS[feed], { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      return jsonResponse({ error: 'Metabase returned HTTP ' + response.getResponseCode() });
    }
    return ContentService
      .createTextOutput(response.getContentText())
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
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
