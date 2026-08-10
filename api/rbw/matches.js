const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

module.exports = async function handler(req, res) {

    const page =
        Math.max(
            1,
            parseInt(req.query.page || "1", 10)
        );

    const season =
        req.query.season !== undefined
            ? Number(req.query.season)
            : null;

    const username =
        String(req.query.username || "")
            .trim();

    const queue =
        String(req.query.queue || "")
            .trim();

    const limit = 20;
    const offset = (page - 1) * limit;

    try {

        const conditions = [
            `
            (
                g.status = 'SCORED'
                OR g.finished_at IS NOT NULL
                OR g.scored_at IS NOT NULL
            )
            `
        ];

        const params = [];

        if (season !== null && Number.isInteger(season) && season > 0) {
            conditions.push("g.season_id = ?");
            params.push(season);
        }

        if (queue) {
            conditions.push(`
                (
                    LOWER(g.queue_name_snapshot) = LOWER(?)
                    OR LOWER(g.queue_name) = LOWER(?)
                )
            `);

            params.push(queue, queue);
        }

        if (username) {
            conditions.push(`
                EXISTS (
                    SELECT 1
                    FROM rbw_game_players gp_search
                    WHERE gp_search.game_id = g.number
                    AND LOWER(gp_search.ign_snapshot) = LOWER(?)
                )
            `);

            params.push(username);
        }

        const [games] = await pool.execute(
            `
            SELECT
                g.number,
                g.state,
                g.casual,
                g.map,

                g.queueID,
                g.queue_id,

                g.season_id,
                g.season_game_number,

                g.created_at,
                g.started_at,
                g.finished_at,
                g.scored_at,

                g.queue_name,
                g.queue_name_snapshot,

                g.map_id,
                g.map_name_snapshot,

                g.team_size,
                g.total_teams,

                g.winner_team,
                g.loser_team,

                g.status,
                g.score_source,
                g.scored_by_snapshot

            FROM rbw_games g

            WHERE ${conditions.join(" AND ")}

            ORDER BY
                COALESCE(
                    g.scored_at,
                    g.finished_at,
                    g.started_at,
                    g.created_at,
                    0
                ) DESC

            LIMIT ${limit}
            OFFSET ${offset}
            `,
            params
        );

        const output = [];

        for (const game of games) {

            const [players] = await pool.execute(
                `
                SELECT
                    player_id,
                    team,
                    queue_id,

                    elo_before,
                    elo_after,
                    elo_change,

                    kills,
                    deaths,

                    final_kills,
                    final_deaths,

                    beds,
                    mvp,

                    result,
                    season_id,

                    ign_snapshot,

                    won,
                    left_early,
                    rejoined,

                    rank_before,
                    rank_after

                FROM rbw_game_players

                WHERE game_id = ?

                ORDER BY
                    team ASC,
                    won DESC,
                    kills DESC,
                    ign_snapshot ASC
                `,
                [game.number]
            );

            const [teams] = await pool.execute(
                `
                SELECT
                    team_number,
                    normalized_roster_hash,
                    normalized_roster
                FROM rbw_game_teams
                WHERE game_id = ?
                ORDER BY team_number ASC
                `,
                [game.number]
            );

            const groupedTeams = {};

            for (const player of players) {

                const teamNumber =
                    Number(player.team || 0);

                if (!groupedTeams[teamNumber]) {
                    groupedTeams[teamNumber] = {
                        team: teamNumber,
                        winner:
                            Number(game.winner_team) === teamNumber,
                        players: []
                    };
                }

                groupedTeams[teamNumber].players.push({
                    playerId:
                        player.player_id,

                    username:
                        player.ign_snapshot ||
                        player.player_id,

                    eloBefore:
                        player.elo_before !== null
                            ? Number(player.elo_before)
                            : null,

                    eloAfter:
                        player.elo_after !== null
                            ? Number(player.elo_after)
                            : null,

                    eloChange:
                        player.elo_change !== null
                            ? Number(player.elo_change)
                            : null,

                    kills:
                        Number(player.kills || 0),

                    deaths:
                        Number(player.deaths || 0),

                    finalKills:
                        Number(player.final_kills || 0),

                    finalDeaths:
                        Number(player.final_deaths || 0),

                    beds:
                        Number(player.beds || 0),

                    mvp:
                        Boolean(player.mvp),

                    result:
                        player.result,

                    won:
                        Boolean(player.won),

                    leftEarly:
                        Boolean(player.left_early),

                    rejoined:
                        Boolean(player.rejoined),

                    rankBefore:
                        player.rank_before || null,

                    rankAfter:
                        player.rank_after || null
                });
            }

            const teamMeta = teams.map(team => ({
                teamNumber:
                    Number(team.team_number),

                normalizedRosterHash:
                    team.normalized_roster_hash,

                normalizedRoster:
                    team.normalized_roster
            }));

            output.push({
                gameNumber:
                    Number(game.number),

                seasonId:
                    game.season_id !== null
                        ? Number(game.season_id)
                        : null,

                seasonGameNumber:
                    game.season_game_number !== null
                        ? Number(game.season_game_number)
                        : null,

                status:
                    game.status ||
                    game.state ||
                    null,

                casual:
                    game.casual || null,

                queue: {
                    id:
                        game.queue_id ||
                        game.queueID ||
                        null,

                    name:
                        game.queue_name_snapshot ||
                        game.queue_name ||
                        null
                },

                map: {
                    id:
                        game.map_id || null,

                    name:
                        game.map_name_snapshot ||
                        game.map ||
                        null
                },

                teamSize:
                    game.team_size !== null
                        ? Number(game.team_size)
                        : null,

                totalTeams:
                    game.total_teams !== null
                        ? Number(game.total_teams)
                        : null,

                winnerTeam:
                    game.winner_team !== null
                        ? Number(game.winner_team)
                        : null,

                loserTeam:
                    game.loser_team !== null
                        ? Number(game.loser_team)
                        : null,

                createdAt:
                    game.created_at !== null
                        ? Number(game.created_at)
                        : null,

                startedAt:
                    game.started_at !== null
                        ? Number(game.started_at)
                        : null,

                finishedAt:
                    game.finished_at !== null
                        ? Number(game.finished_at)
                        : null,

                scoredAt:
                    game.scored_at !== null
                        ? Number(game.scored_at)
                        : null,

                scoreSource:
                    game.score_source || null,

                scoredBy:
                    game.scored_by_snapshot || null,

                teams:
                    Object.values(groupedTeams),

                teamMetadata:
                    teamMeta
            });
        }

        return res.status(200).json({
            page,
            perPage: limit,

            season:
                season || null,

            username:
                username || null,

            queue:
                queue || null,

            count:
                output.length,

            matches:
                output
        });

    } catch (error) {

        console.error(
            "RBW matches API error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to load RBW matches"
        });
    }
};
