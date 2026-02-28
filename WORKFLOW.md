# Setlist Connect Workflow

Lightweight process for planning, building, testing, and releasing features safely.

## Team Roles

- Product owner: defines goals, priorities, and approves releases.
- Lead developer: scopes tasks, implements changes, tests, and manages deploy flow.

## Default Delivery Flow

1. Define feature goal in plain English.
2. Create a feature branch.
3. Implement changes on that branch.
4. Deploy Preview (Vercel auto-preview URL).
5. Test on desktop + mobile.
6. Fix issues found in Preview.
7. Approve and merge to `main`.
8. Deploy Production from `main`.

## Request Format (Product Owner)

When requesting a feature, provide:

- Outcome: what should happen.
- Priority: high / normal / low.
- Deadline: optional target date.
- Visuals: optional screenshots or examples.

## Release Gates

Before merging to `main`, confirm:

- Auth/login flow works.
- Setlist and shared links work.
- Lyrics/doc views work on mobile.
- No blocking console/runtime errors.
- Stripe test flow works in Preview (when billing changes are included).

## Environments

- Production: stable live app.
- Preview: safe testing for feature branches.
- Development: local work.

Use test keys/services in Preview and Development where possible.

## Branching Rules

- `main` is production-only.
- Feature work uses branches: `feature/<name>`.
- Avoid direct commits to `main` for non-trivial changes.

## Status Updates

Each feature cycle should end with:

- Plan: what was built.
- Test URL: preview link.
- Go-live recommendation: yes/no with reason.

## Hotfix Process

For urgent production bugs:

1. Create `hotfix/<name>` branch.
2. Apply minimal fix.
3. Validate in Preview quickly.
4. Merge to `main` and deploy.
