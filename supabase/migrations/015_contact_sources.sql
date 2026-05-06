-- Uitbreiding van lead_contacts.bron met deterministische website-bronnen.
--
-- Tot 015:
--   bron ∈ {kvk, website, handmatig}
--   - kvk:        bestuurders uit KvK-basisprofiel (naam + functie)
--   - website:    LLM-extractie uit gescrapete website-tekst
--   - handmatig:  sales heeft handmatig toegevoegd
--
-- Vanaf 015 splitten we 'website' op in drie sub-bronnen voor
-- traceability:
--   - website-jsonld:  Schema.org Organization/ContactPoint JSON-LD
--                      (deterministisch, hoge betrouwbaarheid)
--   - website-regex:   <a href="mailto:..."> + <a href="tel:...">
--                      uit raw HTML (deterministisch, footer-typisch)
--   - website-llm:     LLM-extractie van persoon-gerelateerde contacten
--                      uit cleaned text (huidige flow, lower-volume)
--
-- Bestaande 'website'-rijen blijven werken (legacy-waarde).

alter table lead_contacts
  drop constraint if exists lead_contacts_bron_check;

alter table lead_contacts
  add constraint lead_contacts_bron_check
  check (
    bron in (
      'kvk',
      'website',
      'website-jsonld',
      'website-regex',
      'website-llm',
      'handmatig'
    )
  );

comment on column lead_contacts.bron is
  'Bron van het contact. website-jsonld/website-regex zijn deterministisch (hoge betrouwbaarheid), website-llm is LLM-extractie. Legacy waarde "website" blijft geldig voor oude rijen.';
