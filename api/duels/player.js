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

        /*
         * MULTIDUELS
         */

        const [multiRows] = await pool.execute(
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
            FROM md_players p
            LEFT JOIN md_stats s
                ON s.uuid = p.uuid
            WHERE LOWER(p.username) = LOWER(?)
            ORDER BY s.mode ASC
            `,
            [username]
        );

        /*
         * STRIKEPRACTICE GLOBAL STATS
         */

        const [practiceRows] = await pool.execute(
            `
            SELECT
                uuid,
                username,
                kills,
                deaths
            FROM stats
            WHERE LOWER(username) = LOWER(?)
            LIMIT 1
            `,
            [username]
        );

        if (
            multiRows.length === 0 &&
            practiceRows.length === 0
        ) {
            return res.status(404).json({
                error: "Player not found"
            });
        }

        const modes = multiRows.map(row => {

            const games =
                Number(row.games_played || 0);

            const wins =
                Number(row.wins || 0);

            const losses =
                Number(row.losses || 0);

            const winRate =
                games === 0
                    ? 0
                    : Number(
                        (
                            wins /
                            games *
                            100
                        ).toFixed(1)
                    );

            return {
                mode: row.mode,

                games,
                wins,
                losses,
                winRate,

                kills:
                    Number(row.kills || 0),

                currentWinStreak:
                    Number(
                        row.current_win_streak || 0
                    ),

                bestWinStreak:
                    Number(
                        row.best_win_streak || 0
                    ),

                bedsBroken:
                    Number(row.beds_broken || 0),

                goalsScored:
                    Number(row.goals_scored || 0)
            };
        });

        const practice =
            practiceRows.length > 0
                ? {
                    username:
                        practiceRows[0].username,

                    kills:
                        Number(
                            practiceRows[0].kills || 0
                        ),

                    deaths:
                        Number(
                            practiceRows[0].deaths || 0
                        )
                }
                : null;

        return res.status(200).json({
            username:
                multiRows[0]?.username ||
                practice?.username ||
                username,

            minecraftUUID:
                multiRows[0]?.uuid ||
                practiceRows[0]?.uuid ||
                null,

            multiDuels: modes,

            strikePractice: practice
        });

    } catch (error) {

        console.error(
            "Duels player API error:",
            error
        );

        return res.status(500).json({
            error: "Unable to load duel player"
        });
    }
};
