# socialinsight Database Review Standard

Use this standard for all database and Prisma review work in socialinsight. Database findings must cite relevant schema, migration, query, or service paths.

## Mandatory Review Criteria

1. Schema integrity: confirm models represent current product behavior and enforce critical invariants.
2. Model responsibilities: verify each model has a clear domain purpose.
3. Relationships: review one-to-one, one-to-many, and many-to-many relationships.
4. Foreign keys: confirm references match expected ownership and lifecycle.
5. Unique constraints: enforce user handles, emails, memberships, likes, saved records, and other identity-sensitive rules.
6. Composite constraints: use composite uniqueness where business rules require one record per actor/object pair.
7. Indexes: verify common filters, joins, searches, and sorts are indexed.
8. Transactions: require transactions for multi-write operations that must remain consistent.
9. Concurrency behavior: identify race conditions and conflicting requests.
10. Cascade behavior: review what happens when parent records are deleted.
11. Delete behavior: distinguish hard delete, soft delete, archive, and status transitions.
12. Optional versus required relations: confirm nullable relations are intentional.
13. Orphan-record risks: identify records that can survive without a valid parent or owner.
14. Duplicate-record risks: identify missing constraints that allow duplicated business events.
15. Counter integrity: review denormalized counters and reconciliation strategy.
16. Migration safety: prefer reviewed Prisma migrations over direct schema push.
17. Data-loss risks: clearly identify destructive changes.
18. Query performance: review expensive queries, large includes, pagination, and sorting.
19. N+1 risks: inspect loops that issue repeated queries.
20. Naming consistency: keep model, field, index, and relation names understandable.
21. Timestamp consistency: review `createdAt`, `updatedAt`, expiry, and status transition timestamps.
22. Enum consistency: prefer explicit enums or validated constants for constrained states.
23. Soft-delete strategy: verify how deleted, inactive, hidden, blocked, archived, and expired states behave.
24. Production versus test database boundaries: clearly distinguish local, test, staging, and production data actions where evidence exists.

## Required Reviewer Judgments

Reviewers must identify when DB-level constraints should enforce business rules.

Reviewers must identify when application-only validation is insufficient.

Reviewers must identify when transactions are required.

Reviewers must identify when concurrent requests may violate integrity.

Reviewers must identify when a migration can cause data loss, downtime, or incompatible application behavior.

## Safety Rules

- Never run destructive database commands automatically.
- Never run `prisma db push --accept-data-loss`.
- Never reset a database without explicit approval.
- Never modify production data automatically.
- Do not run migrations without explicit approval and impact analysis.
- Do not expose connection strings or secret environment values.

