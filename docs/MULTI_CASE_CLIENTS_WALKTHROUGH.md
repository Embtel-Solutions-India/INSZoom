# One login, many cases — walkthrough on one test person (about 15 minutes)

Use ONE test e-mail you can read (for example a plus-address). Create only the cases below, and delete them from Admin at the end (Admin deletes a person's login too once they have no case left).

| # | Do this | You should see |
|---|---|---|
| 1 | Admin -> New case -> **H-4 EAD**, a new client e-mail | The case is created; the client gets ONE e-mail with a **set-password** link. Under the e-mail field there is no "already has cases" notice. The Case ID looks like **B###**. |
| 2 | Client portal: open the e-mail link, set a password, sign in, fill a few details (name, date of birth, A-number, passport number) and upload a **driver's licence** | Normal checklist; Save progress and Upload work as before. |
| 3 | Admin -> New case -> **I-765 EAD**, the SAME e-mail | A blue note: "*Name* already has 1 case. This new case will be added to the same login…". The case is created. |
| 4 | Check the client's e-mail | A **"Case Created - log in"** e-mail with the new Case ID and case type **"I-765 EAD"** — **no set-password link**. Its button opens the login page; after signing in you land on the **new** case. |
| 5 | Client portal, new case: open the checklist | The name / date of birth / A-number / passport answers and the driver's licence are already filled, each with a grey note "Pre-filled from your earlier case"; change one — its note disappears and the earlier case does not change. |
| 6 | Header of the Client portal | The case line is now a menu "**2 cases**". Switch to the first case: it shows its own answers, documents, messages, payments — nothing from the other case. Switch back. |
| 7 | Admin -> the person's case page | A strip "**Other cases for** *Name*" with the other case as a link. In the Cases list the type reads **I-765 EAD** (not I765EAD). |
| 8 | Admin -> New case -> any visa (for example **Naturalization**), the same e-mail | Third case, same login, again no set-password link. The portal menu says "3 cases". |
| 9 | Optional: in Admin open the new case's Forms | Forms fill from the copied answers like any case. |
| 10 | Delete the first (landing) case from Admin | The person can still sign in; the portal lands on a remaining case. |
| 11 | Delete the remaining test cases | The test login disappears with the last one. |

If anything differs, note the step number and what you saw. To switch the feature off at any time: set `MULTI_CASE_CLIENTS=false` and restart the backend (nothing is deleted).
