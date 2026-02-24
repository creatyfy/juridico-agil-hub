-- Monitoramento do core interno de notificações de movimentação processual.

-- 1) Total de notificações enviadas por dia (UTC).
SELECT
  date_trunc('day', sent_at) AS dia_utc,
  COUNT(*) AS total_enviadas
FROM public.notifications
WHERE status = 'sent'
  AND sent_at IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;

-- 2) Taxa de falha (%), considerando todo o histórico.
SELECT
  COUNT(*) FILTER (WHERE status = 'failed') AS total_falhas,
  COUNT(*) FILTER (WHERE status = 'sent') AS total_enviadas,
  COUNT(*) AS total_processadas,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'failed') / NULLIF(COUNT(*), 0),
    2
  ) AS taxa_falha_percentual
FROM public.notifications
WHERE status IN ('sent', 'failed');

-- 3) Processos com notificação pendente.
SELECT
  p.id AS processo_id,
  p.user_id AS tenant_id,
  p.numero_cnj,
  p.last_movement_at,
  p.last_notified_at,
  p.notification_pending,
  COALESCE(np.pending_notifications, 0) AS pending_notifications
FROM public.processos p
LEFT JOIN (
  SELECT process_id, COUNT(*) AS pending_notifications
  FROM public.notifications
  WHERE status = 'pending'
  GROUP BY process_id
) np ON np.process_id = p.id
WHERE p.notification_pending = true
   OR COALESCE(np.pending_notifications, 0) > 0
ORDER BY p.last_movement_at DESC NULLS LAST;
