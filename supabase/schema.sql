-- ============================================================
-- Short Deck Poker - Supabase Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- ROOMS
-- ============================================================
create table if not exists rooms (
  id            text primary key,          -- 6-char room code e.g. "ABC123"
  host_id       text not null,             -- socket/player id of host
  status        text not null default 'waiting',  -- waiting | playing | finished
  settings      jsonb not null default '{
    "gameType": "short_deck",
    "startingChips": 5000,
    "smallBlind": 50,
    "bigBlind": 100,
    "maxPlayers": 9,
    "actionTimeout": 30,
    "bombPotEnabled": false,
    "bombPotAmount": 100,
    "bombPotInterval": 5,
    "twoSevenEnabled": false,
    "twoSevenAmount": 100
  }',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  finished_at   timestamptz
);

-- Auto-update updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger rooms_updated_at
  before update on rooms
  for each row execute function update_updated_at_column();

-- ============================================================
-- PLAYERS (in a room)
-- ============================================================
create table if not exists players (
  id            text not null,             -- socket/player id
  room_id       text not null references rooms(id) on delete cascade,
  name          text not null,
  avatar_color  text not null default '#e74c3c',
  chips         integer not null default 5000,
  seat_index    integer,                   -- seat position 0-8
  is_bot        boolean not null default false,
  is_connected  boolean not null default true,
  joined_at     timestamptz default now(),
  primary key (id, room_id)
);

create index idx_players_room on players(room_id);

-- ============================================================
-- GAME STATE (current hand)
-- ============================================================
create table if not exists game_states (
  room_id         text primary key references rooms(id) on delete cascade,
  hand_number     integer not null default 1,
  stage           text not null default 'waiting', -- waiting|preflop|flop|turn|river|showdown
  community_cards jsonb not null default '[]',
  deck            jsonb not null default '[]',      -- remaining deck (server-side only)
  deck_index      integer not null default 0,
  pot             integer not null default 0,
  current_bet     integer not null default 0,
  small_blind     integer not null default 50,
  big_blind       integer not null default 100,
  dealer_index    integer not null default 0,
  small_blind_index integer not null default 1,
  big_blind_index   integer not null default 2,
  current_player_index integer not null default 0,
  last_raise_index     integer not null default -1,
  player_states   jsonb not null default '[]',      -- array of per-player game state
  winners         jsonb,                            -- set after showdown
  action_log      jsonb not null default '[]',
  updated_at      timestamptz default now()
);

create trigger game_states_updated_at
  before update on game_states
  for each row execute function update_updated_at_column();

-- ============================================================
-- HAND HISTORY (completed hands)
-- ============================================================
create table if not exists hand_history (
  id              uuid primary key default uuid_generate_v4(),
  room_id         text not null references rooms(id) on delete cascade,
  hand_number     integer not null,
  stage_reached   text not null,           -- how far the hand went
  community_cards jsonb not null default '[]',
  pot             integer not null,
  winners         jsonb not null,          -- [{playerId, name, chips_won, hand_name}]
  player_hands    jsonb not null default '[]', -- [{playerId, hole_cards, hand_name, hand_rank}]
  action_log      jsonb not null default '[]',
  played_at       timestamptz default now()
);

create index idx_hand_history_room on hand_history(room_id);
create index idx_hand_history_played_at on hand_history(played_at desc);

-- ============================================================
-- CHAT MESSAGES
-- ============================================================
create table if not exists chat_messages (
  id          uuid primary key default uuid_generate_v4(),
  room_id     text not null references rooms(id) on delete cascade,
  player_id   text not null,
  player_name text not null,
  message     text not null,
  sent_at     timestamptz default now()
);

create index idx_chat_room on chat_messages(room_id, sent_at desc);

-- ============================================================
-- ROW LEVEL SECURITY (optional but recommended)
-- ============================================================
alter table rooms enable row level security;
alter table players enable row level security;
alter table game_states enable row level security;
alter table hand_history enable row level security;
alter table chat_messages enable row level security;

-- Allow all operations via service role (used by backend)
create policy "service_role_all" on rooms for all using (true);
create policy "service_role_all" on players for all using (true);
create policy "service_role_all" on game_states for all using (true);
create policy "service_role_all" on hand_history for all using (true);
create policy "service_role_all" on chat_messages for all using (true);

-- Allow anonymous reads for rooms/players/chat (frontend queries)
create policy "anon_read_rooms" on rooms for select using (true);
create policy "anon_read_players" on players for select using (true);
create policy "anon_read_chat" on chat_messages for select using (true);
create policy "anon_read_history" on hand_history for select using (true);

-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Leaderboard view per room
create or replace view room_leaderboard as
select
  p.room_id,
  p.id as player_id,
  p.name,
  p.chips as current_chips,
  r.settings->>'startingChips' as starting_chips,
  (p.chips - (r.settings->>'startingChips')::int) as net_chips,
  count(distinct h.id) filter (
    where h.winners @> jsonb_build_array(jsonb_build_object('playerId', p.id))
  ) as hands_won
from players p
join rooms r on r.id = p.room_id
left join hand_history h on h.room_id = p.room_id
group by p.room_id, p.id, p.name, p.chips, r.settings;

-- Recent activity
create or replace view recent_rooms as
select
  r.id,
  r.status,
  r.created_at,
  count(distinct p.id) as player_count,
  r.settings
from rooms r
left join players p on p.room_id = r.id
where r.created_at > now() - interval '24 hours'
group by r.id
order by r.created_at desc;
