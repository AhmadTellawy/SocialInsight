export const GROUP_ROLES = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member'
} as const;

export type GroupRole = typeof GROUP_ROLES[keyof typeof GROUP_ROLES];

export const MEMBERSHIP_STATUS = {
  JOINED: 'JOINED',
  PENDING: 'PENDING',
  INVITED: 'INVITED',
  REMOVED: 'REMOVED',
  BANNED: 'BANNED'
} as const;

export type MembershipStatus = typeof MEMBERSHIP_STATUS[keyof typeof MEMBERSHIP_STATUS];

export const JOIN_POLICIES = {
  OPEN: 'OPEN',
  REQUEST: 'REQUEST',
  INVITE_ONLY: 'INVITE_ONLY'
} as const;

export type JoinPolicy = typeof JOIN_POLICIES[keyof typeof JOIN_POLICIES];

export const POSTING_PERMISSIONS = {
  ADMINS_ONLY: 'AdminsOnly',
  ALL_MEMBERS: 'AllMembers',
  APPROVAL_NEEDED: 'ApprovalNeeded'
} as const;

export type PostingPermission = typeof POSTING_PERMISSIONS[keyof typeof POSTING_PERMISSIONS];

export const POST_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  PUBLISHED: 'PUBLISHED',
  REJECTED: 'REJECTED'
} as const;

export type PostStatus = typeof POST_STATUS[keyof typeof POST_STATUS];
