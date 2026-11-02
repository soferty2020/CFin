-- Additive financial core. Apply once to an existing database under a separately authorised migration gate.
-- Neither undated accounts.opening_balance nor legacy entries are backfilled or silently certified.
CREATE TABLE IF NOT EXISTS financial_inventory (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  roster_hash text NOT NULL,
  attested_by uuid NOT NULL REFERENCES users(id),
  attested_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_baselines (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  effective_date date NOT NULL,
  amount numeric(18,2) NOT NULL,
  first_activation boolean NOT NULL DEFAULT false,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  reconciled boolean NOT NULL DEFAULT false,
  attested_by uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  attested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, effective_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_first_activation_unique ON account_baselines(account_id) WHERE first_activation;
CREATE OR REPLACE FUNCTION guard_baseline_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialise attestations of the same account, including distinct effective dates.
  PERFORM 1 FROM accounts WHERE id=NEW.account_id FOR UPDATE;
  IF (NEW.first_activation AND EXISTS
       (SELECT 1 FROM account_baselines WHERE account_id=NEW.account_id AND effective_date<NEW.effective_date)) OR
     EXISTS (SELECT 1 FROM account_baselines WHERE account_id=NEW.account_id AND first_activation AND effective_date>NEW.effective_date) THEN
    RAISE EXCEPTION 'First activation must precede all other baselines' USING ERRCODE='23514', CONSTRAINT='account_baseline_order_guard';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS account_baseline_order_guard ON account_baselines;
CREATE TRIGGER account_baseline_order_guard BEFORE INSERT OR UPDATE ON account_baselines
  FOR EACH ROW EXECUTE FUNCTION guard_baseline_order();
CREATE TABLE IF NOT EXISTS internal_transfers (
  id uuid PRIMARY KEY,
  transfer_date date NOT NULL,
  source_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  target_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_account_id <> target_account_id)
);
CREATE INDEX IF NOT EXISTS internal_transfers_date_idx ON internal_transfers(transfer_date);
-- Reviewed allocation/classification is a sidecar: no historic entry row is rewritten.
-- Fingerprint columns preserve the review decision only while the raw row is unchanged.
CREATE TABLE IF NOT EXISTS entry_financial_review (
  entry_id uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entry_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('income','expense')),
  amount numeric(18,2) NOT NULL,
  category_id uuid NOT NULL,
  classification text NOT NULL CHECK (classification IN ('operating','transfer')),
  provenance text NOT NULL DEFAULT 'manual_review' CHECK (provenance IN ('manual_review','entry_write')),
  reviewed_by uuid NOT NULL REFERENCES users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
-- Existing sidecars retain manual provenance; no legacy entry is certified by this migration.
ALTER TABLE entry_financial_review ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'manual_review';
ALTER TABLE entry_financial_review DROP CONSTRAINT IF EXISTS entry_financial_review_provenance_check;
ALTER TABLE entry_financial_review ADD CONSTRAINT entry_financial_review_provenance_check CHECK (provenance IN ('manual_review','entry_write'));
CREATE TABLE IF NOT EXISTS legacy_transfer_pairs (
  id uuid PRIMARY KEY,
  expense_entry_id uuid NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
  income_entry_id uuid NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
  reviewed_by uuid NOT NULL REFERENCES users(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expense_entry_id <> income_entry_id)
);
CREATE OR REPLACE FUNCTION guard_linked_transfer_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM legacy_transfer_pairs WHERE expense_entry_id=OLD.id OR income_entry_id=OLD.id) THEN
    RAISE EXCEPTION 'Unlink reviewed transfer before editing either leg' USING ERRCODE='23514', CONSTRAINT='linked_transfer_entry_guard';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS linked_transfer_entry_guard ON entries;
CREATE TRIGGER linked_transfer_entry_guard BEFORE UPDATE OR DELETE ON entries
  FOR EACH ROW EXECUTE FUNCTION guard_linked_transfer_entry();
