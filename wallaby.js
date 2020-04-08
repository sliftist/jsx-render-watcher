var fs = require("fs");
var child_process = require("child_process");

module.exports = function (wallaby) {
    return {
        files: [
            //{ pattern: "**/*.d.ts", ignore: true, instrument: false },
            // Ugh... okay, so... wallaby overrides the require function to teleport into the original
            //  node_modules folder (I believe, at least it doesn't copy node_modules over, so that
            //  is probably what is does). BUT... if we copy our all package.json files it...
            "package.json",
            "src/**/*.tsx",
            "src/**/*.ts",
            "entry/**/*.tsx",
            "entry/**/*.ts",
            "loaders/**/*.tsx",
            "loaders/**/*.ts",
            "loaders/**/*.js",
            "src/**/*.cpp",
            "entry/**/*.cpp",
            "loaders/**/*.cpp",
            { pattern: "**/*.temp.cpp", ignore: true },
            { pattern: "**/*.temp.c", ignore: true },
            { pattern: "**/*.test.ts", ignore: true },
            { pattern: "**/*.test.tsx", ignore: true },
            { pattern: "**/*.d.ts", ignore: true },
            { pattern: "**/*.less", ignore: true },
            { pattern: "**/openssl/**", ignore: true },
        ],
        tests: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
        ],

        compilers: {
            "**/*.ts?(x)": wallaby.compilers.typeScript({
                module: "commonjs"
            }),
        },

        maxConsoleMessagesPerTest: 1000 * 100,
        
        env: {
            type: "node",
            kind: "electron",
        },

        workers: {
            // Ugh... some of our tracking to verify our delta code isn't just accessing everything, uses global state.
            //  So... we have to run our tests sequentially.
            initial: 1,
            regular: 1,
            restart: false
        },

        // https://wallabyjs.com/docs/integration/overview.html#supported-testing-frameworks
        testFramework: "jasmine",

        hints: {
            ignoreCoverage: /(ignore|exclude) coverage/
        },
        setup: function() {
            let g = Function('return this')();
            g["TEST"] = true;
            g["NODE_CONSTANT"] = true;
            g["NODE"] = true;
        }
    };
};