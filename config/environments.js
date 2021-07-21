const environments = {
  development: {
    loglevel: "debug", //error, warn, info, debug
    mysql: {
        host: "13.125.98.110",
        user: "root",
        password: "chayasa100!",
        database: "vredu",
        acquireTimeout: 1000,
        connectionLimit: 100, //동시에 최대 100명 접속
        waitForConnections: true, //사용자가 많을 경우 대기 유지
        queueLimit: 0 //Queue에 사용자 제한 없음
    }
  },

  test: {},

  production: {
    status: "production",
  },
};

//NODE_ENV=production or development
const nodeEnv = process.env.NODE_ENV || "development";

module.exports = environments[nodeEnv];
