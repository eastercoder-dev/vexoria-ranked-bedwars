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

    const page =
        Math.max(1, parseInt(req.query.page || "1", 10));

    const limit = 20;
    const offset = (page - 1) * limit;

    try {

        let sql = `
            SELECT
                id,
                killer_uuid,
                killer_username,
                victim_uuid,
                victim_username,
                kit,
                timestamp
            FROM kp_kill_history
        `;

        const params = [];

        if (username) {

            sql += `
                WHERE LOWER(killer_username) = LOWER(?)
                   OR LOWER(victim_username) = LOWER(?)
            `;

            params.push(username, username);
        }

        sql += `
            ORDER BY timestamp DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const [rows] =
            await pool.execute(sql, params);

        return res.status(200).json({
            page,
            perPage: limit,
            username: username || null,

            kills: rows.map(row => ({
                id: Number(row.id),

                killer: {
                    uuid: row.killer_uuid,
                    username: row.killer_username
                },

                victim: {
                    uuid: row.victim_uuid,
                    username: row.victim_username
                },

                kit: row.kit || null,

                timestamp:
                    Number(row.timestamp || 0)
            }))
        });

    } catch (error) {

        console.error("KitPvP kills API error:", error);

        return res.status(500).json({
            error: "Unable to load kill history"
        });
    }
};
