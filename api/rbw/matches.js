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

        const playerName = username(req.query.username);

        const map = String(req.query.map || "").trim();

        if (map.length > 100) {
            return res.status(400).json({
                error: "Invalid map"
            });
        }

        const status = String(req.query.status || "")
            .trim()
            .toUpperCase();

        if (status && !GAME_STATUSES.has(status)) {
            return res.status(400).json({
                error: "Invalid match status"
            });
        }

        // Resolve season
        const { season } = await resolveSeason(
            pool,
            req.query.season
        );

        // No season exists
        if (!season) {
            return res.status(200).json({
                activeSeason: null,
                betweenSeasons: true,

                page,
                limit,

                total: 0,
                totalPages: 0,
                count: 0,

                filters: {
                    game: gameNumber,
                    username: playerName || null,
                    map: map || null,
                    status: status || null
                },

                rows: [],
                matches: []
            });
        }

        // Optional player filter
        let player = null;

        if (playerName) {
            player = await findPlayer(
                pool,
                playerName
            );

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }
        }

        // Build WHERE conditions
        const conditions = [
            "g.season_id = ?"
        ];

        const params = [
            season.season_id
        ];

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
                    WHERE f.game_id = g.game_id
                    AND f.player_id = ?
                )
            `);

            params.push(player.player_id);
        }

        const where = conditions.join(" AND ");

        // Count matches
        const [countRows] = await pool.execute(
            `
            SELECT COUNT(*) AS total
            FROM vrbw_ranked_games g
            WHERE ${where}
            `,
            params
        );

        const total =
            Number(countRows[0]?.total || 0);

        const totalPages =
            total === 0
                ? 0
                : Math.ceil(total / limit);

        // Safe integers
        const safeLimit =
            Math.max(
                1,
                Math.min(100, Number(limit))
            );

        const safeOffset =
            Math.max(
                0,
                (Number(page) - 1) * safeLimit
            );

        /*
         * Load matches.
         *
         * limit/offset are already validated numbers,
         * so they can safely be inserted directly.
         */
        const [games] = await pool.execute(
            `
            SELECT
                g.*,
                s.season_number,
                s.name AS season_name,
                s.type AS season_type

            FROM vrbw_ranked_games g

            INNER JOIN vrbw_seasons s
                ON s.season_id = g.season_id

            WHERE ${where}

            ORDER BY g.game_number DESC

            LIMIT ${safeLimit}
            OFFSET ${safeOffset}
            `,
            params
        );

        // Load participants
        const participants =
            await loadParticipants(
                pool,
                games
            );

        // Build website response
        const rows = games.map(game =>
            gameView(
                game,
                participants.get(
                    String(game.game_id)
                ) || []
            )
        );

        return res.status(200).json({
            ...seasonJson(season),

            activeSeason:
                season.status === "ACTIVE"
                    ? seasonJson(season)
                    : null,

            betweenSeasons: false,

            page,
            limit: safeLimit,

            total,
            totalPages,
            count: rows.length,

            filters: {
                game: gameNumber,
                username: playerName || null,
                map: map || null,
                status: status || null
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
