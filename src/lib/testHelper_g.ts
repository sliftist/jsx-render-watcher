import { g } from "pchannel";

if(!g.xit) {
    g.xit = function(){};
}
let describeStack: string[] = [];
if(!g.it) {
    let runningItCall = false;
    let queuedItCalls: {call: (describeStack: string[]) => Promise<void>; describeStack: string[]}[] = [];
    g.it = function it(name: string, code: () => Promise<void>) {
        let wrappedCode = (async (describeStack: string[]) => {
            runningItCall = true;

            let time = Date.now();

            let path = describeStack.concat(name);
            
            g.TEST = true;
            //try {
                await code();
                time = Date.now() - time;
                console.log(`Test finished, ${path.join(" ")}, took ${time.toFixed(1)}ms`);
                /*
            } catch(e) {
                console.error(`Test finished, ${path.join(" ")}`, e);
            }
            */
           g.TEST = false;

            if(runningItCall) {
                runningItCall = false;
                let nextCall = queuedItCalls.shift();
                if(!nextCall) return;
                await nextCall.call(nextCall.describeStack);
            }
        });

        if(runningItCall) {
            queuedItCalls.push({call: wrappedCode, describeStack: describeStack.slice()});
        } else {
            wrappedCode(describeStack.slice());
        }
    };
}
if(!g.xdescribe) {
    g.xdescribe = function() {};
}
if(!g.describe) {
    g.describe = function it(name: string, code: () => void) {
        if(g.ignoreTests) return;

        describeStack.push(name);
        try {
            code();
        } finally {
            describeStack.pop();
        }
    };
}