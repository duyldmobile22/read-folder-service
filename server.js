var express = require("express");
var app = express();
const fs = require("fs");
const fsExtra = require("fs-extra");
const cors = require("cors");
const path = require("path");
const _ = require("lodash");
const srt2vtt = require("./srt2vtt");
const { SubtitleParser, SubtitleStream } = require("matroska-subtitles");
const { stringifySync } = require("subtitle");
var strstream = require("string-to-stream");

const corsOptions = {
  origin: ["http://localhost:3000", "http://192.168.47.3:3000", "http://172.16.0.104:3000"],
  optionsSuccessStatus: 200
};
const folderPuclic = [
  {
    name: "E",
    path: "E:"
  },
  {
    name: "F",
    path: "F:"
  },
  {
    name: "Download",
    path: "C:/Users/Duy/Downloads"
    // path: "/Users/macbookpro/Downloads",
  }
];

let fileTypes = [".mp4", ".mkv", ".webm"];
let subCode = ["vie", "vn", "vietnam", "viet_nam", "und"];

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
    const paths = [];
    folderNames.forEach((name) => {
      let itemStat;
      try {
        itemStat = fs.statSync([path, name].join("/"));
      } catch (error) {}

      if (itemStat && itemStat.isDirectory()) {
        list.push({ type: "folder", name });
      } else if (fileTypes.find((type) => name.includes(type))) {
        list.push({ type: "file", name });
        paths.push(req.params[0] + name);
      }
    });
    convertSubtitle(paths).then();
    res.send(list);
    return;
  } catch (error) {}
  res.send("listName");
});

app.get("/trasks/*", function (req, res) {
  try {
    let pathFile = req.params[0];
    const fullPath = pathFile.split("/").filter((p) => !!p);

    let root = _.first(fullPath) || "";
    const pathRoot = folderPuclic.find((f) => f.name === root).path;
    const stream = new SubtitleStream();
    let isTracks = false;
    let fulltracks = [];

    const pathSub = getSubtitlesOutside(fullPath);
    if (pathSub) fulltracks.push({ language: "default_sv", lable: "default", type: "utf8", default: true });
    // console.log(stream);

    stream.once("tracks", (tracks) => {
      console.log(tracks);
      isTracks = true;
      for (let index = 0; index < tracks.length; index++) {
        const { language, lable } = tracks[index];
        if (!fulltracks.find((t) => t.language == language))
          fulltracks.push({
            language: language ? language + "_sv" : language,
            lable: lable || language,
            type: "utf8",
            default: index == 0 && _.isEmpty(fulltracks),
            number: tracks[index].number
          });
      }
      convertSubtitle([pathFile], fulltracks);
      setTimeout(() => {
        res.send(fulltracks.filter((t) => !!t.language));
      }, 2000);
    });
    stream.once("drain", (drain) => {
      if (!isTracks) {
        res.send(fulltracks);
      }
    });
    stream.once("error", (error) => {
      res.send(fulltracks);
    });
    fs.createReadStream([pathRoot, ..._.drop(fullPath)].join("/")).pipe(stream);
  } catch (error) {
    console.log(" error", error);
    res.send(fulltracks);
  }
});

app.get("/subtitles/*", function (req, res) {
  const fullPath = req.params[0].split("/").filter((p) => !!p);
  let pathFile = req.params[0];
  fileTypes.forEach((fileType) => {
    pathFile = pathFile.replace(fileType, ".json");
  });
  const language = req.query.language;
  let root = _.first(fullPath) || "";

  let str = "";
  if (language === "default_sv") {
    const path = getSubtitlesOutside(fullPath);
    if (path) fs.createReadStream(path).pipe(srt2vtt()).pipe(res);
    else strstream("").pipe(res);
    return;
  }
  try {
    const data = fs.readFileSync(`subtitles/${pathFile}`, "utf8");
    if (data) {
      const info = JSON.parse(data || "{}");
      str = stringifySync(info[language] || [], { format: "SRT" });
      strstream(str).pipe(srt2vtt()).pipe(res);
      return;
    }
  } catch (error) {}
  strstream("").pipe(srt2vtt()).pipe(res);
});

var server = app.listen(8081, function () {
  var host = server.address().address;
  var port = server.address().port;

  console.log("Ung dung Node.js dang lang nghe tai dia chi: http://%s:%s", host, port);
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

let pathToConverts = [];
let converting = false;
const convertSubtitle = async (paths, tracks, continue_) => {
  
  paths && paths.forEach((path) => {
    pathToConverts.push({ path, tracks });
  });

  if (!converting || continue_) {
    await convert(pathToConverts[0].path, pathToConverts[0].tracks);
    pathToConverts = _.drop(pathToConverts);
    if (_.isEmpty(pathToConverts)) {
      converting = false;
    } else {
      convertSubtitle(null, null, true);
    }
  }
};

const convert = (path, fulltracks) => {
  return new Promise((resolve, reject) => {
    let pathFile = _.clone(path);
    fileTypes.forEach((fileType) => {
      pathFile = pathFile.replace(fileType, ".json");
    });
    try {
      fs.readFileSync(`subtitles/${pathFile}`, "utf8");
      resolve("");
      return;
    } catch (error) {}

    console.log(path, fulltracks);
    const fullPath = path.split("/").filter((p) => !!p);
    let root = _.first(fullPath) || "";
    const pathRoot = folderPuclic.find((f) => f.name === root).path;

    let newTracks = _.cloneDeep(fulltracks);
    if (!newTracks) {
      try {
        newTracks = [];
        const stream = new SubtitleStream();
        let isTracks = false;
        stream.once("tracks", (tracks) => {
          isTracks = true;
          for (let index = 0; index < tracks.length; index++) {
            const { language, lable } = tracks[index];
            if (!newTracks.find((t) => t.language == language))
              newTracks.push({
                language: language ? language + "_sv" : language,
                lable: lable || language,
                type: "utf8",
                default: index == 0,
                number: tracks[index].number
              });
          }
          parter(newTracks, path, pathFile, pathRoot, fullPath, resolve, reject);
        });
        stream.once("drain", (drain) => {
          if (!isTracks) {
            resolve("");
          }
        });
        fs.createReadStream([pathRoot, ..._.drop(fullPath)].join("/")).pipe(stream);
      } catch (error) {
        resolve("");
        return;
      }
    } else {
      parter(newTracks, path, pathFile, pathRoot, fullPath, resolve, reject);
    }
  });
};
const parter = (newTracks, path, pathFile, pathRoot, fullPath, resolve, reject) => {
  const parser = new SubtitleParser();
  const subtitleObj = {};
  let index = 1;
  parser.on("subtitle", (subtitle, trackNumber) => {
    if (index % 100 === 0) {
      console.log(pathFile, ": ", index);
    }
    index++;
    const { language } = newTracks.find((track) => track.number == trackNumber) || {};
    if (language) {
      const rowRob = {
        type: "cue",
        data: { start: subtitle.time, end: subtitle.time + subtitle.duration, text: subtitle.text }
      };
      if (subtitleObj[language]) {
        subtitleObj[language].push(rowRob);
      } else {
        subtitleObj[language] = [rowRob];
      }
    }
  });
  parser.on("finish", () => {
    fsExtra.outputFile(`subtitles/${pathFile}`, JSON.stringify(subtitleObj));
    console.log(path, ": finish");
    resolve("finish");
  });
  fs.createReadStream([pathRoot, ..._.drop(fullPath)].join("/")).pipe(parser);
};
