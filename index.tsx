import * as preact from "preact";
import * as React from "react";
import * as ReactDOM from "react-dom";


import { TestMain } from "./src/test";
import { MountVanillaComponents } from "./src/mount2Vanilla";
import { arrayDelta, KeyDeltaChanges, ArrayDeltaObj, ArrayDelta, DeltaContext, GetCurArrayDelta } from "./src/delta";
import { keyBy } from "./src/lib/misc";
import { g } from "pchannel";
import { JSXNode } from "./src/mount2";
import { eye0_pure } from "./src/eye";

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


let count = 1000 * 100;
let sparseCount = 1000 * 200;

count = 100;
sparseCount = 12;

let libs = [
    //{ name: "react", renderLib: React, mountLib: ReactDOM },
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


//todonext;
// Time to test our SkipList. It is really more of summary tree, or... whatever... but... it is kind of like a skiplist...
//  Testing should be fairly easy, we can do the standard range queries (sums, counting, min, max)


//todonext;
//  Oh wait... for our index delta problem... we can just keep track of our array of changes as ranges,
//  and then apply them to a list of unchanged ranges (starting as everything). Deletes immediately collapse,
//  and insertions split unchanged ranges.
//  And then the unchanged ranges can store "original index", and just by iterating over the final range list we can
//  get "prev index". And then inverting the unchanged ranges will give us changed ranges...
// Yeah... But let's still test our SkipList, because... it could be cool?
//  - But it doesn't replace our indexTree, because it doesn't do collapsing of nodes. Although... I guess it could
//      give us index offsets at any point? Which... could be useful... although for this case it simply isn't needed,
//      unless we want to collapse changes as we are tracking them (to collapse adds/removes), because the tree
//      allows tracking of changes and finding the currentIndex efficiently, which allows new changes to be inserted.
//      However... at the end we would be left with a list of changes in prevIndex order, which.
//todonext;
// Okay... for our index delta problem... we could use it to get prevIndex of any change, allowing us to
//  keep a sorted list of changes, constantly. And then we could iterate through this list, keeping track of the
//  running curIndexOffset, and prevIndex, and then directly use those to directly generate removes, inserts, etc?
//  - Could we keep track of curIndex and prevIndex while inserting? Probably at least prevIndex, and then we could
//      find curIndex easily enough after?
//  - And moves with auxOrder would be easy to calculate, we just keep track of the values in auxStack, and then
//      take them out as we use them.
//      - Then add a TODO to support values being removed, and then added, in such a way that they don't need to be added or removed
//          anymore... it is hard, and we will probably never support it, but... if LongestSequence ever supports ranges,
//          we might do it.

setTimeout(async function() {
    //await runTest(false);
    //await runTest(true);
    //runTestSparseDom();
}, 1000 * 1);


//todonext;
// We need a sort algorithm, that can support specifications that say certain elements are already in order,
//  and then outputs the list of swaps/whatever to make the changes.


async function runTestHarness(
    name: string,
    code: (config: {
        renderLib: any;
        mountLib: any;
        root: HTMLElement;
        renderOperation: (name: string, code: () => Promise<void>|void) => Promise<void>;
    }) => Promise<void>
) {
    console.group(`Test ${name}`);
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
                    console.log("wrong", root.innerHTML);
                    console.log("right", targetHTML);
                    throw new Error(`HTML varied for ${name}`);
                }
            }
        }

        console.group(`Testing library ${name}`);
        await code({
            renderLib,
            mountLib,
            root,
            async renderOperation(name, code) {
                if(g.gc) g.gc();
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
    console.groupEnd();
}

async function runTest(useKeys: boolean) {
    await runTestHarness(`splice rerender ${useKeys ? "keys" : "no keys"}`, async ({renderLib, mountLib, root, renderOperation}) => {
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
        var jsxEye = eye0_pure(jsx);
        let contextDelta!: ArrayDelta;
        let ctx = new DeltaContext(() => {
            //GetCurArrayDelta(jsxEye);
            contextDelta = GetCurArrayDelta(jsx);
        });
        ctx.RunCode();

        await renderOperation("initial render", () => {
            let component = renderLib.createElement(Component, {});
            mountLib.render(component, root);
        });

        await renderOperation("rerender", async () => {

            let spliceCount = 2;
            let offset = 0;

            let curDelta: ArrayDelta = {
                removes: (
                    ([] as number[])
                    .concat([jsx.length - offset - 1])
                    .concat(Array(spliceCount).fill(0).map((x, i) => jsx.length - offset - spliceCount + i - 1).map(x => ~x).reverse())
                    .concat(Array(spliceCount - 1).fill(0).map((x, i) => offset + i).map(x => ~x).reverse())
                ),
                inserts: (
                    ([] as number[])
                    .concat(Array(spliceCount - 1).fill(0).map((x, i) => offset + i).map(x => ~x))
                    .concat(Array(spliceCount).fill(0).map((x, i) => jsx.length - offset - spliceCount + i - 2).map(x => ~x))
                ),
                auxOrder: (
                    ([] as number[])
                    .concat(Array(spliceCount - 1).fill(0).map((x, i) => i + spliceCount))
                    .concat([spliceCount - 1])
                    .concat(Array(spliceCount - 1).fill(0).map((x, i) => i))
                )
            };

            //debugger;
            let move1 = jsxEye.splice(-spliceCount - offset, spliceCount);
            // Remove one from that amount we reinsert, so as it shift all the indexes, to test that.
            move1.pop();
            let move2 = jsxEye.splice(offset, spliceCount, ...move1);
            jsxEye.splice(-offset, 0, ...move2);


            ctx.RunCode();
            let newDelta: ArrayDelta = contextDelta;

            /*
            if(JSON.stringify(newDelta) !== JSON.stringify(curDelta)) {
                console.log("wrong", curDelta);
                console.log("right", newDelta);
                debugger;
            }
            */
            
            let jsxTyped: ArrayDeltaObj<JSXNode> = jsx;
            //jsxTyped[arrayDelta] = () => curDelta;
            
            await new Promise(resolve => instance.forceUpdate(resolve));
        });
    });
}

async function runTestSparseDom() {
    await runTestHarness("empty dom, large vdom, then single dom addition", async ({renderLib, mountLib, root, renderOperation}) => {
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
            await new Promise(resolve => {
                nestedComponentByIndex.get(selectedNestedComponentIndex)?.forceUpdate(resolve)
            });
        });
    });
}