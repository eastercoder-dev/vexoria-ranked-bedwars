const { getPool } = require("../lib/db");

function numeric(value) {
    return Number(value || 0);
}

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }

    const username = String(req.query.username || "").trim();
    if (!username) return res.status(400).json({ error: "Username required" });
    if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
        return res.status(400).json({ error: "Invalid Minecraft username" });
    }

    const suppliedSeason = req.query.season !== undefined && req.query.season !== "";
    const requestedSeason = suppliedSeason ? Number(req.query.season) : null;
    if (suppliedSeason && (!Number.isInteger(requestedSeason) || requestedSeason <= 0)) {
        return res.status(400).json({ error: "Invalid season number" });
    }

    try {
        const pool = getPool();
        const [identityRows] = await pool.execute(
            `SELECT player_id, current_ign, minecraft_uuid
             FROM vrbw_players WHERE LOWER(current_ign) = LOWER(?) LIMIT 1`,
            [username]
        );
        if (identityRows.length === 0) {
            return res.status(404).json({ error: "Player not found" });
        }

        const identity = identityRows[0];
        const [seasonRows] = suppliedSeason
            ? await pool.execute(
                `SELECT season_id, season_number, name, type, status
                 FROM vrbw_seasons WHERE season_number = ? LIMIT 1`,
                [requestedSeason]
            )
            : await pool.query(
                `SELECT season_id, season_number, name, type, status
                 FROM vrbw_seasons WHERE status = 'ACTIVE'
                 ORDER BY season_number DESC LIMIT 1`
            );

        if (suppliedSeason && seasonRows.length === 0) {
            return res.status(404).json({ error: "Season not found" });
        }

        const season = seasonRows[0] || null;
        let stats = null;
        if (season) {
            const [statsRows] = await pool.execute(
                `SELECT elo, peak_elo, wins, losses, kills, deaths, final_kills, final_deaths, beds, mvps,
                        current_win_streak, highest_win_streak,
                        current_loss_streak, highest_loss_streak, xp, level
                 FROM vrbw_player_season_stats
                 WHERE player_id = ? AND season_id = ? LIMIT 1`,
                [identity.player_id, season.season_id]
            );
            stats = statsRows[0] || null;
        }

        const wins = numeric(stats?.wins);
        const losses = numeric(stats?.losses);
        const kills = numeric(stats?.kills);
        const deaths = numeric(stats?.deaths);
        const kd = deaths === 0 ? kills : Number((kills / deaths).toFixed(2));
        const wl = losses === 0 ? wins : Number((wins / losses).toFixed(2));

        return res.status(200).json({
            username: identity.current_ign,
            minecraftUUID: identity.minecraft_uuid || null,
            registered: true,
            hasSeasonStats: stats !== null,
            activeSeason: !suppliedSeason && season ? Number(season.season_number) : null,
            betweenSeasons: !suppliedSeason && season === null,
            seasonNumber: season ? Number(season.season_number) : null,
            seasonName: season?.name || null,
            seasonType: season?.type || null,
            seasonStatus: season?.status || null,
            elo: numeric(stats?.elo),
            peakElo: numeric(stats?.peak_elo),
            wins,
            losses,
            games: wins + losses,
            kills,
            deaths,
            finalKills: numeric(stats?.final_kills),
            finalDeaths: numeric(stats?.final_deaths),
            beds: numeric(stats?.beds),
            mvps: numeric(stats?.mvps),
            currentWinStreak: numeric(stats?.current_win_streak),
            winStreak: numeric(stats?.current_win_streak),
            highestWinStreak: numeric(stats?.highest_win_streak),
            currentLossStreak: numeric(stats?.current_loss_streak),
            highestLossStreak: numeric(stats?.highest_loss_streak),
            level: numeric(stats?.level),
            xp: numeric(stats?.xp),
            kd,
            wl
        });
    } catch (error) {
        console.error("RBW player API failed", error);
        return res.status(500).json({ error: "Unable to load player" });
    }
};
