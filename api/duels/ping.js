module.exports = async function handler(req, res) {
    console.log("DUELS PING HIT");

    return res.status(200).json({
        success: true,
        message: "Duels API is working"
    });
};
