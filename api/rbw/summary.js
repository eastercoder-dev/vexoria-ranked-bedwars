const { getOnly, getPool, publicError, resolveSeason, seasonJson } = require("../../lib/rbw");

module.exports = async function handler(req, res) {
    if (!getOnly(req, res)) return;
    try {
        const pool = getPool();
        const { season } = await resolveSeason(pool, req.query.season);
        const [[registered]] = await pool.query(`SELECT COUNT(*) AS total FROM vrbw_players`);
        if (!season) return res.status(200).json({
            registeredPlayers: Number(registered.total), participatingPlayers: 0, totalGames: 0,
            scoredGames: 0, voidedGames: 0, unresolvedGames: 0, clanCount: 0,
            activeSeason: null, betweenSeasons: true
        });
        const [[participating], [games], [clans]] = await Promise.all([
            pool.execute(`SELECT COUNT(*) AS total FROM vrbw_player_season_stats WHERE season_id=?`, [season.season_id]),
            pool.execute(
                `SELECT COUNT(*) AS total,
                        SUM(CASE WHEN status='SCORED' THEN 1 ELSE 0 END) AS scored,
                        SUM(CASE WHEN status='VOIDED' THEN 1 ELSE 0 END) AS voided,
                        SUM(CASE WHEN status IN ('STARTING','PLAYING','SUBMITTED') THEN 1 ELSE 0 END) AS unresolved
                 FROM vrbw_ranked_games WHERE season_id=?`, [season.season_id]),
            season.type === "CLAN"
                ? pool.execute(`SELECT COUNT(*) AS total FROM vrbw_season_clans WHERE season_id=?`, [season.season_id])
                : Promise.resolve([[{ total: 0 }]])
        ]);
        const gameTotals = games[0] || {};
        return res.status(200).json({
            ...seasonJson(season), activeSeason: season.status === "ACTIVE" ? seasonJson(season) : null,
            betweenSeasons: false, registeredPlayers: Number(registered.total),
            participatingPlayers: Number(participating[0]?.total || 0), totalGames: Number(gameTotals.total || 0),
            scoredGames: Number(gameTotals.scored || 0), voidedGames: Number(gameTotals.voided || 0),
            unresolvedGames: Number(gameTotals.unresolved || 0), clanCount: Number(clans[0]?.total || 0)
        });
    } catch (error) {
        console.error("RBW summary API failed", error);
        return publicError(res, error, "Unable to load RBW summary");
    }
};
