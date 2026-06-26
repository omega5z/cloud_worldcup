# Audit technique de l'existant

> **Dernière mise à jour :** 2026-06-26  
> **Périmètre :** `app/`, `docker-compose.yml`, `.env.dist`, `.dockerignore`, `docs/`, `README.md`

### Légende des statuts

| Symbole | Signification |
|---------|---------------|
| 🔴 | Ouvert — non traité |
| 🟡 | Partiel — amélioration en cours ou incomplète |
| 🟢 | Résolu |

---

## 1. Architecture

### Structure du projet

Le dépôt est organisé autour d'un monolithe simple :

- `app/main.js` : cœur applicatif unique (API Express, logique métier, PostgreSQL, métriques, démarrage serveur).
- `app/public/` : frontend statique HTML/CSS/JS (`app.js` appelle directement les endpoints API).
- `app/tests/` : tests de propriétés et validations fonctionnelles.
- `app/init.sql` : schéma SQL et données initiales.
- `app/Dockerfile` : définition de l'image applicative (à optimiser).
- `docker-compose.yml` : orchestration locale app + PostgreSQL.
- `.env.dist` / `.env` : variables d'environnement (secrets hors Git).
- `docs/` : documentation technique (`GUIDE-ETUDIANT.md`, `OPTIMISATION.md`, cet audit).

### Responsabilités par dossier

- `app/main.js` assume plusieurs responsabilités :
  - création de l'application Express et middleware (`express.json`, métriques, static),
  - définition des routes API,
  - configuration du pool PostgreSQL,
  - collecte des métriques Prometheus,
  - démarrage du serveur,
  - logique métier (matchs, votes, classements).
- `app/public` contient uniquement l'interface utilisateur, couplée aux routes REST.
- `app/init.sql` définit le modèle de données et les données de départ.
- `app/tests` valident le comportement de certaines routes et du Dockerfile.

### Organisation du code

Le code est globalement linéaire et centralisé. Il n'existe pas de séparation nette entre :

- couche HTTP,
- couche service,
- couche accès aux données,
- couche configuration.

### Couplage entre composants

Le couplage est élevé :

- la logique métier est intégrée dans la même unité que la configuration HTTP,
- les routes accèdent directement à la base via le pool PostgreSQL défini dans le même fichier,
- le frontend JavaScript (`app/public/app.js`) connaît directement les endpoints de l'API.

### Qualité de l'architecture

L'architecture est adaptée à une démonstration pédagogique, mais elle n'est pas structurée pour une architecture cloud-native robuste :

- monolithique,
- peu modulable,
- difficile à faire évoluer sans accroître la complexité,
- peu adaptée à un découpage en services ou à une montée en charge par réplication maîtrisée.

---

## 2. Docker

**Taille image actuelle (mesurée) :** ~198 MB dont ~66 MB de `node_modules` (devDependencies incluses).

### Anti-patterns observés

| # | Problème | Statut | Détail |
|---|----------|:------:|--------|
| 1 | Fausse multi-stage | 🔴 | `AS builder` sans second `FROM` — une seule stage effective |
| 2 | Pas de séparation prod/dev | 🔴 | `npm install` sans `--omit=dev` → Jest, Supertest dans l'image |
| 3 | `COPY . .` copie tout le contexte | 🔴 | `tests/`, `init.sql`, `Dockerfile` embarqués dans l'image |
| 4 | `.dockerignore` inefficace | 🔴 | Fichier à la **racine** du repo, mais `build: ./app` → Docker lit `app/.dockerignore` qui **n'existe pas** |
| 5 | `npm install` au lieu de `npm ci` | 🔴 | `package-lock.json` présent mais non exploité |
| 6 | Pas de `NODE_ENV=production` | 🔴 | Comportement runtime moins maîtrisé |
| 7 | Pas de `HEALTHCHECK` image | 🔴 | Pas de signal de santé au niveau conteneur |
| 8 | Ownership `USER node` incorrect | 🔴 | `npm install` en root → `node_modules` appartient à root (uid 0), app tourne en `node` (uid 1000) |

### Fichiers confirmés dans l'image (build réel)

| Fichier | Attendu en image app ? |
|---------|:----------------------:|
| `tests/` | Non |
| `init.sql` | Non (rôle du conteneur Postgres) |
| `jest.config.js` | Non |
| `Dockerfile` | Non |

### Score bonnes pratiques (`check-dockerfile.sh`)

| Critère | État |
|---------|:----:|
| Image alpine avec version fixe | ✅ |
| USER non-root | ⚠️ partiel |
| Multi-stage réel | ❌ |
| `.dockerignore` effectif | ❌ |
| Ordre des layers optimisé | ✅ |

**Score effectif : ~2–3/5**

### Impact global

Ces points affectent la taille de l'image, la sécurité, la reproductibilité des builds, la vitesse de construction et la fiabilité opérationnelle sur Kubernetes ou ECS.

---

## 3. Docker Compose

### Réseau 🔴

- Réseau Docker par défaut, aucun réseau personnalisé ou segmenté.

### Volumes 🟡

- Volume nommé `pgdata` pour PostgreSQL — persistance locale OK.
- `init.sql` monté dans `/docker-entrypoint-initdb.d/`.
- **Piège :** le script ne s'exécute **qu'au premier démarrage** (volume vide). Modifier `init.sql` sans `docker compose down -v` ne change rien.

### Variables d'environnement 🟡

- 🟢 **Résolu (local) :** secrets externalisés via `.env` (gitignoré) et `.env.dist` (modèle versionné).
- Le compose référence `${POSTGRES_USER}`, `${POSTGRES_PASSWORD}`, `${POSTGRES_DB}`, `${DB_HOST}`, `${DB_PORT}` — plus de mots de passe en dur dans `docker-compose.yml`.
- 🔴 **Ouvert (prod) :** pas de `Secret` Kubernetes équivalent.

### Dépendances entre services 🔴

- `depends_on: db` attend le démarrage du conteneur, pas la disponibilité de PostgreSQL.
- L'app peut démarrer avant la fin de l'initialisation (`init.sql`).

### Healthchecks 🔴

- Aucun healthcheck dans `docker-compose.yml`.
- Issues GitHub : [#2](https://github.com/omega5z/cloud_worldcup/issues/2), [#3](https://github.com/omega5z/cloud_worldcup/issues/3).

### Redémarrage 🔴

- Aucune politique `restart` sur `app`.
- Après `/api/admin/kill`, le conteneur reste en état `Exited`.
- Issue GitHub : [#1](https://github.com/omega5z/cloud_worldcup/issues/1).

### Autres points 🔴

- `version: "3.8"` obsolète (warning Compose v2).
- Tag `postgres:15` flottant — Issue [#4](https://github.com/omega5z/cloud_worldcup/issues/4).
- Pas de limites CPU/RAM — Issue [#5](https://github.com/omega5z/cloud_worldcup/issues/5).
- Port `3000:3000` bind sur `0.0.0.0` (toutes interfaces).

### Ports exposés 🟡

- Application exposée sur le port 3000 de l'hôte.
- PostgreSQL non exposé sur l'hôte — cohérent pour un usage local.

---

## 4. Application

### Cycle de vie

- création du pool PostgreSQL au chargement du module,
- création de l'application Express,
- enregistrement des routes et middleware,
- démarrage du serveur si exécuté comme point d'entrée principal (`require.main === module`).

### Démarrage 🔴

- Port **3000 codé en dur** — pas de `process.env.PORT`.
- Pas de vérification PostgreSQL avant d'accepter des requêtes.
- Pas de gestion `SIGTERM` / `SIGINT` — rolling updates K8s risqués.

### Gestion des erreurs 🔴

- Erreurs traitées localement dans les routes.
- Middleware pour erreurs de parsing JSON.
- Pas de journalisation structurée ni d'exception handling centralisé.

### Connexions PostgreSQL 🟡

- `pg.Pool` avec configuration via variables d'environnement.
- Valeurs par défaut sensibles dans le code (`postgres` / `postgres` / `db`).
- Pas de retry, timeout fin ni reconnexion explicite.
- Pool créé à l'import du module.

### Gestion des secrets 🟡

- 🟢 Compose : credentials via `.env`.
- 🔴 Code : defaults `postgres`/`postgres` dans `main.js` si variables absentes.
- 🔴 Prod : pas de Secret K8s.

### Endpoints

| Route | Méthode | Rôle |
|-------|---------|------|
| `/` | GET | Page web (`index.html`) — **pas** un health check JSON |
| `/api/health` | GET | Health check applicatif → `{"status":"ok"}` |
| `/api/health/db` | GET | Health check PostgreSQL |
| `/api/compute` | GET | Saturation CPU (2–3 s) |
| `/api/teams` | GET | Liste des équipes |
| `/api/groups` | GET | Équipes par groupe |
| `/api/matches` | GET | Liste des matchs |
| `/api/standings` | GET | Classement |
| `/api/data` | POST | Insertion résultat match |
| `/api/vote` | POST | Vote pour une équipe |
| `/api/votes/results` | GET | Résultats des votes (%) |
| `/metrics` | GET | Métriques Prometheus |
| `/api/admin/kill` | POST | Crash volontaire (`process.exit(1)`) |

**Probes Kubernetes recommandées :**

- `livenessProbe` → `/api/health` (ne pas utiliser `/api/health/db`)
- `readinessProbe` → `/api/health/db`

### Métriques Prometheus 🟡

- `prom-client` : métriques runtime Node.js + HTTP custom.
- Stockage en mémoire par processus — chaque replica a ses propres compteurs.
- `/metrics` exposé mais aucun collecteur (Prometheus/Grafana) configuré.

### Endpoint de crash 🔴

- `/api/admin/kill` arrête volontairement le processus.
- Utile pour le crash-test capstone ; à protéger en production (NetworkPolicy, Ingress).

---

## 5. PostgreSQL

### Structure SQL

Schéma simple : `teams`, `matches`, `votes`.

### Index 🔴

- Aucun index métier au-delà des PK/FK — limitant si le volume croît.

### Initialisation 🟡

- Script idempotent : `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`.
- Exécuté une seule fois par volume PostgreSQL (comportement standard `docker-entrypoint-initdb.d`).

### Persistance 🟡

- Volume Docker `pgdata` en local.
- Pas de PVC Kubernetes, sauvegarde ni stratégie de restauration documentée.

### Risques 🔴

- Pas de migrations versionnées.
- Pas de réplication ni HA.
- Single Point of Failure.

---

## 6. Cloud Readiness

### Prêt pour Kubernetes 🔴

| Élément | État |
|---------|:----:|
| Healthchecks conteneur | 🔴 |
| Politique de redémarrage | 🔴 |
| Limits/requests CPU/RAM | 🔴 |
| Liveness / readiness probes | 🔴 (endpoints existent, pas de manifests) |
| Secrets externes (K8s Secret) | 🔴 |
| Manifestes Kubernetes | 🔴 |
| Graceful shutdown (`SIGTERM`) | 🔴 |
| Variable `PORT` | 🔴 |
| Dockerfile production-ready | 🔴 |

### Prêt pour AWS ECS 🔴

Conteneur Docker possible, mais pas de service discovery, health checks orchestrateur, auto-scaling, secrets managés, logging centralisé ni réseau défini.

### Auto Scaling 🔴

- `/metrics` expose des métriques Prometheus exploitables, mais **aucun collecteur** ni HPA configuré.
- Pas de configuration de ressources.
- `/api/compute` est un cas d'école pour déclencher un HPA CPU.

### Load Balancer 🔴

Aucun load balancer ou Ingress défini.

### Plusieurs réplicas 🟡

Problématique sans préparation :

- métriques locales par Pod (scraping per-Pod nécessaire),
- endpoint de crash volontaire,
- base PostgreSQL unique (SPOF),
- pas d'état partagé côté app (acceptable pour ce monolithe stateless).

### Blocages principaux pour un déploiement cloud-native

1. Dockerfile non optimisé et `.dockerignore` inefficace.
2. Compose sans résilience (restart, healthchecks) — non représentatif d'un Deployment K8s.
3. Pas de manifestes K8s ni de pipeline CI build/push image.
4. Observabilité non centralisée (logs, dashboards, alerting).
5. Base unique sans HA.
6. Secrets K8s non implémentés (partiel en local via `.env`).

---

## 7. Observabilité

### Logs 🔴

- Très limités (`console.log` au démarrage).
- Pas de logging structuré.
- Erreurs renvoyées en HTTP, peu journalisées.

### Métriques 🟡

- Prometheus endpoint présent (`/metrics`).
- Pas de chaîne de monitoring complète (collecteur, dashboards).

### Traces 🔴

- Aucune trace distribuée ni identifiant de requête.

### Alerting 🔴

- Aucun mécanisme d'alerting.

### Dashboards 🔴

- Aucun dashboard fourni.

---

## 8. Sécurité

### Secrets 🟡

- 🟢 Compose : externalisés dans `.env`.
- 🔴 `main.js` : valeurs par défaut `postgres`/`postgres`.
- 🔴 K8s : pas de Secret.

### Utilisateur root 🟡

- `USER node` présent — positif en apparence.
- `npm install` et `COPY` en root ; `node_modules` non owned par `node`.

### Permissions 🔴

- Pas d'authentification ni d'autorisation.
- Endpoints d'écriture ouverts sans contrôle d'accès.

### Dépendances 🟡

- Versions `^` dans `package.json` ; `package-lock.json` présent mais `npm ci` non utilisé dans le Dockerfile.
- Pas de scan de vulnérabilités visible.

### Surface d'attaque 🔴

- Endpoints d'écriture et crash volontaire exposés.
- Pas de rate limiting ni limite de payload visible.

### Exposition réseau 🟡

- App sur port 3000 (bind `0.0.0.0` en compose).
- Postgres interne au réseau Docker uniquement.

---

## 9. Performances

### Goulets d'étranglement

- `/api/compute` : saturation CPU volontaire (2–3 s).
- Classement calculé côté application — coûteux si les données grossissent.

### Connexions base de données 🟡

- Pool PostgreSQL présent — bon point de départ.
- Taille et stratégie du pool non configurées.

### CPU / mémoire 🔴

- Sensible aux pics via `/api/compute`.
- Métriques Prometheus en mémoire, pas de limites conteneur.

---

## 10. Résilience

### Single Point Of Failure 🔴

- Un seul service applicatif et une seule base PostgreSQL.
- Pas de redondance.

### Comportement en cas de crash 🔴

- `/api/admin/kill` arrête le processus.
- Sans `restart` dans compose, l'app reste hors service.
- En K8s : `restartPolicy: Always` recréerait le Pod.

### Comportement si PostgreSQL tombe 🟡

- Routes DB retournent des erreurs (`503` sur `/api/health/db`).
- Pas de dégradation gracieuse ni fallback.

### Multi-instances 🟡

- App stateless (OK pour replicas).
- Métriques non partagées entre Pods.
- Nécessite readiness probe sur `/api/health/db`.

---

## 11. Préparation Kubernetes — VPS local

Objectif capstone : déployer sur **Kubernetes** (k3s, kubeadm) sur un VPS.

### Mapping Compose → Kubernetes

| Compose | Kubernetes |
|---------|------------|
| `build: ./app` | CI → registry → `image:` dans Deployment |
| `.env` | `Secret` + `ConfigMap` |
| `ports: 3000:3000` | `Service` + `Ingress` (+ TLS) |
| `depends_on` + healthcheck | `readinessProbe` + init container |
| `restart: unless-stopped` | `restartPolicy: Always` |
| `pgdata` volume | `PersistentVolumeClaim` |
| `init.sql` mount | ConfigMap + Job d'init |
| limits CPU/RAM | `resources.requests/limits` |

### Stack recommandée (VPS ~8 GB / 4 vCPU)

- **k3s** ou cluster léger
- **Ingress** (Traefik / nginx) + **cert-manager** (TLS)
- **Deployment** app (2+ replicas) + **HPA** CPU
- **StatefulSet** PostgreSQL + PVC
- **Prometheus + Grafana** (kube-prometheus-stack)

### Chemin de migration

```
Phase 1 — Image & compose (local)
  ├── Créer app/.dockerignore
  ├── Réécrire Dockerfile multi-stage (npm ci --omit=dev)
  ├── Durcir docker-compose (healthchecks, restart)
  └── Corriger README / GUIDE

Phase 2 — Manifestes K8s (VPS)
  ├── Namespace + Secret + ConfigMap
  ├── StatefulSet PostgreSQL + PVC
  ├── Deployment app + probes
  └── Ingress + TLS

Phase 3 — Production capstone
  ├── HPA (CPU, /api/compute)
  ├── Prometheus scrape /metrics
  ├── NetworkPolicy (DB interne only)
  └── CI/CD : build → push → deploy
```

---

## 12. Priorisation des travaux

| Problème | Gravité | Statut | Priorité |
|----------|---------|:------:|----------:|
| Dockerfile non optimisé + `.dockerignore` inefficace | Très élevée | 🔴 | 1 |
| Healthchecks + restart (compose / K8s probes) | Très élevée | 🔴 | 1 |
| Secrets K8s (`Secret`) | Élevée | 🔴 | 1 |
| Manifestes Kubernetes (VPS) | Élevée | 🔴 | 1 |
| Monolithe / HA base de données | Élevée | 🔴 | 1 |
| ~~Secrets en clair dans docker-compose.yml~~ | ~~Très élevée~~ | 🟢 | — |
| Observabilité (collecte, dashboards, alerting) | Élevée | 🔴 | 2 |
| Defaults secrets dans `main.js` | Moyenne | 🔴 | 2 |
| Sécurité réseau (Ingress TLS, NetworkPolicy) | Élevée | 🔴 | 2 |
| Documentation incorrecte (`GET /` vs `/api/health`) | Moyenne | 🔴 | 2 |
| Graceful shutdown + variable `PORT` | Moyenne | 🔴 | 2 |
| Sauvegarde / persistance K8s (PVC) | Moyenne | 🔴 | 2 |
| Métriques non centralisées (multi-replicas) | Moyenne | 🔴 | 3 |
| Index SQL / tuning | Moyenne | 🔴 | 3 |
| Endpoint `/api/admin/kill` exposé publiquement | Moyenne | 🔴 | 3 |

### Suivi

- Corrections compose documentées : [`OPTIMISATION.md`](./OPTIMISATION.md)
- Issues GitHub ouvertes : [#1](https://github.com/omega5z/cloud_worldcup/issues/1) – [#5](https://github.com/omega5z/cloud_worldcup/issues/5)

---

## Conclusion

L'existant est fonctionnel et adapté à une démonstration locale pédagogique. L'externalisation des secrets via `.env` est un premier pas vers l'industrialisation.

Les blocages principaux avant un déploiement **Kubernetes sur VPS** restent :

1. **Dockerfile** — fausse multi-stage, dev dependencies, `.dockerignore` non appliqué au build.
2. **docker-compose** — pas de résilience ni healthchecks, donc comportement local non représentatif d'un Deployment K8s.
3. **Infra K8s** — aucun manifeste, pas de CI, pas de monitoring centralisé.

La trajectoire naturelle : **compose corrigé → image registry → manifests K8s sur VPS → HPA + monitoring**.
