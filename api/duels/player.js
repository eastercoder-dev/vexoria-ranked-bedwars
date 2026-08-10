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

const RANKED_MODES = [
    "BEDFIGHT",
    "FIREBALL_FIGHT",
    "FIREBALL_MACE",
    "SKYFIGHT",
    "BATTLERUSH",
    "BRIDGE"
];

module.exports = async function handler(req, res) {

    const username =
        String(req.query.username || "").trim();

    if (!username) {
        return res.status(400).json({
            error: "Username required"
        });
    }

    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
        return res.status(400).json({
            error: "Invalid Minecraft username"
        });
    }

    try {

        const [players] = await pool.execute(
            `
            SELECT
                uuid,
                username
            FROM md_players
            WHERE LOWER(username) = LOWER(?)
            LIMIT 1
            `,
            [username]
        );

        if (players.length === 0) {
            return res.status(404).json({
                error: "Duels player not found"
            });
        }

        const player = players[0];

        const [globalRows] = await pool.execute(
            `
            SELECT
                global_elo,
                peak_global_elo
            FROM md_global_stats
            WHERE uuid = ?
            LIMIT 1
            `,
            [player.uuid]
        );

        const global =
            globalRows[0] || {
                global_elo: 1000,
                peak_global_elo: 1000
            };

        const [modeRows] = await pool.execute(
            `
            SELECT
                mode,

                games_played,

                ranked_wins,
                ranked_losses,

                kills,

                current_ranked_win_streak,
                best_ranked_win_streak,

                elo,
                peak_elo,

                beds_broken,
                goals_scored

            FROM md_stats

            WHERE uuid = ?
            AND mode IN (
                'BEDFIGHT',
                'FIREBALL_FIGHT',
                'FIREBALL_MACE',
                'SKYFIGHT',
                'BATTLERUSH',
                'BRIDGE'
            )
            `,
            [player.uuid]
        );

        const rowMap = new Map(
            modeRows.map(row => [row.mode, row])
        );

        const rankedModes = RANKED_MODES.map(mode => {

            const row = rowMap.get(mode) || {};

            const wins =
                Number(row.ranked_wins || 0);

            const losses =
                Number(row.ranked_losses || 0);

            /*
             * For ranked display, calculate games from
             * ranked wins + ranked losses instead of the
             * casual-inclusive games_played column.
             */
            const games = wins + losses;

            return {
                mode,

                games,

                wins,
                losses,

                winRate:
                    games === 0
                        ? 0
                        : Number(
                            (
                                wins /
                                games *
                                100
                            ).toFixed(2)
                        ),

                kills:
                    Number(row.kills || 0),

                currentWinStreak:
                    Number(
                        row.current_ranked_win_streak || 0
                    ),

                bestWinStreak:
                    Number(
                        row.best_ranked_win_streak || 0
                    ),

                elo:
                    Number(row.elo ?? 1000),

                peakElo:
                    Number(row.peak_elo ?? 1000),

                bedsBroken:
                    mode === "BEDFIGHT"
                        ? Number(row.beds_broken || 0)
                        : null,

                goalsScored:
                    mode === "BRIDGE"
                        ? Number(row.goals_scored || 0)
                        : null
            };
        });

        const rankedTotals =
            rankedModes.reduce(
                (total, mode) => {
                    total.games += mode.games;
                    total.wins += mode.wins;
                    total.losses += mode.losses;
                    return total;
                },
                {
                    games: 0,
                    wins: 0,
                    losses: 0
                }
            );

        rankedTotals.winRate =
            rankedTotals.games === 0
                ? 0
                : Number(
                    (
                        rankedTotals.wins /
                        rankedTotals.games *
                        100
                    ).toFixed(2)
                );

        return res.status(200).json({

            uuid: player.uuid,
            username: player.username,

            globalElo:
                Number(global.global_elo || 1000),

            peakGlobalElo:
                Number(global.peak_global_elo || 1000),

            rankedTotals,

            rankedModes
        });

    } catch (error) {

        console.error(
            "Duels player API error:",
            error
        );

        return res.status(500).json({
            error: "Unable to load Duels player"
        });
    }
};
