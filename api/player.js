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
                ign,
                elo,
                peakElo,
                wins,
                losses,
                winStreak,
                highestWS,
                mvp,
                beds,
                kills,
                deaths,
                level,
                xp,
                minecraftUUID
            FROM players
            WHERE LOWER(ign) = LOWER(?)
            LIMIT 1
            `,
            [username]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "Player not found"
            });
        }

        const p = rows[0];

        const kd =
            Number(p.deaths) === 0
                ? Number(p.kills)
                : Number(
                    (
                        Number(p.kills) /
                        Number(p.deaths)
                    ).toFixed(2)
                );

        const wl =
            Number(p.losses) === 0
                ? Number(p.wins)
                : Number(
                    (
                        Number(p.wins) /
                        Number(p.losses)
                    ).toFixed(2)
                );

        return res.status(200).json({
            username: p.ign,

            elo: Number(p.elo || 0),
            peakElo: Number(p.peakElo || 0),

            wins: Number(p.wins || 0),
            losses: Number(p.losses || 0),

            winStreak: Number(p.winStreak || 0),
            highestWinStreak: Number(p.highestWS || 0),

            mvps: Number(p.mvp || 0),
            beds: Number(p.beds || 0),

            kills: Number(p.kills || 0),
            deaths: Number(p.deaths || 0),

            kd,
            wl,

            level: Number(p.level || 0),
            xp: Number(p.xp || 0),

            minecraftUUID: p.minecraftUUID || null
        });

    } catch (error) {

        console.error("Player API error:", error);

        return res.status(500).json({
            error: "Unable to load player"
        });

    }
};
