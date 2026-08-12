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
        String(req.query.username || "")
            .trim();

    if (!username) {
        return res.status(400).json({
            error: "Username required"
        });
    }

    try {

        const [players] =
            await pool.execute(
                `
                SELECT
                    uuid,
                    username
                FROM kp_players
                WHERE LOWER(username) = LOWER(?)
                LIMIT 1
                `,
                [username]
            );

        if (players.length === 0) {
            return res.status(404).json({
                error:
                    "KitPvP player not found"
            });
        }

        const player =
            players[0];

        const [kits] =
            await pool.execute(
                `
                SELECT kit
                FROM kp_owned_kits
                WHERE uuid = ?
                ORDER BY kit ASC
                `,
                [player.uuid]
            );

        return res.status(200).json({

            uuid: player.uuid,
            username: player.username,

            ownedKitCount:
                kits.length,

            ownedKits:
                kits.map(row => row.kit)
        });

    } catch (error) {

        console.error(
            "KitPvP kits API error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to load KitPvP kits"
        });
    }
};
