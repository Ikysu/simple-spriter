const fs = require("fs");
const sizeOf = require("image-size");
const { createCanvas, loadImage } = require("canvas");
const path = process.argv[2];
const isPackMode = !path.endsWith(".json");
const folderPath = isPackMode
  ? path.at(-1) === "/"
    ? path.slice(0, -1)
    : path
  : path.slice(0, -5);

let json;

const canvas = createCanvas(0, 0);
const ctx = canvas.getContext("2d");

function Rect(x, y, w, h) {
  this.x = x;
  this.y = y;
  this.w = w;
  this.h = h;
}

Rect.prototype.fits_in = function (outer) {
  return outer.w >= this.w && outer.h >= this.h;
};

Rect.prototype.same_size_as = function (other) {
  return this.w == other.w && this.h == other.h;
};

function Node() {
  this.left = null;
  this.right = null;
  this.rect = null;
  this.filled = false;
}

Node.prototype.insert_rect = function (rect) {
  if (this.left != null)
    return this.left.insert_rect(rect) || this.right.insert_rect(rect);

  if (this.filled) return null;

  if (!rect.fits_in(this.rect)) return null;

  if (rect.same_size_as(this.rect)) {
    this.filled = true;
    return this;
  }

  this.left = new Node();
  this.right = new Node();

  var width_diff = this.rect.w - rect.w;
  var height_diff = this.rect.h - rect.h;

  var me = this.rect;

  if (width_diff > height_diff) {
    // split literally into left and right, putting the rect on the left.
    this.left.rect = new Rect(me.x, me.y, rect.w, me.h);
    this.right.rect = new Rect(me.x + rect.w, me.y, me.w - rect.w, me.h);
  } else {
    // split into top and bottom, putting rect on top.
    this.left.rect = new Rect(me.x, me.y, me.w, rect.h);
    this.right.rect = new Rect(me.x, me.y + rect.h, me.w, me.h - rect.h);
  }

  return this.left.insert_rect(rect);
};

(async () => {
  if (isPackMode) {
    const files = await Promise.all(
      fs.readdirSync(folderPath).map(async (filename) => {
        const path = folderPath + "\\" + filename;
        const { width, height } = sizeOf(path);
        return {
          file: await loadImage(path),
          frame: {
            w: width,
            h: height,
          },
          name: filename,
        };
      })
    );

    const sorted = files.sort((a, b) => a.frame.h - b.frame.h).reverse();

    const cW = files.reduce((a, b) => a + b.frame.w, 0) / 4,
      cH = files.reduce((a, b) => a + b.frame.h, 0);

    const start_node = new Node();
    start_node.rect = new Rect(0, 0, cW, cH);

    let maxWidth = 0;
    let maxHeight = 0;

    for (let i = 0; i < sorted.length; i++) {
      const rect = new Rect(0, 0, sorted[i].frame.w + 1, sorted[i].frame.h);
      const node = start_node.insert_rect(rect).rect;
      sorted[i].frame.x = node.x + 1;
      sorted[i].frame.y = node.y;
      if (maxWidth < sorted[i].frame.x + sorted[i].frame.w)
        maxWidth = sorted[i].frame.x + sorted[i].frame.w;
      if (maxHeight < sorted[i].frame.y + sorted[i].frame.h)
        maxHeight = sorted[i].frame.y + sorted[i].frame.h;
    }

    maxWidth += 1;

    canvas.width = maxWidth;
    canvas.height = maxHeight;

    const fileName = folderPath.split("\\").at(-1);
    const newForlder = `${folderPath}-new`;

    const output = {
      frames: {},
      meta: {
        app: "https://spriter.uki.su",
        version: "1.0",
        image: fileName + ".png",
        format: "RGBA8888",
        size: {
          w: maxWidth,
          h: maxHeight,
        },
        scale: "1",
      },
    };

    for (let i = 0; i < sorted.length; i++) {
      const { name, frame, file } = sorted[i];
      const { w, h, x, y } = frame;
      console.info("Draw:", name);
      const frameInJson = {
        x,
        y,
        w,
        h: h - 1,
      };
      output.frames[name] = {
        frame: frameInJson,
        rotated: false,
        trimmed: false,
        spriteSourceSize: {
          x: 0,
          y: 0,
          w: frameInJson.w,
          h: frameInJson.h,
        },
        sourceSize: {
          w: frameInJson.w,
          h: frameInJson.h,
        },
      };
      ctx.drawImage(file, 0, 0, w, h, x, y, w, h);
    }

    if (!fs.existsSync(newForlder)) fs.mkdirSync(newForlder);

    fs.writeFileSync(
      `${folderPath}-new\\${fileName}.json`,
      JSON.stringify(output, null, 2)
    );

    const file = fs.createWriteStream(`${folderPath}-new\\${fileName}.png`);
    const stream = canvas.createPNGStream();
    stream.pipe(file);
    file.on("finish", () => {
      console.info("Finish!");
    });
  } else {
    json = JSON.parse(fs.readFileSync(path));
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath);

    const png = await loadImage(folderPath + ".png");

    const frames = Object.keys(json.frames);

    function loop(id) {
      if (!frames[id]) {
        console.info("Finish!");
        return;
      }
      const { frame } = json.frames[frames[id]];

      canvas.width = frame.w;
      canvas.height = frame.h;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.drawImage(
        png,
        frame.x,
        frame.y,
        frame.w,
        frame.h,
        0,
        0,
        frame.w,
        frame.h
      );

      const file = fs.createWriteStream(folderPath + "\\" + frames[id]);
      const stream = canvas.createPNGStream();
      stream.pipe(file);
      file.on("finish", () => {
        console.info("Export:", frames[id]);
        loop(id + 1);
      });
    }
    loop(0);
  }
})();
