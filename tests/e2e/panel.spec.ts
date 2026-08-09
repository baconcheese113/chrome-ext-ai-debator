import { expect, openMockTab, seatTab, test } from './fixtures';

/**
 * L4 — the whole machine: dashboard UI → background → orchestrator → content script → page.
 *
 * Every seat here is a local mock provider, so these tests are deterministic and need no
 * accounts. They prove the machine works; they cannot prove a real provider's selectors are
 * still valid. That is L5's job, and only L5's.
 */

const TOPIC = 'How should a solo developer price a compute-heavy SaaS?';

test.describe.configure({ mode: 'serial' });

test('runs a full panel to convergence', async ({ context, dashboard }) => {
  await openMockTab(context, 'mode=normal&words=90&speed=3&converge=yes');
  await openMockTab(context, 'mode=normal&words=90&speed=3&converge=yes');

  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();

  const rows = dashboard.locator('li').filter({ hasText: 'MOCK' });
  await expect(rows).toHaveCount(2);

  await rows.nth(0).locator('input.name').fill('Alpha');
  await rows.nth(0).locator('select').selectOption('participant');
  await rows.nth(1).locator('input.name').fill('Beta');
  await rows.nth(1).locator('select').selectOption('participant');

  await dashboard.locator('#topic').fill(TOPIC);
  await dashboard.locator('#conv').selectOption('self-report');
  await dashboard.getByRole('button', { name: 'Start panel' }).click();

  // Both mocks report CONVERGED: yes, so the panel should stop after one round.
  await expect(dashboard.locator('.chip.done')).toBeVisible({ timeout: 90_000 });
  // Scoped to the heading: the activity log also contains the text "Round 1".
  await expect(dashboard.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await expect(dashboard.locator('.turn')).toHaveCount(2);
  await expect(dashboard.locator('.turn').first()).toContainText('Alpha');
  await expect(dashboard.getByText('settled').first()).toBeVisible();
});

test('narrator summary is parsed and rendered', async ({ context, dashboard }) => {
  await openMockTab(context, 'mode=normal&words=60&speed=3&converge=yes');
  await openMockTab(context, 'mode=normal&words=60&speed=3&converge=yes');
  // The narrator mock replies with prose, not JSON, so this also proves a narrator that
  // ignores the contract degrades visibly instead of crashing the run.
  await openMockTab(context, 'mode=normal&words=60&speed=3');

  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();
  const rows = dashboard.locator('li').filter({ hasText: 'MOCK' });
  await expect(rows).toHaveCount(3);

  await rows.nth(0).locator('select').selectOption('participant');
  await rows.nth(1).locator('select').selectOption('participant');
  await rows.nth(2).locator('input.name').fill('Narrator');
  await rows.nth(2).locator('select').selectOption('narrator');

  await dashboard.locator('#topic').fill(TOPIC);
  await dashboard.getByRole('button', { name: 'Start panel' }).click();

  await expect(dashboard.locator('.chip.done')).toBeVisible({ timeout: 120_000 });
  await expect(dashboard.getByText("didn't return usable JSON")).toBeVisible();
});

test('a failing model raises an incident that can be recovered from', async ({ context, dashboard }) => {
  await openMockTab(context, 'mode=normal&words=90&speed=3&converge=yes');
  await openMockTab(context, 'mode=normal&words=90&speed=3&converge=yes');
  // Truncates mid-stream — the silent-corruption case, which must surface as a failure.
  await openMockTab(context, 'mode=truncate&words=900&speed=1');

  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();
  const rows = dashboard.locator('li').filter({ hasText: 'MOCK' });
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i++) await rows.nth(i).locator('select').selectOption('participant');
  await rows.nth(2).locator('input.name').fill('Flaky');

  await dashboard.locator('#topic').fill(TOPIC);
  await dashboard.getByRole('button', { name: 'Start panel' }).click();

  const incident = dashboard.locator('.incident');
  await expect(incident).toBeVisible({ timeout: 90_000 });
  await expect(incident).toContainText('Flaky');
  await expect(dashboard.locator('.chip.paused')).toBeVisible();

  await incident.getByRole('button', { name: 'Continue without it' }).click();

  await expect(dashboard.locator('.chip.done')).toBeVisible({ timeout: 90_000 });
  await expect(dashboard.locator('.turn')).toHaveCount(2);
});

test('a run always reaches a terminal state, never a stuck Running', async ({ context, dashboard }) => {
  // The worst failure the user hit. Asserted end to end, not just in the unit layer.
  await openMockTab(context, 'mode=normal&words=60&speed=3&converge=yes');
  await openMockTab(context, 'mode=normal&words=60&speed=3&converge=yes');
  await openMockTab(context, 'mode=silent');

  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();
  const rows = dashboard.locator('li').filter({ hasText: 'MOCK' });
  await expect(rows).toHaveCount(3);
  await rows.nth(0).locator('select').selectOption('participant');
  await rows.nth(1).locator('select').selectOption('participant');
  // The silent tab is the narrator — the exact shape that used to kill the run at round 0.
  await rows.nth(2).locator('select').selectOption('narrator');

  await dashboard.locator('#topic').fill(TOPIC);
  await dashboard.getByRole('button', { name: 'Start panel' }).click();

  const incident = dashboard.locator('.incident');
  await expect(incident).toBeVisible({ timeout: 120_000 });
  await incident.getByRole('button', { name: 'Continue without it' }).click();

  // Must finish the panel with the two working participants, not stall on Round 0.
  await expect(dashboard.locator('.chip.done')).toBeVisible({ timeout: 120_000 });
  // Scoped to the heading: the activity log also contains the text "Round 1".
  await expect(dashboard.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await expect(dashboard.locator('.turn')).toHaveCount(2);
});

test('Check adapters reports selector health without sending anything', async ({ context, dashboard }) => {
  const tab = await openMockTab(context, 'mode=normal');
  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();
  await dashboard.getByRole('button', { name: 'Check adapters' }).click();

  await expect(dashboard.locator('.checks')).toBeVisible();
  await expect(dashboard.locator('.pill.ok', { hasText: 'composer' })).toBeVisible();
  // A fresh thread has no replies, which must read as unknown rather than broken.
  await expect(dashboard.locator('.pill.unknown', { hasText: 'responses' })).toBeVisible();

  // The audit must be genuinely read-only: no message may have appeared in the thread.
  await expect(tab.locator('.msg')).toHaveCount(0);
});

test('Check adapters flags an adapter whose selectors match nothing', async ({ context, dashboard }) => {
  // Strip the composer the adapter expects — the exact shape of the Claude failure.
  const tab = await openMockTab(context, 'mode=normal');
  await tab.evaluate(() => document.getElementById('composer')?.remove());

  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();
  await dashboard.getByRole('button', { name: 'Check adapters' }).click();

  await expect(dashboard.locator('.pill.fail', { hasText: 'composer' })).toBeVisible();
  await expect(dashboard.locator('.chk.bad')).toBeVisible();
});

test('Diagnose copies candidate selectors for a seated tab', async ({ context, dashboard }) => {
  await openMockTab(context, 'mode=normal');
  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();

  const row = dashboard.locator('li').filter({ hasText: 'MOCK' }).first();
  await row.getByRole('button', { name: 'Diagnose' }).click();
  await expect(row.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('an armed capture fires by itself once the model starts answering', async ({ context, dashboard }) => {
  // Three real captures in a row came back without a send or stop button, because those
  // controls only exist for the seconds a model is generating and a hand-timed Diagnose
  // cannot reliably land there. The page has to watch for itself.
  const tab = await openMockTab(context, 'mode=normal&words=200&speed=25');
  await dashboard.bringToFront();
  await dashboard.getByRole('button', { name: 'Rescan' }).click();

  const row = dashboard.locator('li').filter({ hasText: 'MOCK' }).first();
  await row.getByRole('button', { name: 'Catch it answering' }).click();
  await expect(row.getByRole('button', { name: 'Waiting…' })).toBeVisible();

  // It must be waiting on the page, not on a timer. Nothing has been sent, so nothing may
  // have been captured — a fixed delay would satisfy every other assertion here by accident.
  await dashboard.waitForTimeout(4000);
  await expect(dashboard.locator('.held')).toHaveCount(0);

  // Now do what a person would do: go to the tab and send it something.
  await tab.bringToFront();
  await tab.locator('#composer').fill('hi');
  await tab.getByTestId('send-button').click();

  await dashboard.bringToFront();
  const held = dashboard.locator('.held');
  await expect(held).toBeVisible({ timeout: 30_000 });
  await expect(held).toContainText('while the model was answering');

  // The capture has to contain the control we came for. The mock's stop button exists only
  // while generating, so this asserts the timing landed — not merely that a capture happened.
  // Read from the rendered summary rather than the clipboard: extension pages are refused
  // clipboard READ access, which is also why the capture is held instead of auto-copied.
  await expect(held).toContainText('including a stop control');
  await expect(held).toContainText('composer markup');
});
