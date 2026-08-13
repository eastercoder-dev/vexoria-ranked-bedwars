const {
    GAME_STATUSES,
    findPlayer,
    getOnly,
    getPool,
    positiveInt,
    publicError,
    resolveSeason,
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

        /*
         * ==========================================
         * PAGINATION
         * ==========================================
         */

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

        /*
         * ==========================================
         * OPTIONAL GAME FILTER
         * ==========================================
         */

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

        /*
         * ==========================================
         * OPTIONAL PLAYER FILTER
         * ==========================================
         */

        const playerName =
            username(req.query.username);

        /*
         * ==========================================
         * OPTIONAL MAP FILTER
         * ==========================================
         */

        const map =
            String(req.query.map || "")
                .trim();

        if (map.length > 100) {
            return res.status(400).json({
                error: "Invalid map"
            });
        }

        /*
         * ==========================================
         * OPTIONAL STATUS FILTER
         * ==========================================
         */

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
         * ==========================================
         * SEASON LOGIC
         * ==========================================
         *
         * IMPORTANT:
         *
         * /api/rbw/matches
         *      -> ALL seasons
         *
         * /api/rbw/matches?season=1
         *      -> Season 1 only
         *
         * /api/rbw/matches?season=2
         *      -> Season 2 only
         */

        const seasonQuery =
            req.query.season === undefined ||
            req.query.season === null ||
            String(req.query.season).trim() === ""
                ? null
                : req.query.season;

        let selectedSeason = null;

        /*
         * Only resolve a season when the website
         * explicitly requested one.
         */
        if (seasonQuery !== null) {
            const result =
                await resolveSeason(
                    pool,
                    seasonQuery
                );

            selectedSeason =
                result.season;

            if (!selectedSeason) {
                return res.status(404).json({
                    error: "Season not found"
                });
            }
        }

        /*
         * ==========================================
         * PLAYER LOOKUP
         * ==========================================
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
         * ==========================================
         * BUILD SQL FILTER
         * ==========================================
         */

        const conditions = [];
        const params = [];

        /*
         * This is THE important difference.
         *
         * Previously:
         *
         * conditions started with:
         *
         * g.season_id = ?
         *
         * which forced every request into the
         * current season.
         *
         * Now season is optional.
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

            params.push(
                gameNumber
            );
        }

        if (map) {
            conditions.push(
                "LOWER(g.map) = LOWER(?)"
            );

            params.push(
                map
            );
        }

        if (status) {
            conditions.push(
                "g.status = ?"
            );

            params.push(
                status
            );
        }

        if (player) {
            conditions.push(
                `EXISTS (
                    SELECT 1
                    FROM vrbw_ranked_game_players f
                    WHERE f.game_id = g.game_id
                    AND f.player_id = ?
                )`
            );

            params.push(
                player.player_id
            );
        }

        /*
         * If there are no filters:
         *
         * WHERE clause is completely omitted.
         */

        const where =
            conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        /*
         * ==========================================
         * COUNT MATCHES
         * ==========================================
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
         * ==========================================
         * SAFE LIMIT / OFFSET
         * ==========================================
         *
         * Keep these directly in SQL because your
         * MySQL server already threw:
         *
         * ER_WRONG_ARGUMENTS
         * Incorrect arguments to mysqld_stmt_execute
         *
         * when LIMIT ? OFFSET ? was used.
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
         * ==========================================
         * LOAD MATCHES
         * ==========================================
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

                JOIN vrbw_seasons s
                    ON s.season_id = g.season_id

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
         * ==========================================
         * LOAD PARTICIPANTS
         * ==========================================
         */

        const participants =
            await loadParticipants(
                pool,
                games
            );

        /*
         * ==========================================
         * FORMAT MATCHES
         * ==========================================
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
         * ==========================================
         * CURRENT ACTIVE SEASON METADATA
         * ==========================================
         *
         * We can safely use resolveSeason() here
         * because this was already part of your
         * working code.
         *
         * IMPORTANT:
         *
         * It is ONLY returned as metadata.
         *
         * It does NOT filter the matches.
         */

        let activeSeason = null;

        try {
            const activeResult =
                await resolveSeason(
                    pool,
                    undefined
                );

            if (
                activeResult &&
                activeResult.season &&
                activeResult.season.status === "ACTIVE"
            ) {
                activeSeason =
                    activeResult.season;
            }
        } catch (seasonError) {
            console.warn(
                "Unable to resolve active RBW season metadata:",
                seasonError
            );
        }

        /*
         * ==========================================
         * RESPONSE
         * ==========================================
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

            limit:
                safeLimit,

            total,

            totalPages,

            count:
                rows.length,

            filters: {
                season:
                    selectedSeason
                        ? selectedSeason.season_number
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

            matches:
                rows
        });

    } catch (error) {
        console.error(
            "RBW matches API failed",
            error
        );

        return publicError(
            res,
            error,
            "Unable to load RBW matches"
        );
    }
};
