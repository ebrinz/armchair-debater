import { Armchair } from '../components/Armchair';
import { RoundPlate } from '../components/RoundPlate';
import { TheoryCardFace } from '../components/TheoryCardFace';
import '../fight.css';
import '../lesson.css';
import '../select.css';
import type { DebateSnapshot, TheoryCard } from '../types';

export interface LessonScreenProps {
  snapshot: DebateSnapshot;
  cards: TheoryCard[];
}

const STEPS = ['The idea', 'The terms', 'The case for it', "What it's up against"];

/**
 * THE LESSON: the theory's card beside the tutor's armchair, and a plate
 * saying which of the four steps this is. No bars — nothing is scored here.
 * Which step is showing comes from the server's `lesson` field alone.
 */
export const LessonScreen = ({ snapshot, cards }: LessonScreenProps) => {
  const card = cards.find((c) => c.id === snapshot.user.theory_id) ?? null;
  const step = snapshot.lesson?.step ?? 1;

  return (
    <div className="lesson">
      <header className="lesson__head">
        <h2 className="lesson__title pixel-text">The lesson</h2>
        <p className="lesson__sub">— {card?.name ?? snapshot.user.theory_name ?? 'a theory'} —</p>
      </header>

      <div className="lesson__plate">
        <RoundPlate snapshot={snapshot} />
      </div>

      <div className="lesson__body">
        <div className="lesson__card">{card && <TheoryCardFace card={card} cards={cards} locked />}</div>
        <div className="lesson__tutor">
          <Armchair
            side="bot"
            variant="champion"
            level={0}
            hurt={false}
            healed={false}
            health={100}
            theoryId={null}
          />
          <p className="lesson__name pixel-text">THE TUTOR</p>
        </div>
      </div>

      <ol className="lesson__steps" aria-label="Lesson steps">
        {STEPS.map((title, i) => (
          <li
            key={title}
            className={[
              'lesson__step',
              i + 1 === step ? 'lesson__step--now' : '',
              i + 1 < step ? 'lesson__step--done' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={i + 1 === step ? 'step' : undefined}
          >
            <span className="lesson__step-num pixel-text">{i + 1}</span>
            <span className="lesson__step-title">{title}</span>
          </li>
        ))}
      </ol>

      <p className="lesson__hint">
        Your mic is open: say “clear” or “go on” to move to the next step, or ask the tutor
        anything about this one.
      </p>
    </div>
  );
};
