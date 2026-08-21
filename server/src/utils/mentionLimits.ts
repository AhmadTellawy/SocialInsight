import { MENTION_RECIPIENT_LIMIT, getUniqueMentionHandles } from './textEntities';

export interface MentionLimitViolation {
    error: string;
    code: 'MENTION_LIMIT_EXCEEDED';
    limit: number;
    recipientCount: number;
}

export const getMentionLimitViolation = (text: string): MentionLimitViolation | null => {
    const recipientCount = getUniqueMentionHandles(text).length;
    if (recipientCount <= MENTION_RECIPIENT_LIMIT) return null;
    return {
        error: `You can mention up to ${MENTION_RECIPIENT_LIMIT} people.`,
        code: 'MENTION_LIMIT_EXCEEDED',
        limit: MENTION_RECIPIENT_LIMIT,
        recipientCount
    };
};
