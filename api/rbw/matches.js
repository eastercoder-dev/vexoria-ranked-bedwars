const { GAME_STATUSES, findPlayer, getOnly, getPool, positiveInt, publicError, resolveSeason, seasonJson, username } = require("../../lib/rbw");
const { gameView, loadParticipants } = require("../../lib/rbw-matches");

module.exports = async function handler(req, res) {
    if (!getOnly(req, res)) return;
    try {
        const pool = getPool();
        const page = positiveInt(req.query.page, 1, 1000000, "page");
        const limit = positiveInt(req.query.limit, 20, 100, "limit");
        const gameNumber = req.query.game === undefined || req.query.game === "" ? null : positiveInt(req.query.game, null, 2147483647, "game number");
        const playerName = username(req.query.username);
        const map = String(req.query.map || "").trim();
        if (map.length > 100) return res.status(400).json({ error: "Invalid map" });
        const status = String(req.query.status || "").trim().toUpperCase();
        if (status && !GAME_STATUSES.has(status)) return res.status(400).json({ error: "Invalid match status" });
        const { season } = await resolveSeason(pool, req.query.season);
        if (!season) return res.status(200).json({
            activeSeason: null, betweenSeasons: true, page, limit, total: 0, totalPages: 0,
            count: 0, rows: [], matches: []
        });

        let player = null;
        if (playerName) {
            player = await findPlayer(pool, playerName);
            if (!player) return res.status(404).json({ error: "Player not found" });
        }
        const conditions = ["g.season_id = ?"], params = [season.season_id];
        if (gameNumber != null) { conditions.push("g.game_number = ?"); params.push(gameNumber); }
        if (map) { conditions.push("LOWER(g.map) = LOWER(?)"); params.push(map); }
        if (status) { conditions.push("g.status = ?"); params.push(status); }
        if (player) {
            conditions.push("EXISTS (SELECT 1 FROM vrbw_ranked_game_players f WHERE f.game_id=g.game_id AND f.player_id=?)");
            params.push(player.player_id);
        }
        const where = conditions.join(" AND ");
        const [[countRow]] = await pool.execute(`SELECT COUNT(*) AS total FROM vrbw_ranked_games g WHERE ${where}`, params);
        const total = Number(countRow.total), totalPages = total === 0 ? 0 : Math.ceil(total / limit), offset = (page - 1) * limit;
        const [games] = await pool.execute(
            `SELECT g.*, s.season_number, s.name AS season_name, s.type AS season_type
             FROM vrbw_ranked_games g JOIN vrbw_seasons s ON s.season_id=g.season_id
             WHERE ${where} ORDER BY g.game_number DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
        const participants = await loadParticipants(pool, games);
        const rows = games.map(game => gameView(game, participants.get(String(game.game_id)) || []));
        return res.status(200).json({
            ...seasonJson(season), activeSeason: season.status === "ACTIVE" ? seasonJson(season) : null,
            betweenSeasons: false, page, limit, total, totalPages, count: rows.length,
            filters: { game: gameNumber, username: playerName || null, map: map || null, status: status || null },
            rows, matches: rows
        });
    } catch (error) {
        console.error("RBW matches API failed", error);
        return publicError(res, error, "Unable to load RBW matches");
    }
};
