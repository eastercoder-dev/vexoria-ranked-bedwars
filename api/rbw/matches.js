const {
    GAME_STATUSES,
    findPlayer,
    getOnly,
    getPool,
    positiveInt,
    publicError,
    seasonJson,
    username
} = require("../../lib/rbw");

const {
    gameView,
    loadParticipants
} = require("../../lib/rbw-matches");

module.exports = async function handler(req, res) {
    if (!getOnly(req, res)) return;

    try {
        const pool = getPool();

        const page = positiveInt(
            req.query.page,
            1,
            1000000,
            "page"
        );

        const limit = positiveInt(
            req.query.limit,
            20,
            100,
            "limit"
        );

        const gameNumber =
            req.query.game === undefined ||
            req.query.game === ""
                ? null
                : positiveInt(
                    req.query.game,
                    null,
                    2147483647,
                    "game number"
                );

        const playerName =
            username(req.query.username);

        const map =
            String(req.query.map || "")
                .trim();

        if (map.length > 100) {
            return res.status(400).json({
                error: "Invalid map"
            });
        }

        const status =
            String(req.query.status || "")
                .trim()
                .toUpperCase();

        if (
            status &&
            !GAME_STATUSES.has(status)
        ) {
            return res.status(400).json({
                error: "Invalid match status"
            });
        }

        /*
         * =========================================
         * SEASON FILTER
         * =========================================
         *
         * IMPORTANT:
         *
         * No season parameter:
         *     Show matches from ALL seasons.
         *
         * ?season=1:
         *     Show only Season 1.
         *
         * ?season=2:
         *     Show only Season 2.
         */

        const rawSeason =
            req.query.season === undefined
                ? ""
                : String(req.query.season).trim();

        let selectedSeason = null;

        if (rawSeason !== "") {
            const seasonNumber =
                Number(rawSeason);

            if (
                !Number.isInteger(seasonNumber) ||
                seasonNumber <= 0
            ) {
                return res.status(400).json({
                    error: "Invalid season"
                });
            }

            const [seasonRows] =
                await pool.execute(
                    `
                    SELECT
                        season_id,
                        season_number,
                        name,
                        type,
                        status,
                        started_at,
                        ended_at,
                        created_at

                    FROM vrbw_seasons

                    WHERE season_number = ?

                    LIMIT 1
                    `,
                    [seasonNumber]
                );

            if (!seasonRows.length) {
                return res.status(404).json({
                    error: "Season not found"
                });
            }

            selectedSeason =
                seasonRows[0];
        }

        /*
         * =========================================
         * PLAYER FILTER
         * =========================================
         */

        let player = null;

        if (playerName) {
            player =
                await findPlayer(
                    pool,
                    playerName
                );

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }
        }

        /*
         * =========================================
         * BUILD WHERE CONDITIONS
         * =========================================
         */

        const conditions = [];
        const params = [];

        /*
         * Only filter season when specifically
         * requested by the website.
         */
        if (selectedSeason) {
            conditions.push(
                "g.season_id = ?"
            );

            params.push(
                selectedSeason.season_id
            );
        }

        if (gameNumber !== null) {
            conditions.push(
                "g.game_number = ?"
            );

            params.push(gameNumber);
        }

        if (map) {
            conditions.push(
                "LOWER(g.map) = LOWER(?)"
            );

            params.push(map);
        }

        if (status) {
            conditions.push(
                "g.status = ?"
            );

            params.push(status);
        }

        if (player) {
            conditions.push(`
                EXISTS (
                    SELECT 1

                    FROM vrbw_ranked_game_players f

                    WHERE
                        f.game_id = g.game_id
                        AND f.player_id = ?
                )
            `);

            params.push(
                player.player_id
            );
        }

        const where =
            conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        /*
         * =========================================
         * COUNT MATCHES
         * =========================================
         */

        const [countRows] =
            await pool.execute(
                `
                SELECT
                    COUNT(*) AS total

                FROM vrbw_ranked_games g

                ${where}
                `,
                params
            );

        const total =
            Number(
                countRows[0]?.total || 0
            );

        const totalPages =
            total === 0
                ? 0
                : Math.ceil(
                    total / limit
                );

        /*
         * Pagination
         */
        const safeLimit =
            Math.max(
                1,
                Math.min(
                    100,
                    Number(limit)
                )
            );

        const safeOffset =
            Math.max(
                0,
                (Number(page) - 1) *
                    safeLimit
            );

        /*
         * =========================================
         * LOAD MATCHES
         * =========================================
         */

        const [games] =
            await pool.execute(
                `
                SELECT
                    g.*,

                    s.season_number,
                    s.name AS season_name,
                    s.type AS season_type

                FROM vrbw_ranked_games g

                INNER JOIN vrbw_seasons s
                    ON s.season_id =
                       g.season_id

                ${where}

                ORDER BY
                    g.created_at DESC,
                    g.game_number DESC

                LIMIT ${safeLimit}
                OFFSET ${safeOffset}
                `,
                params
            );

        /*
         * =========================================
         * LOAD PARTICIPANTS
         * =========================================
         */

        const participants =
            await loadParticipants(
                pool,
                games
            );

        /*
         * =========================================
         * BUILD MATCH OBJECTS
         * =========================================
         */

        const rows =
            games.map(game =>
                gameView(
                    game,
                    participants.get(
                        String(
                            game.game_id
                        )
                    ) || []
                )
            );

        /*
         * =========================================
         * LOAD CURRENT ACTIVE SEASON
         *
         * This is metadata only.
         * It does NOT limit recap matches.
         * =========================================
         */

        const [activeSeasonRows] =
            await pool.execute(
                `
                SELECT
                    season_id,
                    season_number,
                    name,
                    type,
                    status,
                    started_at,
                    ended_at,
                    created_at

                FROM vrbw_seasons

                WHERE status = 'ACTIVE'

                ORDER BY
                    season_number DESC

                LIMIT 1
                `
            );

        const activeSeason =
            activeSeasonRows.length
                ? activeSeasonRows[0]
                : null;

        /*
         * =========================================
         * RESPONSE
         * =========================================
         */

        return res.status(200).json({
            activeSeason:
                activeSeason
                    ? seasonJson(
                        activeSeason
                    )
                    : null,

            betweenSeasons:
                !activeSeason,

            selectedSeason:
                selectedSeason
                    ? seasonJson(
                        selectedSeason
                    )
                    : null,

            allSeasons:
                selectedSeason === null,

            page,
            limit: safeLimit,

            total,
            totalPages,
            count: rows.length,

            filters: {
                season:
                    selectedSeason
                        ? Number(
                            selectedSeason
                                .season_number
                        )
                        : null,

                game:
                    gameNumber,

                username:
                    playerName || null,

                map:
                    map || null,

                status:
                    status || null
            },

            rows,
            matches: rows
        });

    } catch (error) {
        console.error(
            "RBW matches API failed:",
            error
        );

        return publicError(
            res,
            error,
            "Unable to load RBW matches"
        );
    }
};
