# Rebuilt Training — Refactor Demo

This directory is a **proof-of-concept**: one knowledge check (`intro_to_rebuilt_knowledge_check.html`) rewritten to use shared CSS/JS instead of inlining ~750 lines of boilerplate per file.

## What changed

| | Before | After |
|---|---|---|
| HTML per quiz | 802 lines · 40 KB | **183 lines · 12 KB** |
| Total for 10 quizzes | ~8,000 lines · ~400 KB | **~1,830 lines · ~120 KB + 18 KB shared (cached)** |
| To fix a bug in the progress bar | Edit 10 files | **Edit 1 file** |
| To change pass threshold everywhere | Edit 10 files | **Edit 1 file** |
| To add a new knowledge check | Copy 800-line file, hunt-and-replace | **Copy an 80-line shell, fill in `QUIZ_CONFIG`** |

## How it works

```
rebuilt-training-demo/
├── intro_to_rebuilt_knowledge_check.html   ← per-quiz page (just config + content)
└── shared/
    ├── quiz.css       ← all styles, once
    ├── quiz.js        ← all quiz logic, once (reads window.QUIZ_CONFIG)
    ├── quiz-shell.html ← reference markup (not actually loaded, just docs)
    ├── logo.svg       ← extracted from inline base64
    └── favicon.svg
```

Each page defines only its per-quiz bits — module name, questions, material URL — in a `QUIZ_CONFIG` object. The shared `quiz.js` handles everything else (gate, progress bar, scoring, saving to Apps Script).

```html
<!-- What a per-page config looks like -->
<script>
window.QUIZ_CONFIG = {
  moduleId:      'kc_intro',
  moduleName:    'Introduction to Rebuilt',
  materialUrl:   'https://docs.google.com/...',
  scriptUrl:     'https://script.google.com/macros/s/.../exec',
  passThreshold: 0.70,
  resultCopy:    { pass: '...', fail: '...' },
  questions:     [ /* array of { text, options, correct, explanation } */ ]
};
</script>
<script src="shared/quiz.js"></script>
```

## Preview locally

```bash
cd rebuilt-training-demo
python3 -m http.server 8000
# open http://localhost:8000/intro_to_rebuilt_knowledge_check.html
```

## What this doesn't do (yet)

This demo only **reorganizes** the code — it doesn't fix the audit findings. Specifically:

1. **Quiz answers are still in the client.** `correct: 2` still ships in the HTML. Fix is a separate task: move scoring into the Google Apps Script.
2. **No auth on the submission endpoint.** Still the same open POST. Same separate task.
3. **Gate overlay in `index.html` is still cosmetic.** Not touched here.

Fixing those would be the next step after this refactor lands, because it's much easier to patch `quiz.js` once than 10 inlined copies.

## What would "apply to all 10" look like

Mechanical. For each of the other 9 knowledge-check files:
1. Pull out its `questions` array and config values.
2. Delete the inlined CSS/JS (identical across files).
3. Drop in the shared `<link>`/`<script>` tags + `QUIZ_CONFIG`.

That's it. The training modules (hubspot, five9, olt_*) and facilitator guides are a separate pattern — they'd get their own shared bundles (`module.css`/`module.js`, `guide.css`/`guide.js`), same idea.
