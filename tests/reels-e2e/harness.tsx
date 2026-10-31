import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import i18n from '../../i18n';
import { CreateReelScreen } from '../../components/reels/CreateReelScreen';
import { ReelsScreen } from '../../components/reels/ReelsScreen';
import { BottomNav } from '../../components/BottomNav';
import { api } from '../../services/api';
import '../../styles/tailwind.css';
import '../../styles/theme.css';
async function main() {
  await i18n.changeLanguage(new URLSearchParams(location.search).get('lang') || 'en');
  document.documentElement.dir = i18n.dir();
  const session = await (await fetch('/__test/session')).json();
  sessionStorage.setItem('si_csrf_token', session.csrfToken);
  sessionStorage.setItem('si_auth_identity', session.user.id);
  const user = { ...session.user, avatar: '', type: 'Personal', isVerified: true };
  function Creator() { const navigate = useNavigate(); return <CreateReelScreen userProfile={user} userGroups={[]} onClose={() => navigate('/reels')} onSaveDraft={async data => { await api.createSurvey({ ...data, status: 'DRAFT' }); }} onSubmit={async data => { const saved = await api.createSurvey(data); (window as any).__savedReel = saved; }} />; }
  function Viewer() { const navigate = useNavigate(); return <><ReelsScreen userProfile={user} onAuthorClick={author => navigate(`/profile/${author.id}`)} onLike={(id) => api.likeSurvey(id)} onShareToFeed={async (post, caption) => { await api.sharePost(post.id, user.id, caption); return 'shared'; }} onAnalysisClick={id => navigate(`/analysis/${id}`)} onDelete={() => {}} /><BottomNav activeTab="reels" onTabChange={() => {}} onAddClick={() => navigate('/create/reel')} onAddMenuOption={() => navigate('/create/reel')} isVisible isAddMenuOpen={false} /></>; }
  function Profile() { const { id } = useParams(); const navigate = useNavigate(); return <main><h1>Creator profile</h1><p>{id}</p><button onClick={() => navigate(-1)}>Back to Reels</button></main>; }
  // Like App, retain the active tab while a creation/detail route overlays it.
  createRoot(document.getElementById('root')!).render(<BrowserRouter><Viewer /><Routes><Route path="/create/reel" element={<Creator />} /><Route path="/reels" element={null} /><Route path="/profile/:id" element={<Profile />} /><Route path="/analysis/:id" element={<p>Results</p>} /></Routes></BrowserRouter>);
}
void main();
