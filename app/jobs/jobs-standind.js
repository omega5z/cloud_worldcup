const pg = require("pg");
const { Pool } = pg;

const { calculateStandings } = require("../services/standing");

const pool = new Pool({
    host: process.env.DB_HOST || "db",
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "worldcup2026",
});

async function run() {
    console.log("=================================");
    console.log("WorldCup Standings Job");
    console.log("=================================");

    try {
        const groups = await calculateStandings(pool);
        console.log("Standings calculated.");

        await pool.query("TRUNCATE TABLE standings_snapshot");
        console.log("Old snapshot deleted.");

        for (const group of Object.values(groups)) {
            let rank = 1;

            for (const team of group) {
                await pool.query(`
                    INSERT INTO standings_snapshot
                    (
                        computed_at,
                        team_id,
                        group_letter,
                        played,
                        wins,
                        draws,
                        losses,
                        goals_for,
                        goals_against,
                        goal_difference,
                        points,
                        rank
                    )
                    VALUES
                    (
                        NOW(),
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
                    )
                `, [
                    team.id,
                    team.group_letter,
                    team.played,
                    team.won,    // Correspond bien à votre objet standings
                    team.drawn,  // Correspond bien à votre objet standings
                    team.lost,   // Correspond bien à votre objet standings
                    team.goals_for,
                    team.goals_against,
                    team.goal_difference,
                    team.points,
                    rank
                ]);

                rank++;
            }
        }

        console.log("Snapshot saved.");

    } catch (err) {
        console.error("❌ Erreur critique lors de l'exécution du Job :");
        console.error(err);
        // Indispensable pour que Kubernetes détecte l'échec du Job
        process.exit(1); 
    } finally {
        await pool.end();
    }
}

run();