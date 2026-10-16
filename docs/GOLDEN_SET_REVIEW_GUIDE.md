# Golden Set Review — Guide for the Reviewer (admin@immiglance.com)

## What this is, in one minute

The system fills USCIS forms automatically from a client's data. Later, an AI helper will be allowed to *suggest* which client detail goes in which form box. Before that is ever allowed, we need an **answer key** — a list of form boxes where a trusted person has confirmed "this box is filled with exactly this". That answer key is the **golden set**. The AI will be graded against it and is only allowed to help if it scores almost perfectly.

You are the trusted person. The draft was built from the mappings already in use, written in plain words. **Your job is to check each one against the real USCIS form and say Right, Wrong or Not sure.**

Nothing you do here changes how any form is filled today. Your answers only grade the system.

## What you need

- A login for **admin@immiglance.com** with an Admin-portal staff role (admin, super admin or team lead). The account must be able to open the Admin portal.
- The official USCIS form PDF open next to the screen (uscis.gov → Forms), to check each box.
- About 4–6 hours in total. You can stop and continue any time; every answer is saved the moment you give it.

## Step by step

1. Sign in to the **Admin portal** as admin@immiglance.com.
2. Open **Form Governance** from the menu.
3. Click **Show Golden Set Review** (top right of the page).
4. You see a progress bar ("Answered 0 of 424") and a small button for each form (I-129, I-130 …) with how many you have answered.
5. The list starts on **Not answered yet**. For each card:
   - Read: *Form and place* (e.g. "Form I-130 – Part 2, Item 14, page 2"), *The box on the form is*, *This box is about* (who: employer, worker, sponsor, relative…), *We fill it with*, and when shown *How it is written*, *Only when*, *If that is empty we use*.
   - Read the **Example**: fictional client Maria Gonzalez (worker/relative) and Daniel Carter (employer/sponsor). It shows what the box would contain for them. If a box depends on a condition, the example says "(for a client where this applies)".
   - Find that box in the official PDF and decide:
     - **Right** — the box really should contain that. Click **Right**. Saved immediately.
     - **Wrong** — click **Wrong**, then write what the box should contain instead (e.g. "the employer's last name, not the worker's"). A short note is optional. Click **Save "Wrong"**. This is required; it is how we find real mistakes.
     - **Not sure** — you cannot tell. Click **Not sure**. You must later turn every "Not sure" into Right or Wrong before signing off. Ask a colleague or check USCIS instructions.
6. The card disappears from the "Not answered" list once answered. Use **Marked Not sure / Marked Wrong / Marked Right / All boxes** to look at your earlier answers and change any of them.
7. Use the search box to find a word, and the form buttons to work one form at a time.
8. When every box is answered and no "Not sure" is left, the **Sign off** panel at the bottom shows the confirmation box. Tick it and click **Sign off the golden set**. It records your email, the time, and an exact fingerprint of the list you checked.
9. Optional: **Spreadsheet** downloads everything with your answers (opens in Excel) — useful for a second person's review or for your records.

## What counts as "Right"

Be strict. Right means: the box, for that kind of case, should contain exactly that detail, for that person (employer vs. worker; sponsor vs. relative), in that format. If the person is the wrong one (e.g. employer's name in a worker box) it is **Wrong** even if the wording looks fine.

## The rules the system enforces

- Only the reviewer addresses (default **admin@immiglance.com**, configurable with the server setting `GOLDEN_SET_REVIEWERS`, comma-separated) can answer or sign off. Other staff (admin, super admin, team lead) can look but see no answer buttons.
- Sign-off is refused until: every box is answered, none is "Not sure", and the entries marked **Right** still meet the plan's minimum (300+ entries, 25+ of each box type — text, date, tick box, drop-down — and at least 3 forms in each of the employment, family and single-applicant groups, including the held-back form).
- If the draft list is ever regenerated and a box's wording changes, your old answer for that box stops counting and the sign-off shows **out of date**. You review only the changed boxes and sign again.

## What is in the draft

| | |
|---|---|
| Boxes | 424 across 14 forms |
| Employment forms | I-129, I-140, I-907, I-485 Supplement J |
| Family forms | I-130, I-129F, I-485, G-325A |
| Single-applicant forms | I-765, I-131 (held back), I-90, I-539, I-824 |
| General | G-28 |
| Box types | 267 text, 46 date, 67 tick box, 44 drop-down |

**Held-back form (I-131):** its boxes are in the list and reviewed like the others, but the AI is never shown them while learning; it is tested on them to prove it can handle a form it has never seen.

## What happens after you sign off

1. Your answers are stored: **Right** entries become the official answer key. **Wrong** entries are a bug list — each says which live mapping is incorrect and what it should be; developers fix those (separate, approved change).
2. The AI-suggestion phase (Phase 4) stays locked until a test shows the AI matches the answer key ≥ 99% with **zero** wrong-person mistakes. Without your sign-off that test cannot run.
3. You do not need to do anything else. If new forms are added later, a new draft is generated and you review only what is new.

## Who built what / who does what

| Built (done) | Asked of the reviewer |
|---|---|
| Draft answer key, 424 plain-language entries, with examples | Check each against the official PDF |
| Review screen in Admin → Form Governance, progress, filters, search | Answer Right / Wrong (+ correction) / Not sure |
| Reviewer-only answering, saved immediately, change-your-mind allowed | Resolve every "Not sure" |
| Sign-off with email, time, fingerprint, out-of-date detection | Tick the confirmation and sign off |
| Spreadsheet export | Optionally share it for a second opinion |

For developers: regenerate the draft with `node src/scripts/buildGoldenSetDraft.js` (read-only against the database; writes `Backend/src/modules/form-mapping/golden/goldenSet.draft.json` and `docs/golden-set/GOLDEN_SET_DRAFT.csv`). API: `/api/golden-set/{summary,entries,entries/:id/review,sign-off,export.csv}`. Models: `GoldenSetReview`, `GoldenSetSignOff`.
