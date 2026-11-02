# Overvåking

`/api/metrics` er beskyttet med `METRICS_SECRET` og eksponerer:

| Metrikk | Betydning |
| --- | --- |
| `fsm_ready` | Database og opplastingsvolum er OK |
| `fsm_database_up` | Databasekontrollen svarer |
| `fsm_uploads_writable` | Opplastingsvolumet er skrivbart |
| `fsm_disk_used_ratio` / `fsm_disk_free_bytes` | Disk på opplastingsvolumet |
| `fsm_document_jobs{status="failed"}` | PDF/OCR-jobber som har gitt opp |
| `fsm_sms_messages{status="dead_letter"}` | SMS dead letters |
| `fsm_notification_email_failures` | Varsler som har gitt opp e-post |
| `fsm_backup_age_seconds` / `fsm_backup_fresh` | Backupalder fra statusfilen |
| `fsm_process_uptime_seconds` | Restart-signal (lav verdi = nylig restart) |

## Rask sjekk

```bash
curl -fsS -H "Authorization: Bearer $METRICS_SECRET" \
  http://127.0.0.1:3000/api/metrics | jq .queue,.backup
curl -fsS -H "Authorization: Bearer $METRICS_SECRET" \
  'http://127.0.0.1:3000/api/metrics?format=prometheus' | head
```

Uten `METRICS_SECRET` svarer ruten 503; feil token gir 401. Begge har
`Cache-Control: no-store`.

## Prometheus + Alertmanager

1. Kopier `prometheus.yml` og `fsm-alerts.yml` til Prometheus.
2. Legg hemmeligheten i `/etc/prometheus/fsm-metrics-token` (chmod 600).
3. Kopier `alertmanager.yml.example` og sett mottaker.
4. Start/relast:

```bash
promtool check config /etc/prometheus/prometheus.yml
promtool check rules /etc/prometheus/fsm-alerts.yml
systemctl reload prometheus alertmanager
```

Reglene dekker scrape-feil, readiness, restart, disk, backupalder, feilede
DocumentJob, SMS dead letters og permanente e-postfeil.

## Testvarsel

`scripts/ops-alert.sh --test` sender en testmelding til `ALERT_WEBHOOK_URL`.
Kjør den etter at kanalen er satt opp, og bekreft at meldingen faktisk kommer
fram:

```bash
sudo -u fsmbackup bash -c 'set -a; . /etc/fsm/fsm-alert.env; set +a; \
  /opt/fsm-platform/scripts/ops-alert.sh --test'
```

For Alertmanager kan du også bruke `amtool alert add` mot en testinstans.
Dokumenter i runbooken hvem som mottar varselet og hva som skjer utenfor
arbeidstid.

## Backup-målinger uten appen

`fsm-backup-check.service` kjører:

```bash
scripts/backup-freshness.sh \
  --prometheus-output /var/lib/node_exporter/textfile/fsm-backup.prom
```

Da får node_exporter `fsm_backup_present`, `fsm_backup_age_seconds`,
`fsm_backup_fresh`, `fsm_backup_checksum_ok` og `fsm_backup_remote_ok` selv om
appen er nede.

## Restart

Appen kan ikke lese Docker sin `RestartCount` fra containeren. Bruk
`fsm_process_uptime_seconds` som indikator, og suppler med en ekstern probe:

```bash
docker inspect --format '{{.RestartCount}}' \
  "$(docker compose -f docker-compose.prod.yml ps -q app)"
```
