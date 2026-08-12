const SERVER_ADDRESS = "mc.vexoriannetwork.club";

module.exports = async function handler(req, res) {
    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({ error: "Method not allowed" });
    }
    try {
        const response = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(SERVER_ADDRESS)}`, {
            signal: AbortSignal.timeout(4000), headers: { "Accept": "application/json" }
        });
        if (!response.ok) throw new Error(`Status provider returned ${response.status}`);
        const data = await response.json();
        return res.status(200).json({
            address: SERVER_ADDRESS, online: Boolean(data.online),
            onlinePlayers: Number(data.players?.online || 0), maxPlayers: Number(data.players?.max || 0),
            version: data.version || null
        });
    } catch (error) {
        console.error("Network status API failed", error);
        return res.status(503).json({ error: "Network status is temporarily unavailable" });
    }
};
