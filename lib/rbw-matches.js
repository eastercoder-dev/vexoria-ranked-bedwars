function nullableNumber(value) {
    return value == null ? null : Number(value);
}

function participantView(row) {
    return {
        playerId: Number(row.player_id), username: row.current_ign,
        minecraftUUID: row.minecraft_uuid || null, team: nullableNumber(row.team),
        result: row.result || null, kills: nullableNumber(row.kills), deaths: nullableNumber(row.deaths),
        finalKills: nullableNumber(row.final_kills), finalDeaths: nullableNumber(row.final_deaths),
        beds: nullableNumber(row.beds), mvp: row.mvp == null ? null : Boolean(row.mvp),
        eloBefore: nullableNumber(row.elo_before), eloChange: nullableNumber(row.elo_change),
        eloAfter: nullableNumber(row.elo_after)
    };
}

function gameView(game, participantRows) {
    const participants = participantRows.map(participantView);
    const grouped = new Map();
    for (const player of participants) {
        const key = player.team == null ? 0 : player.team;
        if (!grouped.has(key)) grouped.set(key, { team: player.team, winner: player.team != null && player.team === Number(game.winner_team), players: [] });
        grouped.get(key).players.push(player);
    }
    return {
        gameId: Number(game.game_id), gameNumber: Number(game.game_number),
        seasonId: Number(game.season_id), seasonNumber: Number(game.season_number), seasonName: game.season_name,
        seasonType: game.season_type, status: game.status, queueKey: game.queue_key || null,
        queue: { id: game.queue_key || null, name: game.queue_key || null },
        map: game.map || null, mapDetails: { id: null, name: game.map || null },
        winnerTeam: nullableNumber(game.winner_team), startedAt: nullableNumber(game.started_at),
        endedAt: nullableNumber(game.ended_at), createdAt: Number(game.created_at),
        voidReason: game.void_reason || null, participants, teams: Array.from(grouped.values())
    };
}

async function loadParticipants(pool, games) {
    if (games.length === 0) return new Map();
    const placeholders = games.map(() => "?").join(",");
    const [rows] = await pool.execute(
        `SELECT gp.*, p.current_ign, p.minecraft_uuid
         FROM vrbw_ranked_game_players gp JOIN vrbw_players p ON p.player_id=gp.player_id
         WHERE gp.game_id IN (${placeholders}) ORDER BY gp.game_id, gp.team, gp.player_id`,
        games.map(game => game.game_id));
    const byGame = new Map();
    for (const row of rows) {
        const key = String(row.game_id);
        if (!byGame.has(key)) byGame.set(key, []);
        byGame.get(key).push(row);
    }
    return byGame;
}

module.exports = { gameView, loadParticipants };
