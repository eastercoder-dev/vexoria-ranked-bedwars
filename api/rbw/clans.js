const { getOnly, getPool, positiveInt, publicError, resolveSeason, seasonJson } = require("../../lib/rbw");

function clanView(row) {
    return {
        clanId: Number(row.clan_id), seasonId: Number(row.season_id), name: row.name, tag: row.tag,
        leader: { playerId: Number(row.leader_player_id), username: row.leader_ign, minecraftUUID: row.leader_uuid || null },
        createdAt: Number(row.created_at), disbandedAt: row.disbanded_at == null ? null : Number(row.disbanded_at),
        disbanded: row.disbanded_at != null, memberCount: Number(row.member_count || 0),
        clanElo: row.member_count ? Math.round(Number(row.elo_sum) / Number(row.member_count)) : null,
        clanEloExact: row.member_count ? Number(row.elo_sum) / Number(row.member_count) : null
    };
}

module.exports = async function handler(req, res) {
    if (!getOnly(req, res)) return;
    try {
        const pool = getPool();
        const configuredStartingElo = Number(process.env.RBW_STARTING_ELO || 0);
        const startingElo = Number.isFinite(configuredStartingElo) && configuredStartingElo >= 0 ? configuredStartingElo : 0;
        const { season } = await resolveSeason(pool, req.query.season);
        if (!season) return res.status(200).json({ activeSeason: null, betweenSeasons: true, count: 0, clans: [] });
        const clanId = req.query.clan === undefined || req.query.clan === "" ? null : positiveInt(req.query.clan, null, Number.MAX_SAFE_INTEGER, "clan ID");
        const tag = String(req.query.tag || "").trim().toUpperCase();
        const leaderboard = ["1", "true"].includes(String(req.query.leaderboard || "").toLowerCase());
        if (tag && !/^[A-Z0-9]{4}$/.test(tag)) return res.status(400).json({ error: "Invalid clan tag" });
        const conditions = ["c.season_id=?"], params = [season.season_id];
        if (clanId != null) { conditions.push("c.clan_id=?"); params.push(clanId); }
        if (tag) { conditions.push("UPPER(c.tag)=?"); params.push(tag); }
        if (leaderboard) conditions.push("c.disbanded_at IS NULL");
        const [rows] = await pool.execute(
            `SELECT c.*, leader.current_ign AS leader_ign, leader.minecraft_uuid AS leader_uuid,
                    COUNT(m.player_id) AS member_count,
                    COALESCE(SUM(COALESCE(ps.elo, ?)),0) AS elo_sum
             FROM vrbw_season_clans c JOIN vrbw_players leader ON leader.player_id=c.leader_player_id
             LEFT JOIN vrbw_season_clan_members m ON m.clan_id=c.clan_id
             LEFT JOIN vrbw_player_season_stats ps ON ps.player_id=m.player_id AND ps.season_id=c.season_id
             WHERE ${conditions.join(" AND ")}
             GROUP BY c.clan_id, c.season_id, c.name, c.tag, c.leader_player_id, c.created_at, c.disbanded_at,
                      leader.current_ign, leader.minecraft_uuid
             ORDER BY c.disbanded_at IS NOT NULL, c.name, c.clan_id`, [startingElo, ...params]);
        rows.sort((a,b) => {
            const ae=Number(a.member_count)?Number(a.elo_sum)/Number(a.member_count):Number.NEGATIVE_INFINITY;
            const be=Number(b.member_count)?Number(b.elo_sum)/Number(b.member_count):Number.NEGATIVE_INFINITY;
            return be-ae || String(a.name).localeCompare(String(b.name),undefined,{sensitivity:"base"}) || String(a.tag).localeCompare(String(b.tag),undefined,{sensitivity:"base"}) || Number(a.clan_id)-Number(b.clan_id);
        });
        if ((clanId != null || tag) && rows.length === 0) return res.status(404).json({ error: "Clan not found" });
        const clans = rows.map(clanView);
        if (clans.length > 0 && (clanId != null || tag)) {
            const [members] = await pool.execute(
                `SELECT m.player_id, m.role, m.joined_at, p.current_ign, p.minecraft_uuid
                 FROM vrbw_season_clan_members m JOIN vrbw_players p ON p.player_id=m.player_id
                 WHERE m.clan_id=? AND m.season_id=? ORDER BY m.role='LEADER' DESC, m.joined_at, m.player_id`,
                [clans[0].clanId, season.season_id]);
            clans[0].members = members.map(row => ({
                playerId: Number(row.player_id), username: row.current_ign, minecraftUUID: row.minecraft_uuid || null,
                role: row.role, joinedAt: Number(row.joined_at)
            }));
        }
        return res.status(200).json({
            ...seasonJson(season), activeSeason: season.status === "ACTIVE" ? seasonJson(season) : null,
            betweenSeasons: false, count: clans.length, clan: clanId != null || tag ? clans[0] : null,
            leaderboard: leaderboard ? clans.map((clan, index) => ({ rank: index + 1, ...clan })) : undefined,
            clans
        });
    } catch (error) {
        console.error("RBW clans API failed", error);
        return publicError(res, error, "Unable to load RBW clans");
    }
};
