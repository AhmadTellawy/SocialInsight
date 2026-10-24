import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useParams, Link } from 'react-router-dom';
import i18n from '../../i18n';
import { PageCreate } from '../../components/pages/PageCreate';
import { PageManage } from '../../components/pages/PageManage';
import '../../components/pages/pages.css';

async function main() {
  const language = new URLSearchParams(location.search).get('lang') || sessionStorage.getItem('pages_test_language') || 'ar';
  sessionStorage.setItem('pages_test_language', language);
  const ar = language !== 'en';
  await i18n.changeLanguage(ar ? 'ar' : 'en');
  document.documentElement.dir = ar ? 'rtl' : 'ltr';
  const response = await fetch('/__test/session');
  const session = await response.json();
  sessionStorage.setItem('si_csrf_token', session.csrfToken);
  sessionStorage.setItem('si_auth_identity', session.user.id);
  function Manage() {
    const { id } = useParams();
    return <PageManage pageId={id!} userProfile={session.user} cardProps={{} as any} />;
  }
  const router = createBrowserRouter([
    { path: '/pages/create', element: <PageCreate /> },
    { path: '/pages/manage/:id', element: <Manage /> },
    { path: '/pages/mine', element: <Link to="/pages/create">Create another page</Link> },
  ]);
  createRoot(document.getElementById('root')!).render(<div className="pages-shell"><RouterProvider router={router} /></div>);
}
void main();
