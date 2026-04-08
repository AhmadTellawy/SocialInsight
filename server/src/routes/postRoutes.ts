import { Router } from 'express';
import {
    getPosts,
    getPostById,
    createPost,
    updatePost,
    getDrafts,
    votePost,
    getParticipants,
    getPostResults,
    getComments,
    createComment,
    likePost,
    likeComment,
    savePost,
    hidePost,
    reportPost,
    getSavedPosts,
    getPostLikers,
    getCommentLikers,
    sharePost,
    deletePost,
    getPostAnalytics,
    updateComment,
    deleteComment
} from '../controllers/postController';

import { requireAuth, optionalAuth } from '../middleware/authMiddleware';

const router = Router();

// Optional Auth (Guests can view, Users get personalized views)
router.get('/', optionalAuth, getPosts);
router.get('/:id', optionalAuth, getPostById);
router.get('/:id/participants', optionalAuth, getParticipants);
router.get('/:id/results', optionalAuth, getPostResults);
router.get('/:id/comments', optionalAuth, getComments);
router.get('/:id/likes', optionalAuth, getPostLikers);
router.get('/comments/:id/likes', optionalAuth, getCommentLikers);

// Require Auth (Only logged in users can mutate data/view private lists)
router.get('/drafts', requireAuth, getDrafts);
router.get('/saved', requireAuth, getSavedPosts);
router.post('/comments/:id/like', requireAuth, likeComment);
router.put('/comments/:id', requireAuth, updateComment);
router.delete('/comments/:id', requireAuth, deleteComment);
router.post('/', requireAuth, createPost);
router.put('/:id', requireAuth, updatePost);
router.post('/:id/vote', optionalAuth, votePost); // Guest voting might be allowed based on poll settings, we keep optionalAuth
router.post('/:id/comments', requireAuth, createComment);
router.post('/:id/like', requireAuth, likePost);
router.post('/:id/save', requireAuth, savePost);
router.post('/:id/hide', requireAuth, hidePost);
router.post('/:id/report', requireAuth, reportPost);
router.post('/:id/share', requireAuth, sharePost);
router.delete('/:id', requireAuth, deletePost);
router.get('/:id/analytics', requireAuth, getPostAnalytics);

export default router;
