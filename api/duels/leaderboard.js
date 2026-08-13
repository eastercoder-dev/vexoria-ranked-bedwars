const mysql = require("mysql2/promise");

let pool;

function getPool() {
    if (!pool) {
        const required = [
            "DB_HOST",
            "DB_USER",
            "DB_PASSWORD",
            "DB_NAME"
        ];

        for (const key of required) {
            if (!process.env[key]) {
                throw new Error(`Missing environment variable: ${key}`);
            }
        }

        const port = Number(process.env.DB_PORT || 3306);

        if (
            !Number.isInteger(port) ||
            port <= 0 ||
            port > 65535
        ) {
            throw new Error("Invalid DB_PORT");
        }

        pool = mysql.createPool({
            host: process.env.DB_HOST,
            port,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,

            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0,

            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });
    }

    return pool;
}

/*
 * ============================================
 * SUPPORTED LEADERBOARD STATISTICS
 * ============================================
 */

const MODERN_121_STATS = new Set([
    "all",
    "kills",
    "deaths"
]);

const MODERN_121_PLUS_STATS = new Set([
    "all",
    "wins",
    "losses",
    "kills"
]);

/*
 * MultiDuels modes that belong to
 * Modern 1.21+
 */
const MD_MODES = [
    "BEDFIGHT",
    "FIREBALL_FIGHT",
    "FIREBALL_MACE",
    "BRIDGE",
    "SKYFIGHT",
    "BATTLERUSH"
];

/*
 * ============================================
 * HELPERS
 * ============================================
 */

function getQueryValue(value) {
    return Array.isArray(value)
        ? value[0]
        : value;
}

function parseLimit(value) {
    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return 100;
    }

    const parsed = Number(value);

    if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > 100
    ) {
        return null;
    }

    return parsed;
}

/*
 * ============================================
 * MODERN 1.21
 * StrikePractice
 * ============================================
 */

async function getModern121Leaderboard(
    db,
    statistic,
    limit
) {
    /*
     * ALL defaults to KILLS.
     */
    const sortStat =
        statistic === "all"
            ? "kills"
            : statistic;

    /*
     * We aggregate by UUID.
     *
     * This prevents duplicate leaderboard entries
     * if the stats table ever contains multiple
     * records belonging to the same player.
     */
    const orderExpression =
        sortStat === "deaths"
            ? "SUM(COALESCE(deaths, 0))"
            : "SUM(COALESCE(kills, 0))";

    const safeLimit = Math.max(
        1,
        Math.min(100, Number(limit))
    );

    const sql = `
        SELECT
            uuid,

            MAX(username) AS username,

            COALESCE(
                SUM(kills),
                0
            ) AS kills,

            COALESCE(
                SUM(deaths),
                0
            ) AS deaths

        FROM stats

        GROUP BY
            uuid

        ORDER BY
            ${orderExpression} DESC,
            username ASC,
            uuid ASC

        LIMIT ${safeLimit}
    `;

    const [rows] = await db.query(sql);

    return rows.map(
        (row, index) => ({
            rank: index + 1,

            uuid:
                row.uuid,

            username:
                row.username,

            kills:
                Number(row.kills || 0),

            deaths:
                Number(row.deaths || 0),

            value:
                Number(
                    row[sortStat] || 0
                )
        })
    );
}

/*
 * ============================================
 * MODERN 1.21+
 * MultiDuels
 * ============================================
 */

async function getModern121PlusLeaderboard(
    db,
    statistic,
    limit
) {
    /*
     * ALL defaults to WINS.
     */
    const sortStat =
        statistic === "all"
            ? "wins"
            : statistic;

    /*
     * md_stats.wins already contains the
     * appropriate wins.
     *
     * Do NOT add ranked_wins again.
     */
    const statisticExpression = {
        wins:
            "SUM(COALESCE(s.wins, 0))",

        losses:
            "SUM(COALESCE(s.losses, 0))",

        kills:
            "SUM(COALESCE(s.kills, 0))"
    }[sortStat];

    const placeholders =
        MD_MODES
            .map(() => "?")
            .join(", ");

    const safeLimit = Math.max(
        1,
        Math.min(100, Number(limit))
    );

    const sql = `
        SELECT
            p.uuid,

            MAX(p.username)
                AS username,

            COALESCE(
                SUM(s.wins),
                0
            ) AS wins,

            COALESCE(
                SUM(s.losses),
                0
            ) AS losses,

            COALESCE(
                SUM(s.kills),
                0
            ) AS kills

        FROM md_players p

        INNER JOIN md_stats s
            ON s.uuid = p.uuid

        WHERE s.mode IN (
            ${placeholders}
        )

        GROUP BY
            p.uuid

        ORDER BY
            ${statisticExpression} DESC,
            username ASC,
            p.uuid ASC

        LIMIT ${safeLimit}
    `;

    const [rows] = await db.query(
        sql,
        MD_MODES
    );

    return rows.map(
        (row, index) => ({
            rank: index + 1,

            uuid:
                row.uuid,

            username:
                row.username,

            wins:
                Number(row.wins || 0),

            losses:
                Number(row.losses || 0),

            kills:
                Number(row.kills || 0),

            value:
                Number(
                    row[sortStat] || 0
                )
        })
    );
}

/*
 * ============================================
 * API HANDLER
 * ============================================
 */

module.exports = async function handler(
    req,
    res
) {
    /*
     * Always request fresh leaderboard data.
     */
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate"
    );

    res.setHeader(
        "Pragma",
        "no-cache"
    );

    res.setHeader(
        "Expires",
        "0"
    );

    /*
     * GET only.
     */
    if (req.method !== "GET") {
        res.setHeader(
            "Allow",
            "GET"
        );

        return res
            .status(405)
            .json({
                error:
                    "Method not allowed"
            });
    }

    try {
        /*
         * Category/version.
         */
        const version = String(
            getQueryValue(
                req.query.version
            ) || "modern"
        )
            .trim()
            .toLowerCase();

        /*
         * Selected statistic.
         */
        const statistic = String(
            getQueryValue(
                req.query.stat
            ) || "all"
        )
            .trim()
            .toLowerCase();

        /*
         * Result limit.
         */
        const limit = parseLimit(
            getQueryValue(
                req.query.limit
            )
        );

        if (limit === null) {
            return res
                .status(400)
                .json({
                    error:
                        "limit must be between 1 and 100"
                });
        }

        const db = getPool();

        /*
         * ====================================
         * MODERN 1.21
         * ====================================
         */

        if (
            version === "modern" ||
            version === "1.21"
        ) {
            if (
                !MODERN_121_STATS.has(
                    statistic
                )
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid statistic for Modern 1.21",

                        allowedStats:
                            Array.from(
                                MODERN_121_STATS
                            )
                    });
            }

            const players =
                await getModern121Leaderboard(
                    db,
                    statistic,
                    limit
                );

            return res
                .status(200)
                .json({
                    category:
                        "modern",

                    name:
                        "Modern 1.21",

                    statistic,

                    orderBy:
                        statistic === "all"
                            ? "kills"
                            : statistic,

                    defaultStatistic:
                        "kills",

                    count:
                        players.length,

                    players
                });
        }

        /*
         * ====================================
         * MODERN 1.21+
         * ====================================
         */

        if (
            version === "modern-plus" ||
            version === "1.21+" ||
            version === "plus"
        ) {
            if (
                !MODERN_121_PLUS_STATS.has(
                    statistic
                )
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid statistic for Modern 1.21+",

                        allowedStats:
                            Array.from(
                                MODERN_121_PLUS_STATS
                            )
                    });
            }

            const players =
                await getModern121PlusLeaderboard(
                    db,
                    statistic,
                    limit
                );

            return res
                .status(200)
                .json({
                    category:
                        "modern-plus",

                    name:
                        "Modern 1.21+",

                    statistic,

                    orderBy:
                        statistic === "all"
                            ? "wins"
                            : statistic,

                    defaultStatistic:
                        "wins",

                    count:
                        players.length,

                    players
                });
        }

        /*
         * Unknown category.
         */
        return res
            .status(400)
            .json({
                error:
                    "Invalid leaderboard category",

                allowedCategories: [
                    "modern",
                    "modern-plus"
                ]
            });

    } catch (error) {
        console.error(
            "Duels leaderboard error:",
            error
        );

        return res
            .status(500)
            .json({
                error:
                    "Failed to load leaderboard"
            });
    }
};
