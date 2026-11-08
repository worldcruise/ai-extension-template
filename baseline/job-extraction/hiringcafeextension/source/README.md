# HiringCafe+

A personal Chrome + Firefox extension (Manifest V3, no build step) that supercharges [hiring.cafe](https://hiring.cafe) job search: cross-check badges, company ratings & intel, ATS info, job signals, recent-layoff flags with an optional hide filter, smart filters/sort, tracking with real account write-back (including full decoration + views/saves/applications stats on the `/myhiringcafe/tracker` page), alerts, and a keyboard/command-palette layer — all built on the site's own rich job data. **v1.2.0.**

## Install / update

**Chrome / Edge**
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder (or click the **↻ reload** icon on the HiringCafe+ card after updating)

**Firefox** (115+)
1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select this folder's `manifest.json` (or **Reload** after updating)
3. If the popup shows a **Grant site access** banner, click it — Firefox MV3 treats host permissions as user-granted

The same folder loads in both browsers; Firefox uses the `background.scripts` event page and Chrome uses the `background.service_worker`.