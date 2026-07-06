# Handoff: תומכת הוראה אישית - ממשק תוכנית עבודה שנתית

כלי ווב שעוזר למורה למדע וטכנולוגיה בחטיבת ביניים לבנות תוכנית עבודה שנתית.
המורה עונה על כמה שאלות, והמערכת מייצרת לוח שנה שנתי (ספטמבר עד יוני) לייצוא.

> כל הטקסט בממשק בעברית, RTL מלא. מסמך זה כתוב באנגלית כדי שיהיה נוח ל-Claude Code, אבל **המחרוזות בקוד חייבות להישאר בעברית בדיוק כפי שהן מופיעות כאן.**

---

## Overview

A web tool that helps middle-school science & technology teachers build an annual
work plan. The teacher answers a short wizard, and the system generates a full
month-by-month calendar (September → June) ready for export to PDF / Google Calendar.

**Target audience: teachers, NON-technical.** The UI must stay clean, simple,
inviting, and non-intimidating.

## About the Design Files

The files in this bundle (`מסכי תוכנית עבודה.dc.html` + the logo PNGs) are
**design references created in HTML** — a static, pannable mockup showing the
intended look and layout of every screen. They are **not production code to copy
directly.**

The task is to **recreate these designs in the target codebase's environment**
(React, Vue, etc.) using its established patterns, component library, and
conventions. If no codebase exists yet, choose an appropriate stack (a React +
RTL setup such as Vite + React with `dir="rtl"` is a natural fit) and implement
there.

The HTML mockup uses a custom "Design Component" wrapper for previewing; **ignore
that wrapper.** Only the markup, styles, colors, copy, and layout are meaningful.

## Fidelity

**High-fidelity (hifi).** Final colors, typography, spacing, copy, and component
treatments are all decided. Recreate the UI pixel-accurately using the codebase's
own libraries. All exact values are documented below.

## Mandatory design rules (do not deviate)

1. **Hebrew + full RTL** — everything flows right-to-left. Set `dir="rtl"` at the
   root; text-align start = right.
2. **Hyphens: ONLY the regular keyboard hyphen `-`** in all visible text. Never
   use en-dash `–` or em-dash `—`. (This applies to ranges like "אוקטובר -
   נובמבר" too — they use a plain `-` with spaces.)
3. **Accessible**: large-enough text, good contrast. Body text ≥ 14px, tap
   targets ≥ 44px.
4. **Responsive**: must work on both mobile and desktop. The mockup is desktop;
   stack columns vertically on narrow screens (see Responsive notes per screen).

## Branding

- **Tool name:** תומכת הוראה אישית
- **Logos:** two PNGs, shown together in the header (right-aligned), separated by
  a thin vertical divider before the tool name. `logo-misrad.png` (Ministry of
  Education) first, then `logo-mada.png` (Science & Technology). Both also belong
  in the footer where present.
- **Font:** Rubik (Google Fonts), weights 400 / 500 / 600 / 700. RTL-friendly,
  geometric, professional.

---

## Design Tokens

### Colors
| Role | Hex | Usage |
|---|---|---|
| Primary (teal) | `#1c4e5e` | primary buttons, headers, active states, calendar month bars, brand name |
| Primary gradient | `#1c4e5e → #2f7186` | hero panel, "ready to build" banner |
| Primary tint (light) | `#eef5f5` | selected card bg, info chips |
| Primary text on tint | `#2f7186` | secondary teal text |
| Secondary (mustard) | `#e0992f` | accent buttons (download, build), "June" highlight, exam dots |
| Mustard tint | `#fdf6e8` / `#f7e6c4` | warning-soft chips, "רשות" chips |
| Mustard text | `#9a6a18` / `#b07a16` | text on mustard tints |
| Page background | `#f7f3ec` | app body background (warm off-white) |
| Surface / card | `#ffffff` | cards, panels |
| Card border | `#e7e0d3` / `#ece6da` | hairline borders |
| Input bg | `#fbf9f4` | text input fill |
| Input border | `#e2dccf` (idle) `#cdd9da` (filled) | inputs |
| Heading text | `#1c2b30` / `#2b2722` | h1/h2, strong cells |
| Body text | `#5f594f` | paragraphs, table cells |
| Muted text | `#7c766c` / `#8a8378` / `#9a948a` | subtitles, labels, hints |
| Success green | `#2f8a5f` / `#3aa17e` | "נמצא בסטטוס", completed status, progress fill |
| Success tint | `#eef5f1` / `#e7f3ec` | success badge bg |
| Error / event red | `#c2603f` / `#a64a2c` | validation errors, holiday/event chips, alerts |
| Error tint | `#fdf4f0` border `#f0cbbb` | error banner bg |
| Model-task purple | `#6b5aa6` / `#54489a` | model-task dots & chips |
| Model-task tint | `#ece9f5` | model-task chip bg |

### Typography (Rubik)
- H1 (hero): 42px / 700 / line-height 1.25 / letter-spacing -0.5px
- H2 (screen title): 24-27px / 700
- Section label: 16px / 600
- Body: 15-19px / 400 / line-height 1.6-1.7
- Field label: 14px / 600
- Chip / small: 11-14px / 500-600
- Big numeric (stats, stepper): 26-40px / 700

### Spacing & shape
- Card radius: 14-18px; chips: 999px (pill) or 11px; buttons: 11px
- Card shadow: `0 8px 34px rgba(40,33,24,.08)` (frames), `0 4px 18px rgba(40,33,24,.05)` (inner cards)
- Standard body padding: 30px; card inner padding: 18-42px
- Gaps: grids/rows use flex/grid `gap` (8-16px), never margin hacks

### Buttons
- **Primary** (`btn-pr`): bg `#1c4e5e`, white text, 600/16px, padding 15×32px, radius 11px
- **Mustard** (`btn-mu`): bg `#e0992f`, white text, padding 13×26px — for "בנה תוכנית" and "הורד PDF"
- **Ghost** (`btn-gh`): white bg, `#1c4e5e` text, 1.5px border `#cdd9da`, 14px

---

## Screens / Views

There are 8 frames (screen 3 = wizard split into 4 sub-steps).

### Screen 1 — Landing (נחיתה)
- **Purpose:** explain the tool in 2 lines, invite to start.
- **Layout:** full frame, column. Header (68px) → two-column body (right: text
  column, left: teal gradient calendar-preview panel 420px wide) → footer (54px).
- **Components:**
  - Header: brand (2 logos + divider + "תומכת הוראה אישית"), right-side meta
    "מדע וטכנולוגיה · חטיבת ביניים".
  - Pill chip "תכנון שנתי · קל ומלווה" (bg `#f7e6c4`, text `#9a6a18`).
  - H1: "בונים תוכנית עבודה שנתית במדע וטכנולוגיה" (two lines).
  - Paragraph (19px): "עונים על כמה שאלות קצרות, והמערכת בונה עבורכם לוח שנה שלם
    - מספטמבר עד יוני - מוכן לייצוא. בלי טבלאות מסובכות."
  - Primary button "התחלה" with a chevron (points right, i.e. `M15 18l-6-6 6-6`
    — RTL "forward").
  - Left panel: label "שנת הלימודים שלך, במבט אחד", 2×2 grid of mini month cards
    (ספטמבר / דצמבר / מרץ / יוני-mustard), and a 4-segment progress bar.
  - Footer: "פותח עבור מורי מדע וטכנולוגיה · משרד החינוך, המינהל הפדגוגי".
- **Action:** "התחלה" → Screen 2.
- **Responsive:** hide or stack the left gradient panel below the text on mobile.

### Screen 2 — Registration (רישום)
- **Purpose:** identify the teacher and the school.
- **Layout:** centered card (520px) on the page background.
- **Components:** card title "כמה פרטים ונתחיל", subtitle "נשתמש בהם כדי לשלוף את
  נתוני בית הספר שלך מהסטטוס.", three fields:
  - "שם המורה" (text) — example value "רונית לוי".
  - "אימייל" — **shown in error state**: border `#d98b6e`, bg `#fdf4f0`, value
    "ronit.l", inline error row with alert icon + "כתובת אימייל לא תקינה".
  - "סמל מוסד" (institution code) — value "540123", below it a **success
    confirmation row** (green tint): check icon + "חטיבת ביניים אורט רמת גן" +
    left-aligned "נמצא בסטטוס".
  - Full-width primary "המשך"; helper text "הנתונים נשמרים מאובטח ומשמשים לתכנון בלבד".
- **States:** empty/invalid field error (red); short loading while fetching school
  data from "הסטטוס".
- **Action:** "המשך" → wizard.

### Screen 3 — Wizard (שאלון), 4 steps with progress bar
All four sub-steps share: header (with "שלב N מתוך 4" on the left), a 4-segment
progress strip below the header (each segment: 6px bar + label; done/active =
`#1c4e5e`, future = `#dfd8c9` bar + `#a59e90` label), a body, and a 74px footer
with ghost "הקודם" (right) + primary "הבא" (left). Labels: שכבה וכיתה / לוח שבועי
/ משימות מודל / השלמה.

- **3א — שכבה וכיתה (Layer & class):**
  - H2 "איזו שכבה את מלמדת?"
  - Two large choice cards: "ז׳ / כיתה ז" (unselected, gray) and "ח׳ / כיתה ח"
    (**selected**: 2.5px teal border, tint bg, teal check badge top-left).
  - "בחרי כיתה": pill chips ח׳1 (selected, teal) / ח׳2 / ח׳3 / ח׳4.
  - **Hours-from-status card** (mustard tint `#fdf6e8`, border `#f0dcb0`): mustard
    "5" badge + "קיבלנו מהסטטוס: 5 ש"ש (שעות שבועיות)" + "נכון? אם לא, אפשר לתקן
    ידנית" + ghost "תיקון" button. The weekly-hours value arrives automatically
    from the status and is shown for confirmation with an option to correct.

- **3ב — העלאת לוח עבודה שבועי (Upload weekly schedule):**
  - H2 "העלי את מערכת השעות השבועית שלך" + subtitle.
  - Large dashed drop zone (border `#bcc9cb`, bg `#fbfcfc`): upload-cloud icon in
    a circle, "גררי לכאן את הקובץ או לחצי לבחירה", "PDF, Excel או תמונה · עד
    10MB", ghost "בחירת קובץ מהמחשב".
  - **Uploaded-file row** (white card): file icon + "מערכת_שעות_ח1.xlsx" + "הועלה
    בהצלחה · 48KB" + remove (×) button.

- **3ג — משימות המודל (Model tasks):**
  - H2 "משימות המודל".
  - "באילו ימים נכנסות משימות המודל?" — weekday pill toggles א׳ ב׳ ג׳ ד׳ ה׳ ו׳
    (א׳ & ג׳ selected = teal; ו׳ disabled/grayed). 52px wide, centered.
  - "כמה פעמים בחודש?" — stepper: − button (50px) / value box "2" (88×62, tint) /
    + button, then label "פעמים בחודש".
  - Info strip (teal tint): "משימות המודל משובצות אוטומטית בימים שבחרת, ומסומנות
    בלוח השנה הסופי בסגול."

- **3ד — השלמה קצרה (Short completion — only fields missing from status):**
  - H2 "עוד שני דברים קטנים" + subtitle "לא מצאנו את אלה בסטטוס - אישרי או שני.
    בחרנו לך ברירת מחדל סבירה."
  - Two question rows, each a white card with a **segmented כן/לא toggle** (כן
    selected = teal pill inside a `#f1ede4` track):
    - "יש לך מעבדת מדעים זמינה?" / sub "משפיע על שיבוץ שיעורי המעבדה".
    - "משתתפים ביריד חקר בית ספרי?" / sub "נשריין שבועיים בסוף השנה להכנה".
  - **Build banner** (teal gradient): "הכול מוכן לבנייה" + "נבנה לך לוח שנה מלא
    מספטמבר עד יוני" + **mustard button "בנה תוכנית"** with chevron.
- **Action:** "בנה תוכנית" → Screen 4 if hours are short, else Screen 5.

### Screen 4 — Hours trimming (קיצוץ שעות) — only if hours are short
- **Purpose:** when actual hours < required, let the teacher choose what to drop.
- **Layout:** header → scrollable body → 74px footer (הקודם / "המשך לתוכנית").
- **Components:**
  - **Red alert banner**: "חסרות לך שעות לתוכנית המלאה" + "התוכנית המומלצת דורשת
    92 ש' לימוד, ובמערכת שלך יש 84 ש'. צריך להוריד 8 ש'."
  - **Progress card**: "הורדת 6 מתוך 8 ש'" / "נשארו 2 ש'" + green progress bar (75%).
  - **Mandatory topics — locked** (label "נושאי חובה - לא ניתן להוריד"): rows with
    a lock icon, dimmed, teal "חובה · N ש'" chip. (e.g. "מבנה החומר וחלקיקים · 14
    ש'", "מערכות בגוף האדם · 18 ש'".) Cannot be unchecked.
  - **Optional / enrichment** (label "נושאי הרחבה ורשות - אפשר להוריד"): rows with
    a checkbox (checked = teal box with check) + mustard "רשות · N ש'" chip. Two
    checked ("העמקה: ננו טכנולוגיה · 4 ש'", "פרויקט סביבה וקיימות · 2 ש'"), one
    unchecked ("סיור לימודי במוזיאון המדע · 3 ש'").
- **Action:** "המשך לתוכנית" → Screen 5.

### Screen 5 — Result: the plan (התוצאה) — KEY SCREEN
- **Purpose:** present the generated annual plan. The **monthly visual calendar
  is the hero element** — emphasize it.
- **Frame width is wider (1340px in the mockup).** Layout: header with export
  actions → body (alerts → legend → monthly calendar grid → full table).
- **Header actions (left side):** ghost "חזרה לעריכה", ghost "ייצוא ל-Google
  Calendar" (calendar icon), mustard "הורד PDF" (download icon).
- **Title block:** H2 "תוכנית עבודה שנתית · מדע וטכנולוגיה" + "כיתה ח׳1 · 5 ש"ש ·
  רונית לוי · תשפ"ו". On the left, a **legend**: נושא לימוד (teal), חג / אירוע
  (red), מבחן (mustard), משימת מודל (purple) — each a colored 12px square + label.
- **Alerts row** (chips): red "מבחן מחצית (ינואר) חופף לשבוע חנוכה - שווה לבדוק",
  mustard "נושא רשות אחד הוסר עקב מגבלת שעות". (Alert types per spec: hours
  overflow, holiday/exam conflict, unscheduled mandatory topic.)
- **Monthly calendar** (label "לוח שנה חודשי"): a **5-column grid** of 11 month
  cards, ספטמבר → יוני. Each card:
  - Colored top bar (`#1c4e5e`, slightly lighter `#23586a`/`#2c6276` mid-year,
    **mustard `#e0992f` for יוני**) with month name (700/16px white) + hours
    ("20 ש'") on the left.
  - Body: topic line with a colored bullet, plus event/exam/model-task chips
    (color-coded as in the legend).
  - Example data is in the HTML; the developer wires real generated data here.
- **Full plan table** (label "טבלת תוכנית מלאה"): columns
  **נושא · שעות · חודשים · חובה/רשות · הערכה · יוזמות** (grid header `#f4f0e8`,
  rows separated by `#f0ece2`). חובה = teal chip, רשות = mustard chip. 7 example rows.
- **Action:** "חזרה לעריכה" returns to the wizard to change an answer and rebuild.

### Screen 6 — Coordinator view (תצוגת רכז) — later phase
- **Purpose:** a coordinator sees all teachers & classes under the same סמל מוסד.
- **Components:** header with "תצוגת רכז" + avatar; title "מורי מדע וטכנולוגיה" +
  "חטיבת ביניים אורט רמת גן · סמל מוסד 540123"; **4 stat cards** (7 מורים / 4
  תוכניות הושלמו / 2 בתהליך / 1 טרם התחיל, color-coded); **layer filter chips**
  (הכול / ז׳ / ח׳); **teachers table** (מורה · שכבה/כיתות · סטטוס · שעות) with
  status chips הושלם (green) / בתהליך (mustard) / טרם התחיל (gray).

---

## Interactions & Behavior
- **Navigation:** התחלה → רישום → wizard (4 steps, הבא/הקודם) → (קיצוץ שעות, only
  if short) → התוצאה. "חזרה לעריכה" on the result returns to the wizard.
- **Wizard:** linear stepper with a 4-segment progress bar; per-step validation
  before "הבא" is enabled.
- **Validation:** empty/invalid fields show a red border + tint + inline message
  (see email example on Screen 2).
- **Loading:** brief loading state on Screen 2 while fetching school data from the
  status; show a build/generating state after "בנה תוכנית".
- **Hours trimming** appears conditionally (actual hours < required). Mandatory
  topics are locked (uncheckable); optional ones toggle; the progress meter
  ("הורדת A מתוך B") updates as items are unchecked, with required total met.
- **Toggles:** weekday pills and כן/לא segmented controls switch the selected
  pill bg to teal.
- **Stepper:** −/+ adjust the per-month model-task count.
- **Export:** "הורד PDF" and "ייצוא ל-Google Calendar" actions on the result.
- **Hover/active:** standard — primary buttons darken slightly; chips/cards may
  lift. (Not strictly specified; follow codebase conventions.)

## State Management
- `teacher`: { name, email, institutionCode } + fetched school name + status flag.
- `wizard`: { step (1-4), layer ('ז'|'ח'), classId, weeklyHours, scheduleFile,
  modelTaskDays[], modelTaskTimesPerMonth, hasLab, sciFair }.
- `plan`: generated result — array of months (name, color, hours, topics[],
  events[], modelTasks[]) + table rows (topic, hours, months, required/optional,
  assessment, initiatives) + alerts[].
- `trimming`: required vs available hours, optional-topic checked state, derived
  remaining-to-cut.
- `coordinator`: teachers[] (name, layer, classes, status, hours), layer filter.
- Data fetching: school lookup by סמל מוסד from "הסטטוס"; weekly-hours value from
  the status; plan generation from wizard inputs.

## Assets
- `assets/logo-misrad.png` — Ministry of Education logo (111×105, transparent),
  cropped from the user-provided combined logo image.
- `assets/logo-mada.png` — Science & Technology logo (84×97, transparent),
  cropped from the same source.
- Both included in this handoff folder. All other graphics are inline SVG icons
  (upload, check, alert, lock, calendar, download, chevron) — recreate with the
  codebase's icon library (e.g. lucide/heroicons); shapes are simple and standard.

## Files
- `מסכי תוכנית עבודה.dc.html` — the full HTML mockup of all 8 frames (included).
- `assets/logo-misrad.png`, `assets/logo-mada.png` — logos (included).

To preview: open the `.dc.html` in a browser. It is a horizontally/vertically
laid-out canvas of all frames; pan to see each screen.
