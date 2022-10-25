const { createServer } = require("http");
const { Server } = require("socket.io");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const app = express();

// if we don't run this we get a CORS error
const localUrl = "http://localhost:3000";
const deployedUrl = "https://browser-party.herokuapp.com";

// LOCAL
app.use(
    cors({
        origin: localUrl,
    })
);

// DEPLOYED
// app.use(cors({
// origin:deployedUrl
// }))

const PORT = process.env.PORT || 4000;
const URL = process.env.URL || "http://localhost:3000";

console.log(PORT);

// for now, take this as boilerplate
const theServer = createServer();
const io = new Server(theServer, {
    cors: {
        // Check local vs deployed
        origin: localUrl,
        credentials: true,
    },
});

let rooms = {};
const preRoundLength = 8; // in seconds (how long we show scoreboard/instructions between rounds)

const generateTrivia = async (category, socket, roomName, time) => {
    console.log("trivia");
    if (category === "geography") {
        categoryCode = 22;
    } else if ((category = "general")) {
        categoryCode = 9;
    }
    let response = await axios({
        method: "get",
        url: `https://opentdb.com/api.php?amount=1&category=${categoryCode}&difficulty=medium&type=multiple`,
    });
    const results = response.data.results[0];
    const triviaObj = {
        question: results.question,
        correct_answer: results.correct_answer,
        incorrect_answers: results.incorrect_answers,
        category: results.category,
        difficulty: results.difficulty,
    };
    io.emit(`start-trivia-${roomName}`, triviaObj, time);
};

const joinRoom = (socket, room) => {
    room.sockets.push(socket);
    socket.join(room.name);
    // store the room id in the socket for future use
    socket.roomId = room.name;
    console.log(socket.id, "Joined", room.name);
};

const leaveRooms = (socket) => {
    const roomsToDelete = [];
    for (const key in rooms) {
        const room = rooms[key];
        if (room.sockets.includes(socket)) {
            socket.leave(key);
            // remove the socket from the room object
            room.sockets = room.sockets.filter((item) => item !== socket);
        }
        // Prepare to delete any rooms that are now empty
        if (room.sockets.length == 0) {
            roomsToDelete.push(room.name);
            endGame(socket, room.name);
        } else {
            updatePlayers(socket, room);
        }
    }
    // Delete all the empty rooms that we found earlier
    roomsToDelete.forEach((element) => {
        delete rooms[element];
    });
};

const updatePlayers = (socket, room) => {
    const players = [];
    room.sockets.forEach((element) => {
        const player = {
            id: element.id,
            roomName: element.roomId,
            username: element.username,
            score: element.score,
        };
        players.push(player);
    });
    io.emit(`update-players-${room.name}`, players);
};

const setRound = (socket, roomName, round) => {
    console.log(`set round in room ${roomName} to ${round}`);
    io.in(roomName).emit(`set-round-${roomName}`, round);
};

const showScoreboard = (socket, room) => {
    io.emit(`scoreboard-${room}`, true);
    setTimeout(() => {
        io.emit(`scoreboard-${room}`, false);
    }, preRoundLength * 1000);
};

const showCountdown = (socket, room) => {
    io.emit(`countdown-${room}`, true);
    setTimeout(() => {
        io.emit(`countdown-${room}`, false);
    }, 5000);
};

const wait = (timeToDelay) =>
    new Promise((resolve) => setTimeout(resolve, timeToDelay));

const runGame = async (
    socket,
    room,
    includeTrivia,
    includeWhack,
    includeMemory,
    includeSnake
) => {
    if (includeTrivia) {
        await runRound(socket, room, "trivia1", 20);
    }
    if (includeWhack) {
        await runRound(socket, room, "whack", 30);
    }
    if (includeMemory) {
        await runRound(socket, room, "memory", 30);
    }
    if (includeSnake) {
        await runRound(socket, room, "whack", 30);
    }
    if (includeTrivia) {
        await runRound(socket, room, "trivia2", 20);
    }
    endGame(socket, room.name);
};

const runRound = async (socket, room, round, time) => {
    setRound(socket, room.name, round);
    showScoreboard(socket, room.name);
    await wait(preRoundLength * 1000);
    showCountdown(socket, room.name);
    await wait(5000);
    if (round === "trivia1") {
        generateTrivia("geography", socket, room.name, time * 1000);
    } else if (round === "trivia2") {
        generateTrivia("general", socket, room.name, time * 1000);
    } else {
        io.emit(`start-${round}-${room.name}`, time * 1000);
    }
    await wait((time + 3) * 1000);
    updatePlayers(socket, room);
};

const endGame = (socket, roomName) => {
    io.in(roomName).emit(`end-game`);
};

io.on("connection", (socket) => {
    // when a user connects
    console.log(
        "You are now connected. This socket ID is unique everytime: " +
            socket.id
    );

    socket.on("join-room", (roomName, username, callback) => {
        if (rooms[roomName]) {
            callback({
                status: "ok",
            });
            socket.username = username;
            socket.score = 0;
            console.log(`attempting to join room ${roomName}`);
            const room = rooms[roomName];
            joinRoom(socket, room);
            updatePlayers(socket, room);
        } else {
            callback({
                status: "bad",
            });
            return;
        }
    });

    socket.on("create-room", (roomName, username, callback) => {
        if (rooms[roomName]) {
            callback({
                status: "bad",
            });
            return;
        } else {
            console.log("room good");
            callback({
                status: "ok",
            });
            socket.username = username;
            socket.isHost = roomName;
            socket.score = 0;
            const room = {
                // id: uuidv4(), // generate a unique id for the new room, that way we don't need to deal with duplicates.
                name: roomName,
                sockets: [],
                messages: [
                    {
                        username: "BrowserParty",
                        content:
                            "Use this space to say hi to your opponents! Or talk trash and throw them off their game...",
                        id: 0,
                    },
                ],
            };
            rooms[roomName] = room;
            // have the socket join the room they've just created.
            joinRoom(socket, room);
            console.log(room);
            updatePlayers(socket, room);
        }
    });

    socket.on("leave-room", (roomName, username) => {
        const room = rooms[roomName];
        leaveRooms(socket, room);
        console.log(`${username} left room ${room}`);
    });

    socket.on("disconnect", () => {
        leaveRooms(socket);
    });

    socket.on(
        "start-game",
        (
            roomName,
            includeTrivia,
            includeWhack,
            includeMemory,
            includeSnake
        ) => {
            const room = rooms[roomName];
            runGame(
                socket,
                room,
                includeTrivia,
                includeWhack,
                includeMemory,
                includeSnake
            );
        }
    );

    socket.on("send-score", (roundScore) => {
        socket.score = socket.score + roundScore;
    });

    socket.on("send-new-message", (data, roomName, count) => {
        // we tell the client to execute 'new message'
        const room = rooms[roomName];
        console.log(room.messages);
        const messageObj = {
            username: socket.username,
            content: data,
            id: count,
        };
        if (room.messages[room.messages.length - 1] != messageObj) {
            room.messages.push(messageObj);
            console.log(room.messages);
            io.in(roomName).emit("add-new-message", room.messages);
        }
    });
});

theServer.listen(PORT, function () {
    console.log(`listening on port number ${PORT}`);
});
