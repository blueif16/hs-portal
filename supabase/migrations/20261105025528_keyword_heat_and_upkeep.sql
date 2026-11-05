-- Automatic keyword upkeep: each run records every searched keyword's heat (Σ weighted interaction on its
-- 一周内 · 最多点赞 page) and on-niche share; the worker keeps the top 20 and records why a status changed.
alter table public.keywords
  add column status_reason text,
  add column status_changed_at timestamptz;

create table public.keyword_stats (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.job_runs(id) on delete cascade,
  keyword text not null references public.keywords(keyword) on delete cascade,
  status text not null,                   -- the keyword's status when it was searched
  results int not null,
  heat numeric not null,
  on_share numeric,                       -- share of results labelled on-niche
  in_cut boolean not null,                -- made the top-N cut this run
  captured_at timestamptz not null default now()
);
create index keyword_stats_keyword_captured_idx on public.keyword_stats (keyword, captured_at desc);
create index keyword_stats_run_idx on public.keyword_stats (run_id);

alter table public.keyword_stats enable row level security;
create policy "owner full access" on public.keyword_stats for all to authenticated
  using ((select private.is_owner())) with check ((select private.is_owner()));
