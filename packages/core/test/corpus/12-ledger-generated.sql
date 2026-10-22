CREATE TABLE accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(12) NOT NULL UNIQUE,
  name text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE journal_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posted_on date NOT NULL,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE entry_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES accounts (id),
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  net numeric(14,2) GENERATED ALWAYS AS (debit - credit) STORED
);
CREATE UNIQUE INDEX entry_lines_unique ON entry_lines (entry_id, account_id);
