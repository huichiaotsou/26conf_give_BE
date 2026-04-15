const express = require("express");
require("dotenv").config();
const session = require("express-session");
const flash = require("connect-flash");
const app = express();
const givingController = require("./controllers/giving");
const cors = require("cors");
const { PORT, SESSION_SECRET, ALLOWED_ORIGIN } = process.env;

app.set("view engine", "ejs");

app.use(
  session({
    secret: SESSION_SECRET || "keyboard cat",
    resave: false,
    saveUninitialized: true,
  })
);

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true, // session/cookie
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(flash());

// NGINX 處理 /api/ 這段，所以實際上的 end point 是 /api/payment
app.post("/payment", givingController.giving);
app.post("/getall", givingController.get);
app.get("/stats", givingController.statsPage);
app.post("/stats/login", givingController.statsLogin);
app.post("/stats/logout", givingController.statsLogout);
app.post("/upload-siyuan", givingController.uploadSiyuan);

app.listen(PORT, () => {
  console.log("server listening on port: ", PORT);
});

module.exports = app;
