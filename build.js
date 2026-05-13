/* oxlint-disable no-console */
/* oxlint-disable @typescript-oxlint/no-var-requires */
/* oxlint-disable no-undef */
const { exec } = require("child_process");
const { readdirSync, existsSync, rmSync, copyFileSync, mkdirSync } = require("fs");
const path = require("path");

const getDirectories = (source) =>
  readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout ? stdout : stderr);
      }
    });
  });
}

function removeDir(dir) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function copyFile(src, dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

async function build() {
  // Clean previous build
  console.log("Clean previous build…");
  removeDir("./build/server");
  removeDir("./build/plugins");

  const d = getDirectories("./plugins");

  // Compile server and shared
  console.log("Compiling…");
  await Promise.all([
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/server ./server"
    ),
    execAsync(
      "yarn babel --extensions .ts,.tsx --quiet -d ./build/shared ./shared"
    ),
  ]);

  for (const plugin of d) {
    const hasServer = existsSync(`./plugins/${plugin}/server`);

    if (hasServer) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/server" "./plugins/${plugin}/server"`
      );
    }

    const hasShared = existsSync(`./plugins/${plugin}/shared`);

    if (hasShared) {
      await execAsync(
        `yarn babel --extensions .ts,.tsx --quiet -d "./build/plugins/${plugin}/shared" "./plugins/${plugin}/shared"`
      );
    }
  }

  // Copy static files
  console.log("Copying static files…");
  copyFile("./server/collaboration/Procfile", "./build/server/collaboration/Procfile");
  copyFile("./server/static/error.dev.html", "./build/server/error.dev.html");
  copyFile("./server/static/error.prod.html", "./build/server/error.prod.html");
  copyFile("./package.json", "./build/package.json");

  for (const plugin of d) {
    const src = `./plugins/${plugin}/plugin.json`;
    if (existsSync(src)) {
      copyFile(src, `./build/plugins/${plugin}/plugin.json`);
    }
  }

  console.log("Done!");
}

void build();
