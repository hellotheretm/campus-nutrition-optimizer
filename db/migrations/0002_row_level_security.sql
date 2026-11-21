-- Row-level security for private user data.
--
-- The application connects as a privileged role (needed for auth and public
-- data), but every query that touches private user data runs inside a
-- transaction that switches to the restricted role "cno_app" and sets
-- app.user_id (see withUser() in src/db/client.ts). The policies below then
-- make other users' rows invisible and unwritable, as a second layer behind
-- the explicit user_id filters in the application queries.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cno_app') then
    create role cno_app nologin;
  end if;
end
$$;

grant cno_app to current_user;
grant usage on schema public to cno_app;

-- Public, read-only reference data.
grant select on universities, dining_locations, foods, menu_days, menu_items to cno_app;

-- Private user data.
grant select, insert, update, delete on profiles, diary_entries, favorites, saved_meals, meal_plans to cno_app;

alter table profiles enable row level security;
alter table diary_entries enable row level security;
alter table favorites enable row level security;
alter table saved_meals enable row level security;
alter table meal_plans enable row level security;

-- The table owner (the role the server connects as) is not subject to these
-- policies; private data is only queried through withUser(), which switches to
-- cno_app. Deleting an auth_user row cascades to all of that user's data.

create policy profiles_owner on profiles for all to cno_app
  using (user_id = current_setting('app.user_id', true))
  with check (user_id = current_setting('app.user_id', true));

create policy diary_owner on diary_entries for all to cno_app
  using (user_id = current_setting('app.user_id', true))
  with check (user_id = current_setting('app.user_id', true));

create policy favorites_owner on favorites for all to cno_app
  using (user_id = current_setting('app.user_id', true))
  with check (user_id = current_setting('app.user_id', true));

create policy saved_meals_owner on saved_meals for all to cno_app
  using (user_id = current_setting('app.user_id', true))
  with check (user_id = current_setting('app.user_id', true));

create policy meal_plans_owner on meal_plans for all to cno_app
  using (user_id = current_setting('app.user_id', true))
  with check (user_id = current_setting('app.user_id', true));
