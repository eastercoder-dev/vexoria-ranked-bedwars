const mysql = require("mysql2/promise");

const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const GLOBAL_POOL_KEY = Symbol.for("vexoria.mysql.pool");

function databaseConfig() {
    const missing = REQUIRED_ENV.filter(name => !process.env[name]);
    if (missing.length > 0) {
        throw new Error(`Missing required database environment variables: ${missing.join(", ")}`);
    }

    const port = Number(process.env.DB_PORT || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("DB_PORT must be a valid TCP port");
    }

    return {
        host: process.env.DB_HOST,
        port,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 2,
        maxIdle: 2,
        idleTimeout: 60000,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
    };
}

function getPool() {
    if (!globalThis[GLOBAL_POOL_KEY]) {
        globalThis[GLOBAL_POOL_KEY] = mysql.createPool(databaseConfig());
    }
    return globalThis[GLOBAL_POOL_KEY];
}

module.exports = { getPool };
