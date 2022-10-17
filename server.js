const express = require("express");
const app = express();
const fs = require("fs");
const fsExtra = require("fs-extra");
const cors = require("cors");
const path = require("path");
const _ = require("lodash");
const srt2vtt = require("./srt2vtt");
const { SubtitleParser, SubtitleStream } = require("matroska-subtitles");
const { stringifySync } = require("subtitle");
const strstream = require("string-to-stream");

const corsOptions = {
  origin: ["http://localhost:3000", "http://192.168.47.3:3000", "http://172.16.0.104:3000", "http://172.16.0.132:3000"],
  optionsSuccessStatus: 200
};
const folderPuclic = [
  // {
  //   name: "Disk_E",
  //   path: "E:"
  // },
  // {
  //   name: "Disk_F",
  //   path: "F:"
  // },
  {
    name: "Download",
    // path: "C:/Users/Duy/Downloads"
    path: "/Users/macbookpro/Downloads"
  }
];

let fileTypes = [".mp4", ".mkv", ".webm"];
let subCode = ["vie", "vn", "vietnam", "viet_nam", "und"];
let pathToConverts = [];
let converting = false;

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
        paths.push([...fullPath, name].join("/"));
      }
    });
    cleanSubs(folderNames, fullPath);
    convertSubtitle(paths);
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
    stream.once("tracks", (tracks) => {
      isTracks = true;
      for (let index = 0; index < tracks.length; index++) {
        const { language, name } = tracks[index];
        if (!fulltracks.find((t) => t.language == language + "_sv"))
          fulltracks.push({
            language: language ? language + "_sv" : language,
            lable: name || language,
            type: "utf8",
            default: index == 0 && _.isEmpty(fulltracks),
            number: tracks[index].number
          });
      }
      try {
        let fileSubtile = _.clone(pathFile).replace(new RegExp(fileTypes.join("|"), "g"), ".json");
        fs.readFileSync(`subtitles/${fileSubtile}`, "utf8");
        res.send(fulltracks.filter((t) => !!t.language));
      } catch (error) {
        convertSubtitle([pathFile], fulltracks);
        res.send({ waiting: true });
      }
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
  let pathFile = req.params[0].replace(new RegExp(fileTypes.join("|"), "g"), ".json");
  const language = req.query.language;
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

const server = app.listen(8081, function () {
  const host = server.address().address;
  const port = server.address().port;
  console.log("Ung dung Node.js dang lang nghe tai dia chi: http://%s:%s", host, port);
});

const getSubtitlesOutside = (fullPath) => {
  const root = _.first(fullPath) || "";
  const pathRoot = folderPuclic.find((f) => f.name === root).path;
  const folder = [pathRoot, ..._.drop(_.dropRight(fullPath))].join("/");
  const file = _.last(fullPath);
  const namesrc = file.replace(new RegExp(fileTypes.join("|"), "g"), ".srt");
  const namevtt = file.replace(new RegExp(fileTypes.join("|"), "g"), ".vtt");
  const files = fs.readdirSync(folder);
  let path;
  files.forEach((f) => {
    if ([namesrc, namevtt].includes(f) && !path) {
      path = [folder, f.trim()].filter((p) => !!p).join("/");
    }
  });
  return path;
};

const cleanSubs = async (fileNames, fullPath) => {
  try {
    const subs = fs.readdirSync(`subtitles/${fullPath.join("/")}`);
    subs.forEach((sub) => {
      const checkNoFile = !fileNames.find((file) => file.replace(new RegExp(fileTypes.join("|"), "g"), "") === sub.replace(".json", ""));
      try {
        if (checkNoFile) fsExtra.removeSync(`subtitles/${[...fullPath, sub].join("/")}`);
      } catch (error) {}
    });
  } catch (error) {}
};

const convertSubtitle = async (paths, tracks, continue_) => {
  if (paths) {
    paths.forEach((path) => {
      pathToConverts.push({ path, tracks });
    });
  }
  if ((!converting || continue_) && !_.isEmpty(pathToConverts)) {
    converting = true;
    const { path, tracks } = pathToConverts[0];
    await convert(path, tracks);
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
    let pathFile = _.clone(path).replace(new RegExp(fileTypes.join("|"), "g"), ".json");
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
            if (!newTracks.find((t) => t.language == language + "_sv"))
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
            fsExtra.outputFile(`subtitles/${pathFile}`, JSON.stringify({}));
            resolve("");
          }
        });
        fs.createReadStream([pathRoot, ..._.drop(fullPath)].join("/")).pipe(stream);
      } catch (error) {
        fsExtra.outputFile(`subtitles/${pathFile}`, JSON.stringify({}));
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
    if (language && subtitle.duration < 10000) {
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
