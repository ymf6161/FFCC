# FFCC — Summary for the Technical Team

## Background

FFCC (Family Financial Control Centre) is a personal and family finance system that works like a business management system. It tracks where money is, where it comes from, where it goes, reserves (tax, ma'aser, emergency fund), goals, net worth and reports. The original brief lists the full feature set: accounts, transactions, categories, rules, reserves, goals, net worth, dashboard, reports, exports, audit trail and settings. All of it stays in scope.

## Key decision: AI-first, "bookkeeper" model

The main risk identified is that users abandon finance apps because manual entry and categorising feel like a second job. So the app does the work itself and only asks the user when it isn't sure. The client approved this direction.

The model has three parts:

### 1. One-off setup

- The user connects bank and card accounts via Open Banking.
- The app imports the past 6–12 months of transactions.
- AI categorises everything. Unknown vendors are identified by a web lookup, stored in a shared merchant database so each vendor is only looked up once.
- The user confirms at merchant level, not transaction level: regular shops, income sources and fixed monthly costs (mortgage, utilities, subscriptions).
- The app detects transfers between the user's own accounts and credit card payments, and the user confirms uncertain pairs.
- Every confirmation becomes a categorisation rule.

### 2. Runs automatically

- New transactions are categorised automatically, each with a confidence level.
- High confidence: filed automatically.
- Low confidence: added to a short question digest sent by SMS, email or WhatsApp, capped at around 5 questions. The user replies with a number, a word or Y/N.
- Each answer becomes a rule for next time.
- Unanswered questions fall back to the AI's best guess, marked "unconfirmed".

### 3. Optional detail, entered by the user

- Tags, events/projects and person tracking are entered manually by the user. The app does not infer or suggest them automatically.
- Stored receipts make occasional catch-up easier, so bulk tagging tools are worth supporting.

## Capture

- **Receipts:** photo upload or email forwarding. AI reads merchant, date, total and line items, then auto-matches the receipt to its bank transaction. Line items can be used to suggest splits.
- **Cash:** a withdrawal moves money into a cash wallet. The user records spending by text or voice note ("40 for the cleaner"), which AI converts into cash expenses. Any unexplained balance at month end becomes "general cash spending".

## Accounting rules

- Transfers and credit card payments are never counted as income or expense.
- Split transactions are supported across categories.
- Refunds are matched to the original purchase and reduce that expense, rather than counting as income.
- Reserves are virtual allocations on top of real accounts, not separate accounts. The dashboard shows "available (unallocated) cash".
- Ma'aser accrues automatically: income increases ma'aser owed by the chosen percentage, and charity payments reduce it. The exact rules are still to be confirmed.
- An audit trail is kept for all edits.

## User experience

- Typical daily effort: under a minute. That means answering a few questions, sending the occasional receipt photo or cash note, and nothing else.
- Dashboard: live balances, net worth, this period's income and spending, reserves, ma'aser owed and goals.
- Monthly summary: a short, clear recap of the month, compared with the previous month.
- Channels: SMS and email are the backbone, because some users have kosher phones without WhatsApp. WhatsApp is optional.

## Technical considerations

- **Open Banking:** needs a regulated aggregator. Connections need periodic re-consent.
- **AI usage:** categorisation, vendor lookup, receipt OCR, voice and text parsing. This is an ongoing per-user cost, reduced by the shared merchant database and learned rules.
- **Multi-user:** build users and permissions into the data model from day one, even though family logins come later.
- **Privacy and security:** bank data combined with AI is sensitive, so this needs strong security and clear messaging.

## Open items

- Ma'aser calculation rules: gross or net, which income counts, what counts as charity.
- Tax reserve method: flat percentage or estimate.
- Whether this is for one family or a product for the community, which affects pricing and onboarding.
- Financial year setting(s).
