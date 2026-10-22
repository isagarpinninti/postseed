SET statement_timeout = 0;
SET client_encoding = 'UTF8';

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE TABLE public.accounts (
    id bigint NOT NULL,
    name character varying NOT NULL,
    subdomain character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);

CREATE SEQUENCE public.accounts_id_seq
    START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;

CREATE TABLE public.users (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    email character varying DEFAULT ''::character varying NOT NULL,
    encrypted_password character varying DEFAULT ''::character varying NOT NULL,
    admin boolean DEFAULT false NOT NULL,
    sign_in_count integer DEFAULT 0 NOT NULL,
    last_sign_in_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);

CREATE SEQUENCE public.users_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;

CREATE TABLE public.projects (
    id bigint NOT NULL,
    account_id bigint NOT NULL,
    owner_id bigint,
    name character varying NOT NULL,
    description text,
    budget_cents integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);

CREATE SEQUENCE public.projects_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;

CREATE TABLE public.tasks (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    assignee_id bigint,
    title character varying NOT NULL,
    done boolean DEFAULT false NOT NULL,
    due_on date,
    position integer,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);

CREATE SEQUENCE public.tasks_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);
ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);

ALTER TABLE ONLY public.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.schema_migrations ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);

CREATE UNIQUE INDEX index_accounts_on_subdomain ON public.accounts USING btree (subdomain);
CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);
CREATE INDEX index_users_on_account_id ON public.users USING btree (account_id);
CREATE INDEX index_projects_on_account_id ON public.projects USING btree (account_id);
CREATE INDEX index_tasks_on_project_id ON public.tasks USING btree (project_id);

ALTER TABLE ONLY public.projects ADD CONSTRAINT fk_rails_aaa FOREIGN KEY (account_id) REFERENCES public.accounts(id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT fk_rails_bbb FOREIGN KEY (project_id) REFERENCES public.projects(id);
ALTER TABLE ONLY public.users ADD CONSTRAINT fk_rails_ccc FOREIGN KEY (account_id) REFERENCES public.accounts(id);
ALTER TABLE ONLY public.projects ADD CONSTRAINT fk_rails_ddd FOREIGN KEY (owner_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.tasks ADD CONSTRAINT fk_rails_eee FOREIGN KEY (assignee_id) REFERENCES public.users(id);

INSERT INTO "schema_migrations" (version) VALUES ('20240101000000');
