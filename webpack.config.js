const path = require("path");
const fs = require("fs");

function getConfig(env, argv) {
    let config = {
        mode: "development",
        entry: {
            index: "./index.tsx",
        },
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: "[name].js",
            libraryTarget: "assign",
            library: "exports"
        },
        devtool: argv.mode === "production" ? undefined : "inline-source-map",
        resolve: {
            extensions: [".ts", ".tsx", ".js", ".cpp", ".h"],
            alias: {
                fs: path.resolve(path.join(__dirname, "noop")),
                jimp: path.resolve(path.join(__dirname, "noop"))
            }
        },
        module: {
            rules: [
                { test: /\.css$/, loader: "new-style-loader" },
                {
                    // .ts, but NOT .d.ts
                    test: /(([^d])|([^.]d)|(^d))\.tsx?$/, loader: "ts-loader",
                    //test: /tsx?$/, loader: "ts-loader",
                },
                { test: /\.md?$/, loader: "load-as-text" },
                { test: /\.cpp$/, loader: "cpp-portable-loader?emitMapFile" },
                //{ test: /\.(png|svg|jpg|gif)$/, loader: "file-loader" },
                { test: /favicon\.ico\.svg$/, loader: "favicon" }
            ]
        },
        resolveLoader: {
            //modules: ["node_modules", "./loaders"]
        },
        plugins: [
            //new (require('webpack-bundle-analyzer').BundleAnalyzerPlugin)()
        ]
    };

    trySetKeys(`/etc/letsencrypt/live/quentinbrooks.com/privkey.pem`, `/etc/letsencrypt/live/quentinbrooks.com/fullchain.pem`);
    //trySetKeys(`../../disks/quentinbrooks.com/privkey.pem`, `../../disks/quentinbrooks.com/fullchain.pem`);
    //trySetKeys(`../../../disks/quentinbrooks.com/privkey.pem`, `../../../disks/quentinbrooks.com/fullchain.pem`);

    function trySetKeys(keyPath, certPath) {
        config.devServer = config.devServer || {};
        if(require("os").type() === "Linux") {
            config.devServer.public = "quentinbrooks.com";
        } else {
            config.devServer.public = "localhost";
        }
        if(fs.existsSync(keyPath)) {
            config.devServer.port = 443;
            config.devServer.host = "0.0.0.0";
            config.devServer.https = {};
            config.devServer.https.key = keyPath;
            config.devServer.https.cert = certPath;
        }
    }

    return config;
}

module.exports = getConfig;