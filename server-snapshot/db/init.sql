CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY, login text NOT NULL UNIQUE, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','user')));
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('bank','cash')), opening_balance numeric(18,2) NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS groups (id uuid PRIMARY KEY, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS subgroups (id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS categories (id uuid PRIMARY KEY, subgroup_id uuid NOT NULL REFERENCES subgroups(id) ON DELETE RESTRICT, name text NOT NULL, sort_order integer NOT NULL DEFAULT 0, allow_income boolean NOT NULL DEFAULT true, allow_expense boolean NOT NULL DEFAULT true, CONSTRAINT categories_direction_check CHECK (allow_income OR allow_expense));
CREATE TABLE IF NOT EXISTS entries (id uuid PRIMARY KEY, category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT, entry_date date NOT NULL, direction text NOT NULL CHECK(direction IN ('income','expense')), amount numeric(18,2) NOT NULL CHECK(amount>0), account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS entries_cell_idx ON entries(entry_date, category_id, direction);
CREATE INDEX IF NOT EXISTS entries_category_direction_idx ON entries(category_id, direction);

CREATE OR REPLACE FUNCTION check_entry_direction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean;
BEGIN
  SELECT CASE NEW.direction WHEN 'income' THEN allow_income ELSE allow_expense END
    INTO allowed FROM categories WHERE id=NEW.category_id FOR UPDATE;
  IF allowed IS FALSE THEN
    RAISE EXCEPTION 'Direction not allowed for category' USING ERRCODE='23514', CONSTRAINT='entries_category_direction_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entries_direction_guard BEFORE INSERT OR UPDATE OF category_id, direction ON entries
  FOR EACH ROW EXECUTE FUNCTION check_entry_direction();

CREATE OR REPLACE FUNCTION check_category_directions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.allow_income AND NOT NEW.allow_income AND EXISTS
    (SELECT 1 FROM entries WHERE category_id=NEW.id AND direction='income')) OR
     (OLD.allow_expense AND NOT NEW.allow_expense AND EXISTS
    (SELECT 1 FROM entries WHERE category_id=NEW.id AND direction='expense')) THEN
    RAISE EXCEPTION 'Category direction has entries' USING ERRCODE='23514', CONSTRAINT='categories_entries_direction_check';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER categories_direction_guard BEFORE UPDATE OF allow_income, allow_expense ON categories
  FOR EACH ROW EXECUTE FUNCTION check_category_directions();
