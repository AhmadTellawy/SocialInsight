import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '../services/api';
import type { ProfileLink } from '../services/api';
import {
  PROFILE_LINK_LIMIT,
  PROFILE_LINK_TITLE_MAX_LENGTH,
  PROFILE_LINK_URL_MAX_LENGTH,
  normalizeProfileLinkUrl,
  truncateProfileUrl,
  validateProfileLinkTitle
} from '../utils/profileValidation';
import type { ProfileLinkTitleError, ProfileLinkUrlError } from '../utils/profileValidation';
import { BottomSheet } from './BottomSheet';

export type ProfileLinksManagerProps = {
  onBack: () => void;
  onLinksChange?: (links: ProfileLink[]) => void;
};

type FormView = { kind: 'form'; link: ProfileLink | null };
type ManagerView = { kind: 'manage' } | FormView;
type Notice = { type: 'success' | 'error'; message: string } | null;

const sortProfileLinks = (links: ProfileLink[]): ProfileLink[] => [...links].sort((left, right) => (
  left.sortOrder - right.sortOrder
  || left.createdAt.localeCompare(right.createdAt)
  || left.id.localeCompare(right.id)
));

const titleErrorKey = (error: ProfileLinkTitleError): string => ({
  required: 'profileLinks.validation.titleRequired',
  tooLong: 'profileLinks.validation.titleTooLong',
  controlCharacters: 'profileLinks.validation.titleControlCharacters',
  markup: 'profileLinks.validation.titlePlainText'
})[error];

const urlErrorKey = (error: ProfileLinkUrlError): string => ({
  required: 'profileLinks.validation.urlRequired',
  tooLong: 'profileLinks.validation.urlTooLong',
  controlCharacters: 'profileLinks.validation.urlControlCharacters',
  whitespace: 'profileLinks.validation.urlWhitespace',
  protocolRelative: 'profileLinks.validation.urlProtocolRelative',
  invalidScheme: 'profileLinks.validation.urlScheme',
  credentials: 'profileLinks.validation.urlCredentials',
  invalidUrl: 'profileLinks.validation.urlInvalid'
})[error];

const apiErrorKey = (error: unknown, fallback: 'load' | 'add' | 'update' | 'delete'): string => {
  if (error instanceof ApiError) {
    if (['PROFILE_LINK_LIMIT', 'PROFILE_LINK_LIMIT_REACHED', 'MAX_PROFILE_LINKS'].includes(error.code || '')) {
      return 'profileLinks.errors.limit';
    }
    if (['DUPLICATE_PROFILE_LINK', 'PROFILE_LINK_DUPLICATE'].includes(error.code || '')) {
      return 'profileLinks.errors.duplicate';
    }
    if (['INVALID_PROFILE_LINK_URL', 'INVALID_URL'].includes(error.code || '')) {
      return 'profileLinks.validation.urlInvalid';
    }
  }
  return `profileLinks.errors.${fallback}`;
};

const ScreenHeader: React.FC<{
  title: string;
  backLabel: string;
  onBack: () => void;
  action?: React.ReactNode;
}> = ({ title, backLabel, onBack, action }) => (
  <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between border-b border-gray-100 bg-white/95 px-3 backdrop-blur-md">
    <button
      type="button"
      onClick={onBack}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label={backLabel}
      title={backLabel}
    >
      <ArrowLeft size={23} className="rtl:rotate-180" aria-hidden="true" />
    </button>
    <h1 className="min-w-0 flex-1 truncate px-2 text-center text-base font-black text-gray-900">{title}</h1>
    <div className="flex h-11 w-11 shrink-0 items-center justify-center">{action}</div>
  </header>
);

export const ProfileLinksManager: React.FC<ProfileLinksManagerProps> = ({ onBack, onLinksChange }) => {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<ManagerView>({ kind: 'manage' });
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileLink | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const onLinksChangeRef = useRef(onLinksChange);

  useEffect(() => {
    onLinksChangeRef.current = onLinksChange;
  }, [onLinksChange]);

  const publishLinks = useCallback((next: ProfileLink[]) => {
    const sorted = sortProfileLinks(next);
    setLinks(sorted);
    onLinksChangeRef.current?.(sorted);
  }, []);

  const loadLinks = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await api.getProfileLinks({ signal });
      if (!signal?.aborted) publishLinks(result);
    } catch (error) {
      if (!signal?.aborted) setLoadError(t(apiErrorKey(error, 'load')));
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [publishLinks, t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadLinks(controller.signal);
    return () => controller.abort();
  }, [loadLinks]);

  const atLimit = links.length >= PROFILE_LINK_LIMIT;
  const openAddForm = () => {
    if (atLimit) {
      setNotice({ type: 'error', message: t('profileLinks.limitReached', { max: PROFILE_LINK_LIMIT }) });
      return;
    }
    setNotice(null);
    setView({ kind: 'form', link: null });
  };

  const openEditForm = (link: ProfileLink) => {
    setNotice(null);
    setView({ kind: 'form', link });
  };

  const requestDelete = (link: ProfileLink) => {
    setDeleteError(null);
    setDeleteTarget(link);
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProfileLink(deleteTarget.id);
      publishLinks(links.filter((link) => link.id !== deleteTarget.id));
      setDeleteTarget(null);
      setNotice({ type: 'success', message: t('profileLinks.success.deleted') });
    } catch (error) {
      setDeleteError(t(apiErrorKey(error, 'delete')));
    } finally {
      setIsDeleting(false);
    }
  };

  const addAction = (
    <button
      type="button"
      onClick={openAddForm}
      disabled={atLimit || isLoading}
      className="flex h-11 w-11 items-center justify-center rounded-full text-blue-600 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:text-gray-300"
      aria-label={atLimit
        ? t('profileLinks.limitReached', { max: PROFILE_LINK_LIMIT })
        : t('profileLinks.actions.add')}
      title={atLimit
        ? t('profileLinks.limitReached', { max: PROFILE_LINK_LIMIT })
        : t('profileLinks.actions.add')}
    >
      <Plus size={24} aria-hidden="true" />
    </button>
  );

  if (view.kind === 'form') {
    return (
      <ProfileLinkForm
        link={view.link}
        links={links}
        onBack={() => setView({ kind: 'manage' })}
        onSaved={(saved) => {
          const next = view.link
            ? links.map((link) => link.id === saved.id ? saved : link)
            : [...links, saved];
          publishLinks(next);
          setView({ kind: 'manage' });
          setNotice({
            type: 'success',
            message: t(view.link ? 'profileLinks.success.updated' : 'profileLinks.success.added')
          });
        }}
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-gray-50" dir={i18n.dir()} aria-labelledby="profile-links-title">
      <ScreenHeader
        title={t('profileLinks.manageTitle')}
        backLabel={t('profileLinks.actions.back')}
        onBack={onBack}
        action={addAction}
      />
      <span id="profile-links-title" className="sr-only">{t('profileLinks.manageTitle')}</span>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 no-scrollbar">
        <div className="mx-auto w-full max-w-lg">
          <div className="mb-4 flex items-center justify-between gap-3 px-1">
            <p className="text-xs font-bold text-gray-500">
              {t('profileLinks.count', { count: links.length, max: PROFILE_LINK_LIMIT })}
            </p>
            {atLimit && (
              <p id="profile-links-limit" className="text-xs font-semibold text-amber-700" role="status">
                {t('profileLinks.limitReached', { max: PROFILE_LINK_LIMIT })}
              </p>
            )}
          </div>

          {notice && (
            <div
              className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${notice.type === 'success'
                ? 'border-green-100 bg-green-50 text-green-700'
                : 'border-red-100 bg-red-50 text-red-700'}`}
              role={notice.type === 'error' ? 'alert' : 'status'}
            >
              {notice.message}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label={t('profileLinks.loading')}>
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex min-h-[76px] animate-pulse items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3">
                  <div className="h-11 w-11 rounded-xl bg-gray-100" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-2/5 rounded-full bg-gray-100" />
                    <div className="h-3 w-4/5 rounded-full bg-gray-100" />
                  </div>
                </div>
              ))}
              <span className="sr-only">{t('profileLinks.loading')}</span>
            </div>
          ) : loadError ? (
            <div className="rounded-3xl border border-red-100 bg-white px-6 py-10 text-center" role="alert">
              <AlertCircle size={38} className="mx-auto mb-4 text-red-400" aria-hidden="true" />
              <h2 className="text-base font-black text-gray-900">{t('profileLinks.loadErrorTitle')}</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500">{loadError}</p>
              <button
                type="button"
                onClick={() => void loadLinks()}
                className="mx-auto mt-5 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <RefreshCw size={17} aria-hidden="true" />
                {t('profileLinks.actions.retry')}
              </button>
            </div>
          ) : links.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white px-6 py-12 text-center shadow-sm">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-50 text-blue-600">
                <LinkIcon size={34} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <h2 className="mt-6 text-lg font-black text-gray-900">{t('profileLinks.empty.title')}</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-gray-500">{t('profileLinks.empty.description')}</p>
              <button
                type="button"
                onClick={openAddForm}
                className="mx-auto mt-6 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <Plus size={18} aria-hidden="true" />
                {t('profileLinks.actions.add')}
              </button>
            </div>
          ) : (
            <ul className="space-y-3" aria-label={t('profileLinks.listLabel')}>
              {links.map((link) => (
                <li key={link.id} className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600" aria-hidden="true">
                    <LinkIcon size={19} />
                  </div>
                  <div className="min-w-0 flex-1 text-start">
                    <p className="truncate text-sm font-black text-gray-900">{link.title}</p>
                    <p className="mt-1 truncate text-xs text-gray-500" dir="ltr" aria-label={link.url} title={link.url}>
                      {truncateProfileUrl(link.url)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditForm(link)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label={t('profileLinks.actions.editLink', { title: link.title })}
                      title={t('profileLinks.actions.editLink', { title: link.title })}
                    >
                      <Pencil size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDelete(link)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      aria-label={t('profileLinks.actions.deleteLink', { title: link.title })}
                      title={t('profileLinks.actions.deleteLink', { title: link.title })}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <BottomSheet
        isOpen={deleteTarget !== null}
        onClose={() => { if (!isDeleting) setDeleteTarget(null); }}
        title={t('profileLinks.delete.title')}
        ariaLabel={t('profileLinks.delete.title')}
      >
        <div className="pt-3" dir={i18n.dir()}>
          <p className="text-sm leading-relaxed text-gray-600">
            {t('profileLinks.delete.message', { title: deleteTarget?.title || '' })}
          </p>
          {deleteError && <p className="mt-3 text-sm font-medium text-red-600" role="alert">{deleteError}</p>}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
              className="min-h-11 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
            >
              {t('profileLinks.actions.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={isDeleting}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {isDeleting && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
              {isDeleting ? t('profileLinks.delete.deleting') : t('profileLinks.delete.confirm')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </section>
  );
};

const ProfileLinkForm: React.FC<{
  link: ProfileLink | null;
  links: ProfileLink[];
  onBack: () => void;
  onSaved: (link: ProfileLink) => void;
}> = ({ link, links, onBack, onSaved }) => {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(link?.title || '');
  const [url, setUrl] = useState(link?.url || '');
  const [titleTouched, setTitleTouched] = useState(false);
  const [urlTouched, setUrlTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleValidation = useMemo(() => validateProfileLinkTitle(title), [title]);
  const urlValidation = useMemo(() => normalizeProfileLinkUrl(url), [url]);
  const isDuplicate = useMemo(() => {
    if (!urlValidation.valid) return false;
    return links.some((item) => {
      if (item.id === link?.id) return false;
      if (item.normalizedUrl) return item.normalizedUrl === urlValidation.value.normalizedUrl;
      const existing = normalizeProfileLinkUrl(item.url);
      return existing.valid && existing.value.normalizedUrl === urlValidation.value.normalizedUrl;
    });
  }, [link?.id, links, urlValidation]);

  const originalUrl = useMemo(() => link ? normalizeProfileLinkUrl(link.url) : null, [link]);
  const hasChanges = !link
    ? Boolean(title.trim() || url.trim())
    : (
      (titleValidation.valid ? titleValidation.value : title.trim()) !== link.title
      || (urlValidation.valid ? urlValidation.value.normalizedUrl : url.trim())
        !== (originalUrl?.valid ? originalUrl.value.normalizedUrl : link.url)
    );
  const canSubmit = titleValidation.valid && urlValidation.valid && !isDuplicate && hasChanges && !isSubmitting;
  const titleCount = Array.from(title).length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTitleTouched(true);
    setUrlTouched(true);
    setSubmitError(null);
    if (!titleValidation.valid || !urlValidation.valid || isDuplicate || !hasChanges || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = { title: titleValidation.value, url: urlValidation.value.url };
      const saved = link
        ? await api.updateProfileLink(link.id, payload)
        : await api.createProfileLink(payload);
      onSaved(saved);
    } catch (error) {
      setSubmitError(t(apiErrorKey(error, link ? 'update' : 'add')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const titleError = titleTouched && !titleValidation.valid ? t(titleErrorKey(titleValidation.error), {
    max: PROFILE_LINK_TITLE_MAX_LENGTH
  }) : null;
  const urlError = urlTouched
    ? isDuplicate
      ? t('profileLinks.validation.duplicate')
      : !urlValidation.valid
        ? t(urlErrorKey(urlValidation.error), { max: PROFILE_LINK_URL_MAX_LENGTH })
        : null
    : null;

  return (
    <section className="flex h-full min-h-0 flex-col bg-gray-50" dir={i18n.dir()}>
      <ScreenHeader
        title={t(link ? 'profileLinks.editTitle' : 'profileLinks.addTitle')}
        backLabel={t('profileLinks.actions.back')}
        onBack={onBack}
      />
      <form onSubmit={submit} noValidate className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 no-scrollbar">
        <div className="mx-auto w-full max-w-lg space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="profile-link-title" className="text-xs font-black text-gray-700">
                {t('profileLinks.fields.title')}
              </label>
              <span
                className={`text-xs tabular-nums ${titleCount > PROFILE_LINK_TITLE_MAX_LENGTH ? 'font-bold text-red-600' : 'text-gray-400'}`}
                aria-live="polite"
              >
                {t('profileLinks.fields.characterCount', { count: titleCount, max: PROFILE_LINK_TITLE_MAX_LENGTH })}
              </span>
            </div>
            <input
              id="profile-link-title"
              type="text"
              value={title}
              onChange={(event) => { setTitle(event.target.value); setSubmitError(null); }}
              onBlur={() => setTitleTouched(true)}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(titleError)}
              aria-describedby={titleError ? 'profile-link-title-error' : undefined}
              placeholder={t('profileLinks.fields.titlePlaceholder')}
              className={`min-h-12 w-full rounded-2xl border bg-white px-4 text-sm font-semibold text-gray-900 outline-none transition-shadow focus:ring-2 ${titleError
                ? 'border-red-400 focus:ring-red-100'
                : 'border-gray-200 focus:border-blue-500 focus:ring-blue-100'}`}
            />
            {titleError && <p id="profile-link-title-error" className="mt-2 text-xs font-medium text-red-600" role="alert">{titleError}</p>}
          </div>

          <div>
            <label htmlFor="profile-link-url" className="mb-2 block text-xs font-black text-gray-700">
              {t('profileLinks.fields.url')}
            </label>
            <input
              id="profile-link-url"
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setSubmitError(null); }}
              onBlur={() => setUrlTouched(true)}
              autoComplete="url"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              aria-invalid={Boolean(urlError)}
              aria-describedby={`profile-link-url-hint${urlError ? ' profile-link-url-error' : ''}`}
              placeholder={t('profileLinks.fields.urlPlaceholder')}
              className={`min-h-12 w-full rounded-2xl border bg-white px-4 text-left text-sm font-medium text-gray-900 outline-none transition-shadow focus:ring-2 ${urlError
                ? 'border-red-400 focus:ring-red-100'
                : 'border-gray-200 focus:border-blue-500 focus:ring-blue-100'}`}
            />
            <p id="profile-link-url-hint" className="mt-2 text-xs leading-relaxed text-gray-500">
              {t('profileLinks.fields.protocolHint')}
            </p>
            {urlError && <p id="profile-link-url-error" className="mt-2 text-xs font-medium text-red-600" role="alert">{urlError}</p>}
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-700" role="alert">
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-black text-white shadow-lg shadow-blue-500/20 transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {isSubmitting && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
            {isSubmitting ? t('profileLinks.actions.saving') : t('profileLinks.actions.save')}
          </button>
        </div>
      </form>
    </section>
  );
};
