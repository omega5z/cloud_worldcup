const express = require('express');
const path = require('path');
const crypto = require('crypto');
const pg = require('pg');
const { Pool } = pg;
const client = require('prom-client');
const { calculateStandings } = require('./services/standing');

// Override pg's default DATE parser to return raw strings (YYYY-MM-DD)
// instead of JavaScript Date objects, avoiding timezone-related date shifts.
if (pg.types && pg.types.setTypeParser) {
  pg.types.setTypeParser(1082, (val) => val);
}

// Configuration du pool PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'worldcup2026',
});

// ============================================================
// Configuration Prometheus
// ============================================================

// Collecte des métriques par défaut du processus Node.js (mémoire, CPU, event loop)
client.collectDefaultMetrics();

// Compteur de requêtes HTTP totales avec labels method et status_code
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'status_code'],
});

// Histogramme de durée des requêtes HTTP avec label route
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['route'],
});

// Création de l'application Express
const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware JSON
app.use(express.json());

// Middleware de gestion des erreurs de parsing JSON
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ status: 'error', message: 'Format de requête invalide : corps JSON non parsable' });
  }
  next(err);
});

// Middleware de métriques Prometheus (placé après express.json, avant les routes)
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer({ route: req.path });
  res.on('finish', () => {
    httpRequestsTotal.inc({ method: req.method, status_code: res.statusCode });
    end();
  });
  next();
});

// ============================================================
// Routes
// ============================================================

// GET /metrics - Exposition des métriques Prometheus
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await client.register.metrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.status(200).send(metrics);
  } catch (error) {
    res.status(500).json({ status: 'error', message: `Failed to collect metrics: ${error.message}` });
  }
});

// GET / - Serve the World Cup website
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET /api/health - Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// GET /api/compute - Saturation CPU (2-3 secondes)
app.get('/api/compute', (req, res) => {
  try {
    const durationTarget = 2000 + Math.random() * 1000; // entre 2000 et 3000 ms
    const start = Date.now();
    let iterations = 0;

    // Boucle de hachage cryptographique SHA-256 pour saturer le CPU
    while (Date.now() - start < durationTarget) {
      crypto.createHash('sha256').update(`iteration-${iterations}`).digest('hex');
      iterations++;
    }

    const duration_ms = Date.now() - start;
    res.status(200).json({ result: iterations, duration_ms });
  } catch (error) {
    res.status(500).json({ status: 'error', message: `Erreur lors du calcul intensif: ${error.message}` });
  }
});

// GET /api/health/db - Health check base de données
app.get('/api/health/db', async (req, res) => {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database health check timeout: exceeded 5 seconds')), 5000)
    );
    const query = pool.query('SELECT 1');
    await Promise.race([query, timeout]);
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error', message: error.message });
  }
});

// ============================================================
// Routes de données (lecture)
// ============================================================

// GET /api/teams - Liste de toutes les équipes
app.get('/api/teams', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, group_letter, country_code FROM teams ORDER BY group_letter, name');
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Erreur lors de la récupération des équipes' });
  }
});

// GET /api/groups - Équipes groupées par groupe
app.get('/api/groups', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, group_letter, country_code FROM teams ORDER BY group_letter, name');
    const groups = {};
    for (const team of result.rows) {
      if (!groups[team.group_letter]) {
        groups[team.group_letter] = [];
      }
      groups[team.group_letter].push(team);
    }
    res.status(200).json(groups);
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Erreur lors de la récupération des groupes' });
  }
});

// GET /api/matches - Liste de tous les matchs
app.get('/api/matches', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, th.name AS team_home, ta.name AS team_away,
             m.score_home, m.score_away, m.stage, m.match_date
      FROM matches m
      JOIN teams th ON th.id = m.team_home_id
      JOIN teams ta ON ta.id = m.team_away_id
      ORDER BY m.match_date, m.id
    `);
    res.status(200).json(result.rows);
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Erreur lors de la récupération des matchs' });
  }
});

// GET /api/standings - Classement par groupe
app.get('/api/standings', async (req, res) => {

    try {

        const groups = await calculateStandings(pool);

        res.status(200).json(groups);

    } catch (error) {

        res.status(500).json({
            status: "error",
            message: "Erreur lors du calcul des classements"
        });

    }

});

// ============================================================
// Routes de vote
// ============================================================

// POST /api/vote - Voter pour une équipe
app.post('/api/vote', async (req, res) => {
  try {
    const { team_id } = req.body;

    // Validation : team_id présent
    if (team_id === undefined || team_id === null) {
      return res.status(400).json({ status: 'error', message: 'Le champ team_id est requis' });
    }

    // Validation : team_id est un entier
    if (!Number.isInteger(team_id)) {
      return res.status(400).json({ status: 'error', message: 'Le champ team_id doit être un entier' });
    }

    // Validation : team_id existe dans la table teams
    const teamCheck = await pool.query('SELECT id FROM teams WHERE id = $1', [team_id]);
    if (teamCheck.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: `L'équipe avec l'id ${team_id} n'existe pas` });
    }

    // Insertion du vote
    const result = await pool.query('INSERT INTO votes (team_id) VALUES ($1) RETURNING id', [team_id]);
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Erreur interne du serveur' });
  }
});

// GET /api/votes/results - Résultats des votes
app.get('/api/votes/results', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id AS team_id, t.name AS team_name, COUNT(v.id) AS votes
      FROM votes v
      JOIN teams t ON t.id = v.team_id
      GROUP BY t.id, t.name
      ORDER BY votes DESC
    `);

    if (result.rows.length === 0) {
      return res.status(200).json([]);
    }

    const totalVotes = result.rows.reduce((sum, row) => sum + parseInt(row.votes, 10), 0);

    const results = result.rows.map(row => ({
      team_id: row.team_id,
      team_name: row.team_name,
      votes: parseInt(row.votes, 10),
      percentage: parseFloat(((parseInt(row.votes, 10) / totalVotes) * 100).toFixed(2)),
    }));

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Erreur interne du serveur' });
  }
});

// ============================================================
// Route de crash volontaire
// ============================================================

// POST /api/admin/kill - Crash volontaire du processus
app.all('/api/admin/kill', (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Seule la méthode POST est acceptée' });
  }

  res.status(200).json({ status: 'killing' });
  res.on('finish', () => {
    setTimeout(() => process.exit(1), 100);
  });
});

// POST /api/data - Insertion d'un résultat de match
app.post('/api/data', async (req, res) => {
  // Vérification Content-Type / corps parsable
  // express.json() ne parse que si Content-Type contient application/json
  // Si le body n'est pas un objet (undefined ou vide), c'est un problème de format
  if (!req.is('application/json') || !req.body || typeof req.body !== 'object') {
    return res.status(400).json({ status: 'error', message: 'Format de requête invalide : Content-Type application/json requis' });
  }

  const { team_home, team_away, score_home, score_away, stage, date } = req.body;

  // Validation des champs requis
  const validStages = ['Group Stage', 'Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
  const errors = [];

  if (!team_home || typeof team_home !== 'string' || team_home.trim() === '') {
    errors.push('team_home doit être une chaîne non vide');
  }
  if (!team_away || typeof team_away !== 'string' || team_away.trim() === '') {
    errors.push('team_away doit être une chaîne non vide');
  }
  if (score_home === undefined || score_home === null || !Number.isInteger(score_home) || score_home < 0) {
    errors.push('score_home doit être un entier >= 0');
  }
  if (score_away === undefined || score_away === null || !Number.isInteger(score_away) || score_away < 0) {
    errors.push('score_away doit être un entier >= 0');
  }
  if (!stage || !validStages.includes(stage)) {
    errors.push(`stage doit être parmi : ${validStages.join(', ')}`);
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push('date doit être au format ISO YYYY-MM-DD');
  } else {
    // Vérifier que la date est valide
    const parsedDate = new Date(date + 'T00:00:00Z');
    if (isNaN(parsedDate.getTime())) {
      errors.push('date doit être une date valide au format YYYY-MM-DD');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ status: 'error', message: errors.join('; ') });
  }

  try {
    // Recherche des IDs des équipes
    const homeTeamResult = await pool.query('SELECT id FROM teams WHERE name = $1', [team_home.trim()]);
    if (homeTeamResult.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: `Équipe non trouvée : ${team_home}` });
    }

    const awayTeamResult = await pool.query('SELECT id FROM teams WHERE name = $1', [team_away.trim()]);
    if (awayTeamResult.rows.length === 0) {
      return res.status(400).json({ status: 'error', message: `Équipe non trouvée : ${team_away}` });
    }

    const teamHomeId = homeTeamResult.rows[0].id;
    const teamAwayId = awayTeamResult.rows[0].id;

    // Insertion du match
    const insertResult = await pool.query(
      'INSERT INTO matches (team_home_id, team_away_id, score_home, score_away, stage, match_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [teamHomeId, teamAwayId, score_home, score_away, stage, date]
    );

    res.status(201).json({ id: insertResult.rows[0].id });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Erreur lors de l\'écriture en base de données' });
  }
});

// ============================================================
// Démarrage du serveur
// ============================================================

const PORT = parseInt(process.env.PORT, 10) || 3000;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export pour les tests et les autres modules
module.exports = { app, pool };
