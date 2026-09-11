export const isShareCancellation = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';

/** A cancelled native picker is terminal; only unsupported file data gets a link retry. */
export async function shareWithFileFallback(
  navigatorApi: Pick<Navigator, 'share' | 'canShare'>,
  data: ShareData,
  file?: File,
): Promise<'shared' | 'cancelled'> {
  const withFile = !!file && !!navigatorApi.canShare?.({ files: [file] });
  try {
    await navigatorApi.share(withFile ? { ...data, url: undefined, text: `${data.text || ''}\n${data.url || ''}`, files: [file!] } : data);
    return 'shared';
  } catch (error) {
    if (isShareCancellation(error)) return 'cancelled';
    if (!withFile || !(error instanceof TypeError || (error as { name?: string })?.name === 'NotSupportedError')) throw error;
    try {
      await navigatorApi.share(data);
      return 'shared';
    } catch (fallbackError) {
      if (isShareCancellation(fallbackError)) return 'cancelled';
      throw fallbackError;
    }
  }
}
