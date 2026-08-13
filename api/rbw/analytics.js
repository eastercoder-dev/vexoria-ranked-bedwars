const { findPlayer, getOnly, getPool, positiveInt, publicError, resolveSeason, seasonJson, username } = require("../../lib/rbw");

function rate(value, total) {
    return total === 0 ? 0 : Number((value / total * 100).toFixed(2));
}

async function stats(pool, playerId, seasonId) {
    const [rows] = await pool.execute(
        `SELECT s.*, p.current_ign, p.minecraft_uuid
         FROM vrbw_players p LEFT JOIN vrbw_player_season_stats s
         ON s.player_id=p.player_id AND s.season_id=? WHERE p.player_id=? LIMIT 1`,
        [seasonId, playerId]);
    const row = rows[0] || {}, n = value => Number(value || 0);
    const wins = n(row.wins), losses = n(row.losses), kills = n(row.kills), deaths = n(row.deaths);
    return {
        playerId: Number(playerId), username: row.current_ign, minecraftUUID: row.minecraft_uuid || null,
        hasSeasonStats: row.season_id != null, elo: n(row.elo), peakElo: n(row.peak_elo), wins, losses,
        games: wins + losses, kills, deaths, finalKills: n(row.final_kills), finalDeaths: n(row.final_deaths), beds: n(row.beds), mvps: n(row.mvps),
        currentWinStreak: n(row.current_win_streak), highestWinStreak: n(row.highest_win_streak),
        currentLossStreak: n(row.current_loss_streak), highestLossStreak: n(row.highest_loss_streak),
        level: n(row.level), xp: n(row.xp), kd: deaths === 0 ? kills : Number((kills / deaths).toFixed(2)),
        wl: losses === 0 ? wins : Number((wins / losses).toFixed(2))
    };
}

async function pairRows(pool, playerId, seasonId, sameTeam, minimum) {
    const relation = sameTeam ? "other.team = me.team" : "other.team <> me.team";
    const [rows] = await pool.execute(
        `SELECT other.player_id, p.current_ign, p.minecraft_uuid, COUNT(*) AS meetings,
                SUM(CASE WHEN me.result='WIN' THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN me.result='LOSS' THEN 1 ELSE 0 END) AS losses
         FROM vrbw_ranked_game_players me
         JOIN vrbw_ranked_games g ON g.game_id=me.game_id AND g.status='SCORED' AND g.season_id=?
         JOIN vrbw_ranked_game_players other ON other.game_id=me.game_id AND other.player_id<>me.player_id AND ${relation}
         JOIN vrbw_players p ON p.player_id=other.player_id
         WHERE me.player_id=? AND me.result IN ('WIN','LOSS') AND other.result IN ('WIN','LOSS')
         GROUP BY other.player_id, p.current_ign, p.minecraft_uuid
         HAVING COUNT(*)>=?`, [seasonId, playerId, minimum]);
    return rows.map(row => {
        const meetings = Number(row.meetings), wins = Number(row.wins), losses = Number(row.losses);
        return {
            playerId: Number(row.player_id), username: row.current_ign, minecraftUUID: row.minecraft_uuid || null,
            games: meetings, meetings, wins, losses, gamesTogether: meetings,
            winsTogether: wins, lossesTogether: losses, winsAgainst: wins, lossesAgainst: losses,
            winRate: rate(wins, meetings), lossRate: rate(losses, meetings)
        };
    });
}

module.exports = async function handler(req, res) {
    if (!getOnly(req, res)) return;
    try {
        const action = String(req.query.action || "summary").trim().toLowerCase();
        if (!new Set(["summary", "teammates", "opponents", "compare", "queues"]).has(action)) {
            return res.status(400).json({ error: "Invalid analytics action" });
        }
        if (action === "summary" && !req.query.player) {
            return res.status(200).json({
                actions: ["teammates", "opponents", "compare", "queues"],
                unsupported: ["mostKilledVictim", "mostFrequentKiller"],
                unsupportedReason: "Ranked game data does not store killer-to-victim attribution."
            });
        }
        const pool = getPool();
        const { season } = await resolveSeason(pool, req.query.season);
        if (!season) return res.status(200).json({ activeSeason: null, betweenSeasons: true, action });
        const firstName = username(req.query.player, true);
        const first = await findPlayer(pool, firstName);
        if (!first) return res.status(404).json({ error: "Player not found" });

        if (action === "summary") {
            const player = await stats(pool, first.player_id, season.season_id);
            return res.status(200).json({
                ...seasonJson(season), activeSeason: season.status === "ACTIVE" ? seasonJson(season) : null,
                betweenSeasons: false, type: "summary", player
            });
        }

        if (action === "teammates" || action === "opponents") {
            const minimum = positiveInt(req.query.minimum, 3, 100, "minimum meetings");
            const teammate = action === "teammates";
            const records = await pairRows(pool, first.player_id, season.season_id, teammate, minimum);
            records.sort(teammate
                ? (a, b) => b.winRate-a.winRate || b.wins-a.wins || b.games-a.games || a.playerId-b.playerId
                : (a, b) => b.lossesAgainst-a.lossesAgainst || b.lossRate-a.lossRate || b.meetings-a.meetings || a.playerId-b.playerId);
            const payload = {
                ...seasonJson(season), betweenSeasons: false, player: first.current_ign,
                minimumMeetings: minimum, count: records.length,
                killerVictimAnalyticsSupported: false
            };
            if (teammate) Object.assign(payload, {
                type: "teammates", teammates: records, bestPartner: records[0] || null,
                mostWinsTogether: [...records].sort((a,b)=>b.winsTogether-a.winsTogether||b.gamesTogether-a.gamesTogether)[0] || null,
                mostLossesTogether: [...records].sort((a,b)=>b.lossesTogether-a.lossesTogether||b.gamesTogether-a.gamesTogether)[0] || null
            });
            else Object.assign(payload, {
                type: "opponents", opponents: records, toughestOpponent: records[0] || null,
                mostLossesTo: [...records].sort((a,b)=>b.lossesAgainst-a.lossesAgainst||b.meetings-a.meetings)[0] || null
            });
            return res.status(200).json(payload);
        }

        if (action === "queues") {
            const [rows] = await pool.execute(
                `SELECT COALESCE(g.queue_key,'Ranked') AS queue_key, COUNT(*) AS games,
                        SUM(CASE WHEN gp.result='WIN' THEN 1 ELSE 0 END) AS wins,
                        SUM(CASE WHEN gp.result='LOSS' THEN 1 ELSE 0 END) AS losses,
                        COALESCE(SUM(gp.elo_change),0) AS elo_change
                 FROM vrbw_ranked_game_players gp JOIN vrbw_ranked_games g ON g.game_id=gp.game_id
                 WHERE gp.player_id=? AND g.season_id=? AND g.status='SCORED'
                 GROUP BY g.queue_key ORDER BY games DESC, queue_key ASC`, [first.player_id, season.season_id]);
            const queues = rows.map(row => ({
                queue: row.queue_key, games: Number(row.games), wins: Number(row.wins), losses: Number(row.losses),
                winRate: rate(Number(row.wins), Number(row.games)), eloChange: Number(row.elo_change)
            }));
            return res.status(200).json({ ...seasonJson(season), betweenSeasons: false, player: first.current_ign, queues });
        }

        const secondName = username(req.query.player2, true);
        const second = await findPlayer(pool, secondName);
        if (!second) return res.status(404).json({ error: "One or both players not found" });
        const [player1, player2] = await Promise.all([
            stats(pool, first.player_id, season.season_id), stats(pool, second.player_id, season.season_id)
        ]);
        const [meetingRows] = await pool.execute(
            `SELECT g.game_id, g.game_number, g.map, g.ended_at,
                    a.team AS player1_team, a.result AS player1_result,
                    b.team AS player2_team, b.result AS player2_result
             FROM vrbw_ranked_games g
             JOIN vrbw_ranked_game_players a ON a.game_id=g.game_id AND a.player_id=?
             JOIN vrbw_ranked_game_players b ON b.game_id=g.game_id AND b.player_id=?
             WHERE g.season_id=? AND g.status='SCORED'
             ORDER BY g.game_number DESC`, [first.player_id, second.player_id, season.season_id]);
        const meetings = meetingRows.map(row => ({
            gameId: Number(row.game_id), gameNumber: Number(row.game_number), map: row.map || null,
            endedAt: row.ended_at == null ? null : Number(row.ended_at), sameTeam: Number(row.player1_team) === Number(row.player2_team),
            player1Result: row.player1_result, player2Result: row.player2_result
        }));
        const opposing = meetings.filter(row => !row.sameTeam), together = meetings.filter(row => row.sameTeam);
        return res.status(200).json({
            ...seasonJson(season), betweenSeasons: false, type: "compare", player1, player2,
            totalMeetings: meetings.length, gamesTogether: together.length, gamesAgainst: opposing.length,
            player1WinsAgainst: opposing.filter(row=>row.player1Result==="WIN").length,
            player2WinsAgainst: opposing.filter(row=>row.player2Result==="WIN").length,
            meetings, killerVictimAnalyticsSupported: false
        });
    } catch (error) {
        console.error("RBW analytics API failed", error);
        return publicError(res, error, "Unable to load RBW analytics");
    }
};
