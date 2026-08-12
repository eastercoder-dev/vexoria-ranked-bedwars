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

const COMPETITIVE_MODES = [
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
                error: "Competitive Duels player not found"
            });
        }

        const player = players[0];

        const [modeRows] = await pool.execute(
            `
            SELECT
                mode,

                ranked_wins,
                ranked_losses,

                current_ranked_win_streak,
                best_ranked_win_streak,

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

        const modes =
            COMPETITIVE_MODES.map(mode => {
                const row =
                    rowMap.get(mode) || {};

                const wins =
                    Number(row.ranked_wins || 0);

                const losses =
                    Number(row.ranked_losses || 0);

                const games =
                    wins + losses;

                return {
                    mode,

                    games,
                    wins,
                    losses,

                    wlr:
                        losses === 0
                            ? wins
                            : Number(
                                (wins / losses).toFixed(2)
                            ),

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

                    currentWinStreak:
                        Number(
                            row.current_ranked_win_streak ||
                            0
                        ),

                    bestWinStreak:
                        Number(
                            row.best_ranked_win_streak ||
                            0
                        ),

                    bedsBroken:
                        mode === "BEDFIGHT"
                            ? Number(
                                row.beds_broken || 0
                            )
                            : null,

                    goalsScored:
                        mode === "BRIDGE"
                            ? Number(
                                row.goals_scored || 0
                            )
                            : null
                };
            });

        const totals =
            modes.reduce(
                (total, mode) => {
                    total.games += mode.games;
                    total.wins += mode.wins;
                    total.losses += mode.losses;

                    total.bestWinStreak =
                        Math.max(
                            total.bestWinStreak,
                            mode.bestWinStreak
                        );

                    return total;
                },
                {
                    games: 0,
                    wins: 0,
                    losses: 0,
                    bestWinStreak: 0
                }
            );

        totals.wlr =
            totals.losses === 0
                ? totals.wins
                : Number(
                    (
                        totals.wins /
                        totals.losses
                    ).toFixed(2)
                );

        totals.winRate =
            totals.games === 0
                ? 0
                : Number(
                    (
                        totals.wins /
                        totals.games *
                        100
                    ).toFixed(2)
                );

        totals.currentWinStreak = null;

        return res.status(200).json({
            type: "COMPETITIVE",

            uuid: player.uuid,
            username: player.username,

            totals,
            modes
        });

    } catch (error) {
        console.error(
            "Competitive Duels player API error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to load Competitive Duels player"
        });
    }
};
