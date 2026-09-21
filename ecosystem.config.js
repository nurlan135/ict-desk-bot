module.exports = {
  apps: [{
    name: "ict-desk",
    script: "node_modules/tsx/dist/cli.mjs",
    args: "src/bot.ts",
    cwd: "C:\\Users\\HP\\Projects\\New folder",
    instances: 1,
    autorestart: true,
  }]
};
