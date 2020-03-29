import * as preact from "preact";
import * as React from "react";
import * as ReactDOM from "react-dom";


import { TestMain } from "./src/test";

export let page = (
    <html>
        <head>
            <link rel="icon" type="image/png" href="/favicon.ico" />
            <meta name="viewport" content="initial-scale=1,user-scalable=yes,width=device-width" />
            {Object.values((new Function("return this")()).styleTags || {}).map((style: any) => (
                // Have to use dangerouslySetInnerHTML, otherwise "" (quotation marks) will be escaped.
                //  It is our own CSS anyway, so this should be safe...
                <style dangerouslySetInnerHTML={{__html: style}}></style>
            ))}
        </head>
        <body>
            <div>
                {<TestMain y={5}/>}
            </div>
            <script type="application/javascript" src="./index.js" defer></script>
        </body>
    </html>
);

if(typeof window !== "undefined") {
    //preact.render(page, document);
}


let count = 1000 * 50;

/*
setTimeout(async function() {
    console.log("Count", count);
    console.log("React");
    console.log("no keys");
    await runTest(React, ReactDOM, false);
    console.log("keys");
    await runTest(React, ReactDOM, true);

    console.log("preact");
    console.log("no keys");
    await runTest(preact, preact, false);
    console.log("keys");
    await runTest(preact, preact, true);
}, 1000);
*/

async function runTest(renderLib: any, mountLib: any, useKeys: boolean) {
    let root = document.body.appendChild(document.createElement("div"));

    //     100K items
    //             no keys             keys
    // preact      400ms -> 170ms      543ms -> 15496ms
    // react       850ms -> 302ms      1189ms -> 170ms

    let jsx: any;

    let instance!: Component;
    class Component extends renderLib.Component<{}, {}> {
        render() {
            instance = this;
            return jsx;
        }
    }

    jsx = (
        Array(count).fill(0).map((x, i) => (
            renderLib.createElement(
                "div",
                useKeys ? { key: i } : {},
                i
            )
        ))
    );

    {
        let time = Date.now();
        mountLib.render(renderLib.createElement(Component, {}), root);
        time = Date.now() - time;
        console.log("initial render", root.innerHTML.length, "took", time + "ms");
    }


    {
        jsx.splice(5, 10);
        let time = Date.now();
        await new Promise(resolve => instance.forceUpdate(resolve));
        time = Date.now() - time;
        console.log("re render", root.innerHTML.length, "took", time + "ms");
    }
}