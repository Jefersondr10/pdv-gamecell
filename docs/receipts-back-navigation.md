# Comprovantes and Back navigation

Scope: existing AtacadoApple application only. No WhatsApp changes, new data
tables, payment writes or changes to the financial comparison rule.

## Receipt review

The `overview` route and permission key are retained. The visible menu is now
**Comprovantes**. It compares receipt amounts to payments entered, not product
prices or a bank statement. The sales screen's payment-vs-sale comparison is a
different check. Cash is still included and explicitly disclosed.

Filters run before SQL totals and pagination: all, matched, divergent, pending
confirmation and missing receipts. Null amounts do not become discrepancies.
Opposing discrepancies across sales cannot cancel each other. Below/above
totals are separate. Background refresh observes pending files in the entire
period, including rows excluded by the selected filter. Images/PDFs are fetched
only when opened.

## Back navigation

The authenticated, successfully loaded app uses a bounded anchor/sentinel pair.
Back closes the top popup/dialog, returns through wizard steps, then previous
menus. A dialog that refuses closing while busy still consumes Back. Same-menu
selection does not remount a form. Permissions are rechecked before restoring a
menu. No customer or session data is stored in browser history.

At the root, leaving requires an explicit choice. It never calls logout. A
fresh standalone window might have no previous page: web code cannot reliably
close a PWA, so the exit action releases the history guard and instructs the
person to press native Back again or close the tab. Continuing restores the
guard. Initial load or bootstrap failure must not install the guard.

Closing a tab, force-quitting the phone app, OS memory eviction and selecting a
distant entry from the browser's history menu cannot be prevented reliably.
Existing draft/operation recovery remains the protection for interruptions.

## Verification

Automated: `test:app-back`, `test:overview`, TypeScript, lint, operation recovery,
upload preparation, permission, receipt reconciliation and sales-filter tests.
Run both deployment builds after the final source edits.

Device acceptance (still required; not claimed as performed by source tests):

- Android standalone and iPhone Safari: open nested details, close with Back,
  then return to the originating menu.
- Return through entry/sale steps with photos and filled fields; ensure they
  remain, including a pending serial lookup. Back during a save must not dismiss.
- Required guide and busy dialogs must refuse closing; Back on a select closes
  only the select. Keyboard focus must return to its trigger.
- Repeat Back on root, continue, explicitly leave, and cold-launch again.
  Bootstrap network failure must allow normal browser exit.
- Filter matched/different/pending receipts, advance pages, then complete OCR;
  totals update and an emptied later page returns to the first page.

Publication requires confirmation for the existing public audience. No live
business records are needed for these tests.
