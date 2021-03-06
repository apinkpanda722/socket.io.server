const express = require("express");
const app = express();
const cors = require("cors");
const server = require("http").createServer(app);
const port = process.env.PORT || 3000;
const io = require("socket.io")(server);
const log = require("./logs");
const dbconn = require("./dbconn");
const logger = require("./logs");

/* const domains = ["http://localhost:3000"];

const corsOptions = {
  origin: function (origin, callback) {
    const isTrue = domains.indexOf(origin) !== -1;
    callback(null, isTrue);
  },
  credentials: true,
}; */

/* const io = require("socket.io")(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    transports: ["websocket", "polling"],
    allowedHeaders: ["Access-Control-Allow-Origin"],
    credentials: true,
  },
  allowEIO3: true,
}); */

server.listen(port, () => {
  log.info("Server listening at port [" + port + "]");
});

/*************************************************************
 *
 * Version : 1.0
 * Created By : Bryan Park
 * Created Date : 2021.06.08
 *
 * CONNECTION PROCESS
 *
 */

//const _conn_socket = io.of("/conn");
const _conn_socket = io;

const padto = (n) => (n < 10 ? "0" + n : n);

const dateYYMMDDHHMMSS = () => {
  let date = new Date();
  return (
    date.getFullYear().toString() +
    padto(date.getMonth() + 1) +
    padto(date.getDate()) +
    padto(date.getHours()) +
    padto(date.getMinutes()) +
    padto(date.getSeconds())
  );
};

let _chr_max_data = 5;
let _chr_data = {};
let _chr_sync = {};

const _MASTER_OPEN_ID = "VR_OPEN_ID";

let _lecture_live_data = {};

const GetRoomList = (roomID) => {
  let clients = _conn_socket.sockets.adapter.rooms[roomID];

  let memList = [];
  let memDupChk = {};
  if (clients) {
    Object.keys(clients.sockets).forEach(function (socketId) {
      let curSocket = _conn_socket.sockets.connected[socketId];
      //if (curSocket && data.member_id != curSocket.member_info.member_id) {
      if (curSocket && memDupChk[curSocket.mem_info.mem_id] != true) {
        memDupChk[curSocket.mem_info.mem_id] = true;
        memList.push(curSocket.mem_info);
      }
    });
  }

  return memList;
};

const FindSocketInfo = (roomID, targMemID, deviceType) => {
  let clients = _conn_socket.sockets.adapter.rooms[roomID];
  let rtSocket = null;

  if (clients) {
    let curKeys = Object.keys(clients.sockets);
    let curDeviceType = deviceType ? deviceType : "WEB";

    for (let i = 0; i < curKeys.length; i++) {
      let curSocket = _conn_socket.sockets.connected[curKeys[i]];
      if (
        curSocket &&
        targMemID == curSocket.mem_info.mem_id &&
        curSocket.mem_info.device == curDeviceType
      ) {
        rtSocket = curSocket;
        break;
      }
    }
  }
  return rtSocket;
};

const initSocketProc = (socket, isSuccess, rstData) => {
  if (isSuccess) {
    socket["mem_info"] = rstData;
    socket.join(_MASTER_OPEN_ID);
    log.info(
      `Join in the ROOM [Member ID:  + ${rstData.mem_id} + Member ROLE:  + ${rstData.role} ]`
    );

    //#?????? ???????????? ????????? ???????????? Socket??? ???????????? ???????????? ?????? init ???????????? ????????????.
    socket.emit("conn:init", {});

    //sending to all clients in room(channel) except sender
    //socket.broadcast.to(roomId).emit("chat:refresh", memList);
    // sending to all clients in room(channel)
    let memList = GetRoomList(_MASTER_OPEN_ID);
    let joinInfos = {
      join_info: rstData,
      all_info: memList,
    };

    //#OPEN ROOM??? ????????? ?????? ??????????????? ?????? ????????? ???????????? ?????? ?????????????????? ????????????.
    _conn_socket.in(_MASTER_OPEN_ID).emit("conn:join", joinInfos);

    //#?????? ????????? ?????? ?????? ROOM??? JOIN ??????.
    socket.on("chat:alljoin", function (data, callback) {
      log.info("connection...::[chat:alljoin]");
      log.info(data);

      dbconn.GetAllChatRoomIDs(socket.mem_info, function (isSuccess, rstData) {
        if (isSuccess) {
          let chr_id_list = [];
          for (let i = 0; i < rstData.length; i++) {
            socket.join(rstData[i].chr_id);
            chr_id_list.push(rstData[i].chr_id);
          }
          callback(chr_id_list);
        }
      });
    });

    //#?????? ?????? ROOM??? JOIN??????.
    socket.on("chat:join", function (data) {
      log.info("connection...::[chat:join]");
      log.info(data);
      //{targ_mem_id : "", chr_id : ""}

      socket.join(data.chr_id);
      log.info(
        "Join in the CHAT ROOM [Member ID: " +
          socket.mem_info.mem_id +
          ", Chat Room ID: " +
          data.chr_id +
          "]"
      );

      let targSocket = FindSocketInfo(_MASTER_OPEN_ID, data.targ_mem_id);
      if (targSocket != null) {
        targSocket.join(data.chr_id);

        let curParam = socket.mem_info;
        curParam["chr_id"] = data.chr_id;
        targSocket.emit("chat:join", curParam);
      }
    });

    //#?????? ?????? ROOM?????? LEAVE??????.
    socket.on("chat:leave", function (data) {
      log.info("connection...::[chat:leave]");
      log.info(data);
      //{chr_id: ""}

      socket.leave(data.chr_id);

      let leaveParam = {
        mem_id: socket.mem_info.mem_id,
        name: socket.mem_info.name,
        char_id: data.chr_id,
      };
      socket.broadcast.to(data.chr_id).emit("chat:leave", leaveParam);
    });

    const cacheDataProc = (chrId, cacheData, data) => {
      cacheData.mem_info[data.mem_info.mem_id] = data.mem_info;
      cacheData.info[data.mem_info.mem_id] = true;
      cacheData.data.push({
        mem_id: data.mem_info.mem_id,
        msg: data.msg,
        date: data.date,
      });

      if (cacheData.data.length > _chr_max_data) {
        let dbParams = {
          chr_id: chrId,
          offset: cacheData.offset,
          data: JSON.stringify({ info: cacheData.info, data: cacheData.data }),
        };

        dbconn.InsChattingData(dbParams, function (isSuccess, rstData) {
          log.info("##..Insert Chatting Data [" + isSuccess + "]");
          if (isSuccess) {
            _chr_data[chrId] = {
              mem_info: {},
              offset: cacheData.offset + 1,
              info: {},
              data: [],
            };
          } else {
            _chr_data[chrId] = cacheData;
          }
          _chr_sync[chrId] = false; //SYNC TOGGLE
        });
      } else {
        _chr_data[chrId] = cacheData;
        _chr_sync[chrId] = false; //SYNC TOGGLE
      }
    };

    //#?????? ???????????? ????????????. (Cache??? ?????? + DB??? ??????)
    socket.on("chat:message", function (data) {
      log.debug("..::[chat:message]");
      log.debug(data);
      //{chr_id : "", msg: ""}
      //data["mem_info"] = socket.mem_info;
      let curChrID = data.chr_id;
      data.mem_info = socket.mem_info;
      data.date = dateYYMMDDHHMMSS();
      data.chr_id = curChrID;
      //sending to all clients in room(channel) except sender
      //{msg: "", date : "", char_id : "", mem_info : { mem_id : "", name: "", img_url : ""}}
      socket.broadcast.to(curChrID).emit("chat:message", data);

      ///// CHECK SYNC
      let curSync = _chr_sync[curChrID];
      if (
        typeof curSync != "undefined" &&
        curSync != null &&
        curSync === true
      ) {
        while (_chr_sync[curChrID] === true) {}
      }

      _chr_sync[curChrID] = true; //SYNC TOGGLE

      ///// SAVE CACHE DATA FOR CHATTING
      let cacheData = _chr_data[curChrID];

      if (!cacheData) {
        dbconn.GetChattingLatestOffset(data, function (isSuccess, rstData) {
          let curOffset = isSuccess === false ? 0 : rstData.offset + 1;
          cacheData = {
            mem_info: {},
            offset: curOffset,
            info: {},
            data: [],
          };

          log.debug("##..LATEST OFFSET [" + curOffset + "]");

          cacheDataProc(curChrID, cacheData, data);
        });
      } else {
        cacheDataProc(curChrID, cacheData, data);
      }
    });

    //#?????? ????????? ????????????. (CACHE?????? ?????? ??? ????????? DB?????? ??????)
    socket.on("chat:hist", function (data, callback) {
      log.debug("..::[chat:hist]");
      log.debug(data);
      ///{chr_id : "", offset : "-1(latest data) or ...."}

      let cacheData = _chr_data[data.chr_id];

      if (cacheData && (data.offset == -1 || cacheData.offset == data.offset)) {
        for (let i = 0; i < cacheData.data.length; i++) {
          cacheData.data[i]["mem_info"] =
            cacheData.mem_info[cacheData.data[i].mem_id];
        }
        callback({ data: cacheData.data, offset: cacheData.offset });
      } else {
        console.log(data);
        dbconn.GetChattingData(data, function (isSuccess, rstData) {
          if (isSuccess) {
            callback(rstData);
          } else {
            callback({ offset: 0, data: [] });
          }
        });
      }
    });

    socket.on("disconnect", () => {
      log.debug("disconnect...[" + socket.mem_info.mem_id + "]");
      // log.debugPrint("Disconnected.. [Member ID: " + memberID + "]");

      //#????????? ???????????? ??????????????? ?????????????????? ?????? ?????? ?????? ????????? ????????? OPEN ROOM??? ????????????.
      // sending to all clients in room(channel)
      let memList = GetRoomList(_MASTER_OPEN_ID);
      let leaveInfos = {
        leave_info: rstData,
        all_info: memList,
      };
      _conn_socket.in(_MASTER_OPEN_ID).emit("conn:leave", leaveInfos);
    });

    //#????????? ?????? ????????? ????????? ????????????.
    socket.on("conn:mems", function (data, callback) {
      log.debug("..::[conn:mems]");
      log.debug(data);

      callback(GetRoomList(_MASTER_OPEN_ID));
    });

    /****************************************
     *** LECTURE COMMUNICATION INTERFACE
     */

    //#JOIN LECTURE CHANNEL ID
    socket.on("lt:join", function (data) {
      log.info("lecture join connection...::[lt:join]");
      log.info("chnnel id : " + data.chnn_id);
      //{chnn_id : ""}

      socket.join(data.chnn_id);

      let memList = GetRoomList(data.chnn_id);
      let joinInfos = {
        join_info: socket.mem_info,
        all_info: memList,
      };
      //sending to all clients in room(channel) except sender
      socket.broadcast.to(data.chnn_id).emit("lt:join", joinInfos);
    });

    //#???????????? ?????? ????????? ????????? ????????????.
    socket.on("lt:mems", function (data, callback) {
      log.debug("..::[lt:mems]");
      log.debug(data);
      //{chnn_id : ""}

      callback(GetRoomList(data.chnn_id));
    });

    //#LIVE ?????? ??????
    socket.on("lt:stlive", function (data) {
      log.info("[lt:stlive]");
      //{chnn_id : "", stream : "", type : "PF(??????) or ST(??????)"}

      let curObject = {
        mem_id: socket.mem_info.mem_id,
        stream: data.stream,
        type: data.type,
      };

      if (
        Object.prototype.hasOwnProperty.call(
          _lecture_live_data,
          data.chnn_id
        ) == false
      ) {
        _lecture_live_data[data.chnn_id] = [];
      }
      _lecture_live_data[data.chnn_id].push(curObject);

      //sending to all clients in room(channel) except sender
      socket.broadcast.to(data.chnn_id).emit("lt:stlive", curObject);
    });

    //#LIVE ?????? ??????
    socket.on("lt:fnlive", function (data) {
      log.info("[lt:fnlive]");
      //{chnn_id : ""}

      let curMemID = socket.mem_info.mem_id;

      if (
        Object.prototype.hasOwnProperty.call(
          _lecture_live_data,
          data.chnn_id
        ) == true
      ) {
        //sending to all clients in room(channel) except sender
        let curChnnData = _lecture_live_data[data.chnn_id];

        for (let i = curChnnData.length - 1; i >= 0; i--) {
          if (curChnnData[i].mem_id == curMemID)
            _lecture_live_data[data.chnn_id].splice(i, 1);
        }
        socket.broadcast
          .to(data.chnn_id)
          .emit("lt:fnlive", { mem_id: curMemID });
      }
    });

    //#LIVE ?????? ?????? ??????
    socket.on("lt:alllive", function (data, callback) {
      log.debug("..::[lt:alllive]");
      //{chnn_id : ""}
      if (
        Object.prototype.hasOwnProperty.call(
          _lecture_live_data,
          data.chnn_id
        ) == false
      ) {
        callback([]);
      } else {
        //[{mem_id:"", stream : object, type : "PF or ST"}]
        callback(_lecture_live_data[data.chnn_id]);
      }
    });

    //#LEAVE LECTURE CHANNEL ID
    socket.on("lt:leave", function (data) {
      log.info("[lt:leave]");
      //{chnn_id : ""}

      socket.leave(data.chnn_id);

      let memList = GetRoomList(data.chnn_id);
      let leaveInfos = {
        leave_info: socket.mem_info,
        all_info: memList,
      };
      socket.broadcast.to(data.chnn_id).emit("lt:leave", leaveInfos);
    });

    //#FINISH LECTURE
    socket.on("lt:finish", function (data) {
      log.info("[lt:finish]");
      //{chnn_id : ""}

      socket.broadcast.to(data.chnn_id).emit("lt:finish", data);
      delete _lecture_live_data[data.chnn_id];
    });

    //#SEND COMMAND LECTURE
    socket.on("lt:command", function (data) {
      log.info("lt command connection...::[lt:command]");
      log.info("chnnel ID : " + data.chnn_id + ", " + data.type);
      //{chnn_id : "", type : "", param01 : "", param02 : "", param03 : ""}
      //CMD_W001 : ???????????? ?????? (WEB), param01 : mem_id
      //CMD_W002 : ???????????? ?????? (WEB), param01 : mem_id
      //CMD_W003 : ?????? ??????(WEB, WEBGL)
      //CMD_A001 : ?????? ?????? ?????? (ALL - WEB + VR), param01 : tmpl_id
      //CMD_V001 : ????????? ?????? (VR), param01 : mem_id, param02 : resc_id
      //CMD_S001 : ????????? ?????? ????????? ???????????? (VR), param01 : mem_id
      //CMD_N001 : ?????? ????????? ???????????? On (VR), param01 : mem_id
      //CMD_F001 : ?????? ????????? ???????????? Off (VR), param01 : mem_id
      //CMD_R001 : ??? ????????? ???????????? (VR), param01 : mem_id

      if (data.type == "CMD_W001") {
        let targSocket = FindSocketInfo(data.chnn_id, data.param01);

        if (targSocket != null) targSocket.emit("lt:command", data);
      } else if (data.type == "CMD_W002") {
        let targSocket = FindSocketInfo(data.chnn_id, data.param01);

        if (targSocket != null) targSocket.emit("lt:command", data);
      } else if (data.type == "CMD_W003") {
        socket.broadcast.to(data.chnn_id).emit("lt:command", data);
      } else if (data.type == "CMD_A001") {
        //sending to all clients in room(channel) except sender
        socket.broadcast.to(data.chnn_id).emit("lt:command", data);
      } else if (data.type == "CMD_V001") {
        let targSocket = FindSocketInfo(data.chnn_id, data.param01, "VR");

        if (targSocket != null) targSocket.emit("lt:command", data);
      } else if (data.type == "CMD_S001") {
        socket.broadcast.to(data.chnn_id).emit("lt:command", data);
      } else if (data.type == "CMD_N001") {
        let targSocket = FindSocketInfo(data.chnn_id, data.param01, "VR");

        if (targSocket != null) targSocket.emit("lt:command", data);
      } else if (data.type == "CMD_F001") {
        let targSocket = FindSocketInfo(data.chnn_id, data.param01, "VR");

        if (targSocket != null) targSocket.emit("lt:command", data);
      } else if (data.type == "CMD_R001") {
        let targSocket = FindSocketInfo(data.chnn_id, data.param01, "VR");

        if (targSocket != null) targSocket.emit("lt:command", data);
      }
    });
  }
};
_conn_socket.on("connection", function (socket) {
  //#VR ????????? MEMBER ID ?????? ?????? ??????
  if (!socket.handshake.query.mem_id) {
    socket.on("vr:init", function (data) {
      dbconn.GetMemberInfo(data, function (isSuccess, rstData) {
        rstData["device"] = "VR";
        initSocketProc(socket, isSuccess, rstData);
      });
    });
  } else {
    //#?????? ???????????? ????????? ?????? ????????? Socket??? ????????????.
    dbconn.GetMemberInfo(socket.handshake.query, function (isSuccess, rstData) {
      rstData["device"] = "WEB";
      initSocketProc(socket, isSuccess, rstData);
    });
  }
});
