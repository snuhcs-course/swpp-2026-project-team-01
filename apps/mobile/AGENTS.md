# Mobile app guidance

This directory contains the CalTalk Expo app for iOS, Android, and web.

- Follow the repository-root `AGENTS.md` for project workflow and Supabase schema conventions.
- Keep mobile-specific changes in this directory and update `documentations/` when behavior or setup changes.
- Never put Supabase service-role keys, Google OAuth tokens, LLM credentials, or other secrets in Expo public environment variables.
- Require authenticated host approval for calendar writes; recheck availability and make event creation idempotent on the server.
