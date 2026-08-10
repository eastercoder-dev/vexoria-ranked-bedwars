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

        const [rows] = await pool.execute(
            `
            SELECT
                p.uuid,
                p.username,
                p.first_seen,
                p.last_seen,
                s.kills,
                s.deaths,
                s.coins,
                s.experience,
                s.current_killstreak,
                s.best_killstreak,
                s.rank_index,
                s.selected_kit,
                s.projectile_hits
            FROM kp_players p
            LEFT JOIN kp_stats s
                ON s.uuid = p.uuid
            WHERE LOWER(p.username) = LOWER(?)
            LIMIT 1
            `,
            [username]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "KitPvP player not found"
            });
        }

        const p = rows[0];

        return res.status(200).json({
            uuid: p.uuid,
            username: p.username,

            firstSeen: Number(p.first_seen || 0),
            lastSeen: Number(p.last_seen || 0),

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
                p.selected_kit || null,

            projectileHits:
                Number(p.projectile_hits || 0)
        });

    } catch (error) {

        console.error("KitPvP player API error:", error);

        return res.status(500).json({
            error: "Unable to load KitPvP player"
        });
    }
};
