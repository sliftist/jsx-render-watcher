const path = require("path");
const fs = require("fs");


function getConfig(env, argv) {
    let config = {
        mode: "development",
        entry: {
            index: "./index.tsx",
            debugUtils: "./src/debugUtils/debugUtils.tsx",
            test: "./src/test.tsx",
            profileBundle: "./src/profileBundle.ts"
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
            modules: ["node_modules", "./loaders"]
        },
        plugins: [
            //new (require('webpack-bundle-analyzer').BundleAnalyzerPlugin)()
        ],
        optimization: {
            minimize: false
        }
    };
    return config;
}

module.exports = getConfig;