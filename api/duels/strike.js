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

        const [playerRows] =
            await pool.execute(
                `
                SELECT
                    uuid,
                    fight,
                    username,
                    is_winner,
                    player_data,
                    id

                FROM fight_players

                WHERE LOWER(username) = LOWER(?)

                ORDER BY id DESC

                LIMIT 10
                `,
                [username]
            );

        if (playerRows.length === 0) {

            return res.status(404).json({
                error:
                    "No StrikePractice fights found for player"
            });
        }

        const fightIds =
            playerRows
                .map(row => row.fight)
                .filter(Boolean);

        let fights = [];

        if (fightIds.length > 0) {

            const placeholders =
                fightIds.map(() => "?").join(",");

            /*
             * StrikePractice fight_players.fight is VARCHAR,
             * while fights.id is INT in your schema, so cast
             * ID to text when comparing.
             */

            const [fightRows] =
                await pool.execute(
                    `
                    SELECT
                        id,
                        started,
                        ended,
                        replay_id,
                        arena,
                        kit,
                        mode,
                        fight_data

                    FROM fights

                    WHERE CAST(id AS CHAR)
                    IN (${placeholders})

                    ORDER BY ended DESC
                    `,
                    fightIds.map(String)
                );

            fights = fightRows;
        }

        return res.status(200).json({

            username,

            playerRows,

            fights
        });

    } catch (error) {

        console.error(
            "StrikePractice inspection API error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to inspect StrikePractice data"
        });
    }
};
