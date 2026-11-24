-- =====================================================================
-- SuiviTri — schéma de base de données (Supabase / PostgreSQL)
-- À coller dans Supabase > SQL Editor > New query, puis « Run ».
-- Le script peut être relancé sans risque (il ne supprime aucune donnée).
-- =====================================================================

-- ---------- Profils (1 ligne par personne connectée) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  strava_id   bigint unique,
  name        text not null default '',
  role        text not null default 'athlete' check (role in ('coach','athlete')),
  approved    boolean not null default false,   -- validé par le coach
  hr_z1       int not null default 145,         -- FC max de la zone 1
  hr_z2       int not null default 165,         -- FC max de la zone 2
  params      jsonb not null default '{}'::jsonb, -- profil : VMA, FTP, allure seuil, FC par sport
  last_sync   timestamptz,
  created_at  timestamptz not null default now()
);

-- Mise à jour d'une base existante (sans effet si la colonne existe déjà)
alter table public.profiles add column if not exists params jsonb not null default '{}'::jsonb;

-- ---------- Jetons Strava (jamais lisibles depuis le navigateur) ----------
create table if not exists public.strava_tokens (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     bigint not null,
  updated_at     timestamptz not null default now()
);

-- ---------- Séances ----------
create table if not exists public.sessions (
  id                 text primary key default gen_random_uuid()::text,
  athlete_id         uuid not null references public.profiles(id) on delete cascade,
  date               date not null,
  sport              text not null check (sport in ('swim','bike','run','strength')),
  title              text not null default '',
  blocks             jsonb not null default '[]'::jsonb,
  bilan              jsonb not null default '{}'::jsonb,
  strava_activity_id bigint unique,
  updated_at         timestamptz not null default now()
);
create index if not exists sessions_athlete_date on public.sessions (athlete_id, date);

-- ---------- Bibliothèque (séances types et plans) ----------
create table if not exists public.library_sessions (
  id      text primary key,
  sport   text not null check (sport in ('swim','bike','run','strength')),
  title   text not null,
  descr   text not null default '',
  blocks  jsonb not null default '[]'::jsonb,
  custom  boolean not null default false
);
create table if not exists public.library_plans (
  id     text primary key,
  title  text not null,
  descr  text not null default '',
  weeks  jsonb not null default '[]'::jsonb
);

-- ---------- Fonctions d'aide pour la sécurité ----------
create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'coach');
$$;
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (approved or role = 'coach'));
$$;

-- Un adhérent ne peut pas se donner le rôle coach ni se valider lui-même
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_coach() then
    new.role := old.role;
    new.approved := old.approved;
    new.strava_id := old.strava_id;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- Création automatique du profil quand quelqu'un crée un compte (e-mail ou Strava)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

-- ---------- Sécurité ligne par ligne (RLS) ----------
alter table public.profiles         enable row level security;
alter table public.strava_tokens    enable row level security;  -- aucune règle = inaccessible au navigateur
alter table public.sessions         enable row level security;
alter table public.library_sessions enable row level security;
alter table public.library_plans    enable row level security;

drop policy if exists "profil: lire le sien ou coach" on public.profiles;
create policy "profil: lire le sien ou coach" on public.profiles
  for select using (id = auth.uid() or public.is_coach());
drop policy if exists "profil: modifier le sien ou coach" on public.profiles;
create policy "profil: modifier le sien ou coach" on public.profiles
  for update using (id = auth.uid() or public.is_coach());
drop policy if exists "profil: coach crée" on public.profiles;
create policy "profil: coach crée" on public.profiles
  for insert with check (public.is_coach());
drop policy if exists "profil: coach supprime" on public.profiles;
create policy "profil: coach supprime" on public.profiles
  for delete using (public.is_coach() and id <> auth.uid());

drop policy if exists "séances: athlète validé ou coach" on public.sessions;
create policy "séances: athlète validé ou coach" on public.sessions
  for all
  using      (public.is_coach() or (athlete_id = auth.uid() and public.is_approved()))
  with check (public.is_coach() or (athlete_id = auth.uid() and public.is_approved()));

drop policy if exists "biblio séances: lecture" on public.library_sessions;
create policy "biblio séances: lecture" on public.library_sessions for select using (public.is_approved());
drop policy if exists "biblio séances: coach écrit" on public.library_sessions;
create policy "biblio séances: coach écrit" on public.library_sessions for all using (public.is_coach()) with check (public.is_coach());
drop policy if exists "biblio plans: lecture" on public.library_plans;
create policy "biblio plans: lecture" on public.library_plans for select using (public.is_approved());
drop policy if exists "biblio plans: coach écrit" on public.library_plans;
create policy "biblio plans: coach écrit" on public.library_plans for all using (public.is_coach()) with check (public.is_coach());
