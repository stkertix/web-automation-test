# Web Automation Test

Chrome extension (Manifest V3) for recording and playing back browser automation tests from the Side Panel. Built with WXT + Vue 3.

`<all_urls>` host permission is required so the content script can record and replay interactions on normal web pages.

## Setup

```bash
npm install
npm run dev
```

Load the unpacked extension from `.output/chrome-mv3` (created by `npm run dev` / `npm run build`) in `chrome://extensions` with Developer mode enabled.

## Usage

1. Open any normal web page (not `chrome://`).
2. Click the extension icon to open the Side Panel.
3. Organize tests in **Library** with folders (create / rename / move / delete).
4. Click **Record**, interact with the page, then **Stop**.
5. Click **Play** to replay the active test.
6. Use toolbar **Export** / **Import** to share a single test case (import adds a new test under Unfiled).
7. Use Library **Export** / **Import** to back up or restore the entire library (import replaces the current library after confirmation).
8. Use a folder’s **Export** / **Import** icons to share a folder tree (import adds it under that folder, or at top level from Unfiled).
9. Add/edit steps via dialog while Idle.

## Icons

UI icons use [Flaticon Uicons](https://www.flaticon.com/uicons) (`@flaticon/flaticon-uicons`). Attribution: **Uicons by Flaticon**.

## Sample test

1. Open [`samples/forms/demo-form.html`](samples/forms/demo-form.html) in Chrome.
2. Open the Side Panel and click **Import JSON**.
3. Choose [`samples/forms/demo-form.json`](samples/forms/demo-form.json).
4. Optionally create a folder (e.g. `Forms`) and move the imported test into it.
5. Click **Play**.

The sample fills name/email, selects a role, checks newsletter, picks High priority, then submits the form.

## Scripts

| Command         | Description                        |
| --------------- | ---------------------------------- |
| `npm run dev`   | Development build with HMR         |
| `npm run build` | Production build                   |
| `npm run zip`   | Zip the extension for distribution |

## Phase 1 scope

- Record: click, dblclick, input, change (select/checkbox/radio), submit, navigate
- Playback: sequential steps with fixed inter-step delay
- Side Panel editor: delete step, edit selector/value/URL
- Test library with folders (create, rename, move, delete)
- Persist library in `chrome.storage.local` + JSON export/import
