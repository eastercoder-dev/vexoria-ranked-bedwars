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
 * StrikePractice modes
 *
 * These come from:
 * fight_players
 *
 * We normalize the fight column so values such as:
 *
 * Sword
 * sword
 * NETHERITE_POT
 * Netherite Pot
 * netheritepot
 *
 * can still match.
 */
const CASUAL_MODES = {
    SWORD: [
        "sword"
    ],

    NETHERITEPOT: [
        "netheritepot",
        "netheritepotion",
        "netheritepotion"
    ],

    BUILDUHC: [
        "builduhc",
        "uhc"
    ],

    CRYSTAL: [
        "crystal",
        "crystalpvp"
    ],

    MACE: [
        "mace"
    ],

    LIFESTEAL: [
        "lifesteal"
    ]
};

/*
 * MultiDuels modes
 *
 * These come from md_stats.
 */
const RANKED_MODES = [
    "BEDFIGHT",
    "FIREBALL_FIGHT",
    "FIREBALL_MACE",
    "BRIDGE",
    "SKYFIGHT",
    "BATTLERUSH"
];

const RANKED_STATS = {
    elo: "s.elo",
    peakelo: "s.peak_elo",
    wins: "s.ranked_wins",
    losses: "s.ranked_losses",
    games: "(s.ranked_wins + s.ranked_losses)",
    kills: "s.kills",
    streak: "s.best_ranked_win_streak",
    currentstreak: "s.current_ranked_win_streak",
    winrate: `
        CASE
            WHEN (s.ranked_wins + s.ranked_losses) = 0 THEN 0
            ELSE (
                s.ranked_wins /
                (s.ranked_wins + s.ranked_losses)
            )
        END
    `
};

function normalizeFightColumn() {
    /*
     * Remove:
     * spaces
     * underscores
     * hyphens
     *
     * and lowercase everything.
     */
    return `
        LOWER(
            REPLACE(
                REPLACE(
                    REPLACE(fight, ' ', ''),
                    '_',
                    ''
                ),
                '-',
                ''
            )
        )
    `;
}

async function loadCasualLeaderboard(mode, stat) {
    const aliases = CASUAL_MODES[mode];

    /*
     * At the moment fight_players definitely gives us:
     *
     * matches
     * wins
     * losses
     * win rate
     *
     * Do not invent per-kit kills unless StrikePractice stores them
     * somewhere reliable.
     */
    const allowedStats = [
        "wins",
        "losses",
        "games",
        "winrate"
    ];

    if (!allowedStats.includes(stat)) {
        stat = "winrate";
    }

    const placeholders = aliases.map(() => "?").join(", ");

    let orderBy;

    switch (stat) {
        case "wins":
            orderBy = "wins DESC, win_rate DESC";
            break;

        case "losses":
            /*
             * Usually leaderboard shouldn't reward losses,
             * but endpoint supports it if requested.
             */
            orderBy = "losses DESC, wins DESC";
            break;

        case "games":
            orderBy = "games_played DESC, wins DESC";
            break;

        case "winrate":
        default:
            orderBy = "win_rate DESC, wins DESC, games_played DESC";
            break;
    }

    const [rows] = await pool.execute(
        `
        SELECT
            MAX(uuid) AS uuid,
            username,

            COUNT(*) AS games_played,

            SUM(
                CASE
                    WHEN is_winner = 1 THEN 1
                    ELSE 0
                END
            ) AS wins,

            SUM(
                CASE
                    WHEN is_winner = 0 THEN 1
                    ELSE 0
                END
            ) AS losses,

            CASE
                WHEN COUNT(*) = 0 THEN 0
                ELSE (
                    SUM(
                        CASE
                            WHEN is_winner = 1 THEN 1
                            ELSE 0
                        END
                    ) / COUNT(*)
                ) * 100
            END AS win_rate

        FROM fight_players

        WHERE ${normalizeFightColumn()} IN (${placeholders})

        GROUP BY LOWER(username), username

        HAVING COUNT(*) > 0

        ORDER BY ${orderBy},
                 username ASC

        LIMIT 100
        `,
        aliases
    );

    return rows.map((player, index) => ({
        position: index + 1,

        source: "STRIKEPRACTICE",

        uuid: player.uuid,
        username: player.username,

        mode,

        gamesPlayed:
            Number(player.games_played || 0),

        wins:
            Number(player.wins || 0),

        losses:
            Number(player.losses || 0),

        winRate:
            Number(
                Number(player.win_rate || 0).toFixed(2)
            )
    }));
}

async function loadRankedLeaderboard(mode, stat) {
    if (!RANKED_STATS[stat]) {
        stat = "winrate";
    }

    const orderColumn =
        RANKED_STATS[stat];

    const [rows] = await pool.execute(
        `
        SELECT
            p.uuid,
            p.username,

            s.mode,

            s.elo,
            s.peak_elo,

            s.ranked_wins,
            s.ranked_losses,

            s.kills,

            s.current_ranked_win_streak,
            s.best_ranked_win_streak

        FROM md_stats s

        JOIN md_players p
            ON p.uuid = s.uuid

        WHERE s.mode = ?

        ORDER BY ${orderColumn} DESC,
                 s.ranked_wins DESC,
                 p.username ASC

        LIMIT 100
        `,
        [mode]
    );

    return rows.map((player, index) => {
        const wins =
            Number(player.ranked_wins || 0);

        const losses =
            Number(player.ranked_losses || 0);

        const games =
            wins + losses;

        const winRate =
            games === 0
                ? 0
                : (wins / games) * 100;

        return {
            position: index + 1,

            source: "MULTIDUELS",

            uuid: player.uuid,
            username: player.username,

            mode,

            elo:
                Number(player.elo || 1000),

            peakElo:
                Number(player.peak_elo || 1000),

            gamesPlayed:
                games,

            wins,

            losses,

            kills:
                Number(player.kills || 0),

            winRate:
                Number(winRate.toFixed(2)),

            currentWinStreak:
                Number(
                    player.current_ranked_win_streak || 0
                ),

            bestWinStreak:
                Number(
                    player.best_ranked_win_streak || 0
                )
        };
    });
}

module.exports = async function handler(req, res) {
    const mode =
        String(req.query.mode || "BEDFIGHT")
            .trim()
            .toUpperCase();

    let stat =
        String(req.query.stat || "winrate")
            .trim()
            .toLowerCase();

    const isCasual =
        Object.prototype.hasOwnProperty.call(
            CASUAL_MODES,
            mode
        );

    const isRanked =
        RANKED_MODES.includes(mode);

    if (!isCasual && !isRanked) {
        return res.status(400).json({
            error: "Invalid duel mode",

            allowedModes: [
                ...Object.keys(CASUAL_MODES),
                ...RANKED_MODES
            ]
        });
    }

    try {
        let players;

        if (isCasual) {
            players =
                await loadCasualLeaderboard(
                    mode,
                    stat
                );
        } else {
            players =
                await loadRankedLeaderboard(
                    mode,
                    stat
                );
        }

        return res.status(200).json({
            mode,

            type:
                isCasual
                    ? "CASUAL"
                    : "RANKED",

            source:
                isCasual
                    ? "STRIKEPRACTICE"
                    : "MULTIDUELS",

            statistic: stat,

            count:
                players.length,

            players
        });
    } catch (error) {
        console.error(
            "Duels leaderboard API error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to load duel leaderboard"
        });
    }
};
