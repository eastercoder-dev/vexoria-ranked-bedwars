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

/*
 * KitPvP leaderboard statistics
 *
 * "all" returns all statistics and uses kills as the
 * default leaderboard ordering.
 */
const STATS = {
    all: "s.kills",
    kills: "s.kills",
    deaths: "s.deaths",
    coins: "s.coins",
    experience: "s.experience",
    streak: "s.best_killstreak"
};

/*
 * Optional aliases so the frontend can use different
 * common names without causing "Invalid leaderboard statistic".
 */
const STAT_ALIASES = {
    kill: "kills",
    death: "deaths",

    xp: "experience",
    exp: "experience",

    killstreak: "streak",
    best_killstreak: "streak",
    bestkillstreak: "streak",
    ks: "streak",

    overall: "all",
    stats: "all"
};

module.exports = async function handler(req, res) {

    /*
     * Read selected leaderboard category.
     * Defaults to "all" if no category is provided.
     */
    let stat = String(req.query.stat || "all")
        .trim()
        .toLowerCase();

    /*
     * Convert aliases to canonical stat names.
     */
    if (STAT_ALIASES[stat]) {
        stat = STAT_ALIASES[stat];
    }

    /*
     * Reject unsupported statistics.
     */
    if (!STATS[stat]) {
        return res.status(400).json({
            error: "Invalid leaderboard statistic",
            receivedStat: stat,
            allowedStats: Object.keys(STATS)
        });
    }

    try {

        const orderColumn = STATS[stat];

        /*
         * Load KitPvP player statistics.
         */
        const [rows] = await pool.query(
            `
            SELECT
                p.uuid,
                p.username,

                s.kills,
                s.deaths,
                s.coins,
                s.experience,

                s.current_killstreak,
                s.best_killstreak,

                s.rank_index,
                s.selected_kit

            FROM kp_stats s

            INNER JOIN kp_players p
                ON p.uuid = s.uuid

            ORDER BY
                ${orderColumn} DESC,
                p.username ASC

            LIMIT 100
            `
        );

        /*
         * Convert database values into clean API output.
         */
        const players = rows.map((player, index) => ({

            position: index + 1,

            uuid: player.uuid,
            username: player.username,

            kills: Number(player.kills || 0),
            deaths: Number(player.deaths || 0),

            coins: Number(player.coins || 0),
            experience: Number(player.experience || 0),

            currentKillstreak:
                Number(player.current_killstreak || 0),

            bestKillstreak:
                Number(player.best_killstreak || 0),

            rankIndex:
                Number(player.rank_index || 0),

            selectedKit:
                player.selected_kit || null
        }));

        /*
         * Successful response.
         */
        return res.status(200).json({
            statistic: stat,
            orderBy:
                stat === "all"
                    ? "kills"
                    : stat,
            count: players.length,
            players
        });

    } catch (error) {

        console.error(
            "KitPvP leaderboard API error:",
            error
        );

        return res.status(500).json({
            error: "Unable to load KitPvP leaderboard"
        });
    }
};
