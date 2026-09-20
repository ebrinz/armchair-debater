import { RTVIEvent } from '@pipecat-ai/client-js';
import {
  PipecatClientProvider,
  usePipecatClientTransportState,
  useRTVIClientEvent,
} from '@pipecat-ai/client-react';
import '@fontsource/press-start-2p';
import '@fontsource/vt323';
import { useCallback, useEffect, useMemo } from 'react';

import { BotAudioOutput } from '@/components/pipecat/bot-audio';

import { DEFAULT_TRANSPORT, TRANSPORT_FACTORIES, TRANSPORT_PROPS } from '../config';
import { usePipecatApp } from '../hooks/use-pipecat-app';
import './arcade.css';
import { battleLines } from './battleText';
import { CrtOverlay } from './components/CrtOverlay';
import { LiveRegion } from './components/LiveRegion';
import { Stage } from './components/Stage';
import { startMockReplay } from './mock';
import { ROUND_LABELS, screenFor } from './screen';
import { DecisionScreen } from './screens/DecisionScreen';
import { FightScreen } from './screens/FightScreen';
import { SelectScreen } from './screens/SelectScreen';
import { TitleScreen } from './screens/TitleScreen';
import { useArcadeStore } from './store';

/**
 * Transport states that mean the bot is live, and the ones that mean an
 * attempt is in flight. Both mirror the scaffold's own reading of the
 * transport in src/components/pipecat/connect-button.tsx (DISCONNECT_STATES
 * at line 139, TRANSITIONAL_STATES at line 130); `connected` is the narrower
 * of the two so the title screen can show CONNECTING… while it happens.
 */
const LIVE_STATES = ['connected', 'ready'];
const BUSY_STATES = ['initializing', 'authenticating', 'authenticated', 'connecting'];

/** What the polite live region says on each screen. */
const announce = (
  screen: ReturnType<typeof screenFor>,
  snapshot: ReturnType<typeof useArcadeStore.getState>['snapshot']
): string => {
  if (screen === 'title') return '';
  if (!snapshot) return ROUND_LABELS.setup;
  const lines = [ROUND_LABELS[snapshot.stage]];
  if (screen === 'fight' && snapshot.last_hit) lines.push(...battleLines(snapshot.last_hit));
  if (screen === 'decision' && snapshot.verdict) lines.push(snapshot.verdict.rationale);
  return lines.join('. ');
};

interface ViewProps {
  connected: boolean;
  busy: boolean;
  error: string | null;
  onStart: () => void;
}

/**
 * The arcade root: the stage, whichever screen the server's state calls for,
 * and the CRT. The screen is never stored — `screenFor` derives it.
 */
const ArcadeView = ({ connected, busy, error, onStart }: ViewProps) => {
  const snapshot = useArcadeStore((s) => s.snapshot);
  const cards = useArcadeStore((s) => s.cards);
  const hitCount = useArcadeStore((s) => s.hitCount);
  const screen = screenFor(connected, snapshot);

  return (
    <div className="arcade">
      <Stage dim={screen !== 'fight'} fire={screen === 'decision' ? 'dim' : 'idle'} />
      <div className="arcade-screen">
        {screen === 'title' && <TitleScreen onStart={onStart} busy={busy} error={error} />}
        {screen === 'select' && <SelectScreen snapshot={snapshot} cards={cards} />}
        {screen === 'fight' && snapshot && (
          <FightScreen snapshot={snapshot} hitCount={hitCount} />
        )}
        {screen === 'decision' && snapshot && <DecisionScreen snapshot={snapshot} />}
      </div>
      <LiveRegion text={announce(screen, snapshot)} />
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

  const transportState = usePipecatClientTransportState();
  const connected = LIVE_STATES.includes(transportState);
  const busy = BUSY_STATES.includes(transportState);

  useEffect(() => {
    if (!connected) clear();
  }, [connected, clear]);

  return (
    <>
      <ArcadeView connected={connected} busy={busy} error={error} onStart={onStart} />
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
    return <ArcadeView connected busy={false} error={null} onStart={() => {}} />;
  }

  // The transport module is still loading; show the title screen, mid-boot.
  if (!app.client) {
    return <ArcadeView connected={false} busy error={app.error} onStart={() => {}} />;
  }

  return (
    <PipecatClientProvider client={app.client}>
      <ArcadeSession error={app.error} onStart={onStart} />
    </PipecatClientProvider>
  );
};
