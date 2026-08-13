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

        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error("Invalid DB_PORT");
        }

        pool = mysql.createPool({
            host: process.env.DB_HOST,
            port,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 2,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });
    }

    return pool;
}

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

const MD_MODES = [
    "BEDFIGHT",
    "FIREBALL_FIGHT",
    "FIREBALL_MACE",
    "BRIDGE",
    "SKYFIGHT",
    "BATTLERUSH"
];

function getQueryValue(value) {
    return Array.isArray(value) ? value[0] : value;
}

function parseLimit(value) {
    if (value === undefined) {
        return 100;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
        return null;
    }

    return parsed;
}

async function getModern121Leaderboard(db, statistic, limit) {
    /*
     * "all" defaults ranking to kills.
     */
    const sortStat = statistic === "all"
        ? "kills"
        : statistic;

    const orderColumn = sortStat === "deaths"
        ? "`deaths`"
        : "`kills`";

    const sql = `
        SELECT
            uuid,
            username,
            kills,
            deaths
        FROM stats
        WHERE ${orderColumn} > 0
        ORDER BY
            ${orderColumn} DESC,
            username ASC,
            uuid ASC
        LIMIT ?
    `;

    const [rows] = await db.query(sql, [limit]);

    return rows.map((row, index) => ({
        rank: index + 1,
        uuid: row.uuid,
        username: row.username,
        kills: Number(row.kills || 0),
        deaths: Number(row.deaths || 0),
        value: Number(row[sortStat] || 0)
    }));
}

async function getModern121PlusLeaderboard(db, statistic, limit) {
    /*
     * "all" defaults ranking to wins.
     *
     * IMPORTANT:
     * md_stats.wins already includes ranked + unranked wins.
     * md_stats.losses already includes ranked + unranked losses.
     *
     * Do NOT add ranked_wins/ranked_losses again.
     */

    const sortStat = statistic === "all"
        ? "wins"
        : statistic;

    const statisticExpression = {
        wins: "SUM(s.wins)",
        losses: "SUM(s.losses)",
        kills: "SUM(s.kills)"
    }[sortStat];

    const placeholders = MD_MODES.map(() => "?").join(", ");

    const sql = `
        SELECT
            p.uuid,
            p.username,
            COALESCE(SUM(s.wins), 0) AS wins,
            COALESCE(SUM(s.losses), 0) AS losses,
            COALESCE(SUM(s.kills), 0) AS kills
        FROM md_players p
        INNER JOIN md_stats s
            ON s.uuid = p.uuid
        WHERE s.mode IN (${placeholders})
        GROUP BY
            p.uuid,
            p.username
        HAVING ${statisticExpression} > 0
        ORDER BY
            ${statisticExpression} DESC,
            p.username ASC,
            p.uuid ASC
        LIMIT ?
    `;

    const [rows] = await db.query(sql, [
        ...MD_MODES,
        limit
    ]);

    return rows.map((row, index) => ({
        rank: index + 1,
        uuid: row.uuid,
        username: row.username,
        wins: Number(row.wins || 0),
        losses: Number(row.losses || 0),
        kills: Number(row.kills || 0),
        value: Number(row[sortStat] || 0)
    }));
}

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");

        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const version = String(
            getQueryValue(req.query.version) || "modern"
        ).toLowerCase();

        let statistic = String(
            getQueryValue(req.query.stat) || "all"
        ).toLowerCase();

        const limit = parseLimit(
            getQueryValue(req.query.limit)
        );

        if (limit === null) {
            return res.status(400).json({
                error: "limit must be between 1 and 100"
            });
        }

        const db = getPool();

        /*
         * MODERN 1.21
         *
         * StrikePractice
         */
        if (version === "modern" || version === "1.21") {
            if (!MODERN_121_STATS.has(statistic)) {
                return res.status(400).json({
                    error: "Invalid statistic for Modern 1.21"
                });
            }

            const players = await getModern121Leaderboard(
                db,
                statistic,
                limit
            );

            return res.status(200).json({
                category: "modern",
                name: "Modern 1.21",
                statistic,
                defaultStatistic: "kills",
                count: players.length,
                players
            });
        }

        /*
         * MODERN 1.21+
         *
         * MultiDuels
         */
        if (
            version === "modern-plus" ||
            version === "1.21+" ||
            version === "plus"
        ) {
            if (!MODERN_121_PLUS_STATS.has(statistic)) {
                return res.status(400).json({
                    error: "Invalid statistic for Modern 1.21+"
                });
            }

            const players = await getModern121PlusLeaderboard(
                db,
                statistic,
                limit
            );

            return res.status(200).json({
                category: "modern-plus",
                name: "Modern 1.21+",
                statistic,
                defaultStatistic: "wins",
                count: players.length,
                players
            });
        }

        return res.status(400).json({
            error: "Invalid leaderboard category"
        });
    } catch (error) {
        console.error("Duels leaderboard error:", error);

        return res.status(500).json({
            error: "Failed to load leaderboard"
        });
    }
};
