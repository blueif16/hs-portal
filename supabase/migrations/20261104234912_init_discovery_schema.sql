-- hs-portal discovery pipeline + dashboard schema.
-- Worker (Mac) writes with the secret key (bypasses RLS); the dashboard reads/edits as a signed-in owner.

-- ---------- access control ----------
create table public.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.app_owners enable row level security;  -- no policies: managed with the secret key only

create function public.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_owners where user_id = (select auth.uid())) $$;
revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

create function public.set_updated_at() returns trigger
language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- jobs (heartbeats) ----------
create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,                      -- e.g. 'xhs-discovery', 'web-trends'
  host text not null,                     -- machine that ran it
  status text not null default 'running' check (status in ('running', 'ok', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  error text
);
create index job_runs_job_started_idx on public.job_runs (job, started_at desc);

-- ---------- discovery ----------
create table public.keywords (
  id bigint generated always as identity primary key,
  keyword text not null unique,
  status text not null default 'active' check (status in ('active', 'candidate', 'retired')),
  source text not null default 'seed' check (source in ('seed', 'proposed', 'manual')),
  proposed_reason text,
  added_at timestamptz not null default now(),
  validated_at timestamptz
);

create table public.notes (
  note_id text primary key,
  xsec_token text,
  title text,
  note_type text,                         -- 'normal' (图文) | 'video'
  author_id text,
  author_name text,
  description text,                       -- full text, filled by the detail fetch
  image_count int,
  tags text[] not null default '{}',
  published_at timestamptz,
  first_keyword text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  detail_fetched_at timestamptz,
  niche text check (niche in ('on', 'off')),
  niche_reason text,
  classified_at timestamptz
);
create index notes_last_seen_idx on public.notes (last_seen_at desc);

create table public.note_snapshots (
  id bigint generated always as identity primary key,
  note_id text not null references public.notes(note_id) on delete cascade,
  run_id bigint references public.job_runs(id) on delete set null,
  keyword text,
  search_rank int,
  likes int,
  collects int,
  comments int,
  shares int,
  captured_at timestamptz not null default now()
);
create index note_snapshots_note_captured_idx on public.note_snapshots (note_id, captured_at desc);
create index note_snapshots_run_idx on public.note_snapshots (run_id);

create table public.note_comments (               -- text + likes only; no commenter identities
  id bigint generated always as identity primary key,
  note_id text not null references public.notes(note_id) on delete cascade,
  comment_id text not null,
  content text not null,
  likes int,
  captured_at timestamptz not null default now(),
  unique (note_id, comment_id)
);

-- ---------- outputs ----------
create table public.opportunities (
  id bigint generated always as identity primary key,
  run_id bigint references public.job_runs(id) on delete set null,
  title text not null,
  summary text not null,
  why_now text,
  angle text,
  evidence_note_ids text[] not null default '{}',   -- every card must cite notes in public.notes
  keywords text[] not null default '{}',
  score numeric,
  status text not null default 'new' check (status in ('new', 'saved', 'dismissed', 'drafted')),
  created_at timestamptz not null default now()
);
create index opportunities_created_idx on public.opportunities (created_at desc);
create index opportunities_run_idx on public.opportunities (run_id);

create table public.drafts (
  id bigint generated always as identity primary key,
  opportunity_id bigint references public.opportunities(id) on delete set null,
  title text not null,
  body text not null,
  topics text[] not null default '{}',
  cover_text text,
  ai_generated boolean not null default true,       -- tick 笔记含AI合成内容 when publishing
  status text not null default 'draft' check (status in ('draft', 'approved', 'published', 'rejected')),
  published_note_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drafts_opportunity_idx on public.drafts (opportunity_id);
create trigger drafts_set_updated_at before update on public.drafts
  for each row execute function public.set_updated_at();

create table public.account_snapshots (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  fans int,
  follows int,
  interactions int,                        -- 获赞与收藏
  notes_count int
);

create table public.library_items (              -- shared knowledge library
  id bigint generated always as identity primary key,
  kind text not null default 'note' check (kind in ('note', 'insight', 'link', 'template')),
  title text not null,
  body text,
  url text,
  tags text[] not null default '{}',
  source text not null default 'manual',   -- 'manual' | 'worker' | 'web-trends'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger library_items_set_updated_at before update on public.library_items
  for each row execute function public.set_updated_at();

-- ---------- RLS: owner-only for the dashboard ----------
do $$
declare t text;
begin
  foreach t in array array['job_runs', 'keywords', 'notes', 'note_snapshots', 'note_comments',
                           'opportunities', 'drafts', 'account_snapshots', 'library_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owner full access" on public.%I for all to authenticated '
                   'using ((select public.is_owner())) with check ((select public.is_owner()))', t);
  end loop;
end $$;
