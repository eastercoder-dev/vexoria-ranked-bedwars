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

const MODES = [
    "BEDFIGHT",
    "FIREBALL_FIGHT",
    "FIREBALL_MACE",
    "BRIDGE",
    "SKYFIGHT",
    "BATTLERUSH"
];

const STATS = {
    wins: "s.wins",
    losses: "s.losses",
    games: "s.games_played",
    kills: "s.kills",
    streak: "s.best_win_streak",
    beds: "s.beds_broken",
    goals: "s.goals_scored"
};

module.exports = async function handler(req, res) {

    const mode = String(req.query.mode || "BEDFIGHT").toUpperCase();
    const stat = String(req.query.stat || "wins").toLowerCase();

    if (!MODES.includes(mode)) {
        return res.status(400).json({
            error: "Invalid duel mode",
            allowedModes: MODES
        });
    }

    if (!STATS[stat]) {
        return res.status(400).json({
            error: "Invalid leaderboard statistic",
            allowedStats: Object.keys(STATS)
        });
    }

    try {

        const orderColumn = STATS[stat];

        const [rows] = await pool.execute(
            `
            SELECT
                p.uuid,
                p.username,
                s.mode,
                s.games_played,
                s.wins,
                s.losses,
                s.kills,
                s.current_win_streak,
                s.best_win_streak,
                s.beds_broken,
                s.goals_scored
            FROM md_stats s
            JOIN md_players p
                ON p.uuid = s.uuid
            WHERE s.mode = ?
            ORDER BY ${orderColumn} DESC,
                     s.wins DESC,
                     p.username ASC
            LIMIT 100
            `,
            [mode]
        );

        const players = rows.map((p, index) => {

            const games = Number(p.games_played || 0);
            const wins = Number(p.wins || 0);

            return {
                position: index + 1,

                uuid: p.uuid,
                username: p.username,
                mode: p.mode,

                gamesPlayed: games,
                wins,
                losses: Number(p.losses || 0),
                kills: Number(p.kills || 0),

                winRate:
                    games === 0
                        ? 0
                        : Number(((wins / games) * 100).toFixed(2)),

                currentWinStreak:
                    Number(p.current_win_streak || 0),

                bestWinStreak:
                    Number(p.best_win_streak || 0),

                bedsBroken:
                    Number(p.beds_broken || 0),

                goalsScored:
                    Number(p.goals_scored || 0)
            };
        });

        return res.status(200).json({
            mode,
            statistic: stat,
            count: players.length,
            players
        });

    } catch (error) {

        console.error("Duels leaderboard API error:", error);

        return res.status(500).json({
            error: "Unable to load duel leaderboard"
        });
    }
};
