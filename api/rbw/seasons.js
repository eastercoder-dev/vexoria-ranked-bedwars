const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

module.exports = async function handler(req, res) {
    try {
        const [rows] = await pool.query(`
            SELECT *
            FROM rbw_seasons
            ORDER BY id DESC
        `);

        const seasons = rows.map(row => ({
            ...row,
            id: row.id != null ? Number(row.id) : null
        }));

        return res.status(200).json({
            count: seasons.length,
            seasons
        });

    } catch (error) {
        console.error("RBW seasons API error:", error);

        return res.status(500).json({
            error: "Unable to load RBW seasons"
        });
    }
};
