-- 007_kb_sources.sql
-- Insert fixed-UUID source rows for the INTELLECT support knowledge base.
-- These UUIDs are referenced by sync-notion-kb.ts and must never change.
--
--   000...0002  →  document  (Troubleshooting cases, Scripts, Safety docs)
--   000...0003  →  qa        (FAQ short Q&A pairs)
--
-- This migration is safe to re-run (ON CONFLICT DO NOTHING).

INSERT INTO sources (id, type, name, external_ref, is_active)
VALUES
    (
        '00000000-0000-0000-0000-000000000002',
        'document',
        'intellect-support-kb',
        'notion',
        TRUE
    ),
    (
        '00000000-0000-0000-0000-000000000003',
        'qa',
        'intellect-faq',
        'notion',
        TRUE
    )
ON CONFLICT (id) DO NOTHING;
