# Coupe du Monde 2026 — Déploiement Cloud-Native

Application Node.js + PostgreSQL pour suivre la Coupe du Monde 2026, déployée sur un cluster **k3s** multi-nœuds (homelab Proxmox) avec auto-scaling, haute disponibilité, observabilité et pipeline CI/CD.

**Dépôt :** [github.com/omega5z/cloud_worldcup](https://github.com/omega5z/cloud_worldcup)

---

## Accès production

| Service | URL |
|---------|-----|
| Application (public) | https://worldcup.yohanvelay.nybtech.fr |
| Application (LAN) | https://worldcup.internal.nybtech.fr |
| Métriques Prometheus | https://worldcup.yohanvelay.nybtech.fr/metrics |
| Grafana | https://grafana-worldcup.internal.nybtech.fr |
| Image Docker | `ghcr.io/omega5z/cloud_worldcup:latest` |

---

## Architecture

```
Internet / LAN
      │
      ▼
┌─────────────┐
│    Caddy    │  TLS (Let's Encrypt) · CT 100 (interne) / CT 102 (public)
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────────────────────────┐
│  Service    │────▶│  Deployment app (2–6 replicas)     │
│  ClusterIP  │     │  HPA · probes · anti-affinité      │
└─────────────┘     └──────────────┬───────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
            ┌─────────────┐  ┌──────────┐  ┌─────────────┐
            │ CNPG Postgres│  │ CronJob  │  │ Prometheus  │
            │ 3 instances  │  │ standings│  │ + Grafana   │
            └─────────────┘  └──────────┘  └─────────────┘
```

**Infrastructure :** VM `worldcup-k8s` (Proxmox) · k3s multi-nœuds · CloudNative-PG · exposition via Caddy · monitoring `kube-prometheus-stack`.

---

## Fonctionnalités

| Domaine | Implémentation |
|---------|----------------|
| **Conteneurisation** | Dockerfile multi-stage (`node:22-alpine`), `npm ci --omit=dev`, utilisateur non-root, `HEALTHCHECK` |
| **Orchestration** | Namespace `worldcup`, Deployment 2 réplicas, HPA CPU 60 % (2–6 pods), probes startup/liveness/readiness |
| **Base de données** | Cluster PostgreSQL CNPG (3 instances, anti-affinité, `local-path`) |
| **Résilience** | Self-healing K8s, `POST /api/admin/kill` pour crash-test, rolling updates |
| **Élasticité** | HPA + tests de charge [kube-burner](kube-burner/) |
| **Observabilité** | Métriques `prom-client`, ServiceMonitor, dashboard Grafana, alertes Prometheus |
| **Industrialisation** | GitHub Actions : tests, scan Trivy, build GHCR, déploiement kubectl |
| **Job créatif** | CronJob toutes les 30 min — calcul et snapshot des classements |

---

## Démarrage rapide (local)

```bash
git clone git@github.com:omega5z/cloud_worldcup.git
cd cloud_worldcup

cp .env.dist .env
docker compose up --build
```

```bash
curl http://localhost:3000/api/health          # {"status":"ok"}
curl http://localhost:3000/api/health/db       # vérifie PostgreSQL
curl http://localhost:3000/metrics             # métriques Prometheus
```

### Tests

```bash
cd app && npm ci && npm test
```

---

## Structure du projet

```
cloud_worldcup/
├── app/                        # Application Node.js (Express)
│   ├── main.js                 # API REST, métriques, health checks
│   ├── services/standing.js    # Logique de classement
│   ├── jobs/jobs-standind.js   # Job CronJob (snapshot standings)
│   ├── public/                 # Frontend statique
│   ├── init.sql                # Schéma et données initiales
│   ├── Dockerfile              # Image optimisée multi-stage
│   └── tests/                  # Tests property-based (Jest + fast-check)
├── k8s/                        # Manifestes Kubernetes
│   ├── app/                    # Deployment, Service, HPA
│   ├── postgres/               # Cluster CNPG + init ConfigMap
│   ├── monitoring/             # ServiceMonitor, règles, dashboard Grafana
│   └── cron-job.yaml           # CronJob classements
├── kube-burner/                # Scénarios de charge (HPA, users)
├── scripts/kube-burner.sh      # Wrapper local pour kube-burner
├── .github/workflows/deploy.yml # CI/CD (test → scan → build → deploy)
├── docker-compose.yml          # Environnement local
└── docs/                       # Guides détaillés (voir ci-dessous)
```

---

## Déploiement Kubernetes

Le déploiement cible un cluster **k3s** sur homelab Proxmox. Les manifestes sont dans `k8s/`.

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
# Secrets : db-credentials, ghcr-credentials, postgres-cnpg-auth (hors Git)
kubectl apply -f k8s/postgres/
kubectl apply -f k8s/app/
kubectl apply -f k8s/cron-job.yaml
kubectl apply -f k8s/monitoring/
```

Guide complet : [docs/GUIDE-DEPLOIEMENT-HOMELAB.md](docs/GUIDE-DEPLOIEMENT-HOMELAB.md)

Variante VPS cloud : [docs/GUIDE-DEPLOIEMENT-K8S-VPS.md](docs/GUIDE-DEPLOIEMENT-K8S-VPS.md)

---

## CI/CD

Le workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) s'exécute sur chaque push vers `main` :

1. `npm test` (avec retry sur flaky tests)
2. Scan Trivy (fail on HIGH/CRITICAL)
3. Build et push vers GHCR (`:latest` + `:${{ github.sha }}`)
4. Rolling update du Deployment via `kubectl set image`

**Secrets / variables GitHub requis :** `KUBE_SERVER`, `KUBE_TOKEN` (ou `KUBE_CONFIG_B64`), `K8S_NAMESPACE`, `K8S_DEPLOYMENT`, `K8S_CONTAINER`.

---

## Tests de charge

```bash
./scripts/kube-burner.sh install    # installe kube-burner localement
./scripts/kube-burner.sh hpa        # charge CPU → déclenche le HPA
./scripts/kube-burner.sh users      # charge HTTP sur l'API
./scripts/kube-burner.sh cleanup    # nettoie les ressources de test
```

---

## Documentation

| Guide | Contenu |
|-------|---------|
| [GUIDE-ETUDIANT.md](docs/GUIDE-ETUDIANT.md) | Routes API, variables d'environnement, exemples curl |
| [GUIDE-DEPLOIEMENT-HOMELAB.md](docs/GUIDE-DEPLOIEMENT-HOMELAB.md) | Déploiement k3s sur homelab Proxmox + Caddy |
| [GUIDE-DEPLOIEMENT-K8S-VPS.md](docs/GUIDE-DEPLOIEMENT-K8S-VPS.md) | Variante déploiement sur VPS |
| [GUIDE-K3S-MULTI-NODE-PROXMOX.md](docs/GUIDE-K3S-MULTI-NODE-PROXMOX.md) | Cluster k3s multi-nœuds |
| [GUIDE-POSTGRES-CNPG-HOMELAB.md](docs/GUIDE-POSTGRES-CNPG-HOMELAB.md) | PostgreSQL CloudNative-PG |
| [GUIDE-PROMETHEUS-GRAFANA-WORLDCUP.md](docs/GUIDE-PROMETHEUS-GRAFANA-WORLDCUP.md) | Stack monitoring |
| [GUIDE-ALERTES-WORLDCUP.md](docs/GUIDE-ALERTES-WORLDCUP.md) | Alertes Prometheus / Alertmanager |
| [GUIDE-BESZEL-RYBBIT-WORLDCUP.md](docs/GUIDE-BESZEL-RYBBIT-WORLDCUP.md) | Monitoring hôte + analytics web |
| [OPTIMISATION.md](docs/OPTIMISATION.md) | Optimisation Dockerfile (avant/après) |
| [AUDIT_ARCHITECTURE.md](docs/AUDIT_ARCHITECTURE.md) | Audit technique de l'existant |

---

## Contexte

Projet capstone Ynov — migration et modernisation d'une application monolithique vers une plateforme cloud-native capable d'absorber les pics de trafic d'une Coupe du Monde, avec démonstration de haute disponibilité, élasticité, résilience et observabilité.
