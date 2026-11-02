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

-- Financial core tables on fresh installs. Existing databases use migrations/002_financial_core.sql.
CREATE TABLE IF NOT EXISTS financial_inventory (id boolean PRIMARY KEY DEFAULT true CHECK(id), roster_hash text NOT NULL, attested_by uuid NOT NULL REFERENCES users(id), attested_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS account_baselines (account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, effective_date date NOT NULL, amount numeric(18,2) NOT NULL, first_activation boolean NOT NULL DEFAULT false, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500), reconciled boolean NOT NULL DEFAULT false, attested_by uuid NOT NULL REFERENCES users(id), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), attested_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,effective_date));
CREATE UNIQUE INDEX IF NOT EXISTS account_first_activation_unique ON account_baselines(account_id) WHERE first_activation;
CREATE OR REPLACE FUNCTION guard_baseline_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM accounts WHERE id=NEW.account_id FOR UPDATE;
  IF (NEW.first_activation AND EXISTS (SELECT 1 FROM account_baselines WHERE account_id=NEW.account_id AND effective_date<NEW.effective_date)) OR
     EXISTS (SELECT 1 FROM account_baselines WHERE account_id=NEW.account_id AND first_activation AND effective_date>NEW.effective_date) THEN
    RAISE EXCEPTION 'First activation must precede all other baselines' USING ERRCODE='23514', CONSTRAINT='account_baseline_order_guard';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS account_baseline_order_guard ON account_baselines;
CREATE TRIGGER account_baseline_order_guard BEFORE INSERT OR UPDATE ON account_baselines FOR EACH ROW EXECUTE FUNCTION guard_baseline_order();
CREATE TABLE IF NOT EXISTS internal_transfers (id uuid PRIMARY KEY, transfer_date date NOT NULL, source_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, target_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, amount numeric(18,2) NOT NULL CHECK(amount>0), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), CHECK(source_account_id<>target_account_id));
CREATE INDEX IF NOT EXISTS internal_transfers_date_idx ON internal_transfers(transfer_date);
CREATE TABLE IF NOT EXISTS entry_financial_review (entry_id uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, entry_date date NOT NULL, direction text NOT NULL CHECK(direction IN ('income','expense')), amount numeric(18,2) NOT NULL, category_id uuid NOT NULL, classification text NOT NULL CHECK(classification IN ('operating','transfer')), provenance text NOT NULL DEFAULT 'manual_review' CHECK (provenance IN ('manual_review','entry_write')), reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS legacy_transfer_pairs (id uuid PRIMARY KEY, expense_entry_id uuid NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT, income_entry_id uuid NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT, reviewed_by uuid NOT NULL REFERENCES users(id), reviewed_at timestamptz NOT NULL DEFAULT now(), CHECK(expense_entry_id<>income_entry_id));
CREATE OR REPLACE FUNCTION guard_linked_transfer_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM legacy_transfer_pairs WHERE expense_entry_id=OLD.id OR income_entry_id=OLD.id) THEN
    RAISE EXCEPTION 'Unlink reviewed transfer before editing either leg' USING ERRCODE='23514', CONSTRAINT='linked_transfer_entry_guard';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS linked_transfer_entry_guard ON entries;
CREATE TRIGGER linked_transfer_entry_guard BEFORE UPDATE OR DELETE ON entries FOR EACH ROW EXECUTE FUNCTION guard_linked_transfer_entry();
