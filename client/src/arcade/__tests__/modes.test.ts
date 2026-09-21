import { describe, expect, it } from 'vitest';

import { battleLines, decisionBanners, feltDamage, turnCue } from '../battleText';
import explore from '../fixtures/explore-state.json';
import debate from '../fixtures/debate-state.json';
import sparring from '../fixtures/sparring-state.json';
import { MODE_LINES, MENU_LINE, againLine } from '../modes';
import { ROUND_LABELS, plateFor, screenFor, splashKey } from '../screen';
import { useArcadeStore } from '../store';
import { isDebateSnapshot } from '../types';
import type { DebateSnapshot } from '../types';

const frames = {
  debate: debate as DebateSnapshot[],
  sparring: sparring as DebateSnapshot[],
  explore: explore as DebateSnapshot[],
};

describe('the contract’s three fixtures', () => {
  it('are all snapshots the client accepts, with the mode fields present', () => {
    for (const list of Object.values(frames)) {
      for (const frame of list) {
        expect(isDebateSnapshot(frame)).toBe(true);
        expect(frame).toHaveProperty('mode');
        expect(frame).toHaveProperty('focus');
        expect(frame).toHaveProperty('question');
      }
    }
  });

  it('still accepts a snapshot from a server that predates the modes, as a debate', () => {
    const old: Record<string, unknown> = { ...frames.debate.at(-1)! };
    for (const key of ['mode', 'focus', 'question']) delete old[key];
    expect(isDebateSnapshot(old)).toBe(true);
    const store = useArcadeStore.getState();
    store.clear();
    store.receive(old);
    expect(useArcadeStore.getState().snapshot).toMatchObject({ mode: null, focus: null, question: null });
  });

  it('rejects a mode or a question it cannot draw', () => {
    const good = frames.sparring.find((f) => f.question)!;
    expect(isDebateSnapshot({ ...good, mode: 'karaoke' })).toBe(false);
    expect(isDebateSnapshot({ ...good, question: { number: 'three', of: 5 } })).toBe(false);
    expect(isDebateSnapshot({ ...good, focus: 7 })).toBe(false);
  });
});

describe('which screen a mode shows', () => {
  it('opens on the mode select, whatever has or has not been chosen yet', () => {
    expect(screenFor(true, frames.debate[0])).toBe('mode');
    expect(screenFor(true, frames.debate[1])).toBe('mode');
  });

  it('runs sparring on the select, fight and decision screens, with no versus splash', () => {
    const seen = frames.sparring.map((f) => screenFor(true, f));
    expect([...new Set(seen)]).toEqual(['mode', 'select', 'fight', 'decision']);
    // Matched, but there is no second theory to set against it.
    const seated = frames.sparring.find((f) => f.stage === 'setup' && f.user.theory_id)!;
    expect(screenFor(true, seated)).toBe('select');
    expect(splashKey(seated)).toBeNull();
  });

  it('shows the explorer while exploring', () => {
    expect(frames.explore.slice(1).map((f) => screenFor(true, f))).toEqual([
      'explore',
      'explore',
      'explore',
      'explore',
    ]);
  });
});

describe('the round plate', () => {
  it('counts questions in sparring and rounds in a debate', () => {
    const third = frames.sparring.find((f) => f.question?.number === 3)!;
    expect(plateFor(third)).toEqual({ title: 'QUESTION 3', sub: 'OF 5', pips: 5, lit: 3 });
    const rebuttal = frames.debate.find((f) => f.stage === 'rebuttal')!;
    expect(plateFor(rebuttal)).toEqual({ title: 'ROUND 2', sub: 'REBUTTAL', pips: 4, lit: 2 });
  });

  it('labels the new stages', () => {
    expect(ROUND_LABELS.mode).toBe('CHOOSE YOUR GAME');
    expect(ROUND_LABELS.sparring).toBe('EXAMINATION');
    expect(ROUND_LABELS.explore).toBe('THE DECK');
  });
});

describe('sparring, in words', () => {
  const answer = frames.sparring.find((f) => f.last_hit && f.last_hit.recovery > 0)!.last_hit!;

  it('reads a scored answer as the examiner’s question, and gives the recovery to the player', () => {
    const lines = battleLines(answer, 'sparring');
    expect(lines[0]).toBe(`THE EXAMINER: "${answer.reason}"`);
    expect(lines.at(-1)).toBe(`YOU won some back!  +${answer.recovery}`);
    // The debate's wording is untouched.
    expect(battleLines(answer)[0]).toBe(`THE HOUSE used "${answer.reason}"`);
  });

  it('words the damage from the defender’s side', () => {
    const at = (damage: number) => battleLines({ ...answer, damage, recovery: 0 }, 'sparring')[1];
    expect(at(0)).toBe('Answered in full!');
    expect(at(5)).toBe('A scratch…  −5');
    expect(at(14)).toBe('That one landed.  −14');
    expect(at(15)).toBe('A hole in the view!  −15');
    expect(at(25)).toBe('A hole in the view!  −25');
    // Sparring scores at half the debate's scale, so a hit is felt at double:
    // the worst answer shakes the room as hard as the hardest blow.
    expect(feltDamage({ ...answer, damage: 25 }, 'sparring')).toBe(50);
    expect(feltDamage({ ...answer, damage: 25 }, 'debate')).toBe(25);
  });

  it('always hands the floor to the player', () => {
    expect(turnCue(null, 'sparring')).toBe('ANSWER THE EXAMINER');
    expect(turnCue(answer, 'sparring')).toBe('ANSWER THE EXAMINER');
  });

  it('calls the finding from the player’s bar alone', () => {
    const end = frames.sparring.at(-1)!;
    const at = (health: number) => ({ ...end, user: { ...end.user, health } });
    expect(decisionBanners(at(70))).toEqual(['YOUR VIEW HOLDS']);
    expect(decisionBanners(at(69))).toEqual(['SHAKEN']);
    expect(decisionBanners(at(40))).toEqual(['SHAKEN']);
    expect(decisionBanners(at(39))).toEqual(['IN TATTERS']);
    expect(decisionBanners(end)).toEqual([end.user.health >= 70 ? 'YOUR VIEW HOLDS' : 'SHAKEN']);
  });
});

describe('what the mode buttons say', () => {
  it('says each choice the way a person would', () => {
    expect(MODE_LINES).toEqual({
      debate: "Let's debate.",
      sparring: "I'd like to spar: test my view with questions.",
      explore: 'I want to explore the theories.',
    });
    expect(MENU_LINE).toBe('Take me back to the menu.');
  });

  it('asks for another go in the mode’s own terms', () => {
    expect(againLine('debate')).toBe("I'd like a rematch.");
    expect(againLine(null)).toBe("I'd like a rematch.");
    expect(againLine('sparring')).toBe("I'd like another round of questions.");
  });
});
