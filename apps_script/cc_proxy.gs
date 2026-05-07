// ============================================================
// Rebuilt Contact Center · Metabase CSV Proxy
// Deploy as Google Apps Script Web App:
//   - Execute as: Me
//   - Who has access: Anyone
// After deploying, copy the /exec URL into the dashboard HTML
// ============================================================
//
// No-arg request returns the main call-data CSV (back-compat).
// ?feed=<name> returns a named feed from FEEDS below.

const METABASE_CSV_URL = 'https://rebuilt.metabaseapp.com/public/question/8ffe27c1-0bcf-465e-a28f-2e500c571212.csv';

const FEEDS = {
  // Routing Fidelity — campaign × skill, last 1y of inbound human-answered calls
  routing_fidelity: 'https://rebuilt.metabaseapp.com/public/question/7b4b560d-6646-4c01-80bd-a9537f69f8ce.csv',

  // Waterfall Root Cause — one row per inbound call that did not land on its
  // primary skill, last 1y. Drives the Waterfall Root Cause tab.
  waterfall_events: 'https://rebuilt.metabaseapp.com/public/question/a26c897b-90ff-4524-8536-ac45e86e0628.csv',

  // Campaign Calls Hourly Detail — one row per (call_date, call_hour, campaign),
  // last 60 days. Drives the Campaign Calls Hourly Detail table on the Hourly
  // tab. SQL for the Metabase question lives in cc_dashboard.html (search for
  // "SQL · Campaign · Hourly Detail"). Paste the public CSV URL here after
  // publishing the question.
  campaign_hourly: '',
};

function doGet(e) {
  try {
    const feed = ((e && e.parameter && e.parameter.feed) || '').trim();
    const url  = feed ? FEEDS[feed] : METABASE_CSV_URL;

    if (!url) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Unknown or unconfigured feed: ' + feed, available: Object.keys(FEEDS) }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      muteHttpExceptions: true
    });

    return ContentService
      .createTextOutput(response.getContentText())
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
