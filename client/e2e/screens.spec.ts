import { expect, test } from '@playwright/test';

import { frameIndex } from './frames';

const PLATES = [
  { mode: 'learn', pick: (f) => (f.lesson as { step: number } | null)?.step === 2, title: 'STEP 2', sub: 'THE TERMS' },
  { mode: 'learn', pick: (f) => (f.question as { number: number } | null)?.number === 3, title: 'CHECK 3', sub: 'OF 3' },
  { mode: 'sparring', pick: (f) => (f.question as { number: number } | null)?.number === 2, title: 'QUESTION 2', sub: 'OF 5' },
  { mode: 'debate', pick: (f) => f.stage === 'crossexam', title: 'ROUND 3', sub: 'CROSS-EXAMINATION' },
] as const;

for (const plate of PLATES) {
  test(`the plate reads ${plate.title} ${plate.sub}`, async ({ page }) => {
    await page.goto(`/?mock=${plate.mode}&frame=${frameIndex(plate.mode, plate.pick as never)}`);
    await expect(page.locator('.round-plate__title')).toHaveText(plate.title);
    await expect(page.locator('.round-plate__stage')).toHaveText(plate.sub);
  });
}

test('the learn report offers the next rungs, and a click only asks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // the whole finish at once
  const said: string[] = [];
  page.on('console', (m) => m.type() === 'info' && said.push(m.text()));
  await page.goto(`/?mock=learn&frame=${frameIndex('learn', (f) => f.stage === 'verdict')}`);

  // The banner, not the screen reader's copy of the same words.
  await expect(page.locator('.decision__banner')).toHaveText("YOU'VE GOT IT");
  await page.getByRole('button', { name: 'SPAR WITH IT' }).click();
  expect(said).toContain('Let me spar with it: question me on this theory.');
  // The screen is the server's to change; a click alone leaves the report up.
  await expect(page.locator('.decision__title')).toHaveText('THE REPORT');

  await page.getByRole('button', { name: 'DEBATE WITH IT' }).click();
  expect(said).toContain('Let me debate with it.');
});

test('the explorer asks the guide once, however many times Enter is pressed', async ({ page }) => {
  // A venue session on 2026-10-14 sent "Tell me about Orchestrated Objective
  // Reduction" 25 times in 11 seconds: a held key, or clicks while the bot was slow.
  const said: string[] = [];
  page.on('console', (m) => m.type() === 'info' && said.push(m.text()));
  await page.goto('/?mock=explore&frame=2'); // the guide is on a card, and stays there

  await page.locator('.slot--focused').focus();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('Enter');
  // A change of mind while the guide is still answering is a cursor move, not another ask.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  expect(said.filter((line) => line.startsWith('Tell me about'))).toHaveLength(1);
  await expect(page.locator('.select__prompt')).toHaveText('Asking the guide…');
});
