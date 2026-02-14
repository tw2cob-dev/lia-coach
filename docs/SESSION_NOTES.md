# Session Notes (User Preferences)

Last updated: 2026-02-13

## Context
- Project uses Firebase Auth to avoid paying for custom email/domain infra.
- No custom domain available right now.
- Outlook/Hotmail delivery can be unreliable with default Firebase sender.

## Communication Preferences
- Explain steps for non-technical user, very clear and simple.
- Always indicate if commands are separate or can run together.
- Never present keyboard shortcuts as copy/paste commands.
- For user-filled values, always mark with `<<RELLENAR>>`.
- Keep guidance in Spanish.

## Security Preferences
- User enters secrets manually.
- Do not print or request full secret values in chat.
- Prefer boolean checks (`OK/FALTA`) over showing secret content.

## Operational Preferences
- When giving terminal actions, format as numbered sequence:
1. Command 1
2. Command 2
- If a step is not a command (example: press Ctrl + C), call it out explicitly.
- Environment config: use Windows environment variables; do not rely on `.env.local`.

## Current Auth Decisions
- Auth provider: Firebase (Email/Password + email verification).
- Legacy Supabase/Resend auth code removed from active flow.
- Session is secured via backend token flow (do not reintroduce insecure marker cookies).

## Known Product Constraints
- Without custom domain, Outlook can send verification emails to Spam or delay them.
- Practical fallback for tests: Gmail users for verification reliability.

## Reuse In New CLI Sessions
Tell the next agent:
- "Please read `docs/SESSION_NOTES.md` and follow it for this session."
