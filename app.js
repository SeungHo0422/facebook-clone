const express = require("express");
const morgan = require("morgan");
const mongoose = require("mongoose");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const socket = require("socket.io");
const dotenv = require("dotenv");
const flash = require("connect-flash");
const Post = require("./models/Post");
const User = require("./models/User");
const winston = require('./config/winston');
const helmet = require('helmet');
const hpp = require('hpp');

/* Port Setting */
const port = process.env.PORT || 3000;

/* 온라인 user 정보 데이터 */
const onlineChatUsers = {};

dotenv.config();

const postRoutes = require("./routes/posts");
const userRoutes = require("./routes/users");
const app = express();

app.set("view engine", "ejs");

/* Middleware */
if (process.env.NODE_ENV === 'production') {
    // app.enable('trust proxy');
    app.use(morgan('combined'));
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(hpp());
} else {
    app.use(morgan('dev'));
}
app.use(cookieParser(process.env.SECRET))
const sessOptions = {
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false,
    },
};
if (process.env.NODE_ENV === 'production') {
    // sessOptions.proxy = true; //for proxy option
    // sessOptions.cookie.secure = true; //for https option
}
app.use(session(sessOptions));
app.use(flash());
/* connect-flash는 내부적으로 cookie-parser,express-session을 사용하므로
둘 뒤에 작성해야한다. */

/* passport setup */
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

/* Middleware */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* MongoDB Connection */
mongoose
    .connect("mongodb://127.0.0.1:27017/facebook_clone", {
        useNewUrlParser: true, //false <= deprecated
        // useCreateIndex: true, //false <= deprecated
        useUnifiedTopology: true, // Enables the new unified topology layer
    })
        .then(() => {
            console.log("Connected to MongoDB");
        })
        .catch((err) => {
            winston.error(err);
        });

/* Template 파일에 변수 전송 */
app.use((req, res, next) => {
    res.locals.user = req.user;
    res.locals.login = req.isAuthenticated();
    res.locals.error = req.flash("error");
    res.locals.success = req.flash("success");
    next();
});

/* Routers */
app.use('/', userRoutes);
app.use('/', postRoutes);

/* Connecting Server-Port */
const server = app.listen(port, () => {
    winston.info(`App is running on port ${port}`);
});

/* WebSocket setup */
const io = socket(server); //express 서버와 연결

const room = io.of('/chat');
room.on("connection", socket => {
    console.log("new user : ", socket.id);

    room.emit("newUser", { socketID: socket.id });

    // 새로운 사용자가 등장했을 때
    socket.on("newUser", data => {
        if (!(data.name in onlineChatUsers)) {
            onlineChatUsers[data.name] = data.socketID;
            socket.name = data.name;
            room.emit("updateUserList", Object.keys(onlineChatUsers));
            winston.info("Online users: " + Object.keys(onlineChatUsers));
        }
    });

    // 사용자가 나갔을 때
    socket.on("disconnect", () => {
        delete onlineChatUsers[socket.name];
        room.emit("updateUserList", Object.keys(onlineChatUsers));
        winston.info(`user ${socket.name} disconnected`);
    });

    // 사용자들이 메세지를 보냈을 때
    socket.on("chat", data => {
        winston.info(data);
        if (data.to === "Global Chat") {
            room.emit("chat", data);
        } else if (data.to) {
            room.to(onlineChatUsers[data.name]).emit("chat", data);
            room.to(onlineChatUsers[data.to]).emit("chat", data);
        }
    });
});
