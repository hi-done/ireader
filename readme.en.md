<div align="center">

# 📚 IReader

**A fully offline local manga reader (PDF / EPUB / CBZ / MOBI)**

Import · Collections · Immersive reading · Resume where you left off — your manga collection belongs to your computer alone

[中文](./readme.md) · [English](./readme.en.md) · [日本語](./readme.ja.md)

[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-F0C929?style=flat-square)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-grey?style=flat-square)

![Library home](pics/主页.webp)

*Library home — import, search, sorting and collections at a glance*

</div>

---

## ✨ Highlights

- 📴 **Fully offline** — zero network requests except the manual "Check for updates" in Settings and the AI translation you trigger yourself; books, covers, progress and translations stay on your machine. The custom `ireader://` protocol serves files by id without exposing local paths
- 📚 **Multi-format** — import PDF, EPUB, CBZ / ZIP comic archives and image-based comic MOBI files, all sharing the library, collections and resume support; PDF renders through the pdf.js canvas pipeline, EPUB uses epub.js pagination (image-based manga in side-by-side spreads, text-based books flow-paginated), CBZ / ZIP and MOBI are read on demand in the main process and served page by page, reusing the entire PDF paging pipeline; one set of reading preferences and shortcuts
- 🌐 **Trilingual UI** — Settings → General → Language offers Follow system / 中文 / English / 日本語; changes take effect instantly and persist across restarts, with dates, durations, plurals and title sorting adapting to the current language
- 📖 **Immersive reading** — single / double-page layouts with three directions: right-to-left (manga), left-to-right (webtoon) and top-to-bottom (strip comics) — the two horizontal directions use the canvas-drawn paper-curl animation, while top-to-bottom switches to continuous vertical scrolling with a fixed 16px gap and no page-turn animation; a pure-black viewport fills the screen while top and bottom bars appear near the edges and hide automatically; fit-width long pages support continuous wheel scrolling and turn the page at the edges
- 🪄 **AI selection translation** — press `A` in the reader (or the "AI translate" toolbar button) and drag a box around a speech bubble to translate it into Chinese / English / Japanese; the glass selection box turns into a white translation box in place, sized to the bubble from the model's suggested font ratio, and can be dragged, resized from the bottom-right corner, collapsed into a small pill or deleted; translations persist per book and page; both OpenAI-compatible and Anthropic-compatible endpoints are supported (several saved model profiles with a connection test), and it works for PDF / CBZ / MOBI and image-based EPUB (including top→bottom)
- 🔖 **Resume anywhere** — every book independently records its page, reading mode, direction and zoom, so reopening returns to where you left off
- 🗂️ **Collections** — organize manga by series; a book belongs to exactly one collection at a time; import straight into a collection, or fuzzy-search from the home page and select all
- 📊 **Reading stats** — total time, today's reading and streak at a glance, with 7 / 30-day bar charts and a book ranking; time is tracked automatically and the ranking switches between today / all time
- ⚡ **Smooth rendering** — offscreen canvas rendering plus an LRU bitmap cache for millisecond cache hits; dragging the slider across pages costs zero rendering, and adjacent spreads are prefetched in the background

## 🖼 Screenshots

<table>
  <tr>
    <td width="50%" align="center">
      <img src="pics/阅读界面（带设置）.webp" alt="Immersive reader" /><br/>
      <sub><b>Reader · toolbar</b> — switch double page / direction / zoom and fullscreen from the top bar; drag the bottom slider to turn pages</sub>
    </td>
    <td width="50%" align="center">
      <img src="pics/阅读界面2（设置隐藏）.webp" alt="Immersive mode" /><br/>
      <sub><b>Immersive mode</b> — toolbars hide automatically; the pure-black viewport is all that's left, just the manga</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="pics/合集.webp" alt="Collection view" /><br/>
      <sub><b>Collection view</b> — a 3D book "Continue reading" sidebar; switch focus within the collection and click the cover to resume</sub>
    </td>
    <td width="50%" align="center">
      <img src="pics/设置.webp" alt="Settings" /><br/>
      <sub><b>Settings</b> — interface language, reading preferences and appearance; theme supports light / dark / follow system</sub>
    </td>
  </tr>
</table>

## 📥 Download

Get the installer for your platform from the [**Releases**](../../releases) page:

| Platform | Installer | Status |
| --- | --- | --- |
| macOS 12+ (verified on Apple Silicon) | `IReader-<version>-mac.dmg` | ✅ Available |
| Windows 10+ (verified) | `IReader-<version>-win.exe` | ✅ Available |

> **macOS signing note**: current builds use ad-hoc signing (`identity: "-"`, no Apple Developer certificate required). If macOS says it "cannot be checked for malicious software" on first launch after downloading from a browser, open **System Settings → Privacy & Security** and click **Open Anyway** once.
>
> **Windows unsigned note**: the installer is unsigned. If SmartScreen blocks the first run, click **More info** → **Run anyway**.

**In-app updates**: installed users can click "Check for updates" under Settings → About. Windows supports incremental updates (only changed parts are downloaded, then a one-click restart installs silently); macOS cannot install in-app without a Developer ID certificate, so a detected update opens the browser to the Releases page for download.

## ⌨️ Shortcuts

| Action | Keys |
| --- | --- |
| Next / previous page | `→` / `←` (fixed semantics, not mirrored for RTL), `↓` / `↑` |
| Next / previous page | `Space` / `Shift+Space`, `PgDn` / `PgUp` |
| First / last spread | `Home` / `End` |
| Spread jump | Drag the bottom slider (follows while dragging, plays one page-turn animation on release) |
| Page scroll / edge turn | `Wheel` scrolls the content first; keep scrolling at the top / bottom to turn the page (when fit-width content exceeds one screen) |
| Horizontal pan | `Shift+Wheel` (wheel down pans right, up pans left; switches to vertical scrolling at the far left / right edge) |
| Single / double page | `D` |
| Toggle reading direction | `R` (left→right → right→left → top→bottom) |
| Zoom in / out | `Cmd/Ctrl+=` / `Cmd/Ctrl+-`, `Cmd/Ctrl+Wheel` |
| Fullscreen | `F` or the toolbar button; `Esc` exits fullscreen / returns to the library |
| AI translation selection | `A` (press again or `Esc` to exit; a hint appears at the bottom when disabled or unsupported) |

<details>
<summary><b>📚 Full feature list</b></summary>

#### Library (home)

- **Import**: multi-select PDF / EPUB / CBZ / ZIP / MOBI files, or pick a folder for recursive scanning (hidden directories and symlinks are skipped); duplicates are removed by normalized absolute path and the format is inferred from the extension; images inside CBZ / ZIP archives are read in natural filename order, while MOBI pages follow the `<img recindex>` reference order in the text (falling back to record order when it cannot be parsed)
- **Covers**: a cover queue renders page 1 of each book to disk (480px JPEG) and fills in progressively; failures show a placeholder
- **Cards**: cover, title, reading progress (percentage + bar) and last-read time
- **Sorting**: recently read (default) / date added / title, with the preference persisted
- **Card actions**: open, move to collection, rename, remove (optionally delete the file, with confirmation) and relink a missing file

#### Collections

- Create collections on the home page; collection cards are as tall as book cards with a stacked-page edge on the right; the cover is the first book by title order
- Click a collection to open the collection view: member books (title order) and dissolve collection (members move back to ungrouped, with confirmation)
- Import comics / folders directly inside a collection (new imports join that collection automatically)
- **Add from home**: a multi-select dialog moves ungrouped books into the collection, with fuzzy title search (space-separated terms, case-insensitive) and **Select all**
- **Continue reading sidebar**: the right rail shows the most recently read book in the collection (large cover with a thick 3D book style), with previous / next buttons to move focus and a click to resume

#### Reader

- **Spreads**: single page `[1][2][3]…`; double page puts the cover alone by default `[1][2,3][4,5]…` (can be disabled in Settings)
- **Direction**: RTL (manga) puts page 1 on the right of a spread; LTR (webtoon) puts it on the left; click zones mirror with the direction (arrow keys keep fixed semantics, see Shortcuts)
- **Continuous vertical scroll** (top-to-bottom): pages stack vertically with a fixed 16px gap between rows (0 inside a double-page row, both pages vertically centered) and no page-turn animation; only pages near the viewport are mounted and rendered, the wheel / trackpad scrolls continuously, and keys, click zones, the slider and the step buttons jump instantly; progress is saved about 1s after scrolling stops, so reopening returns to the same row; the in-row page order follows the horizontal direction used before switching (left-to-right by default); text-based EPUB books use the epub.js continuous flow, which is forced to a single column, so the double-page button is disabled with a hint
- **Zoom**: fit width / fit height (default, pages fill the viewport) / original 100% / custom 25%–400% (`Ctrl/Cmd+Wheel` or `=`/`-` in 10% steps); drag to pan when larger than the viewport
- **Page animation**: a canvas-drawn paper curl (450ms, with fold shadow and paper-edge highlight); rapid turns cancel the previous layer and `prefers-reduced-motion` is respected
- **Wheel reading**: when fit-width or custom zoom makes a page taller than the viewport, the wheel scrolls the content first and turns the page after another ~80px at the top / bottom, aligning to the page start when moving forward and the page end when moving back; `Shift+Wheel` pans horizontally (down → right, up → left) and switches to vertical scrolling at the edges, where page turns work the same way; without horizontal overflow it behaves like a normal wheel
- **Render pipeline**: offscreen canvas → LRU bitmap cache (12 entries with render signatures) → blit to screen; 0–4 adjacent spreads prefetched in the background per Settings
- **EPUB reading**: epub.js pagination; image-based manga books show side-by-side spreads aligned to the center (single cover centered), zoom 50%–200%; text-based books flow-paginate with font-size steps; resume restores layout state (single/double page, direction, font size / zoom)
- **CBZ reading**: images inside the archive are browsed in natural filename order (1 → 2 → 10, zero padding supported); page count is known on import and the first page becomes the cover; reuses the full PDF spread / cache / animation pipeline
- **MOBI reading**: a self-contained zero-dependency parser (PalmDB record table + MOBI header + EXTH + PalmDOC LZ77 decompression) browses pages in the order the text references them; page count is known on import and the first page becomes the cover; shares the same image-page pipeline as CBZ. The scope is limited to **image-based comic MOBI** — text-only and encrypted MOBI files report that they are unsupported when opened
- **Performance guards**: dragging the slider across many pages costs no rendering (both pages render in parallel on release); late results from invalidated render loops are cached but never blitted

#### AI translation

- **Entry**: Settings → Data → AI extensions → AI configuration; the master switch, target language (Simplified Chinese / English / Japanese) and model profiles live here, and turning it off disables the reader button
- **Model profiles**: save several profiles (name, endpoint, API key, model, protocol) and pick the active one; the protocol can be OpenAI-compatible (`/chat/completions`) or Anthropic-compatible (`/v1/messages`), "Test connection" reports the model name and round-trip time, and a DeepSeek preset fills the draft without overwriting your API key
- **Selecting**: press `A` or click "AI translate" in the top bar to enter selection mode, then drag a rectangle with the mouse / trackpad to translate immediately while a spinner shows in the box; toolbars are suppressed during selection, `Esc` cancels, and no text detected shows a hint without saving
- **Translation box**: the glass box turns into a white translation box of the same size with vertically centered text that scrolls when it overflows; the font size is the page display height × the model's suggested ratio, then shrunk proportionally to fit the space inside the box
- **Box actions**: drag the whole box to move it, resize it from the bottom-right handle, collapse it into a small pill (click to restore) or delete it; the toolbar dropdown offers "Hide all / Collapse all / Expand all"
- **Persistence**: text, normalized rectangle, font ratio and collapsed state are stored per book and page and removed with the book; boxes stay glued to their bubbles after switching single / double page, zoom or direction, and the overlay is gated with the page while turning
- **Scope**: PDF, CBZ, MOBI and image-based EPUB in single / double page and top→bottom scrolling; reflowable text EPUB has no stable page boundary, so pressing `A` explicitly reports that it is unsupported
- **Requests**: all outbound requests are made in the main process, translation requests time out after 60s, and they are only sent when you drag a box or test a connection; the selected image and book title are sent to the service you configured (target language, profiles and translations stay on this machine, and the API key is stored in plain text in the local settings)

#### Reading stats

- Entry: Settings → Data → Reading statistics
- Overview: total reading time, today's reading (with yesterday comparison) and reading streak
- Daily bar chart for the last 7 / 30 days, fetched once and sliced locally
- Book ranking: today / all-time modes showing duration, share bar and last-read time
- Timing: settled every 30 seconds while on the reader page, paused when the page is hidden, the window loses focus or loading fails, and split across midnight into the correct day

#### Settings

| Setting | Values | Default |
| --- | --- | --- |
| Interface language | Follow system / 中文 / English / 日本語 | Follow system |
| Default reading mode | Single / double page | Single page |
| Default reading direction | Left→right (LTR) / right→left (RTL) / top→bottom (TTB) | RTL |
| Theme | Light / dark / follow system | Follow system |
| Preloaded spreads | 0–4 | 2 |
| Double-page cover as single page | On / off | On |

A per-book progress record overrides the global defaults (the "Cover solo / Cover paired" button in the comic and image-based EPUB reader toolbar overrides it for a single book).

The Data group in Settings provides the reading statistics and AI configuration (AI extensions) entries; the About group shows the current version and checks for updates (incremental updates on Windows, browser download on macOS).

</details>

## 🛠️ Tech stack

| Layer | Technology |
| --- | --- |
| Desktop framework | Electron 42 |
| Frontend | Vue 3 + TypeScript + Pinia + Vue Router, built with Vite 5 (vite-plugin-electron) |
| PDF rendering | pdfjs-dist 4.x (parsed by a renderer worker → canvas) |
| EPUB rendering | epubjs 0.3.x (unpacked in the renderer → pagination; adaptive scaling for image-based books) |
| CBZ rendering | yauzl 3.x (unpacks zip images on demand in the main process, served per page via ireader://cbz/{id}/{page}) |
| MOBI parsing | Self-contained, zero dependencies (reads a single record straight from the PalmDB offset table, PalmDOC LZ77 decompression, served per page via ireader://mobi/{id}/{page}) |
| Database | better-sqlite3 12.x (embedded SQLite in the main process, WAL mode) |
| UI language | Self-built zero-dependency i18n with type-isomorphic dictionaries; Intl for dates, durations and plurals, Intl.Collator for sorting |
| AI translation | Global `fetch` in the main process (60s timeout, no SDK dependency): dual protocol support for OpenAI-compatible `/chat/completions` and Anthropic-compatible `/v1/messages`, sending the cropped image as base64 plus the prompt and parsing the text and suggested font ratio |
| Packaging | electron-builder 26 (macOS DMG / Windows NSIS) |
| Testing | Vitest 1.x (pure logic: spread building, cover queue, CBZ ordering and sizing, the MOBI parser core, wheel-scroll state machine, AI reply parsing, i18n and sorting — 476 cases) |

## 🧭 Architecture

Electron with two processes and a clear separation:

```
Renderer (Vue 3 SPA)
  Library / Reader / Settings / Stats — four routes
  PDF: pdf.js worker → offscreen canvas → LRU cache → blit
  EPUB: epub.js unpack → paginated rendering (spine page model for image-based books)
  CBZ / MOBI: fetch images page by page (unpacked on demand / text decompressed + image records read directly in main) → same canvas pipeline as PDF
  Top→bottom: VerticalScrollView row-box layout with windowed mounting (canvas rendering, sharing the spread table with horizontal mode)
  AI translation: page-box overlay (normalized rectangles) → cropped image → IPC → main-process request → translations stored per book + page
  i18n: trilingual dictionaries + Intl formatting; locale changes re-render the whole UI
        ▲ IPC (type-safe contextBridge API, contextIsolation + sandbox)
Main process (Node.js)
  Library / collections / progress / settings / AI service (the only outbound network path: OpenAI / Anthropic protocols), cover files, logging
  ireader:// custom protocol (serves PDF / EPUB / CBZ / MOBI pages and covers by id, never exposing file paths)
        ▲
  {userData}/ireader.db (SQLite WAL) + {userData}/covers/
```

```
├── electron/          # Main process: main / preload / db (repos + migrations) / services (incl. aiService·aiProtocol·aiReply) / ipc
├── src/               # Renderer: views / stores / services (pdf·epub·imagePage·cache·pageCurl·spread·verticalLayout·aiCrop·aiTranslation) / components
├── src/i18n/          # Trilingual dictionaries, duration/date formatting and error-code mapping
├── shared/types.ts    # Shared types (Book / Collection / Settings / Result…)
├── pics/              # UI screenshots
└── build/             # Packaging assets (icons, etc.)
```

Security baseline: the renderer is sandboxed with `contextIsolation: true` and `nodeIntegration: false`; local files are only reachable by id through `ireader://pdf/{id}`, `ireader://epub/{id}`, `ireader://cbz/{id}/{page}`, `ireader://mobi/{id}/{page}` and `ireader://cover/{id}`. AI translation is the only feature that sends content out, and it only sends the selected image and book title to the model service you configured.

<details>
<summary><b>🗄️ Data model (SQLite, incremental migrations)</b></summary>

- `books`: title, format (derived from the extension), normalized path (unique), page count, cover path, added / last-read times, `collection_id` (NULL = ungrouped)
- `collections`: collections (id, title, created time)
- `reading_progress`: one row per book (page, mode, direction, zoom, cfi/percentage for EPUB locations, `row_order` for the page order inside vertical rows), saved with a 1s debounce and flushed on exit
- `reading_stats`: daily reading-time aggregation (one row per book per day, ms accumulated; deleted with the book)
- `ai_translations`: AI selection translations (book id + page + normalized rectangle + text + font ratio + collapsed state + created time; deleted with the book)
- `settings`: key-value (JSON)

Migrations use the `PRAGMA user_version` number plus sequential scripts (currently v7: collection ownership, progress cfi/percentage, reading time stats, vertical row order, AI translation records, per-book cover-solo override); scripts are append-only.

</details>

## 💻 Local development

```bash
npm install        # install dependencies (postinstall runs electron-rebuild for better-sqlite3)
npm run dev        # start the dev environment
npm test           # Vitest unit tests
npm run typecheck  # vue-tsc type check
```

> Note: `better-sqlite3` is a native module built for the Electron ABI; running it directly under system Node fails with `ERR_DLOPEN_FAILED`. To script database access, use `ELECTRON_RUN_AS_NODE=1 npx electron <script>`.

Issues and pull requests are welcome.

## 📦 Packaging and release

```bash
npm run build      # type check → vite build → electron-builder
```

Artifacts go to `release/<version>/`:

- `IReader-<version>-mac.dmg` — macOS disk image
- `mac-arm64/IReader.app` — ready-to-run app bundle

Notes:

- macOS builds currently use **ad-hoc signing** (`identity: "-"`, no certificate; `hardenedRuntime: false` prevents library validation from rejecting Electron's pre-signed frameworks under ad-hoc signing): if macOS says it "cannot be checked for malicious software" on first launch, open System Settings → Privacy & Security and click "Open Anyway" once
- `asarUnpack` already includes `better-sqlite3` (native `.node` binaries cannot load from inside asar)
- The Windows NSIS target is configured and verified on real hardware

### Publishing to GitHub Releases

Installers are not committed to git (`.gitignore` ignores `release/`); **GitHub Actions builds and publishes them automatically** — pushing a version tag like `v*` triggers the workflow: type check and tests first, then builds on macOS and Windows, attaching artifacts to the Release with auto-generated notes.

**Standard release flow** (requires a clean git working tree):

```bash
# 1. Bump the version — pick one based on the change (updates package.json's version,
#    commits automatically with the version as the message, and creates a v-prefixed tag;
#    no need to write the version by hand):
npm version patch          # patch +1, bug fixes          1.0.1 → 1.0.2
npm version minor          # minor +1, new features        1.0.1 → 1.1.0
npm version major          # major +1, breaking changes    1.0.1 → 2.0.0

# 2. Push the branch and tag (the tag triggers the automated release):
git push origin main --follow-tags

# 3. Watch progress and verify:
gh run list --workflow Release --limit 1   # latest build status (note the run-id)
gh run watch <run-id> --exit-status        # optional: watch progress in the terminal
gh release view v<new-version>             # verify the Release and both platform artifacts
```

The build takes about 5–10 minutes; progress is also visible on the repository's **Actions** page, and the Release appears on the Releases page when done.

**Re-running a failed release** (the tag points at the old commit, so re-running from the Actions page does nothing — recreate the tag):

```bash
git push origin :refs/tags/vx.y.z   # delete the old remote tag
git tag -f vx.y.z                   # move the local tag to the fixed commit
git push origin vx.y.z              # push the tag alone to trigger a new build
```

Manual local build (fallback): run `npm run build`, then
`gh release create v<version> "release/<version>/IReader-<version>-mac.dmg" --title "v<version>" --notes "release notes"`.

## 📄 License

Released under the [MIT](./LICENSE) license.
