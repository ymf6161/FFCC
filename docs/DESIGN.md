---
# gstack: design-md-format=spec
name: FFCC
description: Bold colour fields on warm stone. Each kind of money has its own colour, figures are set large in a characterful grotesque, and everything else stays quiet.
colors:
  paper: "#EDE8DF"
  card: "#FBF8F2"
  sunken: "#E4DED3"
  divider: "#E4DED3"
  border-strong: "#8A8278"
  text: "#1A1714"
  text-muted: "#625B52"
  ink: "#1A1714"
  on-ink: "#F6F1E7"
  on-ink-muted: "#B8B1A6"
  teal: "#0E4A47"
  on-teal: "#F6F1E7"
  on-teal-muted: "#B9D3CF"
  saffron: "#F3B33D"
  on-saffron: "#1A1714"
  plum: "#3A2148"
  on-plum: "#F6F1E7"
  on-plum-muted: "#D6C6DE"
  money-in: "#1B6B43"
  money-in-on-field: "#9FE3BE"
  success-tint: "#DCEFE2"
  warning: "#8F5600"
  warning-strong: "#6E4300"
  warning-tint: "#FBE7BE"
  error: "#B3261E"
  error-tint: "#F9E1DE"
  dark-paper: "#151311"
  dark-card: "#1F1C19"
  dark-sunken: "#2A2622"
  dark-divider: "#2E2A26"
  dark-border-strong: "#6E675E"
  dark-text: "#F1ECE3"
  dark-text-muted: "#A9A196"
  dark-ink: "#F1ECE3"
  dark-on-ink: "#151311"
  dark-teal-text: "#7FC8C1"
  dark-money-in: "#7DD3A2"
  dark-warning: "#F3B33D"
  dark-error: "#F28B82"
typography:
  figure-hero:
    fontFamily: Bricolage Grotesque
    fontWeight: 700
    fontSize: clamp(3rem, 2.4rem + 2.4vw, 4rem)
    lineHeight: 1
    letterSpacing: -0.035em
    fontFeature: tnum
    fontVariation: '"opsz" 96'
  figure:
    fontFamily: Bricolage Grotesque
    fontWeight: 700
    fontSize: 1.75rem
    lineHeight: 1.1
    letterSpacing: -0.02em
    fontFeature: tnum
  title:
    fontFamily: Bricolage Grotesque
    fontWeight: 800
    fontSize: 2rem
    lineHeight: 1.1
    letterSpacing: -0.02em
  heading:
    fontFamily: Bricolage Grotesque
    fontWeight: 700
    fontSize: 1.375rem
    lineHeight: 1.2
    letterSpacing: -0.01em
  subheading:
    fontFamily: Figtree
    fontWeight: 700
    fontSize: 1.125rem
    lineHeight: 1.3
  body:
    fontFamily: Figtree
    fontWeight: 400
    fontSize: 1.0625rem
    lineHeight: 1.55
  label:
    fontFamily: Figtree
    fontWeight: 500
    fontSize: 0.875rem
    lineHeight: 1.4
  amount:
    fontFamily: Figtree
    fontWeight: 700
    fontSize: 1.0625rem
    fontFeature: tnum
  hebrew:
    fontFamily: Noto Sans Hebrew
    fontWeight: 400
rounded:
  sm: 8px
  md: 12px
  lg: 20px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  tile-gap: 10px
  md: 16px
  tile-pad: 20px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.full}"
    height: 48px
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.full}"
    height: 48px
  input:
    backgroundColor: "{colors.card}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.md}"
    height: 48px
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  tile-cash:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.lg}"
  tile-questions:
    backgroundColor: "{colors.saffron}"
    textColor: "{colors.on-saffron}"
    rounded: "{rounded.lg}"
  tile-plan:
    backgroundColor: "{colors.plum}"
    textColor: "{colors.on-plum}"
    rounded: "{rounded.lg}"
  nav-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink-muted}"
    rounded: "{rounded.full}"
  nav-link-active:
    backgroundColor: "{colors.on-ink}"
    textColor: "{colors.ink}"
  focus-ring:
    color: "{colors.teal}"
    width: 3px
    offset: 2px
---

# FFCC

## Overview

**Creative North Star: Blocks.** Bold, flat colour fields on warm stone, like a well-designed Scandinavian bank. Each kind of money has its own colour, so the family learns where things live without reading: deep teal is cash, saffron is "needs you", plum is money set aside. Figures are set large in a characterful grotesque. Everything around the colour blocks is quiet.

**Product context:** a family finance app for Orthodox Jewish households in the UK. It keeps the books itself and only asks when it isn't sure. Users range from young couples to grandparents, some less confident with technology, some on kosher phones who use FFCC on a computer and answer questions by SMS. Screens and features are in `docs/BUILD_PLAN.md` section 6.

**Mode per surface:**
- Home, Plan, Reports: **Read**. A few colour tiles carrying the headline figures, detail underneath.
- Activity, Settings, import wizard, onboarding: **Operate**. Mostly neutral cards and lists; colour only for status.
- Questions inbox and digests: **Operate**, one decision at a time, on saffron.
- No marketing surface in v1.

**Key characteristics (first five seconds):**
- A big teal tile at the top of Home with available cash in large figures.
- A saffron tile you can't miss when there are questions, and that disappears when there aren't.
- Warm stone page, rounded tiles, a pill-shaped black navigation bar.
- Large, readable figures; every button and icon has a word.

**Preview:** three directions were compared on the same Home screen (Signal, Midnight, Blocks) in `docs/design-preview.html` (open it in a browser). Blocks was chosen. An earlier navy-on-paper "bank statement" proposal was rejected as too generic.

**What stayed from the brief:** colour carries meaning, no gradients, no illustrations or images of people, no dark patterns, large tap targets, plain warm wording, tabular figures and consistent £ formatting.

## Colors

**Strategy: committed area colours plus semantic colours.** Three deep "field" colours each own one kind of thing. Semantic colours (green, amber, red) sit on top and are only for meaning.

**Field colours and what they own:**

| Field | Owns | Used for |
| --- | --- | --- |
| Teal `teal` | Cash and the household's own money | Available cash tile, account balance headers, links, focus ring, progress fills, selected states, the main chart series |
| Saffron `saffron` | Things that need the family | Questions tile, unanswered-question banner, "Not sure" items, the question screen header. Saffron is the attention colour and doubles as "warning" |
| Plum `plum` | Money set aside | Set-aside tile on Home, Plan headers (reserves, ma'aser, goals), reserve progress |
| Ink `ink` | Actions and navigation | Primary buttons, the navigation bar, the Add button |

**Field rules:**
- At most three coloured tiles on any screen. Home uses all three; other screens use one at most, the one matching their area (Plan uses plum, the questions screen uses saffron, an account page uses teal). Activity, Reports and Settings are neutral cards with colour only for status.
- A tile is a flat field. No borders, shadows, gradients or patterns on tiles.
- Text on a field uses its `on-*` tokens. Never put ordinary ink text on teal or plum, or cream text on saffron.
- The saffron tile only appears when there is something to do. When there are no questions, Home shows a quiet line on a card instead ("All caught up. Nothing needs you today.").

**Neutrals:** `paper` (warm stone) is the page; `card` is lists, forms, dialogs; `sunken` is progress tracks, read-only fields and table header bands; `divider` separates list rows; `border-strong` outlines inputs and secondary buttons.

**Semantic colours:**
- `money-in` (green) for money in, with a `+`; "On track"; successful imports. On teal or plum tiles use `money-in-on-field`.
- `warning` / `warning-strong` / `warning-tint` (amber, from the saffron family) for "Not sure", "Needs a look", stale connections, a reserve behind plan. Badges use `warning-tint` with `warning-strong` text.
- `error` / `error-tint` (red) for genuine problems only: overdrawn, failed import, validation errors, destructive confirmations.

**Money colour rule:** money out is in the text colour, not red. Money in is green with `+`. Transfers between own accounts are muted with no sign. An ordinary week should look calm.

**Light or dark:** light (stone) is the default. Dark tokens are defined (`dark-*` in the front matter) and the field colours stay the same in dark, since teal, saffron and plum already work on a near-black page. Settings offers Light, Dark and Match device; the default is Light, so an older user never finds the app "gone black" by surprise. In dark, the primary button flips to cream with dark text, and links and focus use `dark-teal-text`.

**Contrast (checked, WCAG 2.1):** text on paper 14.6:1, muted 5.5:1, money-in 5.3:1, warning 4.9:1, error 5.4:1. Cream on teal 8.9:1, on plum 12.5:1, ink on saffron 9.6:1, cream on ink 15.9:1. Muted text on each field: 6.4:1 (teal), 8.7:1 (plum), 8.4:1 (nav). Badge pairs 5.2:1 or better. `border-strong` 3.1:1 on paper and 3.6:1 on card, so input outlines meet the 3:1 rule. Every dark pair is 6.6:1 or better for text and 3.3:1 for borders.

**Charts:** teal for the main series, `text-muted` at reduced opacity for the comparison period. Plan charts use plum. Categories are ranked horizontal bars in one colour, never a rainbow. Semantic colours only when the chart is about the meaning (over budget).

**shadcn/ui mapping** (CSS variables in `app/globals.css`; light under `:root`, dark under `.dark`):

| shadcn variable | Light token | Dark token |
| --- | --- | --- |
| `--background` | paper | dark-paper |
| `--foreground` | text | dark-text |
| `--card`, `--popover` | card | dark-card |
| `--card-foreground`, `--popover-foreground` | text | dark-text |
| `--primary` | ink | dark-ink |
| `--primary-foreground` | on-ink | dark-on-ink |
| `--secondary` | card | dark-card |
| `--secondary-foreground` | text | dark-text |
| `--muted` | sunken | dark-sunken |
| `--muted-foreground` | text-muted | dark-text-muted |
| `--accent` | sunken | dark-sunken |
| `--accent-foreground` | text | dark-text |
| `--destructive` | error | dark-error |
| `--border` | divider | dark-divider |
| `--input` | border-strong | dark-border-strong |
| `--ring` | teal | dark-teal-text |
| `--chart-1` | teal | dark-teal-text |
| `--chart-2` | text-muted | dark-text-muted |
| `--chart-3` | plum | on-plum-muted |

Extra variables registered in the Tailwind theme so classes like `bg-teal`, `text-on-teal`, `bg-saffron`, `text-money-in` and `bg-warning-tint` exist: `--teal`, `--on-teal`, `--on-teal-muted`, `--saffron`, `--on-saffron`, `--plum`, `--on-plum`, `--on-plum-muted`, `--money-in`, `--money-in-on-field`, `--success-tint`, `--warning`, `--warning-strong`, `--warning-tint`, `--error-tint`. Never hard-code a colour in a component.

## Typography

**Two families with clear jobs.**

- **Bricolage Grotesque** (Google Fonts, SIL Open Font License, variable with optical size) for figures, page titles and section headings. It has character at large sizes, which is where FFCC's personality lives: the big numbers. Use the `opsz` axis at its maximum (96) for hero figures and titles so the letterforms tighten up.
- **Figtree** (Google Fonts, SIL Open Font License) for body text, labels, buttons, inputs and amounts in lists. Clean, open and very readable at 14 to 17px.
- **Noto Sans Hebrew** as a fallback in both stacks, so Hebrew typed by the family (tags, event names, notes, merchant names) renders properly. User-entered text gets `dir="auto"`.

**Stacks:**
- Display: `"Bricolage Grotesque", "Noto Sans Hebrew", ui-sans-serif, "Segoe UI", sans-serif`
- Text: `"Figtree", "Noto Sans Hebrew", ui-sans-serif, "Segoe UI", Roboto, sans-serif`

**Loading:** `next/font/google`, self-hosted at build time. Bricolage Grotesque with the `opsz` axis and weights 500, 700, 800; Figtree 400, 500, 600, 700; Noto Sans Hebrew 400, 600. Exposed as `--font-display` and `--font-sans` and set in the Tailwind theme (`font-display`, `font-sans`).

**Tabular figures are mandatory for money.** Both Bricolage Grotesque and Figtree ship proportional figures by default and include `tnum` (verified in the font files). Every amount, balance, percentage and date column uses `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`). The `<Money>` component sets it.

**Scale** (root 16px; body is 17px for older eyes):

| Role | Face | Size / weight | Use |
| --- | --- | --- | --- |
| figure-hero | Bricolage | 48 to 64px / 700, tight | One per screen, on its field tile: available cash, a reserve's balance, net worth |
| title | Bricolage | 32px / 800 | Page titles |
| figure | Bricolage | 28px / 700 | Secondary tile figures: set aside, question count, month totals on Reports |
| heading | Bricolage | 22px / 700 | Section and card headings ("Recent", "Ma’aser") |
| subheading | Figtree | 18px / 700 | Transaction name in detail view, question text (19px) |
| body | Figtree | 17px / 400, line-height 1.55 | Everything else |
| amount | Figtree | 17px / 700 | Amounts in list rows and tables |
| label | Figtree | 14px / 500 | Labels, dates, metadata, table headers |

Nothing is smaller than 14px except badges (13px / 700, always with a word). Bricolage is never used below 22px or for running text. Headings get `text-wrap: balance`. Running text is capped at about 65 characters. Sentence case everywhere; no all-caps labels.

## Money formatting

All money is stored as integer pence (see `CLAUDE.md`). One helper, `formatMoney(pence, options)`, built on `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })`, and one `<Money>` component that uses it. No other code formats money.

- **Always pounds and pence:** `£1,234.56`, `£0.40`, `£12.00`, with comma thousands separators. Exception: whole-pound figures are allowed on secondary tiles (e.g. "Set aside £6,500") and in comparison sentences; the exact figure is always one tap away.
- **Money out:** true minus U+2212 before the pound sign, text colour: `−£86.40`. Never a hyphen, brackets or red.
- **Money in:** plus sign and green: `+£3,850.00`.
- **Transfers:** no sign, muted: `£500.00`.
- **Balances:** no sign when positive. A credit card balance reads "£842.10 owed". An overdrawn current account shows `−£120.00` in red with an "Overdrawn" badge.
- **Hero figures:** the pence are set at 45% size in the field's muted colour, aligned to the top of the pounds: £4,218<sup>.36</sup>. Pounds read at a glance; the exact figure is still there.
- **Comparisons in words:** "£214 less than September", not "−5.2%" or a red arrow.
- **Alignment:** amounts right-aligned in lists and tables.
- **Input:** amount fields accept `40`, `40.00`, `£40`, `40.5`; `inputmode="decimal"`; the parsed value is shown in £ on blur; conversion to pence goes through a Zod-validated parser. Errors say how to fix it: "That doesn’t look like an amount. Try something like 250.00."
- **Dates:** `16 Oct 2026`, or `16 Oct` within the current year, "Today", "Yesterday". Months in full in headings ("October 2026"). Day before month, always.
- **No count-up animations on figures.** A number that animates is wrong for most of its animation.

## Layout

**Phone first, then widen.** Design every screen at 375px.

- **Phone (below 1024px):** 12px outer margin around tiles, 16px for text-only screens (plus safe-area insets). Top row: the `ffcc` wordmark (or page title) on the left, a pill **Add** button (receipt, cash note, manual transaction) on the right. Content is a two-column tile grid with 10px gaps: full-width tiles for hero figures and lists, half-width tiles for paired figures (questions + set aside). A pill navigation bar in ink at the bottom with the five areas, words always visible, the active area as a cream pill. No floating action button.
- **Desktop (1024px and up):** a 248px left rail with the wordmark, Add button, the five areas as a vertical pill list in ink, and the questions count. Content up to 1120px wide, 32px gutters. Home becomes a bento grid: teal cash tile across two columns, saffron questions and plum set-aside tiles beside it, then Recent and Goals as cards below. Activity becomes a table inside a card.
- **Breakpoints:** Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280). Navigation switches at `lg`.
- **Spacing:** 4px base. Tile padding 20px on phone, 24px on desktop. 10px between tiles on phone, 16px on desktop. 16px between related items, 24px between groups, 32 to 48px between page sections.
- **Tap targets:** 48px minimum for buttons and inputs; 60px minimum for list rows; whole tiles are tap targets when they lead somewhere (questions tile opens the questions, set-aside tile opens Plan). 8px minimum between targets.
- **Home order:** cash tile (available cash, money in and out this month), questions tile and set-aside tile side by side, setup checklist (until onboarding is done), recent activity, goals.
- **Tiles are for headline figures, not for everything.** Lists, forms and detail views are plain cards. Never put a card inside a tile or a tile inside a card.
- **Tables on phone:** become list rows below `md`. Wide tables that must stay tables (CSV preview) scroll inside their own container.

## Elevation & Depth

Flat. Depth comes from colour fields against the stone page, not from shadows.

- Tiles and cards: no border, no shadow. Cards separate from the page by colour (`card` on `paper`).
- Popovers, menus, the Add sheet: `0 8px 24px rgb(26 23 20 / 0.14)`.
- Dialogs and bottom sheets: the same shadow over a `rgb(26 23 20 / 0.45)` scrim.
- No glows, gradients, blurred glass or inner shadows.

## Shapes

Soft and friendly, but consistent.

- `full` (pill): buttons, navigation bar and its items, badges, chips, segmented controls.
- `lg` 20px: tiles, cards, dialogs, bottom sheets (top corners only).
- `md` 12px: inputs, selects, list-row hover and selected fills inside a card, menu items.
- `sm` 8px: checkboxes, small swatches, progress tracks (or full).
- Nested rounded elements use outer radius minus the gap (a 20px card with 8px inner padding gives 12px inner rows).

Set shadcn's `--radius` to `1.25rem` (20px) and override button, badge and input radii as above.

## Components

All built from shadcn/ui primitives restyled through the tokens. Every interactive component has default, hover, `focus-visible` (3px teal ring, 2px offset, never removed), active, disabled (50% opacity, `not-allowed` cursor, with the reason nearby when it isn't obvious) and loading states.

- **Button.** Pill-shaped, 48px tall, 18 to 20px horizontal padding, Figtree 700. Primary: ink with cream text, for the one main action on a screen. Secondary: card with a `border-strong` outline. Quiet: text only in teal ("Not now", "Ask me later"). Destructive: error red, always confirmed in place with what will happen ("Undo this import? 214 transactions will be removed."). On a field tile, the primary button is cream with ink text. Labels are verbs that say what happens. Icons sit left of a word, never alone, except a dialog's close button (with an accessible label).
- **Field tile.** `<Tile tone="teal|saffron|plum">`. Label (on-*-muted, 15px) at the top, figure in Bricolage, optional supporting line or mini progress bar at the bottom. The whole tile is a link when it leads somewhere, with a visible focus ring.
- **Money.** `<Money pence={…} kind="in|out|transfer|balance" size="hero|figure|row" onField?={boolean} />`. Owns formatting, tabular figures, sign, colour and hero pence styling, and picks `money-in-on-field` when on a tile.
- **Transaction row.** Inside a card: merchant name (Figtree 600) with a status chip, category and date on the second line (14px muted), amount on the right (Figtree 700). Whole row is the tap target. Unconfirmed items show a saffron "Not sure" chip, never only a coloured dot.
- **Question card.** One question at a time, on a saffron header band. Question text at 19px / 700 with the amount and payee in it ("Was £100.00 to Tomchei Shabbos ma’aser?"), one line of context in muted text ("Paid from the current account on 12 Oct. Your answer applies to future payments to them too."), then pill answer buttons, full width on phone. Always an "Ask me later" option. After answering, a short confirmation ("Saved. We’ll file Tomchei Shabbos as ma’aser from now on.") and the next question.
- **Chip / badge.** Pill, 13px / 700, tint background with strong text, always a word: "Not sure", "On track", "Overdrawn", "Unconfirmed", "Refunded", "Transfer".
- **Notice.** Full-width rounded band in a tint (warning, success or error tint) with a sentence and at most one button. No side stripes.
- **Progress bar.** 8px tall pill. On a card: `sunken` track, teal fill (plum on Plan), green once the target is reached. On a field tile: 25% cream track, cream fill. Always with words beside it ("64% of £5,000 by 31 Jan").
- **Input, select, date.** 48px tall, 12px radius, `border-strong` outline on card background, label above (never placeholder-only), hint below in muted text, error below in red with what to do next.
- **Navigation.** Phone: ink pill bar, five items with icon and word, active item as a cream pill with ink text. Desktop: the same as a vertical list in an ink rail. Questions count as a saffron count badge.
- **Stepper (onboarding, import wizard).** "Step 2 of 11: Add your accounts", a teal progress bar, a "Save and finish later" quiet button on every step, Back always available.
- **Setup checklist.** A card with rows: a tick or an empty circle and a word ("Done", "To do"), not colour alone.
- **Empty states.** Text only, no illustrations: what will appear here and the one action that fills it ("No transactions yet. Import a bank statement to get started." with an "Import a CSV" button).
- **Loading.** Skeleton tiles and rows in `sunken` matching the final layout. Long jobs show real progress in words: "Sorted 1,204 of 1,830 transactions. You can leave this page; we’ll keep going."
- **Errors.** What happened and what to do, without apology words or blame: "We couldn’t read this file. It may not be a CSV. Try exporting it again from your bank."
- **Toasts.** Only to confirm an action just taken, ink pill above the navigation, 5 seconds, with Undo where possible. Nothing important lives only in a toast.

## Voice and wording

Plain British English, calm and modest. Like a careful family bookkeeper explaining something across the kitchen table. The colour is bold; the words are not.

- "Money in" and "money out" on everyday screens; "income" and "spending" in reports and settings.
- "Available cash" for the headline; "Set aside" for reserves in the UI ("reserves" is fine in settings).
- Spell it ma’aser with a typographic apostrophe. Use the family's own words for charities and events; never translate or "correct" them.
- Questions are short and answerable in one word: "Reply 1 for Household, 2 for Gifts".
- No exclamation marks, no emoji, no "Oops", "Awesome", "supercharge". No guilt: never "You overspent!", instead "Money out was £214 more than September."
- No urgency to drive engagement. No streaks, no engagement badges, no red dots to pull people back.
- Sentence case for everything, including buttons and headings.
- SMS and email follow the same voice, start with "FFCC:", and fit one SMS (160 characters) per question where possible.

## Imagery and icons

- No illustrations, photos or images of people. No mascots. No decorative shapes. The colour fields are the decoration.
- Icons: lucide (shadcn's default), 20 to 24px, 2px stroke, in their label's colour, always with a word. The five areas: house, list, wallet, bar chart, settings.
- Wordmark: "ffcc" in lower case, Bricolage Grotesque 800, ink (cream on dark). No symbol until one is designed properly.

## Accessibility

- WCAG 2.2 AA as the floor. Contrast figures are in Colors.
- Works at 200% text zoom and at 320px width without horizontal scrolling (data tables scroll in their own container). Tiles reflow to one column when text is enlarged.
- State is never shown by colour alone: every coloured state has a word or a sign (+, −). The field colours always come with a label ("Available cash", "3 questions waiting", "Set aside").
- Focus always visible. Logical tab order. Every form control has a visible label.
- Respect `prefers-reduced-motion` and the OS text size.
- `lang="en-GB"`; user-entered text gets `dir="auto"` so Hebrew displays right to left.

## Do's and Don'ts

- Do show amounts only through `<Money>`, in tabular figures, right-aligned in lists.
- Do keep each field colour to its meaning: teal for cash, saffron for things that need the family, plum for money set aside.
- Do keep money out in the text colour and money in green with `+`; transfers muted with no sign.
- Do label every icon, tile and coloured state with words.
- Do use 48px minimum for controls and 60px for list rows; make tiles that lead somewhere fully tappable.
- Don't use more than three field tiles on a screen, or a field colour for decoration.
- Don't use red for ordinary spending, or show the saffron tile when nothing needs doing.
- Don't use gradients, shadows on tiles or cards, glass effects, illustrations, mascots or images of people.
- Don't nest cards and tiles, or add a coloured stripe to the edge of anything.
- Don't use a floating action button, swipe-only actions, or long-press as the only way to do something.
- Don't animate numbers, show percentages without the amounts behind them, or use urgency to get attention.

## Motion

- **Approach:** minimal-functional. Motion only shows where something came from or went.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 100ms (press, toggle), short 150 to 200ms (menus, toasts, tile press), medium 250ms (sheets and dialogs). Nothing longer.
- **Tile press:** scale to 0.98 for 100ms. No hover lift.
- **Reduced motion:** all transitions become instant or a simple fade.
- **The one authored moment:** when the last question is answered, the saffron tile folds away (250ms) and the set-aside tile widens to fill the row, leaving "All caught up. Nothing needs you today." No confetti.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 16 Oct 2026 | Initial design system created | /design-consultation from the client brief and `docs/BUILD_PLAN.md`; no competitive research or outside voices |
| 16 Oct 2026 | Rejected navy-on-paper "bank statement" proposal | Client found it too standard; asked for something modern, sleek and out of the box |
| 16 Oct 2026 | Chose "Blocks" over "Signal" (Swiss, typographic) and "Midnight" (dark-first) | Bold colour fields give a distinctive look and help less confident users find their way by colour |
| 16 Oct 2026 | Field colours: teal = cash, saffron = needs you, plum = set aside; ink for actions | Each colour owns one meaning; saffron doubles as the warning family |
| 16 Oct 2026 | Bricolage Grotesque for figures and headings, Figtree for text | Character where the numbers are, plain readability everywhere else; `tnum` verified in both font files |
| 16 Oct 2026 | Money out shown in text colour, not red | Ordinary spending should look calm; red is kept for genuine problems |
| 16 Oct 2026 | Noto Sans Hebrew in the fallback stacks, `dir="auto"` on user text | Families will type Hebrew tags, event names and notes |
| 16 Oct 2026 | Light by default; Dark and Match device available in Settings | Avoids surprising less confident users; field colours work on both |
| 16 Oct 2026 | Labelled pill Add button in the top row, no floating action button | Easier to find and understand |
