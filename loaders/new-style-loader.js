module.exports = async function(cssContents) {
    let inputPath = this.resourcePath.replace(/\\/g, "/");

    function clientLoader(cssContents, inputPath) {
        cssContents = `/* ${inputPath} */\n${cssContents}`;
        let g = new Function("return this")();
        g.styleTags = g.styleTags || Object.create(null);
        g.styleTags[inputPath] = cssContents;
        if(typeof window !== "undefined") {
            let style = document.createElement("style");
            style.innerHTML = cssContents;
            document.body.appendChild(style);
        }
    }
    return `clientLoader(${JSON.stringify(cssContents)}, ${JSON.stringify(inputPath)});\n${clientLoader.toString()}`;
};