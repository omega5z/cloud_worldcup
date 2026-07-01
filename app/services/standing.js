async function calculateStandings(pool) {

    const matchesResult = await pool.query(`
        SELECT
            team_home_id,
            team_away_id,
            score_home,
            score_away
        FROM matches
        WHERE stage = 'Group Stage'
    `);

    const teamsResult = await pool.query(`
        SELECT
            id,
            name,
            group_letter,
            country_code
        FROM teams
        ORDER BY group_letter,name
    `);

    const standings = {};

    for (const team of teamsResult.rows) {

        standings[team.id] = {
            id: team.id,
            name: team.name,
            group_letter: team.group_letter,
            country_code: team.country_code,

            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,

            goals_for: 0,
            goals_against: 0,
            goal_difference: 0,

            points: 0
        };
    }

    for (const match of matchesResult.rows) {

        const home = standings[match.team_home_id];
        const away = standings[match.team_away_id];

        if (!home || !away) continue;

        home.played++;
        away.played++;

        home.goals_for += match.score_home;
        home.goals_against += match.score_away;

        away.goals_for += match.score_away;
        away.goals_against += match.score_home;

        if (match.score_home > match.score_away) {

            home.won++;
            away.lost++;

            home.points += 3;

        } else if (match.score_home < match.score_away) {

            away.won++;
            home.lost++;

            away.points += 3;

        } else {

            home.drawn++;
            away.drawn++;

            home.points++;
            away.points++;

        }

    }

    const groups = {};

    for (const team of Object.values(standings)) {

        team.goal_difference =
            team.goals_for - team.goals_against;

        if (!groups[team.group_letter]) {
            groups[team.group_letter] = [];
        }

        groups[team.group_letter].push(team);

    }

    for (const letter of Object.keys(groups)) {

        groups[letter].sort((a, b) => {

            if (b.points !== a.points)
                return b.points - a.points;

            if (b.goal_difference !== a.goal_difference)
                return b.goal_difference - a.goal_difference;

            return b.goals_for - a.goals_for;

        });

    }

    return groups;

}

module.exports = {
    calculateStandings
};