# socialinsight Social Tagging Capability Matrix

This matrix is the implementation reference for `@Mention`, `#Hashtag`, and People Tag. They are independent features with separate persistence, privacy, notification, and lifecycle rules.

| Surface | `@Mention` | `#Hashtag` | People Tag | Mention notification | Topic/Trend contribution |
| --- | --- | --- | --- | --- | --- |
| Poll/Post question or title | Persistent, clickable | Persistent, clickable | Yes | On publication | Topic + Trends |
| Survey title and description | Persistent, clickable | Persistent, clickable | Yes | On publication | Topic + Trends |
| Quiz title and description | Persistent, clickable | Persistent, clickable | Yes | On publication | Topic + Trends |
| Challenge title | Persistent, clickable | Persistent, clickable | Yes | On publication | Topic + Trends |
| Repost caption | Persistent, clickable | Persistent, clickable | No | On publication | Topic + Trends |
| Comment | Persistent, clickable | Persistent, clickable | No | Immediate | Topic relation only; excluded from Trends |
| Reply | Persistent, clickable | Persistent, clickable | No | Immediate, deduplicated against reply notification | Topic relation only; excluded from Trends |
| Profile bio | Persistent, clickable | Clickable | No | Never | None |
| Group description and rules | Persistent, clickable | Clickable | No | Never | None |
| Poll/Survey/Quiz/Challenge option labels | Plain text | Plain text | No | Never | None |
| Rating labels and structured answer labels | Plain text | Plain text | No | Never | None |

## Lifecycle Rules

- Mentions store `targetUserId`; occurrence offsets preserve the authored historical handle while navigation uses stable user identity.
- Post, comment, reply, bio, and group metadata edits reconcile add/keep/remove relationships. Unchanged targets do not receive another notification.
- Removing a Mention deletes its durable Mention notification so it cannot keep navigating to a relationship that no longer exists.
- Pending group posts stage Mention relations. Eligibility and notifications are evaluated again only when the post becomes published.
- Hashtags are Unicode NFC-normalized and case-insensitive. One post contributes at most once to one hashtag.
- People Tags are post-level relationships. They never modify authored text and start as `PENDING` until the tagged user accepts or rejects them.
- A tagged user can remove their association without changing the post or any textual Mention.

## Discovery Ranking

- Topic `Recent` uses `createdAt DESC, id DESC` cursor pagination.
- Topic `Top` scores a bounded recent candidate set with recency and modest logarithmic response, comment, like, and share weight.
- Trending uses a rolling 7-day window over at most 2,000 recent hashtag/post relationships.
- A creator contributes scoring weight from at most three posts per hashtag in that window. Creator diversity boosts the score, while engagement influence is capped at 30 percent.
- Comment hashtag relationships never contribute to Trending.

## Privacy Rules

- Mention and People Tag eligibility is enforced by the server after authentication; autocomplete is only a convenience filter.
- Block state, account state, private/follower audience, and group membership are checked at mutation time.
- People Tag additionally respects `EVERYONE`, `FOLLOWING`, or `NO_ONE` on the target user's profile.
- Topic, Search, Trends, and post-detail queries share the authoritative published-post visibility filter.
- Pending People Tags are visible only to the post author/tagging actor and the tagged user; public viewers see accepted tags only.

## Historical Data Policy

- Hashtag relationships may be backfilled idempotently from eligible published post, repost-caption, comment, and reply text.
- Historical Mentions are linked only when a matching legacy Mention notification proves the original target user and source context. Current-handle matching alone is not sufficient.
- Ambiguous or unresolved historical `@text` remains authored plain text. Profile and group metadata is left unlinked unless future identity evidence becomes available.
