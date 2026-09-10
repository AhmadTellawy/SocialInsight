import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { usePostViewTracker } from '../../../hooks/usePostViewTracker';
import { clearSessionMetadata, getAuthSessionIdentity } from '../../../services/api';
import { GroupScreen } from '../../../components/GroupScreen';
import { TrendsScreen } from '../../../components/TrendsScreen';
import '../../../i18n';

type Card = { id: string; source: string; top: number; count: number };
declare global {
  interface Window { viewFixture: { actor(id: string | null): void; cards(cards: Card[]): void; position(top: number): void }; }
}

function TrackedCard({ card, index }: { card: Card; index: number }) {
  const ref = useRef<HTMLElement | null>(null);
  const { viewCount } = usePostViewTracker(card.id, ref, { sourceSurface: card.source, initialViewCount: card.count });
  useEffect(() => {
    // Independent native observation synchronizes tests with layout; the product
    // observer, timers, API and response handling are imported without patches.
    const observer = new IntersectionObserver(([entry]) => {
      ref.current!.dataset.ratio = String(entry.intersectionRatio);
    }, { threshold: [0, 0.4, 0.5, 1] });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return <article ref={ref} data-testid={`card-${index}`} data-actor={getAuthSessionIdentity() || 'guest'}
    style={{ position: 'fixed', top: card.top, left: 20, width: 200, height: 200, background: '#eef', border: '1px solid transparent', boxSizing: 'border-box' }}>
    <span>{card.id}</span><output data-testid={`count-${index}`}>{viewCount}</output>
  </article>;
}

function Fixture() {
  const [cards, setCards] = useState<Card[]>([]);
  const [, renderActor] = useState(0);
  const [selected, setSelected] = useState(false);
  const mode = new URLSearchParams(location.search).get('producer');
  const select = (id: string, source = 'FEED') => {
    setSelected(true);
    setCards([{ id, source, top: 200, count: 7 }]);
  };
  useEffect(() => {
    window.viewFixture = {
      actor(id) { clearSessionMetadata(); if (id) sessionStorage.setItem('si_auth_identity', id); renderActor(value => value + 1); },
      cards: setCards,
      position(top) { setCards(previous => previous.map(card => ({ ...card, top }))); },
    };
    document.body.dataset.ready = 'true';
  }, []);
  return <>
    {mode === 'trending' && !selected && <TrendsScreen onSurveyClick={select} />}
    {mode === 'group' && !selected && <MemoryRouter><GroupScreen
      group={{ id: 'fixture-group', name: 'Fixture group', visibility: 'Public', membershipStatus: 'JOINED', role: 'MEMBER', stats: { totalPosts: 1, totalMembers: 2 } } as any}
      userProfile={{ id: 'fixture-viewer', name: 'Fixture viewer', handle: 'fixture_viewer' } as any}
      onBack={() => {}} onPostClick={select} onVote={() => {}} /></MemoryRouter>}
    {cards.map((card, index) => <TrackedCard key={`${index}:${card.id}`} card={card} index={index} />)}
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
