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

function cleanUsername(value) {
    return String(value || "").trim();
}

async function findPlayerByIgn(username) {
    const [rows] = await pool.execute(
        `
        SELECT
            discordID,
            ign
        FROM rbw_players
        WHERE LOWER(ign) = LOWER(?)
        LIMIT 1
        `,
        [username]
    );

    return rows[0] || null;
}

module.exports = async function handler(req, res) {

    const action =
        String(req.query.action || "summary")
            .trim()
            .toLowerCase();

    const player =
        cleanUsername(req.query.player);

    const player2 =
        cleanUsername(req.query.player2);

    try {

        /*
         * ==================================================
         * STRONGEST TEAMMATES
         * ==================================================
         *
         * Example:
         * /api/rbw/analytics?action=teammates&player=NoOneHeardMeOnce
         */

        if (action === "teammates") {

            if (!player) {
                return res.status(400).json({
                    error: "Player required"
                });
            }

            const target = await findPlayerByIgn(player);

            if (!target) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            const playerId =
                String(target.discordID);

            const [rows] = await pool.execute(
                `
                SELECT
                    ps.player1,
                    ps.player2,
                    ps.type,
                    ps.wins,
                    ps.losses,
                    ps.games,
                    ps.kills_for,
                    ps.kills_against,

                    CASE
                        WHEN ps.player1 = ? THEN ps.player2
                        ELSE ps.player1
                    END AS other_player_id

                FROM rbw_pair_stats ps

                WHERE
                    (ps.player1 = ? OR ps.player2 = ?)
                    AND LOWER(ps.type) IN (
                        'teammate',
                        'team',
                        'ally',
                        'with'
                    )

                ORDER BY
                    ps.wins DESC,
                    ps.games DESC

                LIMIT 100
                `,
                [
                    playerId,
                    playerId,
                    playerId
                ]
            );

            const output = [];

            for (const row of rows) {

                const [playerRows] =
                    await pool.execute(
                        `
                        SELECT ign
                        FROM rbw_players
                        WHERE CAST(discordID AS CHAR)
                              COLLATE utf8mb4_0900_ai_ci
                              =
                              ?
                              COLLATE utf8mb4_0900_ai_ci
                        LIMIT 1
                        `,
                        [row.other_player_id]
                    );

                const games =
                    Number(row.games || 0);

                const wins =
                    Number(row.wins || 0);

                const losses =
                    Number(row.losses || 0);

                output.push({
                    playerId:
                        row.other_player_id,

                    username:
                        playerRows[0]?.ign ||
                        row.other_player_id,

                    games,
                    wins,
                    losses,

                    winRate:
                        games === 0
                            ? 0
                            : Number(
                                (
                                    wins /
                                    games *
                                    100
                                ).toFixed(2)
                            ),

                    killsFor:
                        Number(
                            row.kills_for || 0
                        ),

                    killsAgainst:
                        Number(
                            row.kills_against || 0
                        )
                });
            }

            return res.status(200).json({
                player: target.ign,
                type: "teammates",
                count: output.length,
                teammates: output
            });
        }

        /*
         * ==================================================
         * TOUGHEST OPPONENTS
         * ==================================================
         *
         * Example:
         * /api/rbw/analytics?action=opponents&player=NoOneHeardMeOnce
         */

        if (action === "opponents") {

            if (!player) {
                return res.status(400).json({
                    error: "Player required"
                });
            }

            const target = await findPlayerByIgn(player);

            if (!target) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            const playerId =
                String(target.discordID);

            const [rows] = await pool.execute(
                `
                SELECT
                    ps.player1,
                    ps.player2,
                    ps.type,
                    ps.wins,
                    ps.losses,
                    ps.games,
                    ps.kills_for,
                    ps.kills_against,

                    CASE
                        WHEN ps.player1 = ? THEN ps.player2
                        ELSE ps.player1
                    END AS other_player_id

                FROM rbw_pair_stats ps

                WHERE
                    (ps.player1 = ? OR ps.player2 = ?)
                    AND LOWER(ps.type) IN (
                        'opponent',
                        'against',
                        'enemy',
                        'versus',
                        'vs'
                    )

                ORDER BY
                    ps.losses DESC,
                    ps.games DESC

                LIMIT 100
                `,
                [
                    playerId,
                    playerId,
                    playerId
                ]
            );

            const output = [];

            for (const row of rows) {

                const [playerRows] =
                    await pool.execute(
                        `
                        SELECT ign
                        FROM rbw_players
                        WHERE CAST(discordID AS CHAR)
                              COLLATE utf8mb4_0900_ai_ci
                              =
                              ?
                              COLLATE utf8mb4_0900_ai_ci
                        LIMIT 1
                        `,
                        [row.other_player_id]
                    );

                const games =
                    Number(row.games || 0);

                const wins =
                    Number(row.wins || 0);

                const losses =
                    Number(row.losses || 0);

                output.push({
                    playerId:
                        row.other_player_id,

                    username:
                        playerRows[0]?.ign ||
                        row.other_player_id,

                    games,
                    wins,
                    losses,

                    winRate:
                        games === 0
                            ? 0
                            : Number(
                                (
                                    wins /
                                    games *
                                    100
                                ).toFixed(2)
                            ),

                    killsFor:
                        Number(
                            row.kills_for || 0
                        ),

                    killsAgainst:
                        Number(
                            row.kills_against || 0
                        )
                });
            }

            return res.status(200).json({
                player: target.ign,
                type: "opponents",
                count: output.length,
                opponents: output
            });
        }

        /*
         * ==================================================
         * PLAYER VS PLAYER
         * ==================================================
         *
         * Example:
         * /api/rbw/analytics?action=compare
         * &player=PlayerA
         * &player2=PlayerB
         */

        if (action === "compare") {

            if (!player || !player2) {
                return res.status(400).json({
                    error:
                        "Both player and player2 are required"
                });
            }

            const a =
                await findPlayerByIgn(player);

            const b =
                await findPlayerByIgn(player2);

            if (!a || !b) {
                return res.status(404).json({
                    error:
                        "One or both players not found"
                });
            }

            const aId =
                String(a.discordID);

            const bId =
                String(b.discordID);

            const [pairRows] =
                await pool.execute(
                    `
                    SELECT
                        player1,
                        player2,
                        type,
                        wins,
                        losses,
                        games,
                        kills_for,
                        kills_against

                    FROM rbw_pair_stats

                    WHERE
                    (
                        player1 = ?
                        AND player2 = ?
                    )
                    OR
                    (
                        player1 = ?
                        AND player2 = ?
                    )
                    `,
                    [
                        aId,
                        bId,
                        bId,
                        aId
                    ]
                );

            let teammateRecord = null;
            let opponentRecord = null;

            for (const row of pairRows) {

                const type =
                    String(row.type || "")
                        .toLowerCase();

                const record = {
                    type: row.type,
                    wins:
                        Number(row.wins || 0),

                    losses:
                        Number(row.losses || 0),

                    games:
                        Number(row.games || 0),

                    killsFor:
                        Number(
                            row.kills_for || 0
                        ),

                    killsAgainst:
                        Number(
                            row.kills_against || 0
                        )
                };

                if (
                    [
                        "teammate",
                        "team",
                        "ally",
                        "with"
                    ].includes(type)
                ) {
                    teammateRecord = record;
                }

                if (
                    [
                        "opponent",
                        "against",
                        "enemy",
                        "versus",
                        "vs"
                    ].includes(type)
                ) {
                    opponentRecord = record;
                }
            }

            /*
             * Recent meetings are taken from actual
             * game participation instead of trying to
             * decode longtext pair history blindly.
             */

            const [meetingRows] =
                await pool.execute(
                    `
                    SELECT DISTINCT
                        g.number,
                        g.season_id,
                        g.season_game_number,
                        g.queue_name_snapshot,
                        g.map_name_snapshot,
                        g.winner_team,
                        g.finished_at,
                        g.scored_at,

                        a.team AS player_a_team,
                        a.kills AS player_a_kills,
                        a.final_kills AS player_a_final_kills,
                        a.beds AS player_a_beds,
                        a.mvp AS player_a_mvp,
                        a.won AS player_a_won,

                        b.team AS player_b_team,
                        b.kills AS player_b_kills,
                        b.final_kills AS player_b_final_kills,
                        b.beds AS player_b_beds,
                        b.mvp AS player_b_mvp,
                        b.won AS player_b_won

                    FROM rbw_games g

                    JOIN rbw_game_players a
                        ON a.game_id = g.number

                    JOIN rbw_game_players b
                        ON b.game_id = g.number

                    WHERE
                        a.player_id = ?
                        AND b.player_id = ?
                        AND a.player_id <> b.player_id

                    ORDER BY
                        COALESCE(
                            g.scored_at,
                            g.finished_at,
                            0
                        ) DESC

                    LIMIT 20
                    `,
                    [
                        aId,
                        bId
                    ]
                );

            const meetings =
                meetingRows.map(row => ({
                    gameNumber:
                        Number(row.number),

                    seasonId:
                        row.season_id !== null
                            ? Number(
                                row.season_id
                            )
                            : null,

                    seasonGameNumber:
                        row.season_game_number !== null
                            ? Number(
                                row.season_game_number
                            )
                            : null,

                    queue:
                        row.queue_name_snapshot ||
                        null,

                    map:
                        row.map_name_snapshot ||
                        null,

                    sameTeam:
                        Number(
                            row.player_a_team
                        ) ===
                        Number(
                            row.player_b_team
                        ),

                    winnerTeam:
                        row.winner_team !== null
                            ? Number(
                                row.winner_team
                            )
                            : null,

                    timestamp:
                        Number(
                            row.scored_at ||
                            row.finished_at ||
                            0
                        ),

                    playerA: {
                        username:
                            a.ign,

                        team:
                            Number(
                                row.player_a_team
                            ),

                        kills:
                            Number(
                                row.player_a_kills ||
                                0
                            ),

                        finalKills:
                            Number(
                                row.player_a_final_kills ||
                                0
                            ),

                        beds:
                            Number(
                                row.player_a_beds ||
                                0
                            ),

                        mvp:
                            Boolean(
                                row.player_a_mvp
                            ),

                        won:
                            Boolean(
                                row.player_a_won
                            )
                    },

                    playerB: {
                        username:
                            b.ign,

                        team:
                            Number(
                                row.player_b_team
                            ),

                        kills:
                            Number(
                                row.player_b_kills ||
                                0
                            ),

                        finalKills:
                            Number(
                                row.player_b_final_kills ||
                                0
                            ),

                        beds:
                            Number(
                                row.player_b_beds ||
                                0
                            ),

                        mvp:
                            Boolean(
                                row.player_b_mvp
                            ),

                        won:
                            Boolean(
                                row.player_b_won
                            )
                    }
                }));

            return res.status(200).json({
                playerA: a.ign,
                playerB: b.ign,

                teammateRecord,
                opponentRecord,

                totalMeetings:
                    meetings.length,

                recentMeetings:
                    meetings
            });
        }

        /*
         * ==================================================
         * QUEUE PERFORMANCE
         * ==================================================
         *
         * Example:
         * /api/rbw/analytics?action=queues&player=NoOneHeardMeOnce
         */

        if (action === "queues") {

            if (!player) {
                return res.status(400).json({
                    error: "Player required"
                });
            }

            const target =
                await findPlayerByIgn(player);

            if (!target) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            const playerId =
                String(target.discordID);

            const [rows] =
                await pool.execute(
                    `
                    SELECT
                        COALESCE(
                            g.queue_name_snapshot,
                            g.queue_name,
                            gp.queue_id,
                            'Unknown'
                        ) AS queue_name,

                        COUNT(*) AS games,

                        SUM(
                            CASE
                                WHEN gp.won = 1
                                THEN 1
                                ELSE 0
                            END
                        ) AS wins,

                        SUM(
                            CASE
                                WHEN gp.won = 0
                                THEN 1
                                ELSE 0
                            END
                        ) AS losses,

                        SUM(gp.kills)
                            AS kills,

                        SUM(gp.deaths)
                            AS deaths,

                        SUM(gp.final_kills)
                            AS final_kills,

                        SUM(gp.final_deaths)
                            AS final_deaths,

                        SUM(gp.beds)
                            AS beds,

                        SUM(gp.mvp)
                            AS mvps,

                        SUM(gp.elo_change)
                            AS elo_change

                    FROM rbw_game_players gp

                    JOIN rbw_games g
                        ON g.number =
                           gp.game_id

                    WHERE gp.player_id = ?

                    GROUP BY
                        COALESCE(
                            g.queue_name_snapshot,
                            g.queue_name,
                            gp.queue_id,
                            'Unknown'
                        )

                    ORDER BY games DESC
                    `,
                    [playerId]
                );

            const queues =
                rows.map(row => {

                    const games =
                        Number(
                            row.games || 0
                        );

                    const wins =
                        Number(
                            row.wins || 0
                        );

                    return {
                        queue:
                            row.queue_name,

                        games,

                        wins,

                        losses:
                            Number(
                                row.losses || 0
                            ),

                        winRate:
                            games === 0
                                ? 0
                                : Number(
                                    (
                                        wins /
                                        games *
                                        100
                                    ).toFixed(2)
                                ),

                        kills:
                            Number(
                                row.kills || 0
                            ),

                        deaths:
                            Number(
                                row.deaths || 0
                            ),

                        finalKills:
                            Number(
                                row.final_kills ||
                                0
                            ),

                        finalDeaths:
                            Number(
                                row.final_deaths ||
                                0
                            ),

                        beds:
                            Number(
                                row.beds || 0
                            ),

                        mvps:
                            Number(
                                row.mvps || 0
                            ),

                        eloChange:
                            Number(
                                row.elo_change ||
                                0
                            )
                    };
                });

            return res.status(200).json({
                player:
                    target.ign,

                queues
            });
        }

        /*
         * ==================================================
         * DEFAULT SUMMARY
         * ==================================================
         */

        return res.status(200).json({
            availableActions: {
                teammates:
                    "/api/rbw/analytics?action=teammates&player=USERNAME",

                opponents:
                    "/api/rbw/analytics?action=opponents&player=USERNAME",

                compare:
                    "/api/rbw/analytics?action=compare&player=PLAYER1&player2=PLAYER2",

                queues:
                    "/api/rbw/analytics?action=queues&player=USERNAME"
            }
        });

    } catch (error) {

        console.error(
            "RBW analytics API error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to load RBW analytics"
        });
    }
};
