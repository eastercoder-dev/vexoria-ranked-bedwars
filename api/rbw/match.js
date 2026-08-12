const { getOnly, getPool, positiveInt, publicError } = require("../../lib/rbw");
const { gameView, loadParticipants } = require("../../lib/rbw-matches");

module.exports = async function handler(req, res) {
    if (!getOnly(req, res)) return;
    try {
        const gameNumber = positiveInt(req.query.game, null, 2147483647, "game number");
        const pool = getPool();
        const [games] = await pool.execute(
            `SELECT g.*, s.season_number, s.name AS season_name, s.type AS season_type
             FROM vrbw_ranked_games g JOIN vrbw_seasons s ON s.season_id=g.season_id
             WHERE g.game_number=? LIMIT 1`, [gameNumber]);
        if (!games[0]) return res.status(404).json({ error: "Match not found" });
        const participants = await loadParticipants(pool, games);
        return res.status(200).json({ match: gameView(games[0], participants.get(String(games[0].game_id)) || []) });
    } catch (error) {
        console.error("RBW match-detail API failed", error);
        return publicError(res, error, "Unable to load RBW match");
    }
};
