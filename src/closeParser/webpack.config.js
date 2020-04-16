const path = require("path");
const fs = require("fs");

function getConfig(env, argv) {
    let config = {
        mode: "development",
        entry: {
            extension: "./extension.ts"
        },
        target: "node",
        externals: {
            "vscode": "commonjs vscode"
        },
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: "[name].js",
            libraryTarget: "assign",
            library: "module.exports"
        },
        devtool: argv.mode === "production" ? undefined : "inline-source-map",
        resolve: {
            extensions: [".ts", ".tsx", ".js"],
            alias: {
                fs: path.resolve(path.join(__dirname, "noop")),
                jimp: path.resolve(path.join(__dirname, "noop"))
            }
        },
        module: {
            rules: [
                {
                    // .ts, but NOT .d.ts
                    test: /(([^d])|([^.]d)|(^d))\.tsx?$/, loader: "ts-loader",
                    //test: /tsx?$/, loader: "ts-loader",
                }
            ]
        },
        resolveLoader: {
            modules: ["node_modules", "./loaders"]
        },
        plugins: [
            //new (require('webpack-bundle-analyzer').BundleAnalyzerPlugin)()
        ]
    };
    return config;
}

module.exports = getConfig;