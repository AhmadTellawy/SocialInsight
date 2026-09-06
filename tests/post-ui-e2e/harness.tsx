import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { CreatePollScreen } from '../../components/CreatePollScreen';
import { CreateSurveyModal } from '../../components/CreateSurveyModal';
import { CreateQuizModal } from '../../components/CreateQuizModal';
import { CreateChallengeScreen } from '../../components/CreateChallengeScreen';
import i18n from '../../i18n';
import { SurveyCard } from '../../components/SurveyCard';
import { SurveyQuestion } from '../../components/Survey/SurveyQuestion';
import { MediaCarousel } from '../../components/media/MediaCarousel';
import { SurveyType, type Survey, type MediaPresentation } from '../../types';

const params = new URLSearchParams(location.search);
document.documentElement.dir = params.get('dir') || 'ltr';
void i18n.changeLanguage('en');
const picture = (color: string, width = 800, height = 500) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${width / 2}" cy="${height / 2}" r="100" fill="white"/></svg>`)}`;
const media: MediaPresentation[] = ['#2563eb', '#0d9488', '#b45309'].map((color, i) => ({ id: `image-${i}`, access: 'PUBLIC', src: picture(color, i === 1 ? 500 : 800, i === 1 ? 800 : 500), width: i === 1 ? 500 : 800, height: i === 1 ? 800 : 500, aspectRatio: i === 1 ? 0.625 : 1.6, altText: `Fixture image ${i + 1}` }));
const names = ['... 123 الخيار العربي الكامل يحتاج إلى سطرين دون اختصار', '... 123 English option name remains fully readable across multiple lines'];
const options = names.map((text, i) => ({ id: `option-${i}`, text, votes: i ? 4 : 6, image: params.get('layout') === 'text' ? undefined : picture(i ? '#0d9488' : '#2563eb') }));
const survey: Survey = { id: 'post-ui-fixture', title: params.has('richTitle') ? '... 123 سؤال عربي مستقل #اختبار @fixture' : '... 123 سؤال عربي مستقل', description: '... 123 English post text stays aligned independently.', type: SurveyType.POLL, participants: 10, likes: 0, commentsCount: 0, isTrending: false, status: 'PUBLISHED', author: { id: 'fixture-author', name: 'Test Author', avatar: picture('#64748b') }, options, media, imageLayout: 'horizontal', resultsWho: 'Public', resultsTiming: 'Immediately', createdAt: '2026-09-01T00:00:00Z' };

if (params.has('richTitle')) {
  const rawText = '@fixture';
  const startOffset = survey.title.indexOf(rawText);
  survey.mentions = [{
    id: 'fixture-mention',
    targetUserId: 'fixture-user',
    sourceType: 'POST',
    targetUser: { id: 'fixture-user', name: 'Fixture User', handle: 'fixture' },
    occurrences: [{ surface: 'POST_TITLE', startOffset, endOffset: startOffset + rawText.length, rawText }],
  }];
}

function Harness() {
  const [voted, setVoted] = useState(false);
  const mode = params.get('create');
  const Creator = ({ poll: CreatePollScreen, survey: CreateSurveyModal, quiz: CreateQuizModal, challenge: CreateChallengeScreen } as any)[mode || ''];
  if (params.has('challenge')) return <MemoryRouter><main className="max-w-[680px] mx-auto bg-white" data-testid="challenge"><SurveyCard survey={{ ...survey, type: SurveyType.CHALLENGE }} isDetailView onVote={() => true} /></main></MemoryRouter>;
  if (params.has('repost')) return <MemoryRouter><main className="max-w-[680px] mx-auto bg-white" data-testid="repost"><SurveyCard survey={{ ...survey, id: 'reposted', sharedFrom: survey, sharedCaption: '... 123 تعليق عربي مستقل' }} isDetailView /></main></MemoryRouter>;
  if (params.has('interactive')) return <MemoryRouter><main className="max-w-[680px] mx-auto bg-white" data-testid="interactive"><SurveyCard survey={{ ...survey, type: params.get('interactive') === 'quiz' ? SurveyType.QUIZ : SurveyType.SURVEY, sections: [{ id: 'section', title: 'Test section', questions: [{ id: 'question', text: '... 123 English independent question', type: 'multiple_choice', imageMedia: media[0], options, imageLayout: 'horizontal' }, { id: 'question-two', text: 'Second question', type: 'multiple_choice', options }] }] }} isDetailView /></main></MemoryRouter>;
  if (Creator) return <MemoryRouter><Creator draft={params.has('creationImages') ? { ...survey, type: ({ poll: SurveyType.POLL, survey: SurveyType.SURVEY, quiz: SurveyType.QUIZ, challenge: SurveyType.CHALLENGE } as any)[mode!], optionPresentation: 'image', sections: [{ id: mode === 'quiz' ? 'sec-quiz-init' : 'sec-init', title: 'Section', questions: [{ id: mode === 'quiz' ? 'q-quiz-init-1' : 'q-init-1', text: 'Draft question', type: 'multiple_choice', optionPresentation: 'image', options }] }] } : undefined} isOpen onClose={() => {}} onSubmit={() => {}} userProfile={{ id: 'fixture-viewer', name: 'Test', handle: 'fixture', groups: [], interests: [], type: 'Personal' }} /></MemoryRouter>;
  return <MemoryRouter><main className="max-w-[680px] mx-auto bg-white" data-testid="harness">
    <div data-testid="post"><SurveyCard survey={{ ...survey, media: params.has('single') ? [media[0]] : media, options: [{ id: 'short-a', text: 'نعم', votes: 6 }, { id: 'short-b', text: 'No', votes: 4 }] }} isDetailView /></div>
    <section className="p-4" data-testid="options"><SurveyQuestion sourceSurvey={survey} options={options} selectedOptions={voted ? ['option-0'] : []} showOptionNames={!params.has('hiddenNames')} shouldShowResults={voted && !params.has('private')} hasVoted={voted} isExpired={false} hasImages={params.get('layout') !== 'text'} isHorizontal={!params.has('layout') || params.get('layout') === 'horizontal'} isRating={false} isMultiple={false} totalVotes={10} portraitImages={new Set()} followUpAnswers={{}} onOptionClick={() => setVoted(true)} onFollowUpChange={() => {}} onImageExpand={() => {}} onDetectOrientation={() => {}} /></section>
    <section data-testid="single"><MediaCarousel media={[media[0]]} /></section>
  </main></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
