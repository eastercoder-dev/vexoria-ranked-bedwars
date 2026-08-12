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
    "SKYFIGHT",
    "BATTLERUSH",
    "BRIDGE"
];

module.exports = async function handler(req, res) {
    const mode =
        String(req.query.mode || "")
            .trim()
            .toUpperCase();

    const username =
        String(req.query.username || "")
            .trim();

    const page =
        Math.max(
            1,
            parseInt(req.query.page || "1", 10)
        );

    const limit = 20;
    const offset = (page - 1) * limit;

    if (mode && !MODES.includes(mode)) {
        return res.status(400).json({
            error: "Invalid mode",
            allowedModes: MODES
        });
    }

    if (
        username &&
        !/^[A-Za-z0-9_]{1,16}$/.test(username)
    ) {
        return res.status(400).json({
            error: "Invalid Minecraft username"
        });
    }

    try {
        const conditions = [];
        const params = [];

        if (mode) {
            conditions.push("m.mode = ?");
            params.push(mode);
        }

        if (username) {
            conditions.push(`
                EXISTS (
                    SELECT 1
                    FROM md_match_players sp
                    WHERE sp.match_id = m.id
                    AND LOWER(sp.username_snapshot) = LOWER(?)
                )
            `);

            params.push(username);
        }

        let sql = `
            SELECT
                m.id,
                m.match_key,
                m.mode,
                m.arena,
                m.started_at,
                m.ended_at,
                m.winner_uuid,
                m.loser_uuid
            FROM md_matches m
        `;

        if (conditions.length) {
            sql +=
                ` WHERE ${conditions.join(" AND ")}`;
        }

        sql += `
            ORDER BY m.ended_at DESC
            LIMIT ${limit}
            OFFSET ${offset}
        `;

        const [matches] =
            await pool.execute(sql, params);

        const result = [];

        for (const match of matches) {
            const [players] =
                await pool.execute(
                    `
                    SELECT
                        uuid,
                        username_snapshot,
                        is_winner,
                        kills,
                        elo_before,
                        elo_after,
                        elo_change
                    FROM md_match_players
                    WHERE match_id = ?
                    ORDER BY
                        is_winner DESC,
                        id ASC
                    `,
                    [match.id]
                );

            result.push({
                id: Number(match.id),

                matchKey:
                    match.match_key || null,

                mode: match.mode,
                arena: match.arena,

                startedAt:
                    Number(match.started_at || 0),

                endedAt:
                    Number(match.ended_at || 0),

                winnerUUID:
                    match.winner_uuid || null,

                loserUUID:
                    match.loser_uuid || null,

                players:
                    players.map(player => ({
                        uuid: player.uuid,

                        username:
                            player.username_snapshot,

                        winner:
                            Boolean(player.is_winner),

                        kills:
                            Number(player.kills || 0),

                        eloBefore:
                            Number(player.elo_before || 0),

                        eloAfter:
                            Number(player.elo_after || 0),

                        eloChange:
                            Number(player.elo_change || 0)
                    }))
            });
        }

        return res.status(200).json({
            type: "COMPETITIVE",
            page,
            perPage: limit,
            mode: mode || null,
            username: username || null,
            matches: result
        });

    } catch (error) {
        console.error(
            "Duels matches API error:",
            error
        );

        return res.status(500).json({
            error: "Unable to load Duels matches"
        });
    }
};
