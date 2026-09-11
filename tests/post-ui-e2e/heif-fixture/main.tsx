import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18n from '../../../i18n';
import { MediaPicker } from '../../../components/media/MediaPicker';
import type { MediaDraft } from '../../../types';
import { mediaDraftsAreReady, readyMediaAssetIds } from '../../../utils/mediaDrafts';
import { authFetch } from '../../../services/api';

const lang = new URLSearchParams(location.search).get('lang') === 'ar' ? 'ar' : 'en';
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
await i18n.changeLanguage(lang);

function Fixture() {
  const [drafts, setDrafts] = useState<MediaDraft[]>([]);
  const [mounted, setMounted] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<number | undefined>();
  const [submission, setSubmission] = useState('idle');
  return <>
    {mounted && <MediaPicker purpose="POST" value={drafts} onChange={setDrafts} maxFiles={8} multiple aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio} />}
    <button type="button" onClick={() => setMounted(false)}>Close picker</button>
    <button type="button" disabled={!drafts.length || !mediaDraftsAreReady(drafts)} onClick={async () => {
      const response = await authFetch('/api/heif-fixture/posts', {
        method: 'POST', body: JSON.stringify({ mediaAssetIds: readyMediaAssetIds(drafts), mediaAspectRatio: aspectRatio })
      });
      const result = await response.json();
      setSubmission(response.ok ? 'accepted' : result.code);
    }}>Submit fixture</button>
    <output hidden data-testid="drafts">{JSON.stringify(drafts.map(({ file, ...draft }) => ({ ...draft, name: file?.name })))}</output>
    <output hidden data-testid="asset-ids">{JSON.stringify(readyMediaAssetIds(drafts))}</output>
    <output hidden data-testid="aspect-ratio">{aspectRatio}</output>
    <output data-testid="submission">{submission}</output>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
