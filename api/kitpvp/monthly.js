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
    kills: "m.kills",
    coins: "m.coins",
    experience: "m.experience"
};

module.exports = async function handler(req, res) {

    const stat =
        String(req.query.stat || "kills").toLowerCase();

    const month =
        String(req.query.month || "").trim();

    if (!STATS[stat]) {
        return res.status(400).json({
            error: "Invalid monthly statistic",
            allowedStats: Object.keys(STATS)
        });
    }

    if (month && !/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({
            error: "Month must use YYYY-MM format"
        });
    }

    try {

        let selectedMonth = month;

        if (!selectedMonth) {

            const [latest] = await pool.query(
                `
                SELECT month
                FROM kp_monthly_stats
                ORDER BY month DESC
                LIMIT 1
                `
            );

            if (latest.length === 0) {
                return res.status(200).json({
                    month: null,
                    statistic: stat,
                    players: []
                });
            }

            selectedMonth = latest[0].month;
        }

        const orderColumn = STATS[stat];

        const [rows] = await pool.execute(
            `
            SELECT
                p.uuid,
                p.username,
                m.month,
                m.kills,
                m.coins,
                m.experience
            FROM kp_monthly_stats m
            JOIN kp_players p
                ON p.uuid = m.uuid
            WHERE m.month = ?
            ORDER BY ${orderColumn} DESC,
                     p.username ASC
            LIMIT 100
            `,
            [selectedMonth]
        );

        return res.status(200).json({
            month: selectedMonth,
            statistic: stat,

            players: rows.map((p, index) => ({
                position: index + 1,
                uuid: p.uuid,
                username: p.username,

                kills: Number(p.kills || 0),
                coins: Number(p.coins || 0),
                experience: Number(p.experience || 0)
            }))
        });

    } catch (error) {

        console.error("KitPvP monthly API error:", error);

        return res.status(500).json({
            error: "Unable to load monthly leaderboard"
        });
    }
};
