const { getPool } = require("./db");

const GAME_STATUSES = new Set(["STARTING", "PLAYING", "SUBMITTED", "SCORED", "VOIDED"]);

function getOnly(req, res) {
    if (req.method === "GET") return true;
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return false;
}

function positiveInt(value, fallback, maximum, label) {
    if (value === undefined || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
        const error = new Error(`Invalid ${label}`);
        error.statusCode = 400;
        throw error;
    }
    return parsed;
}

function username(value, required = false) {
    const clean = String(value || "").trim();
    if (!clean && !required) return "";
    if (!/^[A-Za-z0-9_]{1,16}$/.test(clean)) {
        const error = new Error(clean ? "Invalid Minecraft username" : "Username required");
        error.statusCode = 400;
        throw error;
    }
    return clean;
}

function seasonJson(row) {
    return row ? {
        seasonId: Number(row.season_id),
        seasonNumber: Number(row.season_number),
        seasonName: row.name,
        seasonType: row.type,
        seasonStatus: row.status
    } : null;
}

async function resolveSeason(pool, requested) {
    const supplied = requested !== undefined && requested !== "";
    const number = supplied ? positiveInt(requested, null, 2147483647, "season number") : null;
    const [rows] = supplied
        ? await pool.execute(
            `SELECT season_id, season_number, name, type, status
             FROM vrbw_seasons WHERE season_number = ? LIMIT 1`, [number])
        : await pool.query(
            `SELECT season_id, season_number, name, type, status
             FROM vrbw_seasons WHERE status = 'ACTIVE' ORDER BY season_number DESC LIMIT 1`);
    if (supplied && rows.length === 0) {
        const error = new Error("Season not found");
        error.statusCode = 404;
        throw error;
    }
    return { season: rows[0] || null, explicit: supplied };
}

async function findPlayer(pool, ign) {
    const [rows] = await pool.execute(
        `SELECT player_id, current_ign, minecraft_uuid
         FROM vrbw_players WHERE LOWER(current_ign) = LOWER(?) LIMIT 1`, [ign]);
    return rows[0] || null;
}

function publicError(res, error, message) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: status < 500 ? error.message : message });
}

module.exports = {
    GAME_STATUSES,
    findPlayer,
    getOnly,
    getPool,
    positiveInt,
    publicError,
    resolveSeason,
    seasonJson,
    username
};
