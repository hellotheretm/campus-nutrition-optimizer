-- Campus Nutrition Optimizer: initial schema.
-- Applied by src/db/migrate.ts (tracked in schema_migrations).

-- ---------------------------------------------------------------
-- Auth (Better Auth core tables)
-- ---------------------------------------------------------------
create table auth_user (
  id text primary key,
  name text not null,
  email text not null unique,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table auth_session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id text not null references auth_user(id) on delete cascade
);
create index auth_session_user_idx on auth_session(user_id);

create table auth_account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id text not null references auth_user(id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_account_user_idx on auth_account(user_id);

create table auth_verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index auth_verification_identifier_idx on auth_verification(identifier);

-- ---------------------------------------------------------------
-- Universities, locations and menus (public data)
-- ---------------------------------------------------------------
create table universities (
  id text primary key,
  slug text not null unique,
  name text not null,
  short_name text,
  city text,
  state text,
  timezone text not null default 'America/Chicago',
  website_url text,
  menu_source_url text,
  nutrition_info_url text,
  integration_status text not null default 'import_only'
    check (integration_status in ('live', 'import_only', 'pending_authorization', 'demo', 'inactive')),
  integration_notes text,
  provider text not null default 'import' check (provider in ('nutrislice', 'import', 'demo')),
  provider_config jsonb not null default '{}'::jsonb,
  allergen_notice text,
  is_demo boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dining_locations (
  id text primary key,
  university_id text not null references universities(id) on delete cascade,
  slug text not null,
  name text not null,
  building text,
  address text,
  kind text not null default 'dining_market',
  hours jsonb not null default '[]'::jsonb,
  hours_source_url text,
  hours_verified_on date,
  external_ref text,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
create unique index dining_locations_uni_slug on dining_locations(university_id, slug);

create table foods (
  id text primary key,
  university_id text not null references universities(id) on delete cascade,
  lineage_key text not null,
  revision integer not null default 1,
  name text not null,
  normalized_name text not null,
  description text,
  station text,
  serving_amount double precision,
  serving_unit text,
  serving_grams double precision,
  official jsonb not null default '{}'::jsonb,
  ingredients text,
  allergens text[] not null default '{}',
  dietary_labels text[] not null default '{}',
  source_ref text,
  content_hash text not null,
  estimate jsonb,
  estimate_version text,
  estimated_at timestamptz,
  fdc_override integer,
  first_seen date not null,
  last_seen date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index foods_uni_hash on foods(university_id, content_hash);
create index foods_lineage_idx on foods(university_id, lineage_key);
create index foods_name_idx on foods(university_id, normalized_name);

create table menu_days (
  id bigserial primary key,
  university_id text not null references universities(id) on delete cascade,
  location_id text not null references dining_locations(id) on delete cascade,
  date date not null,
  period text not null,
  status text not null check (status in ('available', 'closed', 'no_data', 'error')),
  source text not null,
  content_hash text,
  fetched_at timestamptz not null default now(),
  sync_run_id text,
  note text
);
create unique index menu_days_loc_date_period on menu_days(location_id, date, period);
create index menu_days_uni_date on menu_days(university_id, date);

create table menu_items (
  id bigserial primary key,
  menu_day_id bigint not null references menu_days(id) on delete cascade,
  food_id text not null references foods(id),
  station text,
  sort_order integer not null default 0
);
create index menu_items_day_idx on menu_items(menu_day_id);
create index menu_items_food_idx on menu_items(food_id);

create table sync_runs (
  id text primary key,
  university_id text not null references universities(id) on delete cascade,
  provider text not null,
  trigger text not null,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  date_from date,
  date_to date,
  stats jsonb,
  error text,
  triggered_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index sync_runs_uni_started on sync_runs(university_id, started_at);

-- ---------------------------------------------------------------
-- User data
-- ---------------------------------------------------------------
create table profiles (
  user_id text primary key references auth_user(id) on delete cascade,
  display_name text,
  university_id text references universities(id) on delete set null,
  reference_standard text not null default 'fda_dv' check (reference_standard in ('fda_dv', 'dri')),
  age_group text not null default 'unspecified',
  sex text not null default 'unspecified',
  show_calories boolean not null default true,
  show_percentages boolean not null default true,
  goals jsonb not null default '{}'::jsonb,
  dietary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table diary_entries (
  id text primary key,
  user_id text not null references auth_user(id) on delete cascade,
  date date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  status text not null default 'logged' check (status in ('logged', 'planned')),
  food_id text references foods(id) on delete set null,
  fdc_id integer,
  custom jsonb,
  name text not null,
  serving_label text,
  servings double precision not null default 1 check (servings > 0 and servings <= 50),
  grams double precision check (grams is null or (grams > 0 and grams <= 5000)),
  location_name text,
  nutrients jsonb not null,
  plan_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index diary_user_date on diary_entries(user_id, date);

create table favorites (
  user_id text not null references auth_user(id) on delete cascade,
  food_key text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, food_key)
);

create table saved_meals (
  id text primary key,
  user_id text not null references auth_user(id) on delete cascade,
  name text not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);
create index saved_meals_user on saved_meals(user_id);

create table meal_plans (
  id text primary key,
  user_id text not null references auth_user(id) on delete cascade,
  date date not null,
  university_id text not null,
  request jsonb not null,
  result jsonb not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meal_plans_user_date on meal_plans(user_id, date);

-- ---------------------------------------------------------------
-- University requests, rate limiting, development mail outbox
-- ---------------------------------------------------------------
create table university_requests (
  id text primary key,
  university_name text not null,
  normalized_key text not null,
  city text,
  state text,
  country text,
  website_url text,
  menu_url text,
  contact_email text,
  message text,
  requester_user_id text,
  supporters integer not null default 1,
  status text not null default 'new' check (status in ('new', 'reviewing', 'planned', 'declined', 'added')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index university_requests_key on university_requests(normalized_key);

create table rate_limits (
  key text primary key,
  count integer not null,
  window_start timestamptz not null
);

create table email_outbox (
  id text primary key,
  to_address text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  created_at timestamptz not null default now()
);
