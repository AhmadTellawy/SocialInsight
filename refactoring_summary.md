# Refactoring Summary

## Database Schema Changes
- **User Model**:
  - Removed `demographics` (JSON string).
  - Added `passwordHash` (for secure auth).
  - Added `status`, `verifiedBadge`, `phone`, `authProvider`.
  - Mapped fields to snake_case in database.
- **UserDemographics Model**:
  - Created new table for structured demographic data (gender, ageGroup, etc.).
  - Linked 1:1 with `User`.
- **Report Model**:
  - Created generic `Report` table to replace `PostReport`.
  - Supports reporting Users, Posts, or Comments via `targetType` and `targetId`.
- **Other Models**:
  - Refactored `Notification`, `Follow`, `SavedPost`, `HiddenPost` to consistent naming conventions.

## Codebase Updates
- **Authentication (`authController.ts`)**:
  - Implemented secure password hashing with `bcryptjs`.
  - Added "Lazy Migration" logic: converts old plain-text passwords to hashes on first login.
  - Fetches structured demographics.
- **User Management (`userController.ts`)**:
  - Updated CRUD operations to handle `UserDemographics` table.
  - Implemented type-safe upsert logic for demographics.
  - Optimized `getUserAnalytics` to use database relations instead of JSON parsing.
- **Posts (`postController.ts`)**:
  - Updated to use the new `Report` system.
  - Fixed API response selection (`SAFE_USER_SELECT`).
- **OTP (`otpController.ts`)**:
  - Updated verification logic to use `verifiedBadge`.

## Status
- Server is running on port 3001.
- Database is synchronized.
- Prisma Client is generated.
