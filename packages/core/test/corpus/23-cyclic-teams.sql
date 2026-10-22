CREATE TABLE teams (id serial PRIMARY KEY, name text NOT NULL UNIQUE, lead_id integer);
CREATE TABLE members (id serial PRIMARY KEY, team_id integer NOT NULL REFERENCES teams (id), name text NOT NULL, email text NOT NULL UNIQUE);
ALTER TABLE teams ADD CONSTRAINT teams_lead_fk FOREIGN KEY (lead_id) REFERENCES members (id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE projects (id serial PRIMARY KEY, team_id integer NOT NULL REFERENCES teams (id), name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')));
