const rdb = require("mysql");
const environments = require("../config/environments");
const log = require("../logs");
const async = require("async");

/*******************************/
// DB CONNECTION
/*******************************/
const connPool = rdb.createPool(environments.mysql);
setInterval(() => {
  connPool.getConnection(function (err, connection) {
    if (err) {
      log.error(err);
    } else {
      connection.ping(function (err) {});
    }
    if (connection) connection.release();
  });
}, 60000);
/////////////////////////////////

const getConnection = (successCB, failCB) => {
  connPool.getConnection(function (err, connection) {
    if (err) {
      if (failCB) failCB();
      throw err;
    }
    successCB(connection);
  });
};

const ResponseProc = (err, result, connection, resultCB) => {
  if (err) resultCB(false, err);
  else resultCB(true, result);
  connection.release();
};

const TransResponseProc = (err, result, connection, resultCB) => {
  if (err) {
    log.error(err);
    connection.rollback(function () {
      resultCB(false, err);
      connection.release();
    });
  } else {
    connection.commit(function (err) {
      if (err) {
        log.error(err);
        connection.rollback(function () {
          resultCB(false, _response.code.api_fail);
          connection.release();
        });
      } else {
        resultCB(true, result);
        connection.release();
      }
    });
  }
};

/////#1. GET MEMBER INFORMATION
exports.GetMemberInfo = (params, resultCB) => {
  log.debug("#MEMBER INFO--------");
  log.debug(params);

  getConnection(function (connection) {
    let tasks = [
      function (callback) {
        connection.query(
          "SELECT a.mem_id, a.name, a.img_url, " +
            "(SELECT role FROM member_roles WHERE mem_id = ?) AS role " +
            "FROM member_master a " +
            "WHERE mem_id = ?;",
          [params.mem_id, params.mem_id],
          function (err, rows) {
            if (err) {
              log.error(err);
              return callback("ERR");
            } else if (rows.length <= 0 || !rows[0].mem_id) {
              log.error("There is No Member Information***--");
              return callback("ERR");
            } else {
              let curMemberInfo = rows[0];
              callback(null, curMemberInfo);
            }
          }
        );
      },
    ];
    async.waterfall(tasks, function (err, result) {
      ResponseProc(err, result, connection, resultCB);
    });
  });
};

/////#2. GET CHATTING DATA
exports.GetChattingData = (params, resultCB) => {
  log.debug("#CHATTING DATA--------");
  log.debug(params);

  let curQry =
    "SELECT chr_id, offset, data FROM chatroom_data WHERE chr_id = ?";

  if (params.offset == -1) {
    curQry += " ORDER BY offset DESC LIMIT 0, 1; ";
  } else {
    curQry += " AND offset >= " + params.offset;
    curQry += " ORDER BY offset ASC LIMIT 0, 1; ";
  }

  getConnection(function (connection) {
    let tasks = [
      function (callback) {
        connection.query(curQry, [params.chr_id], function (err, rows) {
          if (err) {
            log.error(err);
            return callback("ERR");
          } else if (rows.length > 0) {
            callback(null, rows[0]);
          } else {
            callback(null, {});
          }
        });
      },
      function (info, callback) {
        console.log(info);
        if (info.chr_id) {
          let dataJson = JSON.parse(info.data);

          // dataJson.info = {mem_id : true, mem_id : true...}
          // dataJson.data = [{mem_id : "", msg : "", date : "yyyymmddhhmmis"}]

          let qryStr = " SELECT mem_id, name, img_url FROM member_master WHERE";

          let firstLoop = true;
          qryStr += " mem_id IN (";
          for (const key in dataJson.info) {
            qryStr += (firstLoop === false ? `, ` : ``) + `'${key}'`;
            firstLoop = false;
          }
          qryStr += ");";

          connection.query(qryStr, [], function (err, rows) {
            if (err) {
              log.error(err);
              return callback("ERR");
            } else if (rows.length > 0) {
              let memInfo = {};

              for (let i = 0; i < rows.length; i++) {
                memInfo[rows[i].mem_id] = rows[i];
              }

              //{msg: "", date : "", mem_info : { mem_id : "", name: "", img_url : ""}}
              for (let i = 0; i < dataJson.data.length; i++) {
                dataJson.data[i]["mem_info"] = memInfo[dataJson.data[i].mem_id];
              }

              callback(null, { offset: info.offset, data: dataJson.data });
            } else {
              callback(null, { offset: 0, data: [] });
            }
          });
        } else {
          callback(null, { offset: 0, data: [] });
        }
      },
    ];
    async.waterfall(tasks, function (err, result) {
      ResponseProc(err, result, connection, resultCB);
    });
  });
};

/////#3. GET CHATTING LATEST OFFSET
exports.GetChattingLatestOffset = (params, resultCB) => {
  log.debug("#CHATTING OFFSET--------");
  log.debug(params);

  getConnection(function (connection) {
    let tasks = [
      function (callback) {
        connection.query(
          "SELECT IFNULL(MAX(offset), 0) AS offset FROM chatroom_data WHERE chr_id = ?;",
          [params.chr_id],
          function (err, rows) {
            if (err) {
              log.error(err);
              return callback("ERR");
            } else if (rows.length > 0) {
              callback(null, rows[0]);
            } else {
              callback(null, { offset: -1 });
            }
          }
        );
      },
    ];
    async.waterfall(tasks, function (err, result) {
      ResponseProc(err, result, connection, resultCB);
    });
  });
};

/////#4. INSERT CHATTING DATA
exports.InsChattingData = (params, resultCB) => {
  log.debug("#INSERT CHATTING DATA--------");
  log.debug(params);

  getConnection(function (connection) {
    let tasks = [
      function (callback) {
        connection.query(
          "INSERT INTO chatroom_data " +
            "(`chr_id`,  `offset`,  `data`, create_date) " +
            "VALUES (?, ?, ?, NOW());",
          [params.chr_id, params.offset, params.data],
          function (err, rows) {
            if (err) {
              log.error(err);
              return callback("ERR");
            }
            callback(null);
          }
        );
      },
    ];
    async.waterfall(tasks, function (err, result) {
      ResponseProc(err, result, connection, resultCB);
    });
  });
};

/////#5. ALL CHATROOM IDS
exports.GetAllChatRoomIDs = (params, resultCB) => {
  log.debug("#ALL CHATROOM IDS--------");
  log.debug(params);

  getConnection(function (connection) {
    let tasks = [
      function (callback) {
        connection.query(
          "SELECT chr_id FROM chatroom_rel WHERE mem_id = ? AND status_code = ? ",
          [
            params.mem_id,
            "CM0001D0010", //정상
          ],
          function (err, rows) {
            if (err) {
              logger.error(err);
              return callback("ERR");
            }
            callback(null, rows);
          }
        );
      },
    ];
    async.waterfall(tasks, function (err, result) {
      ResponseProc(err, result, connection, resultCB);
    });
  });
};
