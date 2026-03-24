# Interaction Logs - Test & Verification Script

This file contains test cases to verify the interaction logging system.

## Test 1: Valid LIKE Event

```bash
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "like_test_001",
      "actorUserId": "user_123",
      "eventType": "LIKE",
      "postId": "post_456",
      "sourceSurface": "FEED",
      "positionInFeed": 0,
      "sessionId": "session_abc",
      "deviceType": "WEB"
    }
  ]'
```

**Expected Result:**
```json
{
  "acceptedCount": 1,
  "rejectedCount": 0,
  "rejections": []
}
```

**Database Record:**
```json
{
  "id": "like_test_001",
  "actor_user_id": "user_123",
  "event_type": "LIKE",
  "post_id": "post_456",
  "source_surface": "FEED",
  "position_in_feed": 0,
  "session_id": "session_abc",
  "device_type": "WEB",
  "created_at": "<server_timestamp>"
}
```

---

## Test 2: Reject Event with Embedded Object (PII)

```bash
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "like_test_002",
      "actorUserId": "user_123",
      "actor": {
        "name": "John Doe",
        "email": "john@example.com",
        "password": "secret123"
      },
      "eventType": "LIKE",
      "postId": "post_456",
      "sourceSurface": "FEED",
      "positionInFeed": 1,
      "sessionId": "session_abc",
      "deviceType": "WEB"
    }
  ]'
```

**Expected Result:**
```json
{
  "acceptedCount": 1,
  "rejectedCount": 0,
  "rejections": []
}
```

**Database Record (embedded object stripped):**
```json
{
  "id": "like_test_002",
  "actor_user_id": "user_123",
  "event_type": "LIKE",
  "post_id": "post_456",
  "source_surface": "FEED",
  "position_in_feed": 1,
  "session_id": "session_abc",
  "device_type": "WEB",
  "created_at": "<server_timestamp>"
}
```

**Note:** The `actor`, `email`, and `password` fields are automatically stripped by the whitelist.

---

## Test 3: Reject FEED Event Without position_in_feed

```bash
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "like_test_003",
      "actorUserId": "user_123",
      "eventType": "LIKE",
      "postId": "post_456",
      "sourceSurface": "FEED",
      "sessionId": "session_abc",
      "deviceType": "WEB"
    }
  ]'
```

**Expected Result:**
```json
{
  "acceptedCount": 0,
  "rejectedCount": 1,
  "rejections": [
    {
      "id": "like_test_003",
      "eventType": "LIKE",
      "reason": "position_in_feed is REQUIRED as an integer for FEED surface"
    }
  ]
}
```

---

## Test 4: Valid POST_VIEW_START and POST_VIEW_END

```bash
# First: POST_VIEW_START
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "view_start_001",
      "actorUserId": "user_123",
      "eventType": "POST_VIEW_START",
      "postId": "post_789",
      "sourceSurface": "PROFILE",
      "sessionId": "session_xyz",
      "deviceType": "ANDROID"
    }
  ]'

# Then: POST_VIEW_END
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "view_end_001",
      "actorUserId": "user_123",
      "eventType": "POST_VIEW_END",
      "postId": "post_789",
      "dwellTimeMs": 5420,
      "sourceSurface": "PROFILE",
      "sessionId": "session_xyz",
      "deviceType": "ANDROID"
    }
  ]'
```

**Expected Results:**
- Both events accepted
- position_in_feed is NULL for PROFILE surface

---

## Test 5: Reject Invalid Share Method

```bash
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "share_test_001",
      "actorUserId": "user_123",
      "eventType": "SHARE_OR_COPY_LINK",
      "postId": "post_456",
      "method": "INVALID_METHOD",
      "sourceSurface": "FEED",
      "positionInFeed": 0,
      "sessionId": "session_abc",
      "deviceType": "IOS"
    }
  ]'
```

**Expected Result:**
```json
{
  "acceptedCount": 0,
  "rejectedCount": 1,
  "rejections": [
    {
      "id": "share_test_001",
      "eventType": "SHARE_OR_COPY_LINK",
      "reason": "Invalid share method. Allowed: COPY_LINK, NATIVE_SHARE, REPOST"
    }
  ]
}
```

---

## Test 6: Valid Share Event

```bash
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "share_test_002",
      "actorUserId": "user_123",
      "eventType": "SHARE_OR_COPY_LINK",
      "postId": "post_456",
      "method": "COPY_LINK",
      "sourceSurface": "FEED",
      "positionInFeed": 0,
      "sessionId": "session_abc",
      "deviceType": "IOS"
    }
  ]'
```

**Expected Result:**
```json
{
  "acceptedCount": 1,
  "rejectedCount": 0,
  "rejections": []
}
```

---

## Test 7: Duplicate LIKE (Idempotency)

```bash
# Send the same LIKE event twice
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "like_dup_001",
      "actorUserId": "user_123",
      "eventType": "LIKE",
      "postId": "post_999",
      "sourceSurface": "FEED",
      "positionInFeed": 0,
      "sessionId": "session_abc",
      "deviceType": "WEB"
    }
  ]'

# Send again
curl -X POST http://localhost:3001/api/analytics/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": "like_dup_002",
      "actorUserId": "user_123",
      "eventType": "LIKE",
      "postId": "post_999",
      "sourceSurface": "FEED",
      "positionInFeed": 1,
      "sessionId": "session_abc",
      "deviceType": "WEB"
    }
  ]'
```

**Expected Result:**
- First request: acceptedCount = 1
- Second request: acceptedCount = 1 (idempotent, not re-inserted)
- Only ONE LIKE record exists in the database for user_123 + post_999

---

## Verification Queries

### Check interaction_events table structure:
```sql
PRAGMA table_info(InteractionEvent);
```

**Expected columns (14 total):**
1. id
2. actor_user_id
3. event_type
4. post_id
5. target_user_id
6. comment_id
7. method
8. new_state
9. dwell_time_ms
10. source_surface
11. position_in_feed
12. session_id
13. device_type
14. created_at

### Check for PII in interaction_events:
```sql
SELECT * FROM InteractionEvent LIMIT 10;
```

**Verify:**
- ✅ No email field
- ✅ No password field
- ✅ No birthday field
- ✅ No phone field
- ✅ No embedded JSON objects
- ✅ Only IDs in actor_user_id, post_id, etc.

### Count LIKE events per user per post:
```sql
SELECT actor_user_id, post_id, COUNT(*) as like_count
FROM InteractionEvent
WHERE event_type = 'LIKE'
GROUP BY actor_user_id, post_id
HAVING like_count > 1;
```

**Expected Result:** Empty (no duplicates)

### Verify position_in_feed consistency:
```sql
-- FEED events should have position_in_feed
SELECT COUNT(*) FROM InteractionEvent
WHERE source_surface = 'FEED' AND position_in_feed IS NULL;

-- Non-FEED events should NOT have position_in_feed
SELECT COUNT(*) FROM InteractionEvent
WHERE source_surface != 'FEED' AND position_in_feed IS NOT NULL;
```

**Expected Results:** Both queries return 0

---

## Summary

All tests verify:
1. ✅ Only IDs are stored (no embedded objects)
2. ✅ PII is automatically stripped
3. ✅ position_in_feed is enforced for FEED surface
4. ✅ Share methods use fixed enum
5. ✅ LIKE deduplication works
6. ✅ POST_VIEW state machine works
7. ✅ Invalid events are rejected with clear error messages
