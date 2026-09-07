import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { accountApi } from '../services/accountApi';

export function BlockedAccountsScreen({ onBack }: { onBack: () => void }) {
  const { i18n } = useTranslation(), ar = i18n.language.startsWith('ar');
  const [items, setItems] = useState<Awaited<ReturnType<typeof accountApi.getBlockedAccounts>>['items']>([]), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  async function load(more = false) {
    setBusy(true); setError('');
    try { const result = await accountApi.getBlockedAccounts(more ? cursor || undefined : undefined); setItems(old => more ? [...old,...result.items] : result.items); setCursor(result.nextCursor); setLoaded(true); }
    catch { setError(ar ? 'تعذر تحميل الحسابات. أعد المحاولة.' : 'Could not load accounts. Try again.'); } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function unblock(id: string) { setBusy(true); setError(''); try { await accountApi.unblock(id); setItems(old => old.filter(item => item.id !== id)); } catch { setError(ar ? 'تعذر إلغاء الحظر. أعد المحاولة.' : 'Could not unblock the account. Try again.'); } finally { setBusy(false); } }
  return <main dir={ar ? 'rtl' : 'ltr'} className="h-full overflow-y-auto bg-gray-50 p-4 text-gray-900"><header className="mb-5 flex items-center gap-4"><button className="min-h-12 rounded-xl border px-4" onClick={onBack}>{ar ? 'رجوع' : 'Back'}</button><h1 className="text-lg font-bold">{ar ? 'الحسابات المحظورة' : 'Blocked accounts'}</h1></header><p className="mb-4 text-sm text-gray-600">{ar ? 'إلغاء الحظر لا يعيد المتابعة تلقائيًا.' : 'Unblocking does not automatically restore follows.'}</p>{error && <div role="alert" className="text-red-700"><p>{error}</p><button disabled={busy} className="min-h-12 underline" onClick={() => load()}>{ar ? 'أعد المحاولة' : 'Retry'}</button></div>}{busy && <p role="status">{ar ? 'يرجى الانتظار…' : 'Please wait…'}</p>}{loaded && !items.length && <p>{ar ? 'لا توجد حسابات محظورة.' : 'No blocked accounts.'}</p>}<ul className="space-y-3">{items.map(item => <li key={item.id} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-4"><div><p className="font-bold">{item.name}</p><p dir="ltr" className="text-sm text-gray-600">{item.handle}</p></div><button disabled={busy} className="min-h-12 rounded-xl border px-4 text-sm text-blue-700" onClick={() => unblock(item.id!)}>{ar ? 'إلغاء الحظر' : 'Unblock'}</button></li>)}</ul>{cursor && <button disabled={busy} className="my-4 min-h-12 rounded-xl border px-4" onClick={() => load(true)}>{ar ? 'عرض المزيد' : 'Load more'}</button>}</main>;
}
