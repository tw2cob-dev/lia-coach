# Session Notes (User Preferences)

Last updated: 2026-02-14

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

## Chat UI Knobs (Do Not Re-discover)
- File: `app/chat/page.tsx`
- Goal: last message must stay above composer bar (keyboard open/closed), with minimal stable gap.
- Current stable settings:
- `CHAT_TO_COMPOSER_GAP_PX = 2`
- Dynamic clearance model by state:
- `COMPOSER_CLEARANCE_REDUCTION_CLOSED_PX = 30`
- `COMPOSER_CLEARANCE_REDUCTION_FOCUSED_PX = 44`
- `COMPOSER_CLEARANCE_OFFSET_CLOSED_PX = 0`
- `COMPOSER_CLEARANCE_OFFSET_FOCUSED_PX = 0`
- Effective layout behavior:
- Chat bottom padding uses:
- `composerClearanceBasePx = composerHeight - reductionByState`
- `composerClearancePx = max(0, composerClearanceBasePx + offsetByState)`
- Extra visible gap is controlled only by `<div ref={endRef} style={{ height: CHAT_TO_COMPOSER_GAP_PX }}>`.
- Important:
- If user says "gap no cambia", inspect `composerClearancePx` first (not only `CHAT_TO_COMPOSER_GAP_PX`).
- Fine tuning rule:
- Increase `OFFSET_*` => more distance from composer.
- Decrease `OFFSET_*` (can be negative) => closer to composer.

## Reuse In New CLI Sessions
Tell the next agent:
- "Please read `docs/SESSION_NOTES.md` and follow it for this session."

## Agent Reliability Rule (Mandatory)
- Never claim a value was changed without immediate file verification.
- Required workflow for each requested numeric tweak:
1. Apply change.
2. Run `rg` on the exact constant.
3. Reply with exact `file:line` + code line.
- If verification does not match request, explicitly say "not applied yet", fix it, and re-verify in the same turn.
