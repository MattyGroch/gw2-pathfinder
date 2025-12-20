-- Achievement Groups Table
CREATE TABLE IF NOT EXISTS achievement_groups (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  "order" INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Achievement Categories Table
CREATE TABLE IF NOT EXISTS achievement_categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  "order" INTEGER NOT NULL,
  icon TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Group-Category Junction Table
CREATE TABLE IF NOT EXISTS group_categories (
  group_id VARCHAR(255) REFERENCES achievement_groups(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES achievement_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, category_id)
);

-- Achievements Table
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY,
  icon TEXT,
  name TEXT NOT NULL,
  description TEXT,
  requirement TEXT,
  locked_text TEXT,
  type TEXT NOT NULL,
  flags TEXT[],
  tiers JSONB NOT NULL,
  rewards JSONB,
  prerequisites JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Category-Achievement Junction Table
CREATE TABLE IF NOT EXISTS category_achievements (
  category_id INTEGER REFERENCES achievement_categories(id) ON DELETE CASCADE,
  achievement_id INTEGER REFERENCES achievements(id) ON DELETE CASCADE,
  PRIMARY KEY (category_id, achievement_id)
);

-- Achievement to Category Map (for quick lookups)
CREATE INDEX IF NOT EXISTS idx_category_achievements_category ON category_achievements(category_id);
CREATE INDEX IF NOT EXISTS idx_category_achievements_achievement ON category_achievements(achievement_id);
CREATE INDEX IF NOT EXISTS idx_group_categories_group ON group_categories(group_id);
CREATE INDEX IF NOT EXISTS idx_achievements_type ON achievements(type);
CREATE INDEX IF NOT EXISTS idx_achievements_flags ON achievements USING GIN(flags);

-- Add prerequisites column if it doesn't exist (for existing databases)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'achievements' AND column_name = 'prerequisites'
  ) THEN
    ALTER TABLE achievements ADD COLUMN prerequisites JSONB;
    CREATE INDEX IF NOT EXISTS idx_achievements_prerequisites ON achievements USING GIN(prerequisites);
  END IF;
END $$;

-- Ensure index exists (in case column was added but index wasn't)
CREATE INDEX IF NOT EXISTS idx_achievements_prerequisites ON achievements USING GIN(prerequisites);

-- Items Table (for items referenced by achievement rewards)
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT,
  rarity TEXT,
  level INTEGER,
  vendor_value INTEGER,
  icon TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for item lookups
CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_rarity ON items(rarity);

-- Titles Table (for titles referenced by achievement rewards)
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add titles table migration if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'titles'
  ) THEN
    -- Table creation is handled above, this is just for safety
    NULL;
  END IF;
END $$;

-- Add items column migration if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'items'
  ) THEN
    -- Table creation is handled above, this is just for safety
    NULL;
  END IF;
END $$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to auto-update updated_at
CREATE TRIGGER update_achievement_groups_updated_at BEFORE UPDATE ON achievement_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_achievement_categories_updated_at BEFORE UPDATE ON achievement_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_achievements_updated_at BEFORE UPDATE ON achievements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

