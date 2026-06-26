# Audit technique de l’existant

Ce document constitue un audit technique basé uniquement sur les fichiers présents dans le dépôt : app/main.js, app/package.json, app/Dockerfile, docker-compose.yml, app/init.sql et app/tests.

## 1. Architecture

### Structure du projet
Le dépôt est organisé autour d’un monolithe simple :

- app/main.js : cœur applicatif unique, contient l’API Express, la logique métier, la configuration PostgreSQL, les métriques et le démarrage du serveur.
- app/public : frontend statique, HTML/CSS/JS.
- app/tests : tests de propriétés et validations fonctionnelles.
- app/init.sql : schéma SQL et données initiales.
- app/Dockerfile : définition de l’image applicative.
- docker-compose.yml : orchestration locale de l’application et de la base.

### Responsabilités par dossier
- app/main.js assume plusieurs responsabilités :
  - création de l’application Express,
  - définition de middleware,
  - définition des routes API,
  - configuration de la connexion PostgreSQL,
  - collecte des métriques,
  - démarrage du serveur,
  - logique métier liée aux matchs, votes et classements.
- app/public contient uniquement l’interface utilisateur.
- app/init.sql définit le modèle de données et les données de départ.
- app/tests valident le comportement de certaines routes.

### Organisation du code
Le code est globalement linéaire et centralisé. Il n’existe pas de séparation nette entre :
- couche HTTP,
- couche service,
- couche accès aux données,
- couche configuration.

### Couplage entre composants
Le couplage est élevé :
- la logique métier est intégrée dans la même unité que la configuration HTTP,
- les routes accèdent directement à la base via le pool PostgreSQL défini dans le même fichier,
- le frontend JavaScript connaît directement les endpoints de l’API.

### Qualité de l’architecture
L’architecture est adaptée à une démonstration pédagogique, mais elle n’est pas structurée pour une architecture cloud-native robuste :
- monolithique,
- peu modulable,
- difficile à faire évoluer sans accroître la complexité,
- peu adaptée à un découpage en services ou à une montée en charge par réplication maîtrisée.

## 2. Docker

### Anti-patterns observés

1. Structure multi-stage non réellement exploitée
   - Le Dockerfile utilise un stage nommé builder, mais le runtime n’exploite pas une séparation claire entre image de build et image d’exécution.
   - Impact : moins de clarté sur la production, image potentiellement plus lourde et moins maîtrisée.

2. Installation des dépendances sans séparation production/dev
   - Le Dockerfile exécute npm install sans indication de mode production.
   - Impact : installation de dépendances de développement dans l’image finale, donc taille plus importante et surface d’attaque plus large.

3. Copie de tout le contexte
   - Le Dockerfile copie l’intégralité du contexte via COPY . .
   - Impact : temps de build plus longs, plus de fichiers embarqués inutilement, risque d’inclusion de fichiers non nécessaires.

4. Absence de fichier d’exclusion de build
   - Aucune preuve d’un fichier de type .dockerignore n’est visible.
   - Impact : augmentation du contexte Docker et des temps de build.

5. Réproductibilité limitée
   - Le Dockerfile utilise npm install et non npm ci.
   - Impact : moins de reproductibilité, dépendance à l’état du registre et des métadonnées de dépendances.

6. Pas de configuration explicite de l’environnement d’exécution
   - Aucun NODE_ENV=production n’est défini.
   - Impact : comportement moins maîtrisé, dépendances et runtime moins alignés sur un usage de production.

7. Pas de healthcheck dans l’image
   - L’image ne contient pas de HEALTHCHECK.
   - Impact : un orchestrateur ne peut pas détecter proprement l’état de santé du conteneur.

### Impact global
Ces points affectent :
- la taille de l’image,
- la sécurité,
- la répétabilité des builds,
- la vitesse de construction,
- la fiabilité opérationnelle dans un environnement de type Kubernetes ou ECS.

## 3. Docker Compose

### Réseau
- Le fichier utilise le réseau Docker par défaut.
- Aucun réseau personnalisé n’est défini.
- Aucun réseau isolé ou segmenté n’est configuré.

### Volumes
- Un volume nommé pgdata est déclaré pour PostgreSQL.
- Le script SQL est monté dans le répertoire de démarrage de PostgreSQL.
- Cela permet une persistance locale des données.

### Variables d’environnement
- Les variables de connexion PostgreSQL sont définies directement dans le fichier.
- Les identifiants sont visibles en clair dans la configuration.
- Aucune gestion de secrets externe n’est mise en place.

### Dépendances entre services
- Le service applicatif dépend du service base de données via depends_on.
- Cette dépendance ne garantit pas une disponibilité réelle de PostgreSQL au démarrage.
- Le service applicatif peut démarrer avant que la base soit prête.

### Healthchecks
- Aucun healthcheck n’est défini dans docker-compose.yml.
- Cela empêche une détection fiable de l’état de santé par un orchestrateur.

### Redémarrage
- Aucune politique de redémarrage n’est définie.
- En cas d’arrêt du conteneur, il ne se relancera pas automatiquement.

### Ports exposés
- L’application est exposée sur le port 3000.
- La base PostgreSQL n’est pas exposée sur l’hôte, ce qui est cohérent pour un usage local, mais limite l’accès direct depuis l’extérieur.

## 4. Application

### Cycle de vie
L’application suit un cycle simple :
- création du pool PostgreSQL au chargement du module,
- création de l’application Express,
- enregistrement des routes et middleware,
- démarrage du serveur si le fichier est exécuté comme point d’entrée principal.

### Démarrage
Le serveur démarre sur le port 3000.
Le démarrage ne vérifie pas la disponibilité de PostgreSQL avant de commencer à accepter des requêtes.

### Gestion des erreurs
- Certaines erreurs sont traitées localement dans les routes.
- Un middleware gère les erreurs de parsing JSON.
- Les erreurs de base sont renvoyées comme réponses JSON, mais il n’existe pas de stratégie globale de journalisation ou d’exception handling centralisé.

### Connexions PostgreSQL
- L’application utilise pg.Pool.
- La configuration est simple et directe.
- Aucun mécanisme de retry, de timeout finement paramétré, ni de stratégie de reconnexion n’est visible.
- Le pool est créé à l’import du module, ce qui le rend dépendant du contexte d’exécution.

### Gestion des secrets
- Les credentials de base sont fournis via des valeurs par défaut dans le code et via des variables d’environnement.
- Les secrets ne sont pas externisés dans un mécanisme sécurisé.
- La configuration est exposée dans le fichier de composition.

### Endpoints
L’API expose plusieurs routes :
- /api/health
- /api/health/db
- /api/compute
- /api/data
- /api/vote
- /api/votes/results
- /metrics
- /api/admin/kill
- diverses routes de lecture métier.

### Métriques Prometheus
- L’application utilise prom-client.
- Elle expose des métriques de base du runtime Node.js et des métriques HTTP personnalisées.
- Les métriques sont stockées en mémoire au sein du processus.
- Aucune intégration à un collecteur externe n’est visible dans le code.

### Endpoint de crash
- /api/admin/kill provoque volontairement l’arrêt du processus.
- Cet endpoint crée un risque opérationnel important dans un environnement partagé.

### Endpoint de santé
- /api/health est un healthcheck simple.
- /api/health/db vérifie la connectivité PostgreSQL.
- Ces endpoints sont utiles, mais ne couvrent pas de manière complète les besoins d’un orchestrateur moderne.

## 5. PostgreSQL

### Structure SQL
Le schéma est simple et clair :
- teams
- matches
- votes

### Schéma
- teams contient les informations d’identification et de groupe.
- matches stocke les résultats avec des clés étrangères vers teams.
- votes stocke un vote par équipe.

### Index
Aucune index spécifique autre que les contraintes de clé primaire/étrangère n’est visible dans app/init.sql.
Cela peut devenir limitant si le volume de données augmente.

### Initialisation
L’initialisation est faite par un script SQL idempotent :
- création des tables si elles n’existent pas,
- insertion des équipes et matchs si absents.

### Persistance
La persistance est assurée par un volume Docker nommé.
Le stockage est donc localement persistant dans l’environnement Compose.

### Risques
- Pas de mécanisme de migration versionnée visible.
- Pas de stratégie de sauvegarde ou de restauration documentée dans le code.
- Pas de réplication ni de HA de la base.
- Le modèle de données n’est pas conçu pour une montée en charge importante.

## 6. Cloud Readiness

### Prêt pour Kubernetes
L’application n’est pas prête de manière robuste pour Kubernetes :
- absence de healthchecks de niveau conteneur,
- absence de stratégie de redémarrage,
- absence de configuration de ressources,
- absence de readiness/liveness clairement définis,
- absence de secrets externes,
- absence de manifeste Kubernetes.

### Prêt pour AWS ECS
Le niveau de readiness est limité :
- conteneur Docker possible,
- mais l’application n’est pas préparée pour un déploiement robuste avec :
  - service discovery,
  - health checks,
  - auto-scaling,
  - secrets,
  - logging centralisé,
  - réseau défini.

### Auto Scaling
Le projet n’est actuellement pas préparé pour un auto-scaling pertinent :
- pas de métriques externes exploitables par un orchestrateur,
- pas de configuration de ressources,
- pas de stratégie de charge,
- pas de mécanisme de tolérance aux pannes au niveau du service.

### Load Balancer
Aucun élément de type load balancer n’est défini dans le code ou la configuration fournie.

### Plusieurs réplicas
Plusieurs réplicas seraient problématiques sans préparation supplémentaire :
- le service n’est pas conçu pour un état partagé,
- les métriques sont locales au processus,
- l’endpoint de crash volontaire introduit un risque de défaillance volontaire d’une instance,
- la base reste un point central unique.

### Ce qui empêche réellement un déploiement cloud-native
Les principaux blocages observés sont :
- absence d’outillage d’observabilité distribuée,
- absence de gestion des secrets,
- absence de healthchecks opérationnels,
- absence de stratégie de redémarrage et de tolérance aux pannes,
- dépendance à une base unique non préparée pour la haute disponibilité.

## 7. Observabilité

### Logs
- Les logs sont très limités.
- Le code ne montre pas de logging structuré.
- Les erreurs sont principalement renvoyées sous forme de réponse HTTP, pas journalisées de manière exploitable.

### Métriques
- Les métriques Prometheus existent.
- Elles sont utiles pour un usage local, mais ne sont pas intégrées à une chaîne de monitoring complète.

### Traces
- Aucune trace distribuée n’est visible.
- Aucun identifiant de requête ou contexte de traçage n’est mis en place.

### Alerting
- Aucun mécanisme d’alerting n’est présent dans le code ou la configuration observable.

### Dashboards
- Aucun dashboard n’est fourni.

## 8. Sécurité

### Secrets
- Les secrets de base de données sont visibles dans la configuration.
- Le code comporte des valeurs par défaut sensibles.

### Utilisateur root
- Le Dockerfile passe à un utilisateur non privilégié avec USER node.
- Cela est positif, mais l’image n’est pas démontrée comme totalement durcie.

### Permissions
- Le code ne met pas en place de mécanismes de permissions ou d’authentification.
- Les endpoints d’écriture sont accessibles sans contrôle d’accès.

### Dépendances
- Les dépendances sont définies avec des versions de type ^.
- Aucune politique visible de verrouillage, de scan ou de suivi de vulnérabilités.

### Surface d’attaque
- L’API expose des endpoints d’écriture et un endpoint de crash volontaire.
- L’application n’applique pas de rate limiting ni de limitation de taille de payload visible.

### Exposition réseau
- Le service est exposé sur un port réseau.
- La base est interne au réseau Docker, mais l’application n’est pas protégée par un niveau de sécurité réseau plus avancé.

## 9. Performances

### Goulets d’étranglement
- La route /api/compute consomme du CPU de manière volontaire et intensive.
- Le calcul du classement est fait côté application dans app/main.js, ce qui peut devenir coûteux si les données grossissent.

### Appels bloquants
- Les requêtes PostgreSQL sont réalisées de manière synchrone via await sur des pool.query, ce qui est acceptable pour un monolithe simple, mais reste sensible à la latence réseau et au temps d’attente base.

### Connexions base de données
- L’application utilise un pool, ce qui est un bon point de départ.
- Cependant, la taille et la stratégie du pool ne sont pas configurées explicitement.

### Consommation mémoire
- Les métriques Prometheus sont en mémoire.
- Aucun mécanisme de limitation ou d’optimisation mémoire n’est visible.

### CPU
- Le service est sensible à des charges CPU élevées, notamment via la route /api/compute.
- Le cœur applicatif n’est pas optimisé pour des pics de charge importants.

## 10. Résilience

### Single Point Of Failure
- L’application est un seul service.
- La base PostgreSQL est un point central unique.
- Il n’existe pas de redondance sur le service applicatif ou la base.

### Comportement en cas de crash
- L’application peut être arrêtée volontairement via /api/admin/kill.
- Sans politique de redémarrage, l’application reste hors service.

### Comportement si PostgreSQL tombe
- Les routes qui dépendent de la base retournent des erreurs.
- Le service ne dispose pas de mécanisme de degradation ou de fallback visible.

### Comportement si plusieurs instances démarrent
- L’application n’intègre pas de stratégie de coordination multi-instance.
- Les métriques ne sont pas partagées.
- Le modèle n’est pas adapté à un déploiement multi-répliques sans évolution complémentaire.

## 11. Priorisation des travaux

| Problème | Gravité | Impact | Priorité |
|---|---|---:|---:|
| Secrets en clair dans la configuration | Très élevée | Risque sécurité majeur | 1 |
| Absence de healthchecks et de stratégie de redémarrage | Très élevée | Réduction de la résilience et du fonctionnement en orchestration | 1 |
| Monolithe unique avec forte centralisation | Élevée | Limite la scalabilité et la modularité | 1 |
| Absence de gestion de la base en haute disponibilité | Élevée | Risque de panne système complète | 1 |
| Observabilité insuffisante (logs, traces, alerting) | Élevée | Diagnostic difficile en production | 2 |
| Dockerfile peu adapté à la production | Élevée | Taille, sécurité, reproductibilité | 2 |
| Absence de mécanismes de sécurité réseau et d’accès | Élevée | Surface d’attaque plus large | 2 |
| Pas de stratégie de persistance et de sauvegarde visible | Moyenne | Risque de perte de données | 2 |
| Métriques locales et non centralisées | Moyenne | Limite l’exploitation en environnement distribué | 3 |
| Absence d’indexation et de tuning SQL visible | Moyenne | Risque de dégradation à mesure que les données croissent | 3 |
| Endpoint de crash volontaire exposé | Moyenne | Risque opérationnel en environnement partagé | 3 |

## Conclusion

L’existant est fonctionnel, pédagogique et suffisamment cohérent pour une démonstration locale, mais il n’est pas encore en mesure de supporter de manière robuste un déploiement Cloud Native à grande échelle. Les principaux blocages ne sont pas dans la logique métier elle-même, mais dans la préparation opérationnelle du système : résilience, sécurité, observabilité et capacité d’orchestration.
