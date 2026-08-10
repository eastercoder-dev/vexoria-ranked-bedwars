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

const STATS = {
    kills: "s.kills",
    deaths: "s.deaths",
    coins: "s.coins",
    experience: "s.experience",
    streak: "s.best_killstreak"
};

module.exports = async function handler(req, res) {

    const stat =
        String(req.query.stat || "kills").toLowerCase();

    if (!STATS[stat]) {
        return res.status(400).json({
            error: "Invalid leaderboard statistic",
            allowedStats: Object.keys(STATS)
        });
    }

    try {

        const orderColumn = STATS[stat];

        const [rows] = await pool.query(
            `
            SELECT
                p.uuid,
                p.username,
                s.kills,
                s.deaths,
                s.coins,
                s.experience,
                s.current_killstreak,
                s.best_killstreak,
                s.rank_index,
                s.selected_kit
            FROM kp_stats s
            JOIN kp_players p
                ON p.uuid = s.uuid
            ORDER BY ${orderColumn} DESC,
                     p.username ASC
            LIMIT 100
            `
        );

        const players = rows.map((p, index) => ({
            position: index + 1,

            uuid: p.uuid,
            username: p.username,

            kills: Number(p.kills || 0),
            deaths: Number(p.deaths || 0),

            coins: Number(p.coins || 0),
            experience: Number(p.experience || 0),

            currentKillstreak:
                Number(p.current_killstreak || 0),

            bestKillstreak:
                Number(p.best_killstreak || 0),

            rankIndex:
                Number(p.rank_index || 0),

            selectedKit:
                p.selected_kit || null
        }));

        return res.status(200).json({
            statistic: stat,
            count: players.length,
            players
        });

    } catch (error) {

        console.error("KitPvP leaderboard API error:", error);

        return res.status(500).json({
            error: "Unable to load KitPvP leaderboard"
        });
    }
};
