/** Pages policy is independent of personal-account and group policy. */
export const PAGE_POLICY = Object.freeze({
  ownedPageLimit: 5,
  invitationDays: 7,
  transferDays: 7,
  deletionGraceDays: 30,
  handleChangeDays: 30,
  auditRetentionDays: 180,
  closedCaseRetentionDays: 180,
  maxLinks: 3,
  pageSize: 24,
  maxPageSize: 50,
});

export const PAGE_CATEGORIES = ['company', 'project', 'institution', 'creator', 'other'] as const;
export type PageRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'ANALYST';
export type PageCapability = 'readManagement' | 'editInfo' | 'changeHandle' | 'manageContent' |
  'reply' | 'moderateComments' | 'block' | 'analytics' | 'export' | 'manageTeam' | 'audit' |
  'publication' | 'ownership' | 'deletion';

const grants: Readonly<Record<PageRole, readonly PageCapability[]>> = {
  OWNER: ['readManagement', 'editInfo', 'changeHandle', 'manageContent', 'reply', 'moderateComments',
    'block', 'analytics', 'export', 'manageTeam', 'audit', 'publication', 'ownership', 'deletion'],
  ADMIN: ['readManagement', 'editInfo', 'manageContent', 'reply', 'moderateComments', 'block',
    'analytics', 'export', 'manageTeam', 'audit'],
  EDITOR: ['readManagement', 'manageContent', 'reply', 'moderateComments', 'analytics'],
  ANALYST: ['readManagement', 'analytics', 'export'],
};

export const hasPageCapability = (role: PageRole | null, capability: PageCapability): boolean =>
  role !== null && grants[role].includes(capability);

export const mayManagePageRole = (actor: PageRole, target: PageRole): boolean =>
  target !== 'OWNER' && (actor === 'OWNER' || (actor === 'ADMIN' && ['EDITOR', 'ANALYST'].includes(target)));

export interface PageState {
  publicationState: string;
  platformState: string;
  safetyHiddenAt: Date | null;
  deletionRequestedAt: Date | null;
  purgedAt: Date | null;
}

export const isPagePublic = (page: PageState): boolean =>
  page.publicationState === 'PUBLISHED' && page.platformState !== 'SUSPENDED' &&
  page.safetyHiddenAt === null && page.deletionRequestedAt === null && page.purgedAt === null;

export const mayPublishPageContent = (page: PageState): boolean =>
  isPagePublic(page) && page.platformState === 'NONE';

export class PagePolicyError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
    this.name = 'PagePolicyError';
  }
}

/** Reject every representation of a group destination, including legacy arrays/JSON. */
export const assertPageDestination = (input: {
  groupId?: unknown; targetAudience?: unknown; targetGroups?: unknown; targetedGroups?: unknown;
}): void => {
  const hasGroups = (value: unknown): boolean => {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') {
      try { return hasGroups(JSON.parse(value)); } catch { return true; }
    }
    // Relationship operations must never be accepted through a Page publisher.
    return true;
  };
  if (hasGroups(input.groupId) || hasGroups(input.targetGroups) || hasGroups(input.targetedGroups) ||
      (typeof input.targetAudience === 'string' && /groups/i.test(input.targetAudience))) {
    throw new PagePolicyError('PAGE_GROUP_DESTINATION_FORBIDDEN');
  }
};

export const pagePublicWhere = () => ({
  publicationState: 'PUBLISHED', platformState: { not: 'SUSPENDED' },
  safetyHiddenAt: null, deletionRequestedAt: null, purgedAt: null,
  AND: [{OR: [{owner:{status:'ACTIVE'}},{members:{some:{role:{in:['ADMIN','EDITOR']},user:{status:'ACTIVE'}}}}]}],
});
