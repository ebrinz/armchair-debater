import { expect, test } from '@playwright/test';

import { frameIndex } from './frames';

// Every screen where a character speaks must move that character's mouth.
const SPEAKING_SCREENS = [
  { name: 'the lesson tutor', mode: 'learn', pick: (f) => f.stage === 'lesson' },
  { name: 'the check', mode: 'learn', pick: (f) => f.stage === 'check' },
  { name: 'the learn report', mode: 'learn', pick: (f) => f.stage === 'verdict' },
  { name: 'a debate round', mode: 'debate', pick: (f) => f.stage === 'rebuttal' },
  { name: 'the debate verdict', mode: 'debate', pick: (f) => f.stage === 'verdict' },
  { name: 'the sparring finding', mode: 'sparring', pick: (f) => f.stage === 'verdict' },
] as const;

for (const screen of SPEAKING_SCREENS) {
  test(`the bot's mouth moves on ${screen.name}`, async ({ page }) => {
    const frame = frameIndex(screen.mode, screen.pick as never);
    await page.goto(`/?mock=${screen.mode}&frame=${frame}&talk=bot`);
    await expect(page.locator('.armchair--bot.armchair--talking')).toBeVisible();
  });

  test(`the bot is silent on ${screen.name} when nobody talks`, async ({ page }) => {
    const frame = frameIndex(screen.mode, screen.pick as never);
    await page.goto(`/?mock=${screen.mode}&frame=${frame}`);
    await expect(page.locator('.armchair--bot')).toBeVisible();
    await expect(page.locator('.armchair--talking')).toHaveCount(0);
  });
}

test("the player's mouth moves in a debate round", async ({ page }) => {
  const frame = frameIndex('debate', (f) => f.stage === 'rebuttal');
  await page.goto(`/?mock=debate&frame=${frame}&talk=user`);
  await expect(page.locator('.armchair--user.armchair--talking')).toBeVisible();
});
