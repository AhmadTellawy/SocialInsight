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
    getPostAnalytics
} from '../controllers/postController';

const router = Router();

router.get('/drafts', getDrafts);
router.get('/saved', getSavedPosts);
router.post('/comments/:id/like', likeComment);
router.get('/comments/:id/likes', getCommentLikers);
router.get('/', getPosts);
router.get('/:id', getPostById);
router.post('/', createPost);
router.put('/:id', updatePost);
router.post('/:id/vote', votePost);
router.get('/:id/participants', getParticipants);
router.get('/:id/results', getPostResults);
router.get('/:id/comments', getComments);
router.post('/:id/comments', createComment);
router.post('/:id/like', likePost);
router.get('/:id/likes', getPostLikers);
router.post('/:id/save', savePost);
router.post('/:id/hide', hidePost);
router.post('/:id/report', reportPost);
router.post('/:id/share', sharePost);
router.delete('/:id', deletePost);
router.get('/:id/analytics', getPostAnalytics);

export default router;
