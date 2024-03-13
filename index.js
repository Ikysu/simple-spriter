const fs = require("fs");
const sizeOf = require("image-size");
const { createCanvas, loadImage } = require("canvas");
const path = process.argv[2];
const isPackMode = path.split(".").at(-1) !== "json";
const folderPath = isPackMode
  ? path.at(-1) === "/"
    ? path.slice(0, -1)
    : path
  : path.split(".").slice(0, -1).join(".");

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
      const rect = new Rect(0, 0, sorted[i].frame.w, sorted[i].frame.h);
      const node = start_node.insert_rect(rect).rect;
      if (maxWidth < node.x + node.w) maxWidth = node.x + node.w;
      if (maxHeight < node.y + node.h) maxHeight = node.y + node.h;
      sorted[i].frame.x = node.x;
      sorted[i].frame.y = node.y;
    }

    canvas.width = maxWidth;
    canvas.height = maxHeight;

    const output = {
      frames: {},
      meta: {
        app: "https://spriter.uki.su",
        version: "1.0",
        image: folderPath.split("\\").at(-1) + ".png",
        format: "RGBA8888",
        size: {
          w: maxWidth,
          h: maxHeight,
        },
        scale: "1",
      },
    };

    for (let i = 0; i < sorted.length; i++) {
      console.info("Draw:", sorted[i].name);
      output.frames[sorted[i].name] = {
        frame: sorted[i].frame,
        rotated: false,
        trimmed: false,
        spriteSourceSize: {
          x: 0,
          y: 0,
          w: sorted[i].frame.w,
          h: sorted[i].frame.h,
        },
        sourceSize: {
          w: sorted[i].frame.w,
          h: sorted[i].frame.h,
        },
      };
      ctx.drawImage(
        sorted[i].file,
        0,
        0,
        sorted[i].frame.w,
        sorted[i].frame.h,
        sorted[i].frame.x,
        sorted[i].frame.y,
        sorted[i].frame.w,
        sorted[i].frame.h
      );
    }

    fs.writeFileSync(folderPath + "-new.json", JSON.stringify(output, null, 2));

    const file = fs.createWriteStream(folderPath + "-new.png");
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
