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
import { fightAnnouncement } from './battleText';
import type { Announced } from './battleText';
import { CrtOverlay } from './components/CrtOverlay';
import { LiveRegion } from './components/LiveRegion';
import { Stage } from './components/Stage';
import { useAudioLevel } from './hooks/useAudioLevel';
import { useSuperFlare } from './hooks/useHitEffects';
import { startMockReplay } from './mock';
import { ROUND_LABELS, screenFor } from './screen';
import { DecisionScreen } from './screens/DecisionScreen';
import { FightScreen } from './screens/FightScreen';
import { SelectScreen } from './screens/SelectScreen';
import { TitleScreen } from './screens/TitleScreen';
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
  const lines = [ROUND_LABELS[snapshot.stage]];
  if (screen === 'decision' && snapshot.verdict) lines.push(snapshot.verdict.rationale);
  return lines.filter(Boolean).join('. ');
};

/** What clicking a theory card says, as if the player had typed it. */
const pickLine = (card: TheoryCard) => `My view is ${card.name}.`;

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
  onPick: (card: TheoryCard) => void;
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
  userLevel = 0,
  botLevel = 0,
  mock = false,
}: ViewProps) => {
  const snapshot = useArcadeStore((s) => s.snapshot);
  const cards = useArcadeStore((s) => s.cards);
  const hitCount = useArcadeStore((s) => s.hitCount);
  const screen = screenFor(connected, snapshot);
  // The fire belongs to the stage, which is mounted here rather than in the
  // fight screen, so the super-effective flare is lifted to this level.
  const flare = useSuperFlare(hitCount, snapshot?.last_hit ?? null);

  // What the live region last read out, and the words that went with it, so a
  // stage change reads the banner and a hit within the same stage does not.
  // The text is worked out in the same render-time update that records what
  // was announced: React re-renders straight after a state change made during
  // render, so text derived from `announced` afterwards would always compare
  // the snapshot with itself and say nothing.
  const [spoken, setSpoken] = useState<{ announced: Announced | null; text: string }>({
    announced: null,
    text: '',
  });
  const nextAnnounced: Announced | null = snapshot ? { stage: snapshot.stage, hitCount } : null;
  if (
    nextAnnounced?.stage !== spoken.announced?.stage ||
    nextAnnounced?.hitCount !== spoken.announced?.hitCount
  ) {
    setSpoken({
      announced: nextAnnounced,
      text: snapshot ? fightAnnouncement(spoken.announced, snapshot, hitCount) : '',
    });
  }

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
        {screen === 'fight' && snapshot && (
          <FightScreen
            snapshot={snapshot}
            hitCount={hitCount}
            userLevel={userLevel}
            botLevel={botLevel}
            mock={mock}
          />
        )}
        {screen === 'decision' && snapshot && <DecisionScreen snapshot={snapshot} />}
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
    (card: TheoryCard) => {
      void client?.sendText(pickLine(card));
    },
    [client]
  );

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

  useEffect(() => {
    if (!mock) return;
    return startMockReplay();
  }, [mock]);

  // ?mock replays the fixtures with no server and no client of any kind.
  if (mock) {
    // No provider on this path, so nothing is sent: the pick is logged instead.
    return (
      <ArcadeView
        connected
        busy={false}
        error={null}
        onStart={() => {}}
        onPick={(card) => console.info(pickLine(card))}
        mock
      />
    );
  }

  // The transport module is still loading; show the title screen, mid-boot.
  if (!app.client) {
    return (
      <ArcadeView connected={false} busy error={app.error} onStart={() => {}} onPick={() => {}} />
    );
  }

  return (
    <PipecatClientProvider client={app.client}>
      <ArcadeSession error={app.error} onStart={onStart} />
    </PipecatClientProvider>
  );
};
