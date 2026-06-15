--
-- PostgreSQL database dump
--

\restrict LV2uLSZN89HVHBfZYxx1baloEIyB2kGofmShBUYXrlvdCxigZnN0qpZb2HzgxPu

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg12+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: kb_search_key(text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_search_key(q text, a text[]) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ SELECT q || ' ' || array_to_string(a, ' ') $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    persona text DEFAULT ''::text NOT NULL,
    instructions text DEFAULT ''::text NOT NULL,
    welcome_message text DEFAULT ''::text NOT NULL,
    fallback_message text DEFAULT ''::text NOT NULL,
    model text DEFAULT 'gpt-4.1-mini'::text NOT NULL,
    language text DEFAULT 'uk'::text NOT NULL,
    extra_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    last_message_at timestamp with time zone,
    CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel text NOT NULL,
    external_user_id text NOT NULL,
    full_name text,
    username text,
    phone text,
    locale text,
    timezone text,
    profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_channel_check CHECK ((channel = ANY (ARRAY['telegram'::text, 'instagram'::text, 'whatsapp'::text, 'facebook'::text, 'tiktok'::text])))
);


--
-- Name: integration_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_events (
    id bigint NOT NULL,
    event_type text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_error text,
    next_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.integration_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: integration_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.integration_events_id_seq OWNED BY public.integration_events.id;


--
-- Name: kb_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_type text DEFAULT 'faq'::text NOT NULL,
    category text,
    question text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    answer text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    embedding public.vector(1536),
    search_key text GENERATED ALWAYS AS (public.kb_search_key(question, aliases)) STORED,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, public.kb_search_key(question, aliases))) STORED,
    source_ref text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['faq'::text, 'guide'::text]))),
    CONSTRAINT kb_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    direction text NOT NULL,
    channel_message_id text,
    text_content text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])))
);


--
-- Name: rate_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_counters (
    customer_id uuid NOT NULL,
    window_kind text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: response_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_cache (
    query_hash text NOT NULL,
    answer text NOT NULL,
    used_matches integer DEFAULT 0 NOT NULL,
    kb_version bigint NOT NULL,
    hits integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_runs (
    id bigint NOT NULL,
    source text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT sync_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text])))
);


--
-- Name: sync_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_runs_id_seq OWNED BY public.sync_runs.id;


--
-- Name: telegram_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telegram_updates (
    update_id bigint NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: token_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid,
    conversation_id uuid,
    kind text NOT NULL,
    model text NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_abuse_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_abuse_state (
    customer_id uuid NOT NULL,
    strikes integer DEFAULT 0 NOT NULL,
    muted_until timestamp with time zone,
    last_strike_at timestamp with time zone,
    last_text_hash text,
    repeat_count integer DEFAULT 0 NOT NULL,
    notice_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_events ALTER COLUMN id SET DEFAULT nextval('public.integration_events_id_seq'::regclass);


--
-- Name: sync_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs ALTER COLUMN id SET DEFAULT nextval('public.sync_runs_id_seq'::regclass);


--
-- Name: agents agents_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_name_key UNIQUE (name);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: customers customers_channel_external_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_channel_external_user_id_key UNIQUE (channel, external_user_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: integration_events integration_events_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: integration_events integration_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_pkey PRIMARY KEY (id);


--
-- Name: kb_entries kb_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_entries
    ADD CONSTRAINT kb_entries_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: rate_counters rate_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_counters
    ADD CONSTRAINT rate_counters_pkey PRIMARY KEY (customer_id, window_kind, window_start);


--
-- Name: response_cache response_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_cache
    ADD CONSTRAINT response_cache_pkey PRIMARY KEY (query_hash);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sync_runs sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_runs
    ADD CONSTRAINT sync_runs_pkey PRIMARY KEY (id);


--
-- Name: telegram_updates telegram_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telegram_updates
    ADD CONSTRAINT telegram_updates_pkey PRIMARY KEY (update_id);


--
-- Name: token_usage token_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_usage
    ADD CONSTRAINT token_usage_pkey PRIMARY KEY (id);


--
-- Name: user_abuse_state user_abuse_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_abuse_state
    ADD CONSTRAINT user_abuse_state_pkey PRIMARY KEY (customer_id);


--
-- Name: idx_conversations_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_customer ON public.conversations USING btree (customer_id);


--
-- Name: idx_conversations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_status ON public.conversations USING btree (status);


--
-- Name: idx_integration_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_events_status ON public.integration_events USING btree (status, next_retry_at);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_messages_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_customer ON public.messages USING btree (customer_id, created_at);


--
-- Name: idx_messages_outbound_payload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_outbound_payload ON public.messages USING btree ((((payload -> 'ai'::text) -> 'presented_product_ids'::text))) WHERE (direction = 'outbound'::text);


--
-- Name: kb_entries_category_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_entries_category_status_idx ON public.kb_entries USING btree (category, status);


--
-- Name: kb_entries_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_entries_embedding_idx ON public.kb_entries USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: kb_entries_search_key_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_entries_search_key_trgm_idx ON public.kb_entries USING gin (search_key public.gin_trgm_ops);


--
-- Name: kb_entries_tsv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_entries_tsv_idx ON public.kb_entries USING gin (tsv);


--
-- Name: rate_counters_window_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_counters_window_start_idx ON public.rate_counters USING btree (window_start);


--
-- Name: response_cache_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX response_cache_expires_at_idx ON public.response_cache USING btree (expires_at);


--
-- Name: token_usage_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX token_usage_created_at_idx ON public.token_usage USING btree (created_at);


--
-- Name: token_usage_customer_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX token_usage_customer_day_idx ON public.token_usage USING btree (customer_id, created_at);


--
-- Name: user_abuse_state_muted_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_abuse_state_muted_until_idx ON public.user_abuse_state USING btree (muted_until) WHERE (muted_until IS NOT NULL);


--
-- Name: conversations conversations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: rate_counters rate_counters_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_counters
    ADD CONSTRAINT rate_counters_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: token_usage token_usage_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_usage
    ADD CONSTRAINT token_usage_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: user_abuse_state user_abuse_state_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_abuse_state
    ADD CONSTRAINT user_abuse_state_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict LV2uLSZN89HVHBfZYxx1baloEIyB2kGofmShBUYXrlvdCxigZnN0qpZb2HzgxPu

