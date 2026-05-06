-- Schema-version stamping voor MCP raw-cache.
--
-- Probleem: wanneer een MCP een nieuw veld toevoegt (bv. contactPoints,
-- portalsChecked, betere insolventie-output) zit er 14 dagen lang
-- onvolledige data in cache zonder dat de consumer dat merkt.
--
-- Oplossing: per cached payload onthouden welke schema-version 'm
-- produceerde. Cache-reader vergelijkt met de huidige tool-version
-- (gedefinieerd in lib/cache/schema-versions.ts). Mismatch → treat
-- as miss en re-fetch. De TTL-clock blijft ook gelden, dus de strictste
-- van (TTL, schema_version) wint.
--
-- Default 0 voor bestaande rijen — alle huidige cached payloads
-- worden bij eerstvolgende lookup gezien als "outdated" en herfetched.

alter table mcp_raw_responses
  add column if not exists schema_version int not null default 0;

create index if not exists idx_mcp_raw_responses_schema
  on mcp_raw_responses (tool, schema_version);

comment on column mcp_raw_responses.schema_version is
  'Bumped door consumer wanneer het response-schema van een MCP-tool wijzigt. Cache-reader skipt rijen met version < lib/cache/schema-versions.ts:TOOL_SCHEMA_VERSIONS[tool].';
