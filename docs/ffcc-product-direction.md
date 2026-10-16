# FFCC — Product Direction: UX, Features & Core Workflows

Oct 6, 2026 · Yehoshua Fried

We propose one change to the original plan: FFCC should keep the books itself and only ask the family the odd question, instead of relying on them to enter everything. This note explains the problems we found, how the new approach solves them, and what a typical day looks like.

## The main problem

The original brief describes exactly the right result: a complete, business-grade picture of the family's money. But almost every feature depends on the family entering and sorting their transactions, week after week.

That is the point where most people give up. Finance apps are usually abandoned within a few months because keeping them up to date feels like a second job.

## The new approach

FFCC works like a good bookkeeper: it does the work, and only asks when it isn't sure.

1. **A one-off setup.** When the family connects their banks, FFCC downloads the past 6 to 12 months of transactions and sorts them using AI. For shops it doesn't recognise, it looks them up online. The family then confirms a short list: their regular shops, their income and their fixed monthly costs such as mortgage, utilities and subscriptions.
2. **Then it runs by itself.** Every new transaction is sorted automatically, using what it learnt at setup. Anything it isn't sure about becomes a short question sent by text, WhatsApp or email, answered with a single word or number. Every answer teaches it for next time.
3. **Extra detail is up to the family.** Tags, events and projects, such as a simcha or a holiday, are added by the family themselves, if and when they want to. Because receipts are already stored in the app, catching up on these every few weeks is quick and easy.

At any point the family can send a photo of a receipt, which FFCC reads and attaches to the right transaction. Cash spending can be sent the same way, as a short text or voice note.

## A typical day

Here is what a normal weekday looks like for a family using FFCC.

| Time | What happens | What the family does |
| --- | --- | --- |
| Morning | Yesterday's spending has already arrived and been sorted: Tesco under Groceries, Shell under Fuel, the phone bill under Mobile Phone. | Nothing |
| Midday | A card payment at a shop FFCC has never seen. It looks the shop up, finds it is a children's clothing store and files it under Clothing. | Nothing |
| Afternoon | £60 cash is withdrawn and moves into the family's cash wallet in the app. | Sends a voice note: "40 for the cleaner, 20 on taxis" |
| Afternoon | A shopping receipt is photographed at the till. FFCC reads it and attaches it to the matching card payment. | Takes a photo |
| Evening | FFCC sends one short message with the two things it wasn't sure about, for example: "£85 at J. Cohen Ltd: reply 1 for Household, 2 for Gifts" and "Was the £100 to Tomchei Shabbos ma'aser? Y/N". | Replies "1" and "Y", about 10 seconds |
| Any time | The app shows live balances, net worth, this month's spending and the ma'aser owed, all up to date. | Looks whenever they like |

On a typical day the family spends well under a minute on their finances. Once a month they get a short, clear summary of the month, compared with the month before.

## Other problems and how we solve them

| Problem | Solution |
| --- | --- |
| Moving money between your own accounts, or paying off a credit card, can be counted as spending twice. | FFCC recognises these transfers automatically, so they never appear as income or spending. |
| One shop often covers several categories, such as food and clothing in one supermarket trip. | Where a receipt is attached, FFCC suggests how to split the payment. |
| Refunds can look like income. | A refund is matched to the original purchase and reduces that spending instead. |
| Once cash is withdrawn, it disappears from view. | A cash wallet in the app, reduced by quick texts or voice notes. Anything not noted is shown as general cash spending. |
| Money set aside for tax, ma'aser or emergencies usually sits in the same account as everything else. | Reserves are tracked on top of the real accounts, so the family always sees how much is genuinely free to spend. |
| Working out ma'aser by hand is easy to fall behind on. | FFCC adds to the ma'aser owed whenever income arrives and reduces it when charity is paid. |
| Some families use kosher phones without WhatsApp. | Questions, receipts and notes also work by SMS and email. |
