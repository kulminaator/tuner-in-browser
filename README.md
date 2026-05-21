# tuner-in-browser
Simple chromatic tuner for musical instruments. Based on just HTML and Javascript.

You can launch it straight off from github itself here: https://kulminaator.github.io/tuner-in-browser/

I will attempt to make it openable straight from github. The source is open so you can verify that nothing evil takes place here when microphone access is requested.

NB! don't forget to hit the start button in the tuner to make it active.

![App Screenshot](screenshots/first-screenshot.png)

## Running the Tests

Requires **Node.js**. There is no `package.json` — the project has zero dependencies.

Run all three suites:

```bash
node --input-type=module -e "import './tests/test-tuner.js'"
node --input-type=module -e "import './tests/test-audio-recognition.js'"
node --input-type=module -e "import './tests/test-bass-recognition.js'"
```

- **test-tuner.js** — Unit tests using synthetic sine-wave buffers (no WAV files)
- **test-audio-recognition.js** — Pitch detection against pure-tone WAV recordings
- **test-bass-recognition.js** — Pitch detection against real bass-guitar WAV recordings

All 134 tests should pass.
