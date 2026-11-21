# UI checklist

<!-- Exercise 4 hands this in. Tick an item only when you have checked it, and replace
     the "how I checked" line with what you actually did. An unticked box is not a
     failure: it is a gap you then write into READINESS.md. A ticked box you cannot
     demonstrate at the defence is worse than an unticked one. -->

"Modern" is not a style. It is a short list of things a user notices when they are
missing: the screen tells you what is happening, you can get through it with a keyboard,
the text is readable, and nothing jumps around while it loads.

## Layout and typography

- [x] **One spacing scale and one type scale.** Sizes come from a small set of design tokens, not from numbers typed where they were needed.
  - how I checked: every colour, size, spacing, font size, radius and shadow is a token in `public/tokens.css`; `styles.css` has no other number except the two breakpoints (see Measurements). No screenshot: the evidence is the code.
- [x] **Responsive at 380, 768 and 1280 pixels wide.** No horizontal scrollbar, no text running under another element.
  - how I checked: local test server, headless Chrome: the Day view at 380 (a card per workstation), 768 and 1280 (the grid), with no horizontal scroll at any width ([380](ui/day-380.png), [768](ui/day-768.png), [1280](ui/day-1280.png)); 54 page measurements in Measurements.
- [x] **Nothing jumps while the page loads.** Images and cards reserve their space before their content arrives.
  - how I checked: local test server: on My bookings the placeholders start 172 px from the top and the list replaces them at the same 172 px ([loading](ui/loading.png), [content](ui/content.png)).

## The four states, on every screen

A screen that only handles "it worked" is a screen that lies to the user on the day it matters.

- [x] **Loading.** Something tells the user the app is working, within about 100 ms.
  - how I checked: local test server, My bookings with the bookings request held: three grey placeholders, the region marked `aria-busy`, a visually hidden "Loading your bookings…" ([loading](ui/loading.png)). The placeholders are in the HTML, so they show before any script runs.
- [x] **Empty.** The screen says what this list is for and what to do next, instead of showing nothing.
  - how I checked: local test server, My bookings as a student with no bookings: "You have no upcoming bookings." and a "Pick a free slot" button ([empty](ui/empty.png)).
- [x] **Error.** A sentence a person can read. Never a raw JSON body, never a stack trace, never just "Error".
  - how I checked: local test server, My bookings with the request failed as offline: the red "!" box "Could not reach the server. Check your connection and try again." and "Try again" ([error](ui/error.png)).
- [x] **Success.** The user can see that what they did took effect, without reloading the page to find out.
  - how I checked: local test server, My bookings: after Cancel, the green ✓ "Cancelled NL-03 on Mon 23 Nov, 14:00–16:00." and the list went from 2 bookings to 1 in the same page, no reload ([success](ui/success.png)).

## Keyboard and accessibility

- [x] **The main flow works with the keyboard alone.** Sign in, do the core action, sign out, without touching the mouse.
  - how I checked: local test server, keys only: Tab ×3 to Email and type, Tab to Password and type, Enter; Tab ×3 to "Day", Enter; Tab ×32 to the first "Book", Enter ("✓ Booked GL-01 on Monday 23 November, 12:00–14:00."); Shift+Tab ×25 to "Sign out", Enter, back on /login ([the Book button focused](ui/keyboard-book.png), [booked by keyboard](ui/keyboard-booked.png)).
- [x] **The focused element is visible.** A `:focus-visible` outline that is not switched off.
  - how I checked: local test server: a 3 px solid ring on the Email field after Tab ([login focus](ui/login-focus.png)) and on a Book button ([keyboard](ui/keyboard-book.png)); 45 Tab stops on the Day view all draw it (Measurements).
- [x] **Text contrast is at least 4.5:1.** Name the tool you measured with.
  - how I checked: `node scripts/ui/contrast.mjs` (WCAG 2.2 formula on the tokens; all 24 required pairs pass in both themes, table in Measurements); on the local test server the muted intro line measures 7.20:1 ([contrast](ui/contrast.png)).
- [x] **Every input has a label** a screen reader reads, not just placeholder text.
  - how I checked: local test server: Chrome's accessibility tree gives the Email input the role textbox and the name "Email" from its `<label>` ([label](ui/login-label.png)); every input on every page has a `<label for>`.
- [x] **The page has a correct `<title>` and `lang`.**
  - how I checked: local test server: `<html lang="en">` and `<title>Sign in · LabSpot</title>` read from the page ([title and lang](ui/login-title-lang.png)); every page has `lang="en"` and its own title.
- [x] **Touch targets are at least 44 pixels.**
  - how I checked: local test server: a Book button measures 113 × 44 px with getBoundingClientRect ([touch target](ui/touch-target.png)); every button and link button has `min-height: var(--touch-target)` (44px).

## The model feature

- [x] **It shows that it is thinking.** A model call is slow and a free service may have been asleep; a frozen button is the worst possible answer.
  - how I checked: local test server with a fake model that waits 4 s: the button reads "Finding a slot…" and is disabled ([thinking](ui/model-thinking.png)).
- [x] **It shows when it failed,** and the rest of the screen still works.
  - how I checked: local test server with a fake model that fails: "Suggestions are not available right now. Pick a free slot from the list below." with the day grid still below it ([failed](ui/model-failed.png)); and the local Docker image with no GEMINI_API_KEY: the same sentence, 30 blocks still shown ([key off](ui/model-key-off.png)).
- [x] **The user can tell the model's suggestion from a fact.** It is labelled as a suggestion, not presented as data the app knows.
  - how I checked: local test server with a fake model: the card is labelled "SUGGESTION" and has two parts, "Workstation features / From LabSpot's records" and "Why the model picked it / The model's own words" ([suggestion](ui/model-suggestion.png)).

## Decisions

- [x] **Dark mode, or a written decision not to have one.**
  - what I decided and why: dark mode, with the same token names and a second set of values; it follows the system setting (`prefers-color-scheme`) and the button in the top bar switches to the other theme. Contrast is measured in both themes. how I checked: local test server, the Day view after pressing the button ([dark](ui/dark.png)).

## Evidence

All screenshots were taken with `node scripts/ui/screenshots.mjs` on a **local test server** (the real app on an in-process test database with the test seed, a fixed clock and a fake model), not on the live site; `model-key-off.png` and `second-account.txt` come from the **local Docker image** with a throw-away database. A yellow box marked "Annotation" shows a fact that is not on the page itself.

The four states of My bookings:

![loading: placeholders while the bookings request is held](ui/loading.png)
![content: the list where the placeholders were](ui/content.png)
![empty: no upcoming bookings, with Pick a free slot](ui/empty.png)
![error: the request failed as offline](ui/error.png)
![success: a booking cancelled, without a reload](ui/success.png)

The model feature thinking, answering and failing:

![thinking: Finding a slot… on a disabled button](ui/model-thinking.png)
![suggestion: labelled, facts apart from the model's words](ui/model-suggestion.png)
![failed: the fallback with the day grid still below](ui/model-failed.png)
![key off: the local image without GEMINI_API_KEY](ui/model-key-off.png)

Keyboard, accessibility and layout:

![the Email field focused by Tab](ui/login-focus.png)
![the Email input's accessibility name](ui/login-label.png)
![the page's lang and title](ui/login-title-lang.png)
![a Book button focused by Tab](ui/keyboard-book.png)
![booked with the keyboard alone](ui/keyboard-booked.png)
![a Book button measured at 44 px](ui/touch-target.png)
![the intro line's contrast](ui/contrast.png)
![the Day view at 380 px](ui/day-380.png)
![the Day view at 768 px](ui/day-768.png)
![the Day view at 1280 px](ui/day-1280.png)
![the Day view in the dark theme](ui/dark.png)

Step 10 checks, also local: the Day view's request waterfall ([waterfall.txt](ui/waterfall.txt)) and the second-account cancel ([second-account.txt](ui/second-account.txt)).

## Measurements

<!-- Recorded by the agent during the visual pass (Plan D), 2026-11-21. These are inputs for the
     checklist above, not ticks: each box is still yours to check and tick. -->

### Contrast, both themes

Tool: `node scripts/ui/contrast.mjs`, a small Node script using the WCAG 2.2 relative-luminance formula,
which reads the colour values straight from `public/tokens.css` (the light values in `:root`, the dark ones in the dark blocks),
so the table matches the file. Text needs 4.5:1. The edges of
controls and the focus ring need 3:1 (WCAG 1.4.11). Spot-check a few pairs in Chrome DevTools
(Inspect → the colour swatch → Contrast ratio).

| Pair | Used for | Light | Dark | Needs | Result |
|---|---|---|---|---|---|
| `text` on `bg` | body text on the page | 15.31:1 | 15.20:1 | 4.5:1 | pass |
| `text` on `surface` | text on a card | 16.56:1 | 13.50:1 | 4.5:1 | pass |
| `muted` on `bg` | intro lines, the cancelled booking | 7.20:1 | 8.71:1 | 4.5:1 | pass |
| `muted` on `surface` | muted text on a card, empty states, feature tags | 7.79:1 | 7.73:1 | 4.5:1 | pass |
| `muted` on `taken-bg` | neutral badge, time in a Taken block | 6.75:1 | 6.57:1 | 4.5:1 | pass |
| `muted` on `yours-bg` | time in a Yours block | 6.63:1 | 6.22:1 | 4.5:1 | pass |
| `text` on `taken-bg` | a Taken block | 14.36:1 | 11.47:1 | 4.5:1 | pass |
| `text` on `yours-bg` | a hovered chip, the suggestion card | 14.11:1 | 10.85:1 | 4.5:1 | pass |
| `primary-hover` on `yours-bg` | Yours, the Suggestion label | 8.16:1 | 8.18:1 | 4.5:1 | pass |
| `primary` on `bg` | a link on the page | 6.17:1 | 8.95:1 | 4.5:1 | pass |
| `primary` on `surface` | nav links, secondary buttons | 6.67:1 | 7.95:1 | 4.5:1 | pass |
| `primary` on `yours-bg` | a hovered nav link or secondary button | 5.68:1 | 6.39:1 | 4.5:1 | pass |
| `on-primary` on `primary` | a primary button, a pressed chip | 6.67:1 | 8.89:1 | 4.5:1 | pass |
| `on-primary` on `primary-hover` | a hovered primary button or pressed chip | 9.58:1 | 11.37:1 | 4.5:1 | pass |
| `error` on `error-bg` | an error notice (and its ! disc, reversed) | 6.50:1 | 7.54:1 | 4.5:1 | pass |
| `success` on `success-bg` | a success notice and badge (and the ✓ disc) | 5.77:1 | 8.98:1 | 4.5:1 | pass |
| `danger` on `surface` | the Cancel button | 7.43:1 | 8.10:1 | 4.5:1 | pass |
| `danger` on `danger-bg` | the Out of service badge | 6.50:1 | 7.54:1 | 4.5:1 | pass |
| `danger-hover` on `danger-bg` | a hovered Cancel button | 8.83:1 | 9.98:1 | 4.5:1 | pass |
| `border-strong` on `surface` | edges of inputs, chips, date fields on a card | 4.63:1 | 4.67:1 | 3:1 | pass |
| `border-strong` on `bg` | the date field on the page, chips in the editor panel | 4.28:1 | 5.25:1 | 3:1 | pass |
| `focus` on `bg` | focus ring on the page | 8.86:1 | 11.45:1 | 3:1 | pass |
| `focus` on `surface` | focus ring on a card | 9.58:1 | 10.17:1 | 3:1 | pass |
| `focus` on `yours-bg` | focus ring in the suggestion card | 8.16:1 | 8.18:1 | 3:1 | pass |
| `border` on `surface` | decorative lines only (card edges, dividers) | 1.55:1 | 1.42:1 | — | no requirement |

Before this pass, inputs and chips used `border` (1.55:1), below the 3:1 that WCAG 1.4.11 asks for.
They now use `border-strong`. Disabled buttons are dimmed and exempt.

### Breakpoints

Measured with `node scripts/ui/measure.mjs`: headless Chrome through the DevTools protocol, against a
separate test server (the real app on an in-process PGlite database with the test seed, a fixed clock and a fake model; not the
development database). Chrome drew a classic 15 px scrollbar on long pages, so a 768 px window has
753 px for the page.

| Breakpoint | What changes | Measured |
|---|---|---|
| 768px | Day view: below it, a card per workstation with 2 blocks per row (3 on wider phones); from it, one grid per lab (the workstation column plus 6 block columns, times on top) | At exactly 768 px the grid fits with no horizontal scroll. Forced on below that, it still fits at 744 px and overflows at 736 px (by 5 px), so 768 leaves 24 px to spare. |
| 1024px | Top bar: below it, the brand, the email, the theme button (symbol only) and Sign out on the first row and the nav on a second row; from it, one row, and the theme button shows its word | With the longest nav (staff, 5 links), the seeded email and the theme button, one row fits from 910 px and wraps at 900 px. Set at 1024 so that a longer real email still fits. A long email is cut with "…" (at 380 px the seeded one shows as "student@lab…"); the full email is in its tooltip and on the Account page. |

Responsive check: 9 page views (sign-in, labs, day as student and as staff, my bookings, account,
Not allowed, manage labs, all bookings) × 380, 768 and 1280 px × light and dark = 54 measurements.
None has a horizontal scrollbar or an element past the right edge.

### Other measured facts

- Loading: the region has `aria-busy="true"` and fixed-height placeholders. A visually hidden status
  line says what is loading. The shimmer animation is `none` under `prefers-reduced-motion: reduce`.
- Keyboard: 45 Tab presses through the day view (nav, date, suggestion, 16 chips, Book buttons). Every
  stop draws the 3 px focus ring.
- Theme: the system setting (`prefers-color-scheme`) by default. The button in the top bar of every
  page (sign-in included) switches to the other theme and names it ("☾ Dark" or "☀ Light",
  `aria-label` "Switch to the dark theme"). The pick is kept in this browser only when it differs
  from the system, so picking the system's theme again goes back to following it. Measured under a
  light and a dark system: a click switches, a reload keeps it, a second click returns to the system.
  `public/theme.js` is the first, blocking script in `<head>`, so a page never flashes the other
  theme. The dark values are written twice in `tokens.css` (system and picked); `test/tokens.test.js`
  fails if the two copies differ.
- Symbols (○ ● ★ – ✓ ! ⏸ ☾ ☀ and the chips' + / ✓) are `aria-hidden`. The word next to each is what a
  screen reader reads.
