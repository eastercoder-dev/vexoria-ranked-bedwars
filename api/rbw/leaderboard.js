    const {
    getOnly,
    getPool,
    positiveInt,
    publicError,
    resolveSeason,
    seasonJson,
    username
} = require("../../lib/rbw");

const STATS = {
    elo: "s.elo",
    peakelo: "s.peak_elo",
    wins: "s.wins",
    losses: "s.losses",
    games: "(s.wins + s.losses)",
    kills: "s.kills",
    deaths: "s.deaths",
    finalkills: "s.final_kills",
    finaldeaths: "s.final_deaths",
    beds: "s.beds",
    mvps: "s.mvps",
    currentwinstreak: "s.current_win_streak",
    highestwinstreak: "s.highest_win_streak",
    currentlossstreak: "s.current_loss_streak",
    highestlossstreak: "s.highest_loss_streak",
    level: "s.level",
    xp: "s.xp",
    kd: `
        CASE
            WHEN s.deaths = 0 THEN s.kills
            ELSE s.kills / s.deaths
        END
    `,
    wl: `
        CASE
            WHEN s.losses = 0 THEN s.wins
            ELSE s.wins / s.losses
        END
    `
};

function normalizeStat(value) {
    let key = String(value || "elo")
        .replace(/[_-]/g, "")
        .toLowerCase();

    if (key === "beststreak") {
        key = "highestwinstreak";
    }

    if (!STATS[key]) {
        const error = new Error("Invalid leaderboard statistic");
        error.statusCode = 400;
        throw error;
    }

    return key;
}

function optionalUsername(value) {
    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {
        return null;
    }

    return username(value);
}

function rowView(row, position) {
    const wins = Number(row.wins || 0);
    const losses = Number(row.losses || 0);
    const kills = Number(row.kills || 0);
    const deaths = Number(row.deaths || 0);

    return {
        position,

        playerId: Number(row.player_id),
        username: row.current_ign || null,
        minecraftUUID: row.minecraft_uuid || null,

        elo: Number(row.elo || 0),
        peakElo: Number(row.peak_elo || 0),

        wins,
        losses,
        games: wins + losses,

        kills,
        deaths,

        finalKills: Number(row.final_kills || 0),
        finalDeaths: Number(row.final_deaths || 0),

        beds: Number(row.beds || 0),
        mvps: Number(row.mvps || 0),

        currentWinStreak:
            Number(row.current_win_streak || 0),

        winStreak:
            Number(row.current_win_streak || 0),

        highestWinStreak:
            Number(row.highest_win_streak || 0),

        currentLossStreak:
            Number(row.current_loss_streak || 0),

        highestLossStreak:
            Number(row.highest_loss_streak || 0),

        level: Number(row.level || 0),
        xp: Number(row.xp || 0),

        kd:
            deaths === 0
                ? kills
                : Number((kills / deaths).toFixed(2)),

        wl:
            losses === 0
                ? wins
                : Number((wins / losses).toFixed(2))
    };
}

module.exports = async function handler(req, res) {
    if (!getOnly(req, res)) {
        return;
    }

    try {
        const pool = getPool();

        const stat = normalizeStat(req.query.stat);

        const page = positiveInt(
            req.query.page,
            1,
            1000000,
            "page"
        );

        const limit = positiveInt(
            req.query.limit,
            25,
            100,
            "limit"
        );

        /*
         * Username is OPTIONAL.
         *
         * Previously:
         * username(req.query.username)
         *
         * could fail when no username query parameter
         * was supplied.
         */
        const requestedUsername =
            optionalUsername(req.query.username);

        const { season } = await resolveSeason(
            pool,
            req.query.season
        );

        /*
         * No active/requested season.
         */
        if (!season) {
            return res.status(200).json({
                activeSeason: null,
                betweenSeasons: true,

                statistic: stat,

                page,
                limit,

                total: 0,
                totalPages: 0,
                count: 0,

                rows: [],
                players: [],

                requestedPlayer: null
            });
        }

        const [[countRow]] = await pool.execute(
            `
            SELECT COUNT(*) AS total
            FROM vrbw_player_season_stats
            WHERE season_id = ?
            `,
            [season.season_id]
        );

        const total = Number(countRow?.total || 0);

        const totalPages =
            total === 0
                ? 0
                : Math.ceil(total / limit);

        const offset = (page - 1) * limit;

        const order = STATS[stat];

        /*
         * NOTE:
         * LIMIT/OFFSET are inserted only after strict integer
         * validation above.
         *
         * This avoids mysql2/MySQL driver issues some deployments
         * can have with prepared LIMIT/OFFSET placeholders.
         */
        const [records] = await pool.execute(
            `
            SELECT
                s.*,
                p.current_ign,
                p.minecraft_uuid
            FROM vrbw_player_season_stats s

            LEFT JOIN vrbw_players p
                ON p.player_id = s.player_id

            WHERE s.season_id = ?

            ORDER BY
                ${order} DESC,
                s.elo DESC,
                s.wins DESC,
                s.kills DESC,
                s.player_id ASC

            LIMIT ${limit}
            OFFSET ${offset}
            `,
            [season.season_id]
        );

        const rows = records.map(
            (row, index) =>
                rowView(
                    row,
                    offset + index + 1
                )
        );

        let requestedPlayer = null;

        /*
         * Only execute requested-player lookup
         * when username was actually supplied.
         */
        if (requestedUsername) {
            const [targetRows] = await pool.execute(
                `
                SELECT
                    s.*,
                    p.current_ign,
                    p.minecraft_uuid,
                    ${order} AS sort_value
                FROM vrbw_player_season_stats s

                LEFT JOIN vrbw_players p
                    ON p.player_id = s.player_id

                WHERE
                    s.season_id = ?
                    AND LOWER(p.current_ign) = LOWER(?)

                LIMIT 1
                `,
                [
                    season.season_id,
                    requestedUsername
                ]
            );

            if (targetRows[0]) {
                const target = targetRows[0];

                /*
                 * Calculate rank using the exact same
                 * multi-column ordering as the main leaderboard.
                 */
                const [[rankRow]] = await pool.execute(
                    `
                    SELECT
                        COUNT(*) + 1 AS position
                    FROM vrbw_player_season_stats s

                    WHERE
                        s.season_id = ?
                        AND (
                            ${order} > ?
                            OR (
                                ${order} = ?
                                AND s.elo > ?
                            )
                            OR (
                                ${order} = ?
                                AND s.elo = ?
                                AND s.wins > ?
                            )
                            OR (
                                ${order} = ?
                                AND s.elo = ?
                                AND s.wins = ?
                                AND s.kills > ?
                            )
                            OR (
                                ${order} = ?
                                AND s.elo = ?
                                AND s.wins = ?
                                AND s.kills = ?
                                AND s.player_id < ?
                            )
                        )
                    `,
                    [
                        season.season_id,

                        Number(target.sort_value || 0),

                        Number(target.sort_value || 0),
                        Number(target.elo || 0),

                        Number(target.sort_value || 0),
                        Number(target.elo || 0),
                        Number(target.wins || 0),

                        Number(target.sort_value || 0),
                        Number(target.elo || 0),
                        Number(target.wins || 0),
                        Number(target.kills || 0),

                        Number(target.sort_value || 0),
                        Number(target.elo || 0),
                        Number(target.wins || 0),
                        Number(target.kills || 0),
                        Number(target.player_id)
                    ]
                );

                requestedPlayer = rowView(
                    target,
                    Number(rankRow?.position || 1)
                );
            }
        }

        return res.status(200).json({
            ...seasonJson(season),

            activeSeason:
                season.status === "ACTIVE"
                    ? seasonJson(season)
                    : null,

            betweenSeasons: false,

            statistic: stat,

            page,
            limit,

            total,
            totalPages,

            count: rows.length,

            rows,
            players: rows,

            requestedPlayer
        });

    } catch (error) {
        console.error(
            "RBW leaderboard API failed",
            error
        );

        return publicError(
            res,
            error,
            "Unable to load RBW leaderboard"
        );
    }
};
