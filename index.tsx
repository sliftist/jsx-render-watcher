import * as preact from "preact";
import * as React from "react";
import * as ReactDOM from "react-dom";


import { TestMain } from "./src/test";
import { MountVanillaComponents } from "./src/mount2Vanilla";
import { arrayDelta, KeyDeltaChanges } from "./src/delta";
import { keyBy } from "./src/lib/misc";

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


let count = 1000 * 1;
let sparseCount = 1000 * 10;
let libs = [
    { name: "react", renderLib: React, mountLib: ReactDOM },
    { name: "preact", renderLib: preact, mountLib: preact },
    { name: "mount", renderLib: preact, mountLib: {
        render(jsx: JSX.Element, node: HTMLElement) {
            MountVanillaComponents(
                jsx,
                node,
                false
            );
        }
    } },
];

setTimeout(async function() {
    runTestSparseDom();

    /*
    console.group("no keys");
    await runTest(false);
    console.groupEnd();

    console.group("keys");
    await runTest(true);
    console.groupEnd();
    */
}, 1000);


async function runTestHarness(
    code: (config: {
        renderLib: any;
        mountLib: any;
        root: HTMLElement;
        renderOperation: (name: string, code: () => Promise<void>|void) => Promise<void>;
    }) => Promise<void>
) {
    let htmlOutput: string[] | undefined = undefined
    for(let { name, renderLib, mountLib } of libs) {
        let root = document.body.appendChild(document.createElement("div"));

        let curOutput: string[] | undefined = undefined;
        let targetOutput: string[] = (htmlOutput || []).slice();
        if(!htmlOutput) {
            curOutput = [];
        }
        function testHTML() {
            if(curOutput) {
                curOutput.push(root.innerHTML);
            } else {
                let targetHTML = targetOutput.shift();
                if(targetHTML !== root.innerHTML) {
                    console.log(targetHTML);
                    console.log(root.innerHTML);
                    throw new Error(`HTML varied for ${name}`);
                }
            }
        }

        console.group(`Testing ${name}`);
        await code({
            renderLib,
            mountLib,
            root,
            async renderOperation(name, code) {
                let time = Date.now();
                await code();
                time = Date.now() - time;
                console.log(`${time}ms for ${name}`);

                testHTML();
            }
        });
        console.groupEnd();

        root.remove();

        if(curOutput) {
            htmlOutput = curOutput;
        }
    }
}

async function runTest(useKeys: boolean) {
    runTestHarness(async ({renderLib, mountLib, root, renderOperation}) => {
        let instance!: Component;
        class Component extends renderLib.Component<{}, {}> {
            render() {
                instance = this;
                return jsx;
            }
        }

        var jsx = (
            Array(count).fill(0).map((x, i) => (
                renderLib.createElement(
                    "div",
                    useKeys ? { key: i } : {},
                    ["key is ", i]
                )
            ))
        );

        await renderOperation("initial render", () => {
            mountLib.render(renderLib.createElement(Component, {}), root);
        });

        await renderOperation("rerender", async () => {
            let spliceStart = 5;
            let spliceCount = 10;
            jsx.splice(spliceStart, spliceCount);
            // TODO: Add arrayDelta to jsx, to test efficient rerendering
            await new Promise(resolve => instance.forceUpdate(resolve));
        });
    });
}

async function runTestSparseDom() {
    runTestHarness(async ({renderLib, mountLib, root, renderOperation}) => {
        let nestedComponentByIndex = new Map<number, NestedComponent>();
        let selectedNestedComponentIndex = -1;

        class Component extends renderLib.Component<{}, {}> {
            render() {
                return jsx;
            }
        }
        class NestedComponent extends renderLib.Component<{index: number}, {}> {
            render() {
                let { index } = this.props;
                nestedComponentByIndex.set(index, this);
                return (
                    renderLib.createElement(renderLib.Fragment, { key: "key" },
                        index === selectedNestedComponentIndex && renderLib.createElement("div", {}, "selected")
                    )
                )
            }
        }

        var jsx = (
            Array(sparseCount).fill(0).map((x, i) => (
                renderLib.createElement(
                    NestedComponent,
                    { key: i, index: i }
                )
            ))
        );

        await renderOperation("initial render", () => {
            mountLib.render(renderLib.createElement(Component, {}), root);
        });

        await renderOperation("rerender", async () => {
            selectedNestedComponentIndex = sparseCount / 2;
            await new Promise(resolve => nestedComponentByIndex.get(selectedNestedComponentIndex)?.forceUpdate(resolve));
        });
    });
}