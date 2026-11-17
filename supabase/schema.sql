-- RWO Registration: database setup.
-- Paste this whole file into Supabase > SQL Editor and press Run. Safe to run again.
--
-- Every table has Row Level Security switched ON with no public policies,
-- so nobody can read or change data directly from a browser. All access goes through
-- the race-api server function, which checks department PINs.
-- The one exception is "pulse": a single timestamp with no personal data, so screens update live.

create table if not exists events (
  id text primary key,
  name text not null default '',
  location text not null default '',
  start_date date,
  end_date date,
  current boolean not null default false,
  signup_open boolean not null default false
);

create table if not exists boats (
  id text primary key,
  boat_no text not null default '',
  team text not null default '',
  race_class text not null default '',
  owner_first text not null default '',
  owner_last text not null default '',
  owner_email text not null default '',
  owner_phone text not null default '',
  token text not null default '',
  active boolean not null default true
);

create table if not exists entries (
  id text primary key,
  event_id text not null references events(id) on delete cascade,
  boat_id text not null references boats(id) on delete cascade,
  entry_paid boolean not null default false,
  tech boolean not null default false,
  tech_by text not null default '',
  tech_at text not null default '',
  tech_notes text not null default '',
  safety boolean not null default false,
  safety_by text not null default '',
  safety_at text not null default '',
  safety_notes text not null default '',
  notes text not null default ''
);

create table if not exists people (
  id text primary key,
  first text not null default '',
  last text not null default '',
  email text not null default '',
  phone text not null default '',
  rwo_member boolean not null default false,
  rwo_paid boolean not null default false,
  apba_member boolean not null default false,
  apba_paid boolean not null default false,
  apba_no text not null default '',
  medical_exp date,
  dunker_exp date,
  notes text not null default '',
  created text not null default ''
);

create table if not exists crew (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  boat_id text not null references boats(id) on delete cascade,
  role text not null default 'Crew',
  event_ids text not null default '',   -- blank = races every event with this boat
  added_by text not null default '',
  added_at text not null default ''
);

create table if not exists signatures (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  event_id text not null references events(id) on delete cascade,
  signed_at text not null default '',
  signed_by text not null default ''
);

create table if not exists signups (
  id text primary key,
  created text not null default '',
  first text not null default '',
  last text not null default '',
  email text not null default '',
  phone text not null default '',
  typed_team text not null default '',
  typed_boat text not null default '',
  picked_boat_ids text not null default '',
  role text not null default 'Crew',
  event_ids text not null default '',
  status text not null default 'New',
  suggestions text not null default '',
  person_id text not null default '',
  resolved_by text not null default '',
  resolved_at text not null default '',
  note text not null default ''
);

-- remembered spellings: "say less|21" -> the Say Less MF boat
create table if not exists aliases (
  key text not null,
  typed text not null default '',
  boat_id text not null references boats(id) on delete cascade,
  added_by text not null default '',
  added_at text not null default '',
  primary key (key, boat_id)
);

create table if not exists log (
  n bigserial primary key,
  at text not null default '',
  who text not null default '',
  action text not null default '',
  detail text not null default ''
);

create table if not exists settings (
  key text primary key,
  value text not null default ''
);

-- one row per role; tick what that role must have before signing
create table if not exists rules (
  role text primary key,
  rwo_member boolean not null default true,
  rwo_paid boolean not null default true,
  apba_member boolean not null default true,
  apba_paid boolean not null default true,
  medical boolean not null default false,
  dunker boolean not null default false,
  sort int not null default 0
);

-- who last changed each check and when (JSON), and override notes; safe to re-run on an existing database
alter table people add column if not exists stamps text not null default '';
alter table entries add column if not exists stamps text not null default '';
alter table signatures add column if not exists note text not null default '';
alter table log add column if not exists ref text not null default '';
create index if not exists log_ref_idx on log(ref);

-- boat registration details (owner address, hull, engines) kept as JSON
alter table boats add column if not exists details text not null default '';
alter table boats add column if not exists registered_at text not null default '';

-- prices: race entry by class (and event), RWO membership, event extras. Edit in the app: Admin > Fees.
create table if not exists fees (
  id text primary key,
  kind text not null default 'entry',          -- entry | membership | extra
  name text not null default '',
  fee_class text not null default '',          -- for entry fees: the class, or the start of it ("Bracket Class")
  event_match text not null default '',        -- blank = every event; otherwise part of the event name ("Key West")
  amount text not null default '0',            -- dollars
  active boolean not null default true,
  sort text not null default '99'
);

-- every Stripe checkout: pending until Stripe confirms, then paid
create table if not exists payments (
  id text primary key,
  created text not null default '',
  kind text not null default '',               -- entry | membership | extras
  event_id text not null default '',
  boat_id text not null default '',
  person_ids text not null default '',
  items text not null default '',
  total text not null default '0',
  status text not null default 'pending',
  session_id text not null default '',
  intent_id text not null default '',
  paid_at text not null default '',
  payer_name text not null default '',
  payer_email text not null default '',
  note text not null default ''
);
alter table fees enable row level security;
alter table payments enable row level security;

insert into fees (id, kind, name, fee_class, event_match, amount, active, sort) values
  ('F-member', 'membership', 'RWO membership (season)', '', '', '200', true, '1'),
  ('F-SuperCat', 'entry', 'Super Cat race entry', 'Super Cat', '', '2300', true, '10'),
  ('F-Class1', 'entry', 'Class 1 race entry', 'Class 1', '', '2300', true, '11'),
  ('F-Class2', 'entry', 'Class 2 race entry', 'Class 2', '', '2300', true, '12'),
  ('F-SuperStock', 'entry', 'Super Stock race entry', 'Super Stock', '', '1300', true, '13'),
  ('F-SuperVee', 'entry', 'Super Vee race entry', 'Super Vee', '', '2300', true, '14'),
  ('F-ModifiedVee', 'entry', 'Modified Vee race entry', 'Modified Vee', '', '1100', true, '15'),
  ('F-BracketClass', 'entry', 'Bracket Class race entry', 'Bracket Class', '', '400', true, '16'),
  ('F-Cat300', 'entry', 'Cat 300 race entry', 'Cat 300', '', '400', true, '17'),
  ('F-VeeLimited', 'entry', 'Vee Limited race entry', 'Vee Limited', '', '400', true, '18'),
  ('F-SuperCat-KW', 'entry', 'Super Cat race entry (Key West, 3 races)', 'Super Cat', 'Key West', '5000', true, '30'),
  ('F-Class1-KW', 'entry', 'Class 1 race entry (Key West, 3 races)', 'Class 1', 'Key West', '7000', true, '31'),
  ('F-Class2-KW', 'entry', 'Class 2 race entry (Key West, 3 races)', 'Class 2', 'Key West', '5000', true, '32'),
  ('F-SuperStock-KW', 'entry', 'Super Stock race entry (Key West, 3 races)', 'Super Stock', 'Key West', '3200', true, '33'),
  ('F-SuperVee-KW', 'entry', 'Super Vee race entry (Key West, 3 races)', 'Super Vee', 'Key West', '5000', true, '34'),
  ('F-ModifiedVee-KW', 'entry', 'Modified Vee race entry (Key West, 3 races)', 'Modified Vee', 'Key West', '3000', true, '35'),
  ('F-BracketClass-KW', 'entry', 'Bracket Class race entry (Key West, 3 races)', 'Bracket Class', 'Key West', '900', true, '36'),
  ('F-Cat300-KW', 'entry', 'Cat 300 race entry (Key West, 3 races)', 'Cat 300', 'Key West', '900', true, '37'),
  ('F-VeeLimited-KW', 'entry', 'Vee Limited race entry (Key West, 3 races)', 'Vee Limited', 'Key West', '900', true, '38'),
  ('F-rv', 'extra', 'RV / equipment footprint', '', 'Key West', '0', false, '60'),
  ('F-duval', 'extra', 'Duval Street boat entry', '', 'Key West', '0', false, '61'),
  ('F-build', 'extra', 'Boat build contest', '', 'Key West', '0', false, '62')
on conflict (id) do nothing;

create table if not exists pulse (
  id int primary key,
  at timestamptz not null default now()
);

create index if not exists crew_boat_idx on crew(boat_id);
create index if not exists crew_person_idx on crew(person_id);
create index if not exists entries_event_idx on entries(event_id);
create index if not exists people_email_idx on people(lower(email));

-- lock everything down
alter table events enable row level security;
alter table boats enable row level security;
alter table entries enable row level security;
alter table people enable row level security;
alter table crew enable row level security;
alter table signatures enable row level security;
alter table signups enable row level security;
alter table aliases enable row level security;
alter table log enable row level security;
alter table settings enable row level security;
alter table rules enable row level security;
alter table pulse enable row level security;

drop policy if exists "anyone can see the pulse" on pulse;
create policy "anyone can see the pulse" on pulse for select using (true);
insert into pulse (id) values (1) on conflict (id) do nothing;
do $$ begin
  alter publication supabase_realtime add table pulse;
exception when duplicate_object then null; when undefined_object then null;
end $$;

-- starting settings (change PINs right away in Table Editor > settings)
insert into settings (key, value) values
  ('org_name', 'Race World Offshore'),
  ('pin_admin', '9999'),
  ('pin_office', '1111'),
  ('pin_registration', '2222'),
  ('pin_tech', '3333'),
  ('pin_safety', '4444'),
  ('required_roles', 'Driver|Alt Driver; Throttleman|Alt Throttle'),
  ('navigator_required_if_listed', 'Y'),
  ('crew_blocks_boat', 'N'),
  ('must_be_ready_to_sign', 'Y'),
  ('public_board', 'Y'),
  ('site_url', ''),
  ('public_team_pages', 'Y'),
  ('auto_link_score', '75'),
  ('auto_link_gap', '15'),
  ('signup_note', ''),
  ('timezone', 'America/New_York'),
  ('webhook_secret', substr(md5(random()::text), 1, 16))
on conflict (key) do nothing;

insert into rules (role, rwo_member, rwo_paid, apba_member, apba_paid, medical, dunker, sort) values
  ('Driver',       true, true, true, true, true,  true,  1),
  ('Throttleman',  true, true, true, true, true,  true,  2),
  ('Navigator',    true, true, true, true, true,  true,  3),
  ('Alt Driver',   true, true, true, true, true,  true,  4),
  ('Alt Throttle', true, true, true, true, true,  true,  5),
  ('Crew',         true, true, true, true, false, false, 6),
  ('Owner',        true, true, true, true, false, false, 7),
  ('Team Family',  true, true, true, true, false, false, 8),
  ('Team Sponsor', true, true, true, true, false, false, 9),
  ('Other',        true, true, true, true, false, false, 10)
on conflict (role) do nothing;
