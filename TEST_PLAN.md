# SubTranslate — Manual Test Plan

## 1. Installation
- [ ] Load extension via chrome://extensions → Load unpacked → no errors
- [ ] Extension icon appears in toolbar

## 2. API Key Flow
- [ ] Open popup → warning banner visible, Start button disabled
- [ ] Enter key NOT starting with sk-or- → "Invalid key" error shown, not saved
- [ ] Enter key shorter than 20 chars → error shown
- [ ] Enter valid sk-or- key → "Key saved" confirmation, banner hides, Start enables
- [ ] Close and reopen popup → key still saved (shown as ●●●●●●●● placeholder)

## 3. Core Subtitle Flow — YouTube
- [ ] Open any Japanese YouTube video, let it play
- [ ] Click Start → badge shows green "ON"
- [ ] Within ~8 seconds → English subtitles appear on the video
- [ ] Subtitles auto-hide between speech pauses
- [ ] Click Stop → badge clears, subtitles hide, no errors in console

## 4. Multilingual Support
- [ ] Hindi YouTube video → English subtitles appear
- [ ] German YouTube video → English subtitles appear
- [ ] English video → English passthrough (same text returned)
- [ ] Silent video / music only → no subtitle flicker (silence guard working)

## 5. Multi-Site
- [ ] Works on Vimeo
- [ ] Works on Twitter/X video
- [ ] Works on a local HTML page with <video src="...">

## 6. Fullscreen
- [ ] YouTube: press F to fullscreen → subtitles still visible on top of video
- [ ] Exit fullscreen → subtitles still correctly positioned

## 7. Edge Cases
- [ ] Reload tab while capturing → capture stops cleanly, no console errors
- [ ] Close tab while capturing → no zombie processes or errors
- [ ] Navigate to new YouTube video (SPA) → overlay re-attaches to new video within 2s
- [ ] Delete API key mid-capture → subtitle error shown, capture auto-stops

## 8. Request Counter
- [ ] Start subtitle session → counter increments every ~4 seconds
- [ ] Counter shown in popup updates while popup is open (within 5s refresh)
- [ ] At 180+ requests → warning subtitle shown in video overlay
- [ ] At 200 requests → capture auto-stops, "Daily limit reached" subtitle shown

## 9. Settings
- [ ] Font size slider → subtitle text size changes live (next subtitle after change)
- [ ] Position: Top → subtitles appear at top 8% of video
- [ ] Chunk size 2s → faster subtitles (rougher), 6s → slower (more complete sentences)
- [ ] Settings are persisted after popup close/reopen

## 10. Console Hygiene
- [ ] No unhandled promise rejections
- [ ] All logs prefixed with [SubTranslate]
- [ ] No errors in chrome://extensions service worker console during normal use
