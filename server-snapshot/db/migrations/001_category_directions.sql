-- Apply once to an existing volume before deploying the new API; do not run init.sql on an existing volume.
BEGIN;
ALTER TABLE categories ADD COLUMN allow_income boolean NOT NULL DEFAULT true;
ALTER TABLE categories ADD COLUMN allow_expense boolean NOT NULL DEFAULT true;
ALTER TABLE categories ADD CONSTRAINT categories_direction_check CHECK (allow_income OR allow_expense);
CREATE INDEX entries_category_direction_idx ON entries(category_id, direction);

CREATE FUNCTION check_entry_direction() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE FUNCTION check_category_directions() RETURNS trigger LANGUAGE plpgsql AS $$
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
COMMIT;