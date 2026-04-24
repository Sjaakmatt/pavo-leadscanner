-- Geaggregeerde score per bedrijf, gefilterd op signalen < 30 dagen oud
-- zodat stale data niet doorlekt. De view is goedkoop genoeg om per
-- request te queryen; als het later een bottleneck wordt vervangen we
-- hem door een materialized view met refresh on insert.

create or replace view company_scores as
select
  c.kvk,
  c.naam,
  count(s.id) filter (where s.cluster = 1) as cluster_1_signals,
  count(s.id) filter (where s.cluster = 2) as cluster_2_signals,
  count(s.id) filter (where s.cluster = 3) as cluster_3_signals,
  count(s.id) filter (where s.cluster is null) as context_signals,
  coalesce(max(s.sterkte) filter (where s.cluster = 1), 0) as cluster_1_max_sterkte,
  coalesce(max(s.sterkte) filter (where s.cluster = 2), 0) as cluster_2_max_sterkte,
  coalesce(max(s.sterkte) filter (where s.cluster = 3), 0) as cluster_3_max_sterkte,
  max(s.detected_at) as last_signal_at
from companies c
left join signals s on s.kvk = c.kvk
  and s.detected_at > now() - interval '30 days'
group by c.kvk, c.naam;
