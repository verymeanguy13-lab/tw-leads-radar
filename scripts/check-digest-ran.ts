import { Resend } from "resend";
import { db } from "../lib/db";

// Digest watchdog (2026-09-03). Runs on its own independent schedule
// (.github/workflows/digest-watchdog.yml), separate from digest.yml,
// specifically so it can detect the failure mode digest.yml's own
// `if: failure()` alert step structurally cannot: GitHub Actions silently
// never triggering the scheduled workflow at all. When that happens there
// is no run object, so nothing inside digest.yml ever gets a chance to
// alert — this project hit that for real, 2026-09-01 to 09-02, with
// nothing anywhere flagging it at the time.
//
// The check itself is simple: does a digest_runs row exist from roughly
// the last day? scripts/run-digest.ts writes one every time it actually
// executes to completion, success or failure alike — so a missing row
// means the script never even started, which (given digest.yml has no
// other trigger) means the scheduled workflow didn't fire.
const ALERT_TO = process.env.ALERT_EMAIL || "verymeanguy13@gmail.com";

// digest-watchdog.yml is scheduled a few hours after digest.yml's own
// 23:00 UTC start, comfortable buffer past when it would normally finish
// (minutes, not hours). An 8-hour lookback window is generous enough to
// absorb ordinary cron jitter on both workflows without being so wide it
// could ever accidentally reach back into the PREVIOUS day's run (~24
// hours earlier) and mask a real gap.
const LOOKBACK_HOURS = 8;

async function main() {
  console.log(`Checking for a digest_runs row in the last ${LOOKBACK_HOURS} hours...`);

  const sql = db();
  const rows = await sql`
    SELECT id, status, started_at
    FROM digest_runs
    WHERE started_at > now() - make_interval(hours => ${LOOKBACK_HOURS})
    ORDER BY started_at DESC
    LIMIT 1
  `;

  if (rows.length > 0) {
    const row = rows[0] as { id: string; status: string; started_at: string };
    console.log(
      `OK: found digest_runs row ${row.id}, status="${row.status}", started_at=${row.started_at}. ` +
        `digest.yml ran as scheduled — nothing to alert on.`
    );
    process.exit(0);
  }

  console.error(
    `No digest_runs row found in the last ${LOOKBACK_HOURS} hours — the Digest workflow appears ` +
      `to not have run at all.`
  );

  const resend = new Resend(process.env.RESEND_API_KEY!);
  const result = await resend.emails.send({
    from: process.env.EMAIL_FROM!,
    to: ALERT_TO,
    subject: "tw-leads-radar: digest job did not run today",
    text:
      `The scheduled "Digest" GitHub Actions workflow does not appear to have run at all in the ` +
      `last ${LOOKBACK_HOURS} hours — no digest_runs row was logged by scripts/run-digest.ts.\n\n` +
      `This is not the same as the digest job running and failing (that already sends its own ` +
      `"digest FAILED" alert). This means the scheduled trigger itself silently didn't fire — the ` +
      `same thing that happened for real on 2026-09-01 and 09-02.\n\n` +
      `To recover: open the repo's Actions tab, find the "Digest" workflow, and use "Run workflow" ` +
      `to trigger it manually and send today's overdue digests. Then check its run history to see ` +
      `whether recent scheduled runs are missing entirely (vs. present but failed).`,
  });

  if (result.error) {
    console.error("Watchdog alert email failed to send:", result.error);
    process.exit(1);
  }

  console.log(`Watchdog alert email sent to ${ALERT_TO}.`);
  process.exit(1); // still exit non-zero so the Actions run itself shows red, as a second signal
}

main().catch((err) => {
  console.error("check-digest-ran crashed:", err);
  process.exit(1);
});
