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
    const username = String(req.query.username || "").trim();

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
                uuid,
                username,
                kills
            FROM stats
            WHERE LOWER(username) = LOWER(?)
            LIMIT 1
            `,
            [username]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "StrikePractice player not found"
            });
        }

        const player = rows[0];

        return res.status(200).json({
            uuid: player.uuid,
            username: player.username,
            kills: Number(player.kills || 0)
        });

    } catch (error) {
        console.error("Casual Duels API error:", error);

        return res.status(500).json({
            error: "Unable to load casual Duels stats"
        });
    }
};
