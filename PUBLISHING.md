# Publishing SubTranslate to the Chrome Web Store

Step-by-step guide to package, submit, and maintain SubTranslate on the Chrome Web Store. This extension uses sensitive permissions (`tabCapture`) and sends audio to a third-party API (Google Gemini), so the privacy sections below are **required** — reviews fail without them.

---

## 0. Prerequisites

- A **Google account** for the developer dashboard.
- A **one-time $5 USD** registration fee (Chrome Web Store developer account).
- The extension working locally (loads unpacked, no console errors).
- A hosted **privacy policy URL** (required — see §5).

---

## 1. Pre-Submission Checklist

Fix all of these before packaging:

- [ ] `manifest.json` has a real `name`, `version`, and clear `description` (≤132 chars).
- [ ] `version` follows dot notation (e.g. `1.0.0`) and is **higher** than any previously uploaded build.
- [ ] Icons present and correct sizes: `16`, `48`, `128` px PNG.
- [ ] **Remove all debug `console.log` trace lines** added during development (background.js, content.js).
- [ ] No hardcoded API keys anywhere in source.
- [ ] `permissions` and `host_permissions` are the **minimum** needed. Current set:
  - `tabCapture` — capture tab audio (sensitive; must be justified)
  - `offscreen` — run audio capture/VAD (service workers can't)
  - `storage` — save keys + settings
  - `activeTab`, `scripting` — operate on the active tab
  - `host_permissions: https://generativelanguage.googleapis.com/*` — Gemini API calls
- [ ] No remote code / `eval()` (CSP / MV3 compliant).
- [ ] Test on a fresh Chrome profile to confirm a clean first-run.

> Tip: drop `activeTab` or `scripting` if the content script's manifest registration already covers your needs — fewer permissions = faster review.

---

## 2. Bump the Version

Edit `manifest.json` each release:

```json
"version": "1.0.0"
```

The store rejects an upload whose version isn't greater than the last accepted one.

---

## 3. Package the Extension (ZIP)

The store wants a ZIP of the extension **contents** — the `manifest.json` must sit at the ZIP root, not inside a subfolder.

PowerShell, from the project directory:

```powershell
$files = @('manifest.json','background.js','content.js','content.css','offscreen','popup','icons')
Compress-Archive -Path $files -DestinationPath subtranslate.zip -Force
```

Exclude dev-only files — do **not** ship `*.md`, `prompts/`, `.git/`, `TEST_PLAN.md`, or anything not referenced by the extension. Verify by unzipping into an empty folder and loading it unpacked.

---

## 4. Create the Developer Account

1. Go to the **[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)**.
2. Sign in, accept the developer agreement, pay the **one-time $5 fee**.
3. (Recommended) Set up a publisher display name.

---

## 5. Privacy Policy & Data Disclosure (REQUIRED)

This extension captures audio and transmits it to Google's Gemini API. You **must** disclose this or the review fails.

**Write a privacy policy** covering:
- What is collected: tab audio (as short clips), the user's API key.
- Where it goes: audio clips sent to `generativelanguage.googleapis.com` (Google Gemini) for transcription/translation; key stored locally in `chrome.storage.local`.
- What is **not** done: no audio stored/logged by the extension, no analytics, no selling data.
- Contact email.

Host it at a public URL (GitHub Pages, a Gist, your site). Paste that URL into the dashboard's **Privacy** tab.

In the dashboard **Privacy practices** section, you'll also:
- Declare a **single purpose** (e.g. "Display real-time translated subtitles for the audio of the current browser tab").
- **Justify each permission** in the permission-justification fields. Examples:
  - `tabCapture`: "Capture the audio of the active tab to transcribe and translate speech into subtitles."
  - `offscreen`: "MV3 service workers cannot record audio; an offscreen document performs capture and processing."
  - `storage`: "Persist the user's API key and subtitle preferences locally."
  - host permission: "Send audio clips to the Google Gemini API to obtain translated text."
- Certify data-use compliance (no unauthorized resale, etc.).

---

## 6. Store Listing Assets

Prepare before submitting:

| Asset | Requirement |
|-------|-------------|
| Title | ≤ 75 chars |
| Summary | ≤ 132 chars |
| Detailed description | Plain text; what it does, how to set up the key, limits |
| Icon | 128×128 PNG (already in `icons/`) |
| Screenshots | **At least 1**, 1280×800 or 640×400 PNG/JPG. Show subtitles over a video |
| Small promo tile (optional) | 440×280 |
| Category | e.g. "Accessibility" or "Productivity" |
| Language | Primary listing language |

---

## 7. Submit for Review

1. Dashboard → **Add new item** → upload `subtranslate.zip`.
2. Fill the **Store listing** (assets from §6).
3. Fill **Privacy practices** (§5) — single purpose, permission justifications, privacy policy URL.
4. Choose **Visibility**: Public, Unlisted, or Private.
5. Click **Submit for review**.

Review typically takes a few hours to a few business days. Extensions using `tabCapture` and remote API calls often get extra scrutiny — clear justifications speed this up.

---

## 8. After Approval — Updates

To push a new version:

1. Bump `version` in `manifest.json`.
2. Re-zip (§3).
3. Dashboard → your item → **Package** → upload new ZIP → **Submit for review**.

Installed users auto-update once the new version is approved.

---

## 9. Common Rejection Reasons (avoid these)

- **Missing/insufficient privacy policy** for audio capture and data transmission.
- **Over-broad host permissions** — keep it to `generativelanguage.googleapis.com`, never `<all_urls>` for host access. (The content script's `<all_urls>` match is fine and separate; don't request `<all_urls>` host *permissions*.)
- **Unjustified `tabCapture`** — explain exactly why it's needed.
- **Leftover debug logging** or dead/unused permissions.
- **Misleading listing** — screenshots/description must match actual behavior.
- Requiring the user to supply an API key is allowed; just document it clearly in the listing.

---

## 10. Distribution Alternatives (no review)

If you don't want store review:
- **Unlisted** visibility: still reviewed, but only reachable via direct link.
- **Self-hosting / load unpacked**: share the repo; users load it via Developer mode (see [HOW_TO_RUN.md](HOW_TO_RUN.md)). No fee, no review, but no auto-update.
