CREATE TABLE posts (id bigserial PRIMARY KEY, title text NOT NULL);
CREATE TABLE photos (id bigserial PRIMARY KEY, url text NOT NULL);
CREATE TABLE comments (id bigserial PRIMARY KEY, commentable_type varchar(30) NOT NULL, commentable_id bigint NOT NULL, body text NOT NULL, created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX index_comments_on_commentable ON comments (commentable_type, commentable_id);
CREATE TABLE entities (id bigserial PRIMARY KEY, kind varchar(20) NOT NULL, name text NOT NULL);
CREATE TABLE attributes (id serial PRIMARY KEY, name varchar(40) NOT NULL UNIQUE, data_type varchar(10) NOT NULL CHECK (data_type IN ('string', 'number', 'boolean', 'date')));
CREATE TABLE entity_values (entity_id bigint NOT NULL REFERENCES entities (id) ON DELETE CASCADE, attribute_id integer NOT NULL REFERENCES attributes (id), value_text text, value_number numeric(18,4), value_bool boolean, PRIMARY KEY (entity_id, attribute_id));
