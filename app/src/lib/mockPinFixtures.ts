// File contents behind the demo's pinned skills (browser mock only). Each skill has the
// shared copy as it is today and the version a project pinned earlier, so Compare with
// Shared has something real to show. Registered into COMPARE_FIXTURES by mockPins.ts.

import type { FixtureVersion } from "./mockCompare";

const md = (...lines: string[]) => lines.join("\n") + "\n";

// ── browser-qa: the shared copy gained a step and a new selector; acme-web pinned the old one ──

const BQ_FRONT = [
  "---",
  "name: browser-qa",
  "description: Drive a real browser through a release checklist: sign in, add to cart, check out, and capture screenshots and traces for every step. Use before tagging a release.",
  "---",
  "",
  "# Browser QA",
  "",
  "Walk the release checklist in a real browser and report what broke.",
  "",
  "## Before you start",
  "",
  "1. Start the app with `pnpm dev` and wait for `http://localhost:3000/healthz` to return 200.",
  "2. Make sure the test account from `.env.qa` exists. Never use a real customer account.",
  "",
  "## Steps",
  "",
];

const BQ_STEPS_PINNED = [
  "1. Run `scripts/run.sh smoke` to open the app in Chromium.",
  "2. Sign in with the test account and confirm the dashboard loads without console errors.",
  '3. Add the first product to the cart with `[data-test="add-to-cart"]`.',
  '4. Open the cart and press `[data-test="checkout-button"]`.',
  "5. Fill the payment form with the Stripe test card `4242 4242 4242 4242` and confirm the order page shows a reference number.",
  "6. Take a screenshot of every page you visited and save them in `qa-output/screenshots/`.",
];

const BQ_STEPS_SHARED = [
  "1. Run `scripts/run.sh smoke` to open the app in Chromium.",
  "2. Sign in with the test account and confirm the dashboard loads without console errors.",
  '3. Add the first product to the cart with `[data-testid="add-to-cart"]`.',
  '4. Open the cart and press `[data-testid="checkout-submit"]`.',
  "5. Fill the payment form with the Stripe test card `4242 4242 4242 4242` and confirm the order page shows a reference number.",
  "6. For any failing step, save a Playwright trace to `qa-output/traces/` and attach it to the report.",
  "7. Take a screenshot of every page you visited and save them in `qa-output/screenshots/`.",
];

const BQ_REPORT = [
  "",
  "## Report",
  "",
  "- One line per step: pass, fail, or skipped, with the page URL.",
  "- List every console error, with the step that caused it.",
  "- End with a verdict: safe to release, release with known issues, or blocked.",
];

const BQ_RUN_PINNED = md(
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "",
  'mode="${1:-smoke}"',
  'out="qa-output"',
  'mkdir -p "$out/screenshots"',
  "",
  'case "$mode" in',
  "  smoke)",
  "    npx playwright test --project=chromium --grep @smoke ;;",
  "  full)",
  "    npx playwright test --project=chromium ;;",
  "  *)",
  '    echo "usage: run.sh [smoke|full]" >&2; exit 2 ;;',
  "esac",
);

const BQ_RUN_SHARED = md(
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "",
  'mode="${1:-smoke}"',
  'out="qa-output"',
  'mkdir -p "$out/screenshots" "$out/traces"',
  "",
  'case "$mode" in',
  "  smoke)",
  "    npx playwright test --project=chromium --grep @smoke --trace retain-on-failure ;;",
  "  full)",
  "    npx playwright test --project=chromium --project=webkit --trace retain-on-failure ;;",
  "  *)",
  '    echo "usage: run.sh [smoke|full]" >&2; exit 2 ;;',
  "esac",
);

const BQ_CHECKLIST = md(
  "# Release checklist",
  "",
  "- [ ] Sign in and out",
  "- [ ] Add a product to the cart and remove it",
  "- [ ] Check out with a test card",
  "- [ ] Order confirmation email arrives in the test inbox",
  "- [ ] No console errors on any page",
);

export const BROWSER_QA: Record<string, FixtureVersion> = {
  shared: {
    modifiedDaysAgo: 3,
    edited: false,
    files: {
      "SKILL.md": md(...BQ_FRONT, ...BQ_STEPS_SHARED, ...BQ_REPORT),
      "checklist.md": BQ_CHECKLIST,
      "scripts/run.sh": BQ_RUN_SHARED,
    },
  },
  pinned: {
    modifiedDaysAgo: 12,
    edited: false,
    files: {
      "SKILL.md": md(...BQ_FRONT, ...BQ_STEPS_PINNED, ...BQ_REPORT),
      "checklist.md": BQ_CHECKLIST,
      "scripts/run.sh": BQ_RUN_PINNED,
    },
  },
};

// ── deploy-checklist: the shared copy is unchanged; acme-web edited its pinned copy ──

const DC_FRONT = [
  "---",
  "name: deploy-checklist",
  "description: Walk through the pre-deploy checklist for Acme services: changelog, migrations, staged rollout and rollback. Use when cutting a release.",
  "---",
  "",
  "# Deploy Checklist",
  "",
  "## Before tagging",
  "",
  "1. Confirm CI is green on the release branch.",
  "2. Check the changelog has an entry for every merged PR since the last tag.",
];

const DC_MIGRATIONS_SHARED = ["3. Confirm database migrations are backward compatible with the previous release."];
const DC_MIGRATIONS_PINNED = [
  "3. Confirm database migrations are backward compatible with the previous release.",
  "4. Confirm the `checkout_v2` feature flag is still off in production.",
];

const DC_DEPLOY_SHARED = [
  "",
  "## Deploy",
  "",
  "4. Tag the release `vX.Y.Z` and wait for the build to publish.",
  "5. Deploy to staging and run the smoke tests.",
  "6. Deploy to production in batches of 25%, watching error rates between batches.",
];
const DC_DEPLOY_PINNED = [
  "",
  "## Deploy",
  "",
  "5. Tag the release `vX.Y.Z` and wait for the build to publish.",
  "6. Deploy to staging and run the smoke tests.",
  "7. Deploy to production in batches of 10%, watching error rates between batches.",
];

const DC_AFTER_SHARED = [
  "",
  "## After",
  "",
  "7. Post the release notes in #releases.",
  "8. Keep the previous version ready for rollback for 24 hours.",
];
const DC_AFTER_PINNED = [
  "",
  "## After",
  "",
  "8. Post the release notes in #releases.",
  "9. Keep the previous version ready for rollback for 24 hours.",
];

const DC_ROLLBACK = md(
  "# Rollback",
  "",
  "1. Redeploy the previous tag from the CI dashboard.",
  "2. Revert any migration that is not backward compatible.",
  "3. Post in #releases that the release was rolled back, with the reason.",
);

export const DEPLOY_CHECKLIST: Record<string, FixtureVersion> = {
  shared: {
    modifiedDaysAgo: 20,
    edited: false,
    files: {
      "SKILL.md": md(...DC_FRONT, ...DC_MIGRATIONS_SHARED, ...DC_DEPLOY_SHARED, ...DC_AFTER_SHARED),
      "rollback.md": DC_ROLLBACK,
    },
  },
  pinned: {
    modifiedDaysAgo: 4,
    edited: true,
    files: {
      "SKILL.md": md(...DC_FRONT, ...DC_MIGRATIONS_PINNED, ...DC_DEPLOY_PINNED, ...DC_AFTER_PINNED),
      "rollback.md": DC_ROLLBACK,
    },
  },
};
