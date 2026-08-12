const { getPool } = require("../../lib/db");

function seasonView(row) {
    return {
        seasonId: Number(row.season_id),
        seasonNumber: Number(row.season_number),
        name: row.name,
        type: row.type,
        status: row.status,
        startedAt: Number(row.started_at),
        endedAt: row.ended_at == null ? null : Number(row.ended_at)
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const suppliedSeason = req.query.season !== undefined && req.query.season !== "";
    const seasonNumber = suppliedSeason ? Number(req.query.season) : null;
    if (suppliedSeason && (!Number.isInteger(seasonNumber) || seasonNumber <= 0)) {
        return res.status(400).json({ error: "Invalid season number" });
    }

    try {
        const pool = getPool();
        const [rows] = suppliedSeason
            ? await pool.execute(
                `SELECT season_id, season_number, name, type, status, started_at, ended_at
                 FROM vrbw_seasons WHERE season_number = ? LIMIT 1`,
                [seasonNumber]
            )
            : await pool.query(
                `SELECT season_id, season_number, name, type, status, started_at, ended_at
                 FROM vrbw_seasons ORDER BY season_number DESC`
            );

        if (suppliedSeason && rows.length === 0) {
            return res.status(404).json({ error: "Season not found" });
        }

        const seasons = rows.map(seasonView);
        const activeSeason = seasons.find(season => season.status === "ACTIVE") || null;
        return res.status(200).json({
            count: seasons.length,
            activeSeason,
            betweenSeasons: activeSeason === null,
            selectedSeason: suppliedSeason ? seasons[0] : null,
            seasons
        });
    } catch (error) {
        console.error("RBW seasons API failed", error);
        return res.status(500).json({ error: "Unable to load RBW seasons" });
    }
};
