const ACCESS_DENIAL_CODES = new Set(['EACCES', 'EPERM']);
const IMMUTABLE_ROOT_WRITE_DENIAL_CODES = new Set([...ACCESS_DENIAL_CODES, 'EROFS']);

// Owned by the converter user so a writable-root profile would permit the
// write without Landlock. The worker receives READ_FILE only for this exact
// inode, so it can verify integrity while the mutation remains denied.
export const IMMUTABLE_ROOT_CANARY_PATH = '/opt/heif-converter/landlock-write-canary';

export function isAccessDenied(error) {
  return ACCESS_DENIAL_CODES.has(error?.code);
}

// A read-only root filesystem denies writes with EROFS before Landlock sees
// them. This exception is deliberately limited to immutable-root targets;
// job-directory writes must still prove the Landlock access denial itself.
export function isImmutableRootWriteDenied(error) {
  return IMMUTABLE_ROOT_WRITE_DENIAL_CODES.has(error?.code);
}
