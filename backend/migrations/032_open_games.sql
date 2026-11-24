-- "Need players": a customer with a confirmed booking invites others to fill the team. Players join for free here; any cost sharing is between them.
CREATE TABLE IF NOT EXISTS open_games (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  host_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  players_needed int NOT NULL CHECK (players_needed BETWEEN 1 AND 30),
  skill_level    text NOT NULL DEFAULT 'any' CHECK (skill_level IN ('any','beginner','intermediate','advanced')),
  fee_per_player numeric(10,2) CHECK (fee_per_player IS NULL OR fee_per_player >= 0),
  note           text,
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS open_game_players (
  game_id    uuid NOT NULL REFERENCES open_games(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS open_game_players_user_idx ON open_game_players (user_id);
ALTER TABLE open_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_game_players ENABLE ROW LEVEL SECURITY;
