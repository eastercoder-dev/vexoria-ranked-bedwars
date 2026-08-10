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

const ALLOWED_STATS = {
    elo: "s.elo",
    peakelo: "s.peak_elo",
    wins: "s.wins",
    losses: "s.losses",
    games: "s.games",
    kills: "s.kills",
    deaths: "s.deaths",
    beds: "s.beds",
    mvps: "s.mvps",
    winstreak: "s.win_streak",
    beststreak: "s.highest_win_streak",
    finalkills: "s.final_kills",
    finaldeaths: "s.final_deaths"
};

module.exports = async function handler(req, res) {

    const stat =
        String(req.query.stat || "elo")
            .trim()
            .toLowerCase();

    const requestedSeason =
        req.query.season !== undefined
            ? Number(req.query.season)
            : null;

    const username =
        String(req.query.username || "")
            .trim();

    if (!ALLOWED_STATS[stat]) {
        return res.status(400).json({
            error: "Invalid leaderboard statistic",
            allowedStats: Object.keys(ALLOWED_STATS)
        });
    }

    if (
        requestedSeason !== null &&
        (!Number.isInteger(requestedSeason) || requestedSeason <= 0)
    ) {
        return res.status(400).json({
            error: "Invalid season ID"
        });
    }

    try {

        /*
         * Determine season.
         *
         * If ?season= is provided:
         * use that season.
         *
         * Otherwise:
         * try to use the currently active season.
         *
         * We use SELECT * logic on rbw_seasons here only
         * to avoid assuming more than necessary about its schema.
         */

        let seasonId = requestedSeason;

        if (seasonId === null) {

            const [seasonRows] = await pool.query(`
                SELECT *
                FROM rbw_seasons
                ORDER BY id DESC
                LIMIT 20
            `);

            if (seasonRows.length === 0) {
                return res.status(200).json({
                    seasonId: null,
                    statistic: stat,
                    players: []
                });
            }

            /*
             * Try common active-state fields.
             * If none exist, newest season becomes current fallback.
             */

            const activeSeason =
                seasonRows.find(row =>
                    row.active === 1 ||
                    row.active === true ||
                    String(row.status || "").toUpperCase() === "ACTIVE" ||
                    String(row.state || "").toUpperCase() === "ACTIVE"
                );

            seasonId =
                Number(
                    (activeSeason || seasonRows[0]).id
                );
        }

        const orderColumn = ALLOWED_STATS[stat];

        /*
         * RBW's historical season table identifies the player using player_id.
         *
         * Your old rbw_players table uses discord/IGN fields.
         *
         * We attempt to join player_id against likely permanent player ID columns.
         */

        const [rows] = await pool.execute(
            `
            SELECT
                s.season_id,
                s.player_id,

                p.ign,

                s.elo,
                s.peak_elo,

                s.wins,
                s.losses,
                s.games,

                s.kills,
                s.deaths,

                s.final_kills,
                s.final_deaths,

                s.beds,
                s.mvps,

                s.win_streak,
                s.highest_win_streak

            FROM rbw_player_season_stats s

            LEFT JOIN rbw_players p
                ON CAST(p.discordID AS CHAR) = s.player_id

            WHERE s.season_id = ?

            ORDER BY ${orderColumn} DESC,
                     s.wins DESC,
                     s.kills DESC,
                     s.player_id ASC

            LIMIT 100
            `,
            [seasonId]
        );

        const players = rows.map((row, index) => {

            const games = Number(row.games || 0);
            const wins = Number(row.wins || 0);
            const losses = Number(row.losses || 0);
            const kills = Number(row.kills || 0);
            const deaths = Number(row.deaths || 0);

            const winRate =
                games === 0
                    ? 0
                    : Number(
                        ((wins / games) * 100)
                            .toFixed(2)
                    );

            const kd =
                deaths === 0
                    ? kills
                    : Number(
                        (kills / deaths)
                            .toFixed(2)
                    );

            return {
                position: index + 1,

                playerId: row.player_id,

                username:
                    row.ign ||
                    row.player_id,

                elo:
                    Number(row.elo || 0),

                peakElo:
                    Number(row.peak_elo || 0),

                games,
                wins,
                losses,

                winRate,

                kills,
                deaths,
                kd,

                finalKills:
                    Number(row.final_kills || 0),

                finalDeaths:
                    Number(row.final_deaths || 0),

                beds:
                    Number(row.beds || 0),

                mvps:
                    Number(row.mvps || 0),

                winStreak:
                    Number(row.win_streak || 0),

                highestWinStreak:
                    Number(
                        row.highest_win_streak || 0
                    )
            };
        });

        let requestedPlayer = null;

        if (username) {

            const index =
                players.findIndex(
                    player =>
                        String(player.username)
                            .toLowerCase() ===
                        username.toLowerCase()
                );

            if (index !== -1) {
                requestedPlayer = players[index];
            } else {

                /*
                 * Player may be outside top 100.
                 * Find them independently.
                 */

                const [playerRows] =
                    await pool.execute(
                        `
                        SELECT
                            s.player_id,
                            p.ign,
                            s.elo,
                            s.peak_elo,
                            s.wins,
                            s.losses,
                            s.games,
                            s.kills,
                            s.deaths,
                            s.final_kills,
                            s.final_deaths,
                            s.beds,
                            s.mvps,
                            s.win_streak,
                            s.highest_win_streak
                        FROM rbw_player_season_stats s
                        LEFT JOIN rbw_players p
                            ON CAST(p.discordID AS CHAR) = s.player_id
                        WHERE s.season_id = ?
                        AND LOWER(p.ign) = LOWER(?)
                        LIMIT 1
                        `,
                        [seasonId, username]
                    );

                if (playerRows.length > 0) {

                    const target =
                        playerRows[0];

                    const targetValue =
                        Number(
                            target[
                                orderColumn.split(".")[1]
                            ] || 0
                        );

                    const [[rankRow]] =
                        await pool.execute(
                            `
                            SELECT
                                COUNT(*) + 1 AS position
                            FROM rbw_player_season_stats
                            WHERE season_id = ?
                            AND ${orderColumn.replace("s.", "")} > ?
                            `,
                            [
                                seasonId,
                                targetValue
                            ]
                        );

                    const games =
                        Number(target.games || 0);

                    const wins =
                        Number(target.wins || 0);

                    const kills =
                        Number(target.kills || 0);

                    const deaths =
                        Number(target.deaths || 0);

                    requestedPlayer = {
                        position:
                            Number(
                                rankRow.position || 1
                            ),

                        playerId:
                            target.player_id,

                        username:
                            target.ign ||
                            target.player_id,

                        elo:
                            Number(target.elo || 0),

                        peakElo:
                            Number(
                                target.peak_elo || 0
                            ),

                        games,
                        wins,

                        losses:
                            Number(
                                target.losses || 0
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

                        kills,

                        deaths,

                        kd:
                            deaths === 0
                                ? kills
                                : Number(
                                    (
                                        kills /
                                        deaths
                                    ).toFixed(2)
                                ),

                        finalKills:
                            Number(
                                target.final_kills || 0
                            ),

                        finalDeaths:
                            Number(
                                target.final_deaths || 0
                            ),

                        beds:
                            Number(target.beds || 0),

                        mvps:
                            Number(target.mvps || 0),

                        winStreak:
                            Number(
                                target.win_streak || 0
                            ),

                        highestWinStreak:
                            Number(
                                target.highest_win_streak || 0
                            )
                    };
                }
            }
        }

        return res.status(200).json({
            seasonId,
            statistic: stat,
            count: players.length,
            requestedPlayer,
            players
        });

    } catch (error) {

        console.error(
            "RBW leaderboard API error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to load RBW leaderboard"
        });
    }
};
