import { RTVIEvent } from '@pipecat-ai/client-js';
import {
  PipecatClientProvider,
  usePipecatClient,
  usePipecatClientMediaTrack,
  usePipecatClientTransportState,
  useRTVIClientEvent,
} from '@pipecat-ai/client-react';
import '@fontsource/press-start-2p';
import '@fontsource/vt323';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BotAudioOutput } from '@/components/pipecat/bot-audio';

import { DEFAULT_TRANSPORT, TRANSPORT_FACTORIES, TRANSPORT_PROPS } from '../config';
import { usePipecatApp } from '../hooks/use-pipecat-app';
import './arcade.css';
import { decisionBanners, nextSpoken } from './battleText';
import type { Spoken } from './battleText';
import { CrtOverlay } from './components/CrtOverlay';
import { LiveRegion } from './components/LiveRegion';
import { Stage } from './components/Stage';
import { useAudioLevel } from './hooks/useAudioLevel';
import { useSuperFlare } from './hooks/useHitEffects';
import { startMockReplay } from './mock';
import { ROUND_LABELS, VERSUS_MS, nextSplash, screenFor, splashKey } from './screen';
import type { SplashState } from './screen';
import { pickLine } from './selection';
import { DecisionScreen } from './screens/DecisionScreen';
import { FightScreen } from './screens/FightScreen';
import { SelectScreen } from './screens/SelectScreen';
import { TitleScreen } from './screens/TitleScreen';
import { VersusScreen } from './screens/VersusScreen';
import { useArcadeStore } from './store';
import type { TheoryCard } from './types';

/**
 * Transport states that mean the bot is live, and the ones that mean an
 * attempt is in flight. Both mirror the scaffold's own reading of the
 * transport in src/components/pipecat/connect-button.tsx (DISCONNECT_STATES
 * at line 139, TRANSITIONAL_STATES at line 130); `connected` is the narrower
 * of the two so the title screen can show CONNECTING… while it happens.
 */
const LIVE_STATES = ['connected', 'ready'];
const BUSY_STATES = ['initializing', 'authenticating', 'authenticated', 'connecting'];

/**
 * What the polite live region says on each screen. On the fight screen the
 * round banner and the hit lines are read here rather than from a second live
 * region — the same words, once, in the order they appear on screen;
 * `fightText` is worked out by the view, which knows what was last read out.
 */
const announce = (
  screen: ReturnType<typeof screenFor>,
  snapshot: ReturnType<typeof useArcadeStore.getState>['snapshot'],
  fightText: string
): string => {
  if (screen === 'title') return '';
  if (!snapshot) return ROUND_LABELS.setup;
  if (screen === 'fight') return fightText;
  if (screen === 'versus') {
    return `${snapshot.user.theory_name ?? 'You'} versus ${snapshot.bot.theory_name ?? 'the house'}`;
  }
  const lines = [ROUND_LABELS[snapshot.stage]];
  if (screen === 'decision' && snapshot.verdict) {
    lines.push(...decisionBanners(snapshot), snapshot.verdict.rationale);
  }
  return lines.filter(Boolean).join('. ');
};


/** What the REMATCH button says, as if the player had asked out loud. */
const REMATCH_LINE = "I'd like a rematch.";

interface ViewProps {
  connected: boolean;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  /** Live audio levels, 0..1. Zero on every path with no Pipecat client. */
  userLevel?: number;
  botLevel?: number;
  mock?: boolean;
  /** Sends the select screen's pick. */
  onPick: (mine: TheoryCard, house: TheoryCard | null) => void;
  /** Asks for another debate from the decision screen. */
  onRematch: () => void;
}

/**
 * The arcade root: the stage, whichever screen the server's state calls for,
 * and the CRT. The screen is never stored — `screenFor` derives it.
 */
const ArcadeView = ({
  connected,
  busy,
  error,
  onStart,
  onPick,
  onRematch,
  userLevel = 0,
  botLevel = 0,
  mock = false,
}: ViewProps) => {
  const snapshot = useArcadeStore((s) => s.snapshot);
  const cards = useArcadeStore((s) => s.cards);
  const hitCount = useArcadeStore((s) => s.hitCount);

  // The versus splash is the one screen that needs time as well as state: see
  // `nextSplash`. Applied during render like `spoken` below; the timer only
  // ever ends a hold, so it cannot fight the server's state.
  const [splash, setSplash] = useState<SplashState>({ seen: null, holding: null });
  const splashed = nextSplash(splash, splashKey(snapshot));
  if (splashed !== splash) setSplash(splashed);
  const holding = splash.holding;
  useEffect(() => {
    if (!holding) return;
    const timer = window.setTimeout(
      () => setSplash((state) => ({ ...state, holding: null })),
      VERSUS_MS
    );
    return () => window.clearTimeout(timer);
  }, [holding]);

  const fromState = screenFor(connected, snapshot);
  const screen = holding && fromState === 'fight' ? 'versus' : fromState;
  // The fire belongs to the stage, which is mounted here rather than in the
  // fight screen, so the super-effective flare is lifted to this level.
  const flare = useSuperFlare(hitCount, snapshot?.last_hit ?? null);

  // What the live region last read out, and the words that went with it, so a
  // stage change reads the banner and a hit within the same stage does not.
  // `nextSpoken` is a render-time update — React re-renders straight after a
  // state change made during render — but it is pure and returns the SAME
  // object when nothing changed, so this bails out via setState's own
  // Object.is check instead of re-deriving (and losing) the text on every
  // render. See its doc comment for the regression that shape guards against.
  const [spoken, setSpoken] = useState<Spoken>({ announced: null, text: '' });
  const advanced = nextSpoken(spoken, snapshot, hitCount);
  if (advanced !== spoken) setSpoken(advanced);

  return (
    <div className="arcade">
      <Stage
        dim={screen !== 'fight'}
        fire={screen === 'decision' ? 'dim' : flare && screen === 'fight' ? 'flare' : 'idle'}
      />
      <div className="arcade-screen">
        {screen === 'title' && <TitleScreen onStart={onStart} busy={busy} error={error} />}
        {screen === 'select' && (
          <SelectScreen snapshot={snapshot} cards={cards} onPick={onPick} />
        )}
        {screen === 'versus' && snapshot && <VersusScreen snapshot={snapshot} cards={cards} />}
        {screen === 'fight' && snapshot && (
          <FightScreen
            snapshot={snapshot}
            hitCount={hitCount}
            userLevel={userLevel}
            botLevel={botLevel}
            mock={mock}
          />
        )}
        {screen === 'decision' && snapshot && (
          <DecisionScreen snapshot={snapshot} onRematch={onRematch} mock={mock} />
        )}
      </div>
      <LiveRegion text={announce(screen, snapshot, spoken.text)} />
      <CrtOverlay />
    </div>
  );
};

/**
 * Lives inside PipecatClientProvider: feeds every server message to the store,
 * reads the transport, and forgets the debate when the session ends.
 */
const ArcadeSession = ({
  error,
  onStart,
}: {
  error: string | null;
  onStart: () => void;
}) => {
  const receive = useArcadeStore((s) => s.receive);
  const clear = useArcadeStore((s) => s.clear);

  // The scaffold's console hands this callback the message body unwrapped
  // (console.tsx:380-385), so it is passed straight to the store, which
  // ignores anything that is not one of the two messages it knows.
  useRTVIClientEvent(
    RTVIEvent.ServerMessage,
    useCallback((data: unknown) => receive(data), [receive])
  );

  // usePipecatClient() -> PipecatClient | undefined
  // (node_modules/@pipecat-ai/client-react/dist/index.d.ts:360); sendText is
  // PipecatClient.sendText(content, options?) => Promise<void>
  // (node_modules/@pipecat-ai/client-js/dist/index.d.ts:1278), called the same
  // way by the scaffold at src/components/pipecat/text-input.tsx:187.
  const client = usePipecatClient();
  const onPick = useCallback(
    (mine: TheoryCard, house: TheoryCard | null) => {
      void client?.sendText(pickLine(mine, house));
    },
    [client]
  );
  const onRematch = useCallback(() => {
    void client?.sendText(REMATCH_LINE);
  }, [client]);

  const transportState = usePipecatClientTransportState();
  const connected = LIVE_STATES.includes(transportState);
  const busy = BUSY_STATES.includes(transportState);

  // usePipecatClientMediaTrack(trackType, participantType) -> MediaStreamTrack | null
  // (node_modules/@pipecat-ai/client-react/dist/index.d.ts:363; the scaffold
  // uses the same call for the bot at src/components/pipecat/bot-audio.tsx:60).
  // These hooks need the provider, so they live here and not in ArcadeView,
  // which also renders on the ?mock and still-booting paths.
  const userLevel = useAudioLevel(usePipecatClientMediaTrack('audio', 'local'));
  const botLevel = useAudioLevel(usePipecatClientMediaTrack('audio', 'bot'));

  useEffect(() => {
    if (!connected) clear();
  }, [connected, clear]);

  return (
    <>
      <ArcadeView
        connected={connected}
        busy={busy}
        error={error}
        onStart={onStart}
        onPick={onPick}
        onRematch={onRematch}
        userLevel={userLevel}
        botLevel={botLevel}
      />
      <BotAudioOutput />
    </>
  );
};

export const ArcadeApp = () => {
  const mock = useMemo(
    () => new URLSearchParams(window.location.search).has('mock'),
    []
  );

  const app = usePipecatApp({
    transportType: DEFAULT_TRANSPORT,
    transportFactory: TRANSPORT_FACTORIES[DEFAULT_TRANSPORT],
    ...TRANSPORT_PROPS[DEFAULT_TRANSPORT],
    initDevicesOnMount: false,
  });

  const { connect } = app;
  const onStart = useCallback(() => {
    void connect();
  }, [connect]);

  // Bumped by the mock rematch: the effect below stops the running replay and
  // starts a fresh one from the title of the fixture.
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    if (!mock) return;
    return startMockReplay();
  }, [mock, replay]);

  // ?mock replays the fixtures with no server and no client of any kind.
  if (mock) {
    // No provider on this path, so nothing is sent: the pick is logged, and a
    // rematch replays the fixture instead of asking the bot for one.
    return (
      <ArcadeView
        connected
        busy={false}
        error={null}
        onStart={() => {}}
        onPick={(mine, house) => console.info(pickLine(mine, house))}
        onRematch={() => setReplay((n) => n + 1)}
        mock
      />
    );
  }

  // The transport module is still loading; show the title screen, mid-boot.
  if (!app.client) {
    return (
      <ArcadeView
        connected={false}
        busy
        error={app.error}
        onStart={() => {}}
        onPick={() => {}}
        onRematch={() => {}}
      />
    );
  }

  return (
    <PipecatClientProvider client={app.client}>
      <ArcadeSession error={app.error} onStart={onStart} />
    </PipecatClientProvider>
  );
};
