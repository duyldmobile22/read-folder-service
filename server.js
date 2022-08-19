var express = require("express");
var app = express();
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const _ = require("lodash");
const srt2vtt = require("./srt2vtt");
const { SubtitleParser, SubtitleStream } = require("matroska-subtitles");
const { stringifySync } = require("subtitle");
var strstream = require("string-to-stream");

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://192.168.47.4:3000",
    "http://172.16.0.104:3000",
  ],
  optionsSuccessStatus: 200,
};
const folderPuclic = [
  // {
  //   name: "E",
  //   path: "E:"
  // },
  // {
  //   name: "F",
  //   path: "F:"
  // },
  {
    name: "Download",
    path: "/Users/macbookpro/Downloads",
  },
];

let fileTypes = [".mp4", ".mkv", ".webm"];

app.use(cors(corsOptions));
folderPuclic.forEach((f) => {
  app.use(`/public/${f.name}`, express.static(path.join(f.path, "/")));
});
app.get("/public/*", function (req, res) {
  const fullPath = req.params[0].split("/").filter((p) => !!p);

  let root = _.first(fullPath) || "";
  const list = [];
  if (!root) {
    folderPuclic.forEach((f) => {
      list.push({ type: "folder", name: f.name });
    });
    res.send(list);
    return;
  }

  const pathRoot = folderPuclic.find((f) => f.name === root).path;
  const path = [pathRoot, ..._.drop(fullPath)].join("/");

  try {
    const folderNames = fs.readdirSync(path + "/");
    folderNames.forEach((name) => {
      const itemStat = fs.statSync([path, name].join("/"));
      if (itemStat.isDirectory()) {
        list.push({ type: "folder", name });
      } else if (fileTypes.find((type) => name.includes(type))) {
        list.push({ type: "file", name });
      }
    });
    res.send(list);
    return;
  } catch (error) {}
  res.send("listName");
});

const getSubtitlesOutside = (fullPath) => {
  let root = _.first(fullPath) || "";
  const pathRoot = folderPuclic.find((f) => f.name === root).path;

  const folder = [pathRoot, ..._.drop(_.dropRight(fullPath))].join("/");
  let file = _.last(fullPath);
  let namesrc = file;
  let namevtt = file;
  fileTypes.forEach((fileType) => {
    namesrc = namesrc.replace(fileType, ".srt");
    namevtt = namevtt.replace(fileType, ".vtt");
  });
  const files = fs.readdirSync(folder);
  let path;
  files.forEach((f) => {
    if ([namesrc, namevtt].includes(f) && !path) {
      path = [folder, f.trim()].filter((p) => !!p).join("/");
    }
  });
  return path;
};

app.get("/trasks/*", function (req, res) {
  try {
    const fullPath = req.params[0].split("/").filter((p) => !!p);
    let root = _.first(fullPath) || "";
    const pathRoot = folderPuclic.find((f) => f.name === root).path;
    const parser = new SubtitleStream();
    let isTracks = false;
    let fulltracks = [];

    const path = getSubtitlesOutside(fullPath);
    if (path)
      fulltracks.push({ language: "default", type: "utf8", default: true });
    parser.once("tracks", (tracks) => {
      isTracks = true;
      if(_.isEmpty(fulltracks) && !_.isEmpty(tracks)) tracks[0].default = true
      fulltracks.push(...tracks);
      res.send(fulltracks.filter((t) => !!t.language));
    });
    parser.once("drain", (drain) => {
      if (!isTracks) {
        res.send(fulltracks);
      }
    });
    parser.once("error", (error) => {
      res.send(fulltracks);
    });
    fs.createReadStream([pathRoot, ..._.drop(fullPath)].join("/")).pipe(parser);
  } catch (error) {
    console.log(" error", error);
    res.send(fulltracks);
  }
});

app.get("/subtitles/*", function (req, res) {
  const fullPath = req.params[0].split("/").filter((p) => !!p);
  const language = req.query.language;
  let root = _.first(fullPath) || "";
  const pathRoot = folderPuclic.find((f) => f.name === root).path;
  const parser = new SubtitleParser();
  const list = [];
  let str = "";
  if (language == "default") {
    const path = getSubtitlesOutside(fullPath);
    fs.createReadStream(path).pipe(srt2vtt()).pipe(res);
    return;
  }
  parser.once("tracks", (tracks) => {
    const number = tracks.find((t) => t.language == language).number;
    parser.on("subtitle", (subtitle, trackNumber) => {
      if (trackNumber == number) {
        list.push({
          type: "cue",
          data: {
            start: subtitle.time,
            end: subtitle.time + subtitle.duration,
            text: subtitle.text,
          },
        });
      }
    });
  });
  parser.on("finish", () => {
    str = stringifySync(list, { format: "SRT" });
    strstream(str).pipe(srt2vtt()).pipe(res);
  });
  fs.createReadStream([pathRoot, ..._.drop(fullPath)].join("/")).pipe(parser);
});

var server = app.listen(8081, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log(
    "Ung dung Node.js dang lang nghe tai dia chi: http://%s:%s",
    host,
    port
  );
});
