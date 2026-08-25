import { Resend } from "resend";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Session 20b (revised, 2026-08-23) — failure alerting for the
// industry-CSV refresh automation.
//
// Reuses the project's existing Resend setup (RESEND_API_KEY, EMAIL_FROM
// — already configured as GitHub Actions secrets since Session 5) rather
// than adding a second email-sending mechanism.
//
// Per the Session 5 corrections-log entry: resend.emails.send() does NOT
// throw on failure, it returns a result object with an .error field —
// this script checks that explicitly rather than assuming a resolved
// promise means the alert actually sent.

const FAILURES_FILE = join(__dirname, "..", "data", "industry-csv-refresh-failures.json");
const ALERT_TO = process.env.ALERT_TO_EMAIL || "verymeanguy13@gmail.com";

interface RefreshFailure {
  dataset_name: string;
  status: "failed";
  error?: string;
}

const REHARVEST_INSTRUCTIONS = `
The automated CSV refresh (scripts/refresh-industry-csv.ts) failed for
one or more datasets. This usually means GCIS changed something about
the download page (button text, page layout) that the automation's
click targets no longer match.

To investigate and fix, in order:

1. Open a terminal in your project folder (C:\\Users\\user\\projects\\tw-leads-radar)
   and run:
     npx tsx scripts/refresh-industry-csv.ts
   This re-runs the automation and will show you exactly which
   dataset(s) failed and the error message for each.

2. Open the failing dataset's page in a normal browser (the URL is in
   data/industry-csv-datasets.json, matched by dataset_name) and see
   what the download button actually looks like now. Compare it to
   what scripts/refresh-industry-csv.ts expects: a button/link with the
   exact text "CSV", then a popup with a button with the exact text
   "下載檔案".

3. If GCIS changed the button text or page structure, paste both the
   error message from step 1 and a screenshot of the actual page into
   a new conversation with Claude, along with this project's blueprint
   document, and ask for scripts/refresh-industry-csv.ts to be updated
   to match the new page.

4. Once fixed, re-run scripts/refresh-industry-csv.ts to confirm all
   110 datasets succeed, then scripts/backfill-industry-codes.ts to
   apply any newly-downloaded data.

Datasets that failed this run:
`.trim();

async function main() {
  if (!existsSync(FAILURES_FILE)) {
    console.log("No failures file found — nothing to alert on.");
    return;
  }

  let raw = readFileSync(FAILURES_FILE, "utf-8");
  // Strip UTF-8 BOM if present — PowerShell's Out-File -Encoding utf8
  // writes one, and JSON.parse fails on a leading BOM (same issue and
  // fix as parse-industry-csv.ts).
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  const failures: RefreshFailure[] = JSON.parse(raw);

  if (failures.length === 0) {
    console.log("Failures file is empty — refresh succeeded, no alert needed.");
    return;
  }

  const failureList = failures
    .map((f) => `  - ${f.dataset_name}${f.error ? `\n    Error: ${f.error}` : ""}`)
    .join("\n");

  const body = `${REHARVEST_INSTRUCTIONS}\n${failureList}`;

  const resend = new Resend(process.env.RESEND_API_KEY!);
  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: ALERT_TO,
    subject: `tw-leads-radar: industry CSV refresh failed (${failures.length} dataset${failures.length === 1 ? "" : "s"})`,
    text: body,
  });

  if (result.error) {
    console.error("Alert email failed to send:", result.error);
    process.exit(1);
  }

  console.log(`Alert email sent to ${ALERT_TO} for ${failures.length} failure(s).`);
}

main().catch((err) => {
  console.error("send-refresh-alert crashed:", err);
  process.exit(1);
});
