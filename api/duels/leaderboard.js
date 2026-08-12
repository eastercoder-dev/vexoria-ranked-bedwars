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

const COMPETITIVE_MODES = [
    "BEDFIGHT",
    "FIREBALL_FIGHT",
    "FIREBALL_MACE",
    "BRIDGE",
    "SKYFIGHT",
    "BATTLERUSH"
];

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

async function loadPracticeLeaderboard() {
    const columns = await getStatsColumns();

    if (
        !columns.has("uuid") ||
        !columns.has("username") ||
        !columns.has("kills")
    ) {
        throw new Error(
            "stats table must contain uuid, username and kills"
        );
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

    const [rows] = await pool.query(
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

        WHERE COALESCE(kills, 0) > 0

        ORDER BY
            kills DESC,
            username ASC

        LIMIT 100
        `
    );

    return rows.map((player, index) => {
        const kills = Number(player.kills || 0);
        const deaths = Number(player.deaths || 0);

        return {
            position: index + 1,

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
                Number(player.best_kill_streak || 0)
        };
    });
}

async function loadCompetitiveLeaderboard(mode) {
    if (mode) {
        const [rows] = await pool.execute(
            `
            SELECT
                p.uuid,
                p.username,

                s.mode,

                COALESCE(s.ranked_wins, 0) AS wins,
                COALESCE(s.ranked_losses, 0) AS losses,

                COALESCE(
                    s.current_ranked_win_streak,
                    0
                ) AS current_win_streak,

                COALESCE(
                    s.best_ranked_win_streak,
                    0
                ) AS best_win_streak

            FROM md_stats s

            JOIN md_players p
                ON p.uuid = s.uuid

            WHERE s.mode = ?

            ORDER BY
                wins DESC,
                losses ASC,
                p.username ASC

            LIMIT 100
            `,
            [mode]
        );

        return rows.map((player, index) => {
            const wins = Number(player.wins || 0);
            const losses = Number(player.losses || 0);
            const games = wins + losses;

            return {
                position: index + 1,

                type: "COMPETITIVE",

                uuid: player.uuid,
                username: player.username,

                mode: player.mode,

                games,
                wins,
                losses,

                wlr:
                    losses === 0
                        ? wins
                        : Number((wins / losses).toFixed(2)),

                winRate:
                    games === 0
                        ? 0
                        : Number(
                            ((wins / games) * 100).toFixed(2)
                        ),

                currentWinStreak:
                    Number(player.current_win_streak || 0),

                bestWinStreak:
                    Number(player.best_win_streak || 0)
            };
        });
    }

    const placeholders =
        COMPETITIVE_MODES.map(() => "?").join(", ");

    const [rows] = await pool.execute(
        `
        SELECT
            p.uuid,
            p.username,

            SUM(
                COALESCE(s.ranked_wins, 0)
            ) AS wins,

            SUM(
                COALESCE(s.ranked_losses, 0)
            ) AS losses,

            MAX(
                COALESCE(
                    s.best_ranked_win_streak,
                    0
                )
            ) AS best_win_streak

        FROM md_players p

        JOIN md_stats s
            ON s.uuid = p.uuid

        WHERE s.mode IN (${placeholders})

        GROUP BY
            p.uuid,
            p.username

        HAVING
            (
                SUM(COALESCE(s.ranked_wins, 0)) +
                SUM(COALESCE(s.ranked_losses, 0))
            ) > 0

        ORDER BY
            wins DESC,
            losses ASC,
            p.username ASC

        LIMIT 100
        `,
        COMPETITIVE_MODES
    );

    return rows.map((player, index) => {
        const wins = Number(player.wins || 0);
        const losses = Number(player.losses || 0);
        const games = wins + losses;

        return {
            position: index + 1,

            type: "COMPETITIVE",

            uuid: player.uuid,
            username: player.username,

            mode: "OVERALL",

            games,
            wins,
            losses,

            wlr:
                losses === 0
                    ? wins
                    : Number((wins / losses).toFixed(2)),

            winRate:
                games === 0
                    ? 0
                    : Number(
                        ((wins / games) * 100).toFixed(2)
                    ),

            currentWinStreak: null,

            bestWinStreak:
                Number(player.best_win_streak || 0)
        };
    });
}

module.exports = async function handler(req, res) {
    const requestedType =
        String(req.query.type || "")
            .trim()
            .toUpperCase();

    const requestedMode =
        String(req.query.mode || "")
            .trim()
            .toUpperCase();

    let type = requestedType;

    if (!type) {
        type =
            requestedMode &&
            COMPETITIVE_MODES.includes(requestedMode)
                ? "COMPETITIVE"
                : "PRACTICE";
    }

    if (!["PRACTICE", "COMPETITIVE"].includes(type)) {
        return res.status(400).json({
            error: "Invalid leaderboard type",
            allowedTypes: [
                "PRACTICE",
                "COMPETITIVE"
            ]
        });
    }

    if (
        type === "COMPETITIVE" &&
        requestedMode &&
        !COMPETITIVE_MODES.includes(requestedMode)
    ) {
        return res.status(400).json({
            error: "Invalid Competitive Duels mode",
            allowedModes: COMPETITIVE_MODES
        });
    }

    try {
        if (type === "PRACTICE") {
            const players =
                await loadPracticeLeaderboard();

            return res.status(200).json({
                type: "PRACTICE",
                statistic: "kills",
                count: players.length,
                players
            });
        }

        const players =
            await loadCompetitiveLeaderboard(
                requestedMode || null
            );

        return res.status(200).json({
            type: "COMPETITIVE",
            statistic: "wins",
            mode: requestedMode || "OVERALL",
            count: players.length,
            players
        });

    } catch (error) {
        console.error(
            "Duels leaderboard API error:",
            error
        );

        return res.status(500).json({
            error: "Unable to load duel leaderboard"
        });
    }
};
