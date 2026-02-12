# Auth setup (Supabase)

## Tables
Run this SQL in Supabase (SQL editor):

```sql
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists email_verification_codes_user_idx
  on public.email_verification_codes(user_id);
```

## Environment variables
Local `.env.local` and Vercel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

Optional cost tuning:
- `NEXT_PUBLIC_LIA_COST_INPUT_PER_1K`
- `NEXT_PUBLIC_LIA_COST_OUTPUT_PER_1K`
