export interface PostOptionContext {
  isAuthenticated: boolean;
  isPostOwner: boolean;
  isSourceOwner: boolean;
  isRepost: boolean;
  hasViewerPeopleTag: boolean;
}

export const getPostOptionCapabilities = (context: PostOptionContext) => ({
  canEdit: context.isAuthenticated && context.isPostOwner && !context.isRepost,
  canSave: context.isAuthenticated,
  canCopyLink: true,
  canRemovePeopleTag: context.isAuthenticated && context.hasViewerPeopleTag,
  canDelete: context.isAuthenticated && context.isPostOwner,
  canFollowAuthor: context.isAuthenticated && !context.isSourceOwner,
  canHide: context.isAuthenticated && !context.isPostOwner,
  canReport: context.isAuthenticated && !context.isPostOwner
});
