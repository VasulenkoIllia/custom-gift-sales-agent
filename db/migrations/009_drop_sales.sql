-- 009_drop_sales.sql — retire all sales + legacy-KB machinery.
--
-- IRREVERSIBLE. Take a DB snapshot before applying.
-- Run order: this migration must run AFTER 008_kb_entries.sql and AFTER the
-- one-time Notion import (import-notion-to-kb.ts), because the import reads the
-- Notion API and writes kb_entries — it does NOT depend on chunks/sources, but
-- dropping chunks/sources here is final.
--
-- Defensive IF EXISTS / CASCADE because the live schema predates these migration
-- files (migrations 001–006 are empty; the schema was applied out-of-band).

-- Sales catalog + orders + legacy KB indexes
DROP TABLE IF EXISTS product_offer_stocks CASCADE;
DROP TABLE IF EXISTS offer_stocks         CASCADE;
DROP TABLE IF EXISTS product_offers       CASCADE;
DROP TABLE IF EXISTS product_categories   CASCADE;
DROP TABLE IF EXISTS products             CASCADE;
DROP TABLE IF EXISTS products_raw         CASCADE;
DROP TABLE IF EXISTS catalog_chunks       CASCADE;
DROP TABLE IF EXISTS catalog_embeddings   CASCADE;
DROP TABLE IF EXISTS followups            CASCADE;
DROP TABLE IF EXISTS crm_orders           CASCADE;
DROP TABLE IF EXISTS knowledge_items      CASCADE;
DROP TABLE IF EXISTS knowledge_embeddings CASCADE;

-- Unified KB superseded by kb_entries (direct retrieval, no compiled index):
DROP TABLE IF EXISTS chunks               CASCADE;
DROP TABLE IF EXISTS sources              CASCADE;

-- Strip sales fields from customer_memory (keep table for optional light history).
ALTER TABLE customer_memory
    DROP COLUMN IF EXISTS budget_min,
    DROP COLUMN IF EXISTS budget_max,
    DROP COLUMN IF EXISTS objections,
    DROP COLUMN IF EXISTS sales_stage,
    DROP COLUMN IF EXISTS occasion,
    DROP COLUMN IF EXISTS recipient,
    DROP COLUMN IF EXISTS urgency,
    DROP COLUMN IF EXISTS rejected_product_ids;
