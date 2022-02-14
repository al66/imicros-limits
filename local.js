// Redis settings
process.env.REDIS_HOST = "192.168.2.124";
process.env.REDIS_PORT = 31645;
process.env.REDIS_AUTH = "";
process.env.REDIS_DB = 0;

/* Jest config */
module.exports = {
    testPathIgnorePatterns: ["/dev/"],
    coveragePathIgnorePatterns: ["/node_modules/","/dev/","/test/"]
};
