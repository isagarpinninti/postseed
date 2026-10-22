CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    name text NOT NULL,
    email text,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    PRIMARY KEY (id)
);
CREATE TABLE public.todos (
    id integer NOT NULL,
    title text NOT NULL,
    is_completed boolean DEFAULT false NOT NULL,
    is_public boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL
);
CREATE SEQUENCE public.todos_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.todos_id_seq OWNED BY public.todos.id;
ALTER TABLE ONLY public.todos ALTER COLUMN id SET DEFAULT nextval('public.todos_id_seq'::regclass);
ALTER TABLE ONLY public.todos ADD CONSTRAINT todos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.todos ADD CONSTRAINT todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE RESTRICT ON DELETE CASCADE;
CREATE FUNCTION public.set_current_timestamp_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE _new record;
BEGIN _new := NEW; _new."updated_at" = NOW(); RETURN _new; END;
$$;
