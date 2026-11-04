-- Keep the RLS helper out of the exposed API schema (advisor 0029): policies call private.is_owner().
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create function private.is_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_owners where user_id = (select auth.uid())) $$;
revoke execute on function private.is_owner() from public, anon;
grant execute on function private.is_owner() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['job_runs', 'keywords', 'notes', 'note_snapshots', 'note_comments',
                           'opportunities', 'drafts', 'account_snapshots', 'library_items'] loop
    execute format('drop policy "owner full access" on public.%I', t);
    execute format('create policy "owner full access" on public.%I for all to authenticated '
                   'using ((select private.is_owner())) with check ((select private.is_owner()))', t);
  end loop;
end $$;

drop function public.is_owner();
