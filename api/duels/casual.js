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

let cachedStatsColumns = null;

async function getStatsColumns() {
    if (cachedStatsColumns) {
        return cachedStatsColumns;
    }

    const [rows] = await pool.query("SHOW COLUMNS FROM stats");

    cachedStatsColumns = new Set(
        rows.map(row => String(row.Field).toLowerCase())
    );

    return cachedStatsColumns;
}

function firstExisting(columns, candidates) {
    for (const candidate of candidates) {
        if (columns.has(candidate.toLowerCase())) {
            return candidate;
        }
    }

    return null;
}

function selectOrZero(column, alias) {
    return column
        ? `COALESCE(\`${column}\`, 0) AS \`${alias}\``
        : `0 AS \`${alias}\``;
}

module.exports = async function handler(req, res) {
    const username = String(req.query.username || "").trim();

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
        const columns = await getStatsColumns();

        if (
            !columns.has("uuid") ||
            !columns.has("username") ||
            !columns.has("kills")
        ) {
            return res.status(500).json({
                error: "Practice stats table is missing required columns"
            });
        }

        const deathsColumn = firstExisting(columns, [
            "deaths",
            "death",
            "total_deaths"
        ]);

        const currentStreakColumn = firstExisting(columns, [
            "current_kill_streak",
            "current_killstreak",
            "kill_streak",
            "killstreak",
            "current_streak",
            "streak"
        ]);

        const bestStreakColumn = firstExisting(columns, [
            "best_kill_streak",
            "best_killstreak",
            "highest_kill_streak",
            "highest_killstreak",
            "best_streak",
            "highest_streak",
            "max_streak"
        ]);

        const [rows] = await pool.execute(
            `
            SELECT
                uuid,
                username,
                COALESCE(kills, 0) AS kills,
                ${selectOrZero(deathsColumn, "deaths")},
                ${selectOrZero(
                    currentStreakColumn,
                    "current_kill_streak"
                )},
                ${selectOrZero(
                    bestStreakColumn,
                    "best_kill_streak"
                )}
            FROM stats
            WHERE LOWER(username) = LOWER(?)
            LIMIT 1
            `,
            [username]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                error: "Practice player not found"
            });
        }

        const player = rows[0];

        const kills = Number(player.kills || 0);
        const deaths = Number(player.deaths || 0);

        return res.status(200).json({
            type: "PRACTICE",

            uuid: player.uuid,
            username: player.username,

            kills,
            deaths,

            kd:
                deaths === 0
                    ? kills
                    : Number((kills / deaths).toFixed(2)),

            currentKillStreak:
                Number(player.current_kill_streak || 0),

            bestKillStreak:
                Number(player.best_kill_streak || 0),

            available: {
                deaths: Boolean(deathsColumn),
                currentKillStreak: Boolean(currentStreakColumn),
                bestKillStreak: Boolean(bestStreakColumn)
            }
        });

    } catch (error) {
        console.error("Practice Duels API error:", error);

        return res.status(500).json({
            error: "Unable to load Practice Duels stats"
        });
    }
};
