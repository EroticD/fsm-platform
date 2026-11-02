# Automatisk backup med systemd

Disse enhetene kjører `scripts/backup.sh` daglig, kontrollerer ferskhet og
sjekksum daglig, og kjører `scripts/restore-test.sh` ukentlig. Alle har
`OnFailure=fsm-alert@%n.service`, som sender varsel via
`scripts/ops-alert.sh`.

## 1. Installer

```bash
sudo cp deploy/systemd/fsm-*.service deploy/systemd/fsm-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

Rediger stiene i enhetene hvis repoet ikke ligger i `/opt/fsm-platform`.

## 2. Lag driftsbruker

```bash
sudo useradd --system --home /opt/fsm-platform --shell /usr/sbin/nologin fsmbackup
sudo usermod -aG docker fsmbackup
```

`docker`-gruppen er i praksis root-ekvivalent. Bruk en dedikert driftsbruker
og begrens hvem som kan logge inn som den.

## 3. Miljøfiler

`/etc/fsm/fsm-backup.env` (chmod 600, eid av fsmbackup):

```dotenv
NODE_ENV=production
COMPOSE_FILE=docker-compose.prod.yml
BACKUP_DIR=/var/backups/fsm
BACKUP_STATUS_FILE=/opt/fsm-platform/monitoring/backup-status.json
BACKUP_AGE_RECIPIENT=age1...
BACKUP_REMOTE=remote:fsm-backups
RETENTION_DAYS=30
# AGE_IDENTITY=/sikker/age/keys.txt
```

`/etc/fsm/fsm-alert.env` (chmod 600, eid av root):

```dotenv
ALERT_WEBHOOK_URL=https://...
# generic (standard), alertmanager eller slack
ALERT_WEBHOOK_FORMAT=generic
```

`monitoring/`-mappen må finnes og være skrivbar for `fsmbackup`, slik at
Compose kan montere den read-only inn i appen:

```bash
sudo install -d -o fsmbackup -g fsmbackup /opt/fsm-platform/monitoring
```

## 4. Aktiver

```bash
sudo systemctl enable --now fsm-backup.timer fsm-backup-check.timer fsm-restore-test.timer
systemctl list-timers 'fsm-*'
```

Test varslingskanalen bevisst:

```bash
sudo bash -c 'set -a; . /etc/fsm/fsm-alert.env; set +a; \
  /opt/fsm-platform/scripts/ops-alert.sh --test'
```

Kjør en manuell runde før du stoler på timeren:

```bash
sudo systemctl start fsm-backup.service
sudo systemctl start fsm-backup-check.service
sudo systemctl start fsm-restore-test.service
journalctl -u fsm-backup.service -u fsm-backup-check.service -u fsm-restore-test.service -n 100
```

## 5. Overvåk

- `fsm-backup-check.timer` feiler hvis siste backup er eldre enn
  `BACKUP_MAX_AGE_HOURS` (standard 26), sjekksummen er feil, eller den
  eksterne kopien mangler når `REQUIRE_REMOTE_BACKUP=true`.
- Appens `/api/metrics` leser samme statusfil og eksponerer
  `fsm_backup_age_seconds` og `fsm_backup_fresh`.
- `fsm-restore-test.service` feiler hvis en gjenoppretting ikke gir en brukbar
  database. Det er den eneste testen som beviser at backupen faktisk kan
  brukes.

Se `docs/OPERATIONS.md` for RPO/RTO og nøkkelgjenoppretting.
